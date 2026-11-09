import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, generateId, recordAuditEvent, unscoped } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  InventoryConsumptionDetail,
  InventoryConsumptionLineInput,
  InventoryConsumptionPreview,
  InventoryConsumptionPreviewLine,
  InventoryConsumptionSummary,
  InventoryItemLedger,
  InventoryMovementRow,
  InventoryPort,
  InventoryReceiptDetail,
  InventoryReceiptSummary,
  InventoryStockFilters,
  InventoryStockRow,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';
import { InventoryLedgerService } from './inventory-ledger.service';
import { applyConsumption, type StockBalance } from './inventory-valuation.util';
import { isConstraintViolation } from '../organization/constraint-error.util';

const RECORD_RECEIPT_COMMAND_TYPE = 'inventory_receipt.record';
const REVERSE_RECEIPT_COMMAND_TYPE = 'inventory_receipt.reverse';
const RECORD_CONSUMPTION_COMMAND_TYPE = 'inventory_consumption.record';
const REVERSE_CONSUMPTION_COMMAND_TYPE = 'inventory_consumption.reverse';
const MAX_CODE_ATTEMPTS = 5;

/** A project in one of these states can no longer be charged — docs/04
 * §14's "validate ... active project", using ProjectsService's own
 * TERMINAL_STATUSES rather than a second, divergent definition. */
const TERMINAL_PROJECT_STATUSES = ['CANCELLED', 'CLOSED'];

const LEDGER_CODES = {
  inventory: 'INVENTORY',
  accountsPayable: 'ACCOUNTS_PAYABLE_VENDOR',
  openingBalanceEquity: 'OPENING_BALANCE_EQUITY',
  projectMaterialCost: 'PROJECT_MATERIAL_COST',
} as const;

/**
 * Stable, deep serialization for idempotency request hashing.
 *
 * NOT `JSON.stringify(input, Object.keys(input).sort())` — that form passes
 * the key list as JSON.stringify's *replacer allowlist*, which drops every
 * property of a nested object whose name is not in the top-level key list.
 * A payload carrying `lines: [{ quantity, unitCostAmount }]` therefore
 * serializes as `lines: [{}]`, and two requests differing only in their line
 * content hash identically — silently defeating docs/07's "same key +
 * different request hash is rejected" guard. Found by a Phase 7.2 test.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function hashRequest(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

const receiptInclude = {
  legalEntity: true,
  party: true,
  lines: { orderBy: { sequence: 'asc' }, include: { inventoryItem: { include: { unitOfMeasure: true } } } },
} satisfies Prisma.InventoryReceiptInclude;

type ReceiptRow = Prisma.InventoryReceiptGetPayload<{ include: typeof receiptInclude }>;

function toReceiptSummary(row: ReceiptRow): InventoryReceiptSummary {
  return {
    id: row.id,
    receiptNumber: row.receiptNumber,
    receiptType: row.receiptType,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    partyId: row.partyId,
    partyName: row.party?.name ?? null,
    receivedDate: toDateStr(row.receivedDate),
    invoiceChallanNumber: row.invoiceChallanNumber,
    note: row.note,
    status: row.status,
    totalValueAmount: row.totalValueAmount.toFixed(2),
    journalEntryId: row.journalEntryId,
    reversalJournalEntryId: row.reversalJournalEntryId,
    reversalReason: row.reversalReason,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

function toReceiptDetail(row: ReceiptRow): InventoryReceiptDetail {
  return {
    ...toReceiptSummary(row),
    lines: row.lines.map((l) => ({
      id: l.id,
      sequence: l.sequence,
      inventoryItemId: l.inventoryItemId,
      itemCode: l.inventoryItem.code,
      itemName: l.inventoryItem.name,
      unitOfMeasureName: l.inventoryItem.unitOfMeasure.name,
      quantity: l.quantity.toFixed(4),
      unitCostAmount: l.unitCostAmount.toFixed(4),
      lineValueAmount: l.lineValueAmount.toFixed(2),
    })),
  };
}

const consumptionInclude = {
  legalEntity: true,
  project: true,
  lines: { orderBy: { sequence: 'asc' }, include: { inventoryItem: { include: { unitOfMeasure: true } } } },
} satisfies Prisma.InventoryConsumptionInclude;

type ConsumptionRow = Prisma.InventoryConsumptionGetPayload<{ include: typeof consumptionInclude }>;

function toConsumptionSummary(row: ConsumptionRow): InventoryConsumptionSummary {
  return {
    id: row.id,
    consumptionNumber: row.consumptionNumber,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    projectId: row.projectId,
    projectName: row.project.name,
    consumedDate: toDateStr(row.consumedDate),
    note: row.note,
    status: row.status,
    totalValueAmount: row.totalValueAmount.toFixed(2),
    journalEntryId: row.journalEntryId,
    reversalJournalEntryId: row.reversalJournalEntryId,
    reversalReason: row.reversalReason,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

function toConsumptionDetail(row: ConsumptionRow): InventoryConsumptionDetail {
  return {
    ...toConsumptionSummary(row),
    lines: row.lines.map((l) => ({
      id: l.id,
      sequence: l.sequence,
      inventoryItemId: l.inventoryItemId,
      itemCode: l.inventoryItem.code,
      itemName: l.inventoryItem.name,
      unitOfMeasureName: l.inventoryItem.unitOfMeasure.name,
      quantity: l.quantity.toFixed(4),
      unitCostAmount: l.unitCostAmount.toFixed(4),
      lineValueAmount: l.lineValueAmount.toFixed(2),
    })),
  };
}

/**
 * Stock ledger reads, and the standalone (non-vendor-bill) receipt
 * (Phase 7.2, ADR-092).
 *
 * All stock *writes* go through InventoryLedgerService.recordMovement —
 * this service never touches the movement table directly, so there stays
 * exactly one code path that can advance an item's balance.
 */
@Injectable()
export class InventoryService implements InventoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
    private readonly ledger: InventoryLedgerService,
  ) {}

  // ---------------------------------------------------------------- reads

  /** On-hand quantity and value come from each item's latest movement
   * snapshot, never from replaying the ledger — docs/04:463 ("filters do
   * not independently recompute opening/closing values"). */
  async listStock(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: InventoryStockFilters;
  }): Promise<{ rows: InventoryStockRow[]; total: number; totalStockValueAmount: string }> {
    const where: Prisma.InventoryItemWhereInput = {
      organizationId: input.organizationId,
      deletedAt: null,
      isStockTracked: true,
      ...(input.filters.productCategoryId ? { productCategoryId: input.filters.productCategoryId } : {}),
      ...(input.filters.search
        ? {
            OR: [
              { name: { contains: input.filters.search, mode: 'insensitive' as const } },
              { code: { contains: input.filters.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const items = await this.prisma.client.inventoryItem.findMany({
      where,
      include: { unitOfMeasure: true, productCategory: true },
      orderBy: [{ name: 'asc' }],
    });

    const totals = await this.prisma.client.inventoryMovement.groupBy({
      by: ['inventoryItemId'],
      where: { organizationId: input.organizationId, inventoryItemId: { in: items.map((i) => i.id) } },
      _sum: { quantityIn: true, quantityOut: true },
      _max: { sequenceNumber: true },
    });
    const totalsByItem = new Map(totals.map((t) => [t.inventoryItemId, t]));

    const latestMovements = await this.prisma.client.inventoryMovement.findMany({
      where: {
        organizationId: input.organizationId,
        OR: totals.map((t) => ({ inventoryItemId: t.inventoryItemId, sequenceNumber: t._max.sequenceNumber ?? 0 })),
      },
    });
    const latestByItem = new Map(latestMovements.map((m) => [m.inventoryItemId, m]));

    let rows: InventoryStockRow[] = items.map((item) => {
      const agg = totalsByItem.get(item.id);
      const latest = latestByItem.get(item.id);
      return {
        inventoryItemId: item.id,
        code: item.code,
        name: item.name,
        unitOfMeasureName: item.unitOfMeasure.name,
        productCategoryId: item.productCategoryId,
        productCategoryName: item.productCategory?.name ?? null,
        totalQuantityIn: (agg?._sum.quantityIn ?? new Prisma.Decimal(0)).toFixed(4),
        totalQuantityOut: (agg?._sum.quantityOut ?? new Prisma.Decimal(0)).toFixed(4),
        quantityOnHand: (latest?.balanceQuantity ?? new Prisma.Decimal(0)).toFixed(4),
        stockValueAmount: (latest?.balanceValueAmount ?? new Prisma.Decimal(0)).toFixed(2),
        weightedAverageRate: (latest?.weightedAverageRate ?? new Prisma.Decimal(0)).toFixed(4),
      };
    });

    if (input.filters.inStockOnly) rows = rows.filter((r) => new Prisma.Decimal(r.quantityOnHand).greaterThan(0));

    // Summed across the whole filtered set, not just the visible page —
    // a page-scoped total would silently understate stock value.
    const totalStockValueAmount = rows
      .reduce((sum, r) => sum.plus(r.stockValueAmount), new Prisma.Decimal(0))
      .toFixed(2);

    const total = rows.length;
    const start = (input.page - 1) * input.pageSize;
    return { rows: rows.slice(start, start + input.pageSize), total, totalStockValueAmount };
  }

  async getItemLedger(input: {
    organizationId: string;
    inventoryItemId: string;
    fromDate: string | undefined;
    toDate: string | undefined;
  }): Promise<InventoryItemLedger> {
    const item = await this.prisma.client.inventoryItem.findFirst({
      where: { id: input.inventoryItemId, organizationId: input.organizationId, deletedAt: null },
      include: { unitOfMeasure: true },
    });
    if (!item) throwAppError('NOT_FOUND', 'Stock item not found.');

    const movements = await this.prisma.client.inventoryMovement.findMany({
      where: {
        organizationId: input.organizationId,
        inventoryItemId: input.inventoryItemId,
        ...(input.fromDate || input.toDate
          ? {
              movementDate: {
                ...(input.fromDate ? { gte: toDate(input.fromDate) } : {}),
                ...(input.toDate ? { lte: toDate(input.toDate) } : {}),
              },
            }
          : {}),
      },
      include: {
        vendorBillLine: { include: { vendorBill: { include: { vendor: true } } } },
        inventoryReceipt: { include: { party: true } },
        inventoryConsumption: { include: { project: true } },
      },
      orderBy: { sequenceNumber: 'asc' },
    });

    const rows: InventoryMovementRow[] = movements.map((m) => {
      const bill = m.vendorBillLine?.vendorBill ?? null;
      const receipt = m.inventoryReceipt ?? null;
      const consumption = m.inventoryConsumption ?? null;
      const sourceLabel = bill
        ? `Vendor Bill ${bill.vendorBillNumber}`
        : receipt
          ? `${receipt.receiptType === 'OPENING' ? 'Opening Stock' : 'Stock Receipt'} ${receipt.receiptNumber}`
          : consumption
            ? `${m.movementType === 'REVERSAL' ? 'Reversal of ' : ''}Consumption ${consumption.consumptionNumber} — ${consumption.project.name}`
            : m.movementType === 'REVERSAL'
              ? 'Reversal'
              : 'Consumption';
      return {
        id: m.id,
        movementType: m.movementType,
        movementDate: toDateStr(m.movementDate),
        sequenceNumber: m.sequenceNumber,
        quantityIn: m.quantityIn.toFixed(4),
        quantityOut: m.quantityOut.toFixed(4),
        unitCostAmount: m.unitCostAmount.toFixed(4),
        movementValueAmount: m.movementValueAmount.toFixed(2),
        balanceQuantity: m.balanceQuantity.toFixed(4),
        balanceValueAmount: m.balanceValueAmount.toFixed(2),
        weightedAverageRate: m.weightedAverageRate.toFixed(4),
        sourceLabel,
        vendorBillId: bill?.id ?? null,
        vendorBillNumber: bill?.vendorBillNumber ?? null,
        inventoryReceiptId: receipt?.id ?? null,
        inventoryReceiptNumber: receipt?.receiptNumber ?? null,
        inventoryConsumptionId: consumption?.id ?? null,
        inventoryConsumptionNumber: consumption?.consumptionNumber ?? null,
        projectId: consumption?.projectId ?? null,
        projectName: consumption?.project.name ?? null,
        partyName: bill?.vendor.name ?? receipt?.party?.name ?? null,
        createdAt: m.createdAt.toISOString(),
      };
    });

    // Always the item's true current position, never the filtered window's
    // closing figure — a date filter must not look like a stock change.
    const balance = await this.ledger.getBalance(input.organizationId, input.inventoryItemId);

    return {
      inventoryItemId: item.id,
      code: item.code,
      name: item.name,
      unitOfMeasureName: item.unitOfMeasure.name,
      quantityOnHand: balance.quantity.toFixed(4),
      stockValueAmount: balance.valueAmount.toFixed(2),
      weightedAverageRate: balance.weightedAverageRate.toFixed(4),
      movements: rows,
    };
  }

  async listReceipts(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: { receiptType: 'OPENING' | 'DIRECT' | undefined; status: 'POSTED' | 'REVERSED' | undefined };
  }): Promise<{ rows: InventoryReceiptSummary[]; total: number }> {
    const where: Prisma.InventoryReceiptWhereInput = {
      organizationId: input.organizationId,
      ...(input.filters.receiptType ? { receiptType: input.filters.receiptType } : {}),
      ...(input.filters.status ? { status: input.filters.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.inventoryReceipt.findMany({
        where,
        include: receiptInclude,
        orderBy: [{ receivedDate: 'desc' }, { createdAt: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.client.inventoryReceipt.count({ where }),
    ]);
    return { rows: rows.map(toReceiptSummary), total };
  }

  async getReceiptDetail(input: { organizationId: string; id: string }): Promise<InventoryReceiptDetail> {
    const row = await this.prisma.client.inventoryReceipt.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: receiptInclude,
    });
    if (!row) throwAppError('NOT_FOUND', 'Stock receipt not found.');
    return toReceiptDetail(row);
  }

  // ------------------------------------------------------------- commands

  private async generateReceiptNumber(tx: Prisma.TransactionClient, organizationId: string, attempt: number): Promise<string> {
    // Counted across the organization, every legal entity's included (ADR-172).
    const count = await unscoped(() => tx.inventoryReceipt.count({ where: { organizationId } }));
    return `STK-${String(count + 1 + attempt).padStart(6, '0')}`;
  }

  /**
   * Posts a standalone stock receipt: one journal, one movement per line,
   * all in a single transaction (docs/02's own "post inventory receipt +
   * cost entry where applicable" boundary).
   *
   * OPENING credits Opening Balance Equity — reusing ADR-071's opening-
   * balance mechanism rather than inventing a second one. DIRECT credits
   * Accounts Payable — Vendor, which is why the vendor is mandatory there
   * and forbidden on an OPENING receipt (DB CHECK-enforced too).
   */
  async recordReceipt(input: {
    organizationId: string;
    legalEntityId: string;
    receiptType: 'OPENING' | 'DIRECT';
    partyId: string | undefined;
    receivedDate: string;
    invoiceChallanNumber: string | undefined;
    note: string | undefined;
    lines: Array<{ inventoryItemId: string; quantity: string; unitCostAmount: string }>;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<InventoryReceiptSummary> {
    const requestHash = hashRequest({ ...input, idempotencyKey: undefined, actorId: undefined, correlationId: undefined });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: {
        organizationId_commandType_idempotencyKey: {
          organizationId: input.organizationId,
          commandType: RECORD_RECEIPT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) {
        throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      }
      return existingKey.resultReference as unknown as InventoryReceiptSummary;
    }

    if (input.lines.length === 0) throwAppError('VALIDATION_FAILED', 'A stock receipt needs at least one line.');
    if (input.receiptType === 'DIRECT' && !input.partyId) {
      throwAppError('VALIDATION_FAILED', 'A direct stock receipt must name the supplying vendor.');
    }
    if (input.receiptType === 'OPENING' && input.partyId) {
      throwAppError('VALIDATION_FAILED', 'An opening stock receipt has no vendor — it is credited to opening balance equity.');
    }

    const legalEntity = await this.prisma.client.legalEntity.findFirst({
      where: { id: input.legalEntityId, organizationId: input.organizationId },
    });
    if (!legalEntity) throwAppError('NOT_FOUND', 'Legal entity not found.');

    if (input.partyId) {
      const party = await this.prisma.client.party.findFirst({
        where: { id: input.partyId, organizationId: input.organizationId },
      });
      if (!party) throwAppError('NOT_FOUND', 'Vendor not found.');
    }

    const itemIds = [...new Set(input.lines.map((l) => l.inventoryItemId))];
    const items = await this.prisma.client.inventoryItem.findMany({
      where: { id: { in: itemIds }, organizationId: input.organizationId, deletedAt: null },
    });
    if (items.length !== itemIds.length) throwAppError('NOT_FOUND', 'One or more stock items were not found.');
    const inactive = items.find((i) => !i.isActive);
    if (inactive) throwAppError('VALIDATION_FAILED', `Item "${inactive.name}" is inactive.`);
    const nonStock = items.find((i) => !i.isStockTracked);
    if (nonStock) throwAppError('VALIDATION_FAILED', `"${nonStock.name}" is not a stock-tracked item.`);

    const computedLines = input.lines.map((line, index) => {
      const quantity = new Prisma.Decimal(line.quantity);
      const unitCostAmount = new Prisma.Decimal(line.unitCostAmount);
      if (!quantity.greaterThan(0)) throwAppError('VALIDATION_FAILED', `Line ${index + 1}: quantity must be greater than zero.`);
      if (unitCostAmount.isNegative()) throwAppError('VALIDATION_FAILED', `Line ${index + 1}: unit cost cannot be negative.`);
      return { ...line, sequence: index + 1, quantity, unitCostAmount, lineValueAmount: quantity.times(unitCostAmount).toDecimalPlaces(2) };
    });
    const totalValueAmount = computedLines.reduce((sum, l) => sum.plus(l.lineValueAmount), new Prisma.Decimal(0));
    if (!totalValueAmount.greaterThan(0)) {
      throwAppError('VALIDATION_FAILED', 'A stock receipt must carry a value greater than zero.');
    }

    // Chronology is checked here, BEFORE the journal is posted, not only
    // inside recordMovement. PostingService opens its own transaction and
    // cannot join the one below, so a rejection discovered inside that
    // transaction would roll back the receipt while leaving the journal
    // posted — an Inventory debit with no stock behind it. Caught by this
    // slice's own reconciliation test, which is exactly what it is for.
    for (const line of input.lines) {
      await this.ledger.assertCanAcceptMovementOn(input.organizationId, line.inventoryItemId, toDate(input.receivedDate));
    }

    const ledgerAccounts = await this.prisma.client.ledgerAccount.findMany({
      where: { organizationId: input.organizationId, code: { in: Object.values(LEDGER_CODES) } },
    });
    const byCode = new Map(ledgerAccounts.map((a) => [a.code, a]));
    const inventoryAccount = byCode.get(LEDGER_CODES.inventory);
    if (!inventoryAccount) throwAppError('VALIDATION_FAILED', 'Inventory ledger account is not configured.');
    const creditCode = input.receiptType === 'OPENING' ? LEDGER_CODES.openingBalanceEquity : LEDGER_CODES.accountsPayable;
    const creditAccount = byCode.get(creditCode);
    if (!creditAccount) throwAppError('VALIDATION_FAILED', `Ledger account ${creditCode} is not configured.`);

    const receiptId = generateId();
    const journal = await this.posting.postJournal({
      organizationId: input.organizationId,
      legalEntityId: input.legalEntityId,
      accountingDate: input.receivedDate,
      sourceType: 'inventory_receipt',
      sourceId: receiptId,
      postingEvent: 'inventory_receipt.posted',
      description: `Stock receipt (${input.receiptType === 'OPENING' ? 'opening' : 'direct'})`,
      lines: [
        {
          ledgerAccountId: inventoryAccount.id,
          debit: totalValueAmount.toFixed(2),
          credit: '0',
          projectId: undefined,
          partyId: input.partyId,
          employeeId: undefined,
          gstRegistrationId: undefined,
          taxCode: undefined,
          narrative: undefined,
        },
        {
          ledgerAccountId: creditAccount.id,
          debit: '0',
          credit: totalValueAmount.toFixed(2),
          projectId: undefined,
          partyId: input.partyId,
          employeeId: undefined,
          gstRegistrationId: undefined,
          taxCode: undefined,
          narrative: undefined,
        },
      ],
      idempotencyKey: `${RECORD_RECEIPT_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          const receiptNumber = await this.generateReceiptNumber(tx, input.organizationId, attempt);
          await tx.inventoryReceipt.create({
            data: {
              id: receiptId,
              organizationId: input.organizationId,
              legalEntityId: input.legalEntityId,
              receiptNumber,
              receiptType: input.receiptType,
              partyId: input.partyId ?? null,
              receivedDate: toDate(input.receivedDate),
              invoiceChallanNumber: input.invoiceChallanNumber ?? null,
              note: input.note ?? null,
              status: 'POSTED',
              totalValueAmount,
              journalEntryId: journal.id,
              createdBy: input.actorId,
            },
          });

          await tx.inventoryReceiptLine.createMany({
            data: computedLines.map((l) => ({
              id: generateId(),
              organizationId: input.organizationId,
              inventoryReceiptId: receiptId,
              inventoryItemId: l.inventoryItemId,
              sequence: l.sequence,
              quantity: l.quantity,
              unitCostAmount: l.unitCostAmount,
              lineValueAmount: l.lineValueAmount,
            })),
          });

          for (const line of computedLines) {
            await this.ledger.recordMovement(tx, {
              organizationId: input.organizationId,
              inventoryItemId: line.inventoryItemId,
              movementType: input.receiptType === 'OPENING' ? 'OPENING' : 'RECEIPT',
              movementDate: toDate(input.receivedDate),
              quantityIn: line.quantity,
              unitCost: line.unitCostAmount,
              inventoryReceiptId: receiptId,
              actorId: input.actorId,
            });
          }

          await recordAuditEvent(tx, {
            organizationId: input.organizationId,
            legalEntityId: input.legalEntityId,
            entityType: 'INVENTORY_RECEIPT',
            entityId: receiptId,
            action: 'INVENTORY_RECEIPT_POSTED',
            actorId: input.actorId,
            correlationId: input.correlationId,
            newValues: { receiptNumber, receiptType: input.receiptType, totalValueAmount: totalValueAmount.toFixed(2), journalEntryId: journal.id },
          });

          const created = await tx.inventoryReceipt.findFirstOrThrow({ where: { id: receiptId }, include: receiptInclude });
          const summary = toReceiptSummary(created);

          await tx.idempotencyKey.create({
            data: {
              id: generateId(),
              organizationId: input.organizationId,
              commandType: RECORD_RECEIPT_COMMAND_TYPE,
              idempotencyKey: input.idempotencyKey,
              requestHash,
              sourceRecordType: 'INVENTORY_RECEIPT',
              sourceRecordId: receiptId,
              resultReference: summary as unknown as Prisma.InputJsonValue,
            },
          });

          return summary;
        });
      } catch (error) {
        if (isConstraintViolation(error) && attempt < MAX_CODE_ATTEMPTS - 1) continue;
        throw error;
      }
    }
    return throwAppError('VALIDATION_FAILED', 'Could not record the stock receipt due to a conflict. Please try again.');
  }

  /**
   * Reverses a posted receipt: reverses its journal and issues the received
   * quantity back out of stock.
   *
   * Refused once any of that stock has been consumed. Taking it back out
   * would have to invent a cost for units that are already gone, and would
   * drive the balance negative — the correct correction there is a
   * consumption reversal first, then this. Same posture as voiding a
   * finalized vendor bill.
   */
  async reverseReceipt(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<InventoryReceiptSummary> {
    if (!input.reason.trim()) throwAppError('VALIDATION_FAILED', 'A reason is required to reverse a stock receipt.');

    const requestHash = hashRequest({ id: input.id, reason: input.reason, accountingDate: input.accountingDate });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: {
        organizationId_commandType_idempotencyKey: {
          organizationId: input.organizationId,
          commandType: REVERSE_RECEIPT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) {
        throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      }
      return existingKey.resultReference as unknown as InventoryReceiptSummary;
    }

    const receipt = await this.prisma.client.inventoryReceipt.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: receiptInclude,
    });
    if (!receipt) throwAppError('NOT_FOUND', 'Stock receipt not found.');
    if (receipt.status !== 'POSTED') throwAppError('INVALID_STATE_TRANSITION', 'This stock receipt is already reversed.');

    // Checked before any write: every received line must still be fully on
    // hand, or the reversal cannot be valued honestly.
    for (const line of receipt.lines) {
      const balance = await this.ledger.getBalance(input.organizationId, line.inventoryItemId);
      if (balance.quantity.lessThan(line.quantity)) {
        throwAppError(
          'VALIDATION_FAILED',
          `"${line.inventoryItem.name}" has only ${balance.quantity.toFixed(4)} on hand but this receipt brought in ${line.quantity.toFixed(4)} — reverse the later consumption first.`,
        );
      }
    }

    const reversalJournal = await this.posting.reverseJournal({
      organizationId: input.organizationId,
      id: receipt.journalEntryId,
      accountingDate: input.accountingDate,
      reason: input.reason,
      idempotencyKey: `${REVERSE_RECEIPT_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.inventoryReceipt.updateMany({
        where: { id: receipt.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'POSTED' },
        data: {
          status: 'REVERSED',
          reversalJournalEntryId: reversalJournal.id,
          reversedAt: new Date(),
          reversedBy: input.actorId,
          reversalReason: input.reason,
          updatedBy: input.actorId,
          version: { increment: 1 },
        },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This stock receipt was changed by someone else. Reload and try again.');

      for (const line of receipt.lines) {
        await this.ledger.recordMovement(tx, {
          organizationId: input.organizationId,
          inventoryItemId: line.inventoryItemId,
          movementType: 'REVERSAL',
          movementDate: toDate(input.accountingDate),
          quantityOut: line.quantity,
          inventoryReceiptId: receipt.id,
          actorId: input.actorId,
        });
      }

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: receipt.legalEntityId,
        entityType: 'INVENTORY_RECEIPT',
        entityId: receipt.id,
        action: 'INVENTORY_RECEIPT_REVERSED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        reason: input.reason,
        newValues: { reversalJournalEntryId: reversalJournal.id },
      });

      const updated = await tx.inventoryReceipt.findFirstOrThrow({ where: { id: receipt.id }, include: receiptInclude });
      const summary = toReceiptSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: REVERSE_RECEIPT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'INVENTORY_RECEIPT',
          sourceRecordId: receipt.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  // ------------------------------------------------- consumption (7.3)

  async listConsumptions(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: { projectId: string | undefined; status: 'POSTED' | 'REVERSED' | undefined };
  }): Promise<{ rows: InventoryConsumptionSummary[]; total: number }> {
    const where: Prisma.InventoryConsumptionWhereInput = {
      organizationId: input.organizationId,
      ...(input.filters.projectId ? { projectId: input.filters.projectId } : {}),
      ...(input.filters.status ? { status: input.filters.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.inventoryConsumption.findMany({
        where,
        include: consumptionInclude,
        orderBy: [{ consumedDate: 'desc' }, { createdAt: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.client.inventoryConsumption.count({ where }),
    ]);
    return { rows: rows.map(toConsumptionSummary), total };
  }

  async getConsumptionDetail(input: { organizationId: string; id: string }): Promise<InventoryConsumptionDetail> {
    const row = await this.prisma.client.inventoryConsumption.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: consumptionInclude,
    });
    if (!row) throwAppError('NOT_FOUND', 'Stock consumption not found.');
    return toConsumptionDetail(row);
  }

  /**
   * Collapses repeated lines for the same item into one running balance.
   *
   * Two lines naming the same item are not independent: the second is
   * issued out of what the first left behind, and — critically — it is the
   * SECOND one that may trigger full depletion and carry out the residual
   * value. Valuing them independently against the opening balance would
   * both over-issue and strand paise. Shared by `previewConsumption` and
   * `recordConsumption` so the quoted figure and the posted figure are
   * produced by the same code, not two lookalike implementations.
   */
  private computeConsumptionLines(
    lines: Array<{ inventoryItemId: string; quantity: Prisma.Decimal }>,
    balances: Map<string, StockBalance>,
    names: Map<string, string>,
  ): { valued: Array<{ inventoryItemId: string; quantity: Prisma.Decimal; unitCostAmount: Prisma.Decimal; lineValueAmount: Prisma.Decimal }>; errors: Map<number, string> } {
    const running = new Map<string, StockBalance>(balances);
    const valued: Array<{ inventoryItemId: string; quantity: Prisma.Decimal; unitCostAmount: Prisma.Decimal; lineValueAmount: Prisma.Decimal }> = [];
    const errors = new Map<number, string>();

    lines.forEach((line, index) => {
      const current = running.get(line.inventoryItemId);
      if (!current) {
        errors.set(index, 'Stock item not found.');
        return;
      }
      try {
        const result = applyConsumption(current, line.quantity);
        running.set(line.inventoryItemId, result.balance);
        valued.push({
          inventoryItemId: line.inventoryItemId,
          quantity: line.quantity,
          unitCostAmount: result.unitCostAmount,
          lineValueAmount: result.movementValueAmount,
        });
      } catch (error) {
        // applyConsumption's own message already names both figures; it is
        // surfaced per line rather than aborting, so the entry screen can
        // show every shortfall at once instead of one per round-trip.
        const name = names.get(line.inventoryItemId) ?? 'This item';
        errors.set(index, `${name}: ${error instanceof Error ? error.message : 'cannot be issued.'}`);
      }
    });

    return { valued, errors };
  }

  /**
   * What this consumption would cost if posted right now.
   *
   * Read-only and explicitly a quote, not a reservation: the authoritative
   * figure is re-derived under each item's row lock inside
   * `recordConsumption`, and a receipt landing in between will legitimately
   * move the weighted average. It exists so the entry screen never does
   * valuation arithmetic of its own (CLAUDE.md: "do not calculate
   * accounting totals independently in React components").
   */
  async previewConsumption(input: {
    organizationId: string;
    lines: InventoryConsumptionLineInput[];
  }): Promise<InventoryConsumptionPreview> {
    if (input.lines.length === 0) return { lines: [], totalValueAmount: '0.00', isPostable: false };

    const itemIds = [...new Set(input.lines.map((l) => l.inventoryItemId))];
    const items = await this.prisma.client.inventoryItem.findMany({
      where: { id: { in: itemIds }, organizationId: input.organizationId, deletedAt: null },
      include: { unitOfMeasure: true },
    });
    const itemById = new Map(items.map((i) => [i.id, i]));

    const balances = new Map<string, StockBalance>();
    for (const id of itemIds) {
      if (!itemById.has(id)) continue;
      balances.set(id, await this.ledger.getBalance(input.organizationId, id));
    }

    const parsed = input.lines.map((l) => ({ inventoryItemId: l.inventoryItemId, quantity: new Prisma.Decimal(l.quantity) }));
    const names = new Map(items.map((i) => [i.id, i.name]));
    const { errors } = this.computeConsumptionLines(parsed, balances, names);

    // Re-walk in order so every input line gets a row back, valued or not —
    // the screen needs one row per line it sent, in the order it sent them.
    const running = new Map<string, StockBalance>(balances);
    const rows: InventoryConsumptionPreviewLine[] = parsed.map((line, index) => {
      const item = itemById.get(line.inventoryItemId);
      const current = running.get(line.inventoryItemId);
      const shortfallMessage = errors.get(index) ?? null;
      let unitCostAmount = new Prisma.Decimal(0);
      let lineValueAmount = new Prisma.Decimal(0);
      if (current && !shortfallMessage) {
        const result = applyConsumption(current, line.quantity);
        running.set(line.inventoryItemId, result.balance);
        unitCostAmount = result.unitCostAmount;
        lineValueAmount = result.movementValueAmount;
      }
      return {
        inventoryItemId: line.inventoryItemId,
        itemName: item?.name ?? 'Unknown item',
        unitOfMeasureName: item?.unitOfMeasure.name ?? '',
        quantity: line.quantity.toFixed(4),
        quantityOnHand: (balances.get(line.inventoryItemId)?.quantity ?? new Prisma.Decimal(0)).toFixed(4),
        weightedAverageRate: unitCostAmount.toFixed(4),
        lineValueAmount: lineValueAmount.toFixed(2),
        shortfallMessage,
      };
    });

    const totalValueAmount = rows.reduce((sum, r) => sum.plus(r.lineValueAmount), new Prisma.Decimal(0)).toFixed(2);
    return { lines: rows, totalValueAmount, isPostable: errors.size === 0 && rows.length > 0 };
  }

  private async generateConsumptionNumber(tx: Prisma.TransactionClient, organizationId: string, attempt: number): Promise<string> {
    // Counted across the organization, every legal entity's included (ADR-172).
    const count = await unscoped(() => tx.inventoryConsumption.count({ where: { organizationId } }));
    return `CONS-${String(count + 1 + attempt).padStart(6, '0')}`;
  }

  /**
   * Issues stock to a project: Dr Project Material Cost / Cr Inventory at
   * the ruling weighted average (docs/06, "Inventory / Project consumption").
   *
   * Unlike every other posting caller in this codebase, the journal is
   * posted INSIDE the transaction, via `postJournalWithin` (ADR-093). It
   * has to be: the amount posted IS the weighted average read under the
   * item's `FOR UPDATE` lock, and full depletion carries out the entire
   * residual balance rather than quantity x rate. Posting first and writing
   * second — the pattern the receipt path uses, where the amount is known
   * up front — would have to guess that figure, and a concurrent receipt
   * landing in between would leave an Inventory credit the movement
   * disagrees with, silently breaking Phase 7's own "inventory movement
   * reconciles to stock value" exit criterion.
   *
   * Items are locked in sorted id order so two concurrent multi-item
   * consumptions can never deadlock against each other.
   */
  async recordConsumption(input: {
    organizationId: string;
    legalEntityId: string;
    projectId: string;
    consumedDate: string;
    note: string | undefined;
    lines: InventoryConsumptionLineInput[];
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<InventoryConsumptionSummary> {
    const requestHash = hashRequest({ ...input, idempotencyKey: undefined, actorId: undefined, correlationId: undefined });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: {
        organizationId_commandType_idempotencyKey: {
          organizationId: input.organizationId,
          commandType: RECORD_CONSUMPTION_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) {
        throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      }
      return existingKey.resultReference as unknown as InventoryConsumptionSummary;
    }

    if (input.lines.length === 0) throwAppError('VALIDATION_FAILED', 'A stock consumption needs at least one line.');

    const project = await this.prisma.client.project.findFirst({
      where: { id: input.projectId, organizationId: input.organizationId },
    });
    if (!project) throwAppError('NOT_FOUND', 'Project not found.');
    if (TERMINAL_PROJECT_STATUSES.includes(project.operationalStatus)) {
      throwAppError('VALIDATION_FAILED', `Project "${project.name}" is ${project.operationalStatus.toLowerCase()} and can no longer be charged.`);
    }
    // The consumption posts against the project's own legal entity, never a
    // separately chosen one — the cost belongs to the entity that owns the
    // project, and allowing the two to diverge would put a project's
    // material cost in another entity's books.
    if (input.legalEntityId !== project.legalEntityId) {
      throwAppError('VALIDATION_FAILED', "A consumption must be posted in the project's own legal entity.");
    }

    const itemIds = [...new Set(input.lines.map((l) => l.inventoryItemId))];
    const items = await this.prisma.client.inventoryItem.findMany({
      where: { id: { in: itemIds }, organizationId: input.organizationId, deletedAt: null },
    });
    if (items.length !== itemIds.length) throwAppError('NOT_FOUND', 'One or more stock items were not found.');
    const inactive = items.find((i) => !i.isActive);
    if (inactive) throwAppError('VALIDATION_FAILED', `Item "${inactive.name}" is inactive.`);
    const nonStock = items.find((i) => !i.isStockTracked);
    if (nonStock) throwAppError('VALIDATION_FAILED', `"${nonStock.name}" is not a stock-tracked item.`);

    const parsed = input.lines.map((line, index) => {
      const quantity = new Prisma.Decimal(line.quantity);
      if (!quantity.greaterThan(0)) throwAppError('VALIDATION_FAILED', `Line ${index + 1}: quantity must be greater than zero.`);
      return { inventoryItemId: line.inventoryItemId, quantity };
    });

    // Chronology is a pre-flight here too — not because a journal is
    // already posted (it is not, in this path), but so the caller gets the
    // real reason rather than a bare transaction rollback.
    for (const id of itemIds) {
      await this.ledger.assertCanAcceptMovementOn(input.organizationId, id, toDate(input.consumedDate));
    }

    const ledgerAccounts = await this.prisma.client.ledgerAccount.findMany({
      where: { organizationId: input.organizationId, code: { in: [LEDGER_CODES.inventory, LEDGER_CODES.projectMaterialCost] } },
    });
    const byCode = new Map(ledgerAccounts.map((a) => [a.code, a]));
    const inventoryAccount = byCode.get(LEDGER_CODES.inventory);
    if (!inventoryAccount) throwAppError('VALIDATION_FAILED', 'Inventory ledger account is not configured.');
    const materialCostAccount = byCode.get(LEDGER_CODES.projectMaterialCost);
    if (!materialCostAccount) throwAppError('VALIDATION_FAILED', 'Project Material Cost ledger account is not configured.');

    const consumptionId = generateId();
    const names = new Map(items.map((i) => [i.id, i.name]));
    const sortedItemIds = [...itemIds].sort();

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          // Locks first, in a deterministic order, and the balances they
          // protect. Everything below is computed from these figures.
          const balances = new Map<string, StockBalance>();
          for (const id of sortedItemIds) {
            balances.set(id, (await this.ledger.lockAndGetBalance(tx, input.organizationId, id)).balance);
          }

          const { valued, errors } = this.computeConsumptionLines(parsed, balances, names);
          if (errors.size > 0) throwAppError('VALIDATION_FAILED', [...errors.values()].join(' '));

          const computedLines = valued.map((v, index) => ({ ...v, sequence: index + 1 }));
          const totalValueAmount = computedLines.reduce((sum, l) => sum.plus(l.lineValueAmount), new Prisma.Decimal(0));
          if (!totalValueAmount.greaterThan(0)) {
            throwAppError('VALIDATION_FAILED', 'This consumption carries no value — the items on hand are valued at zero.');
          }

          const journal = await this.posting.postJournalWithin(tx, {
            organizationId: input.organizationId,
            legalEntityId: input.legalEntityId,
            accountingDate: input.consumedDate,
            sourceType: 'inventory_consumption',
            sourceId: consumptionId,
            postingEvent: 'inventory_consumption.posted',
            description: `Stock issued to ${project.name}`,
            lines: [
              {
                ledgerAccountId: materialCostAccount.id,
                debit: totalValueAmount.toFixed(2),
                credit: '0',
                projectId: input.projectId,
                partyId: undefined,
                employeeId: undefined,
                gstRegistrationId: undefined,
                taxCode: undefined,
                narrative: undefined,
              },
              {
                ledgerAccountId: inventoryAccount.id,
                debit: '0',
                credit: totalValueAmount.toFixed(2),
                projectId: input.projectId,
                partyId: undefined,
                employeeId: undefined,
                gstRegistrationId: undefined,
                taxCode: undefined,
                narrative: undefined,
              },
            ],
            idempotencyKey: `${RECORD_CONSUMPTION_COMMAND_TYPE}:${input.idempotencyKey}`,
            actorId: input.actorId,
            correlationId: input.correlationId,
          });

          const consumptionNumber = await this.generateConsumptionNumber(tx, input.organizationId, attempt);
          await tx.inventoryConsumption.create({
            data: {
              id: consumptionId,
              organizationId: input.organizationId,
              legalEntityId: input.legalEntityId,
              consumptionNumber,
              projectId: input.projectId,
              consumedDate: toDate(input.consumedDate),
              note: input.note ?? null,
              status: 'POSTED',
              totalValueAmount,
              journalEntryId: journal.id,
              createdBy: input.actorId,
            },
          });

          await tx.inventoryConsumptionLine.createMany({
            data: computedLines.map((l) => ({
              id: generateId(),
              organizationId: input.organizationId,
              inventoryConsumptionId: consumptionId,
              inventoryItemId: l.inventoryItemId,
              sequence: l.sequence,
              quantity: l.quantity,
              unitCostAmount: l.unitCostAmount,
              lineValueAmount: l.lineValueAmount,
            })),
          });

          // The movements re-derive their own value from the same locked
          // balances, so each must reproduce the line exactly. Asserting it
          // rather than assuming it is what keeps the INVENTORY account and
          // the stock ledger provably equal.
          let movedTotal = new Prisma.Decimal(0);
          for (const line of computedLines) {
            const movement = await this.ledger.recordMovement(tx, {
              organizationId: input.organizationId,
              inventoryItemId: line.inventoryItemId,
              movementType: 'CONSUMPTION',
              movementDate: toDate(input.consumedDate),
              quantityOut: line.quantity,
              inventoryConsumptionId: consumptionId,
              actorId: input.actorId,
            });
            movedTotal = movedTotal.plus(movement.movementValueAmount);
          }
          if (!movedTotal.equals(totalValueAmount)) {
            throwAppError(
              'VALIDATION_FAILED',
              `Stock movement value ${movedTotal.toFixed(2)} does not match the posted ${totalValueAmount.toFixed(2)}. Nothing was saved.`,
            );
          }

          await recordAuditEvent(tx, {
            organizationId: input.organizationId,
            legalEntityId: input.legalEntityId,
            entityType: 'INVENTORY_CONSUMPTION',
            entityId: consumptionId,
            action: 'INVENTORY_CONSUMPTION_POSTED',
            actorId: input.actorId,
            correlationId: input.correlationId,
            newValues: {
              consumptionNumber,
              projectId: input.projectId,
              totalValueAmount: totalValueAmount.toFixed(2),
              journalEntryId: journal.id,
            },
          });

          const created = await tx.inventoryConsumption.findFirstOrThrow({ where: { id: consumptionId }, include: consumptionInclude });
          const summary = toConsumptionSummary(created);

          await tx.idempotencyKey.create({
            data: {
              id: generateId(),
              organizationId: input.organizationId,
              commandType: RECORD_CONSUMPTION_COMMAND_TYPE,
              idempotencyKey: input.idempotencyKey,
              requestHash,
              sourceRecordType: 'INVENTORY_CONSUMPTION',
              sourceRecordId: consumptionId,
              resultReference: summary as unknown as Prisma.InputJsonValue,
            },
          });

          return summary;
        });
      } catch (error) {
        if (isConstraintViolation(error) && attempt < MAX_CODE_ATTEMPTS - 1) continue;
        throw error;
      }
    }
    return throwAppError('VALIDATION_FAILED', 'Could not record the stock consumption due to a conflict. Please try again.');
  }

  /**
   * Reverses a posted consumption: reverses its journal and puts the stock
   * back at the cost it left at.
   *
   * The returned units are valued at each line's OWN stored unitCostAmount,
   * not at today's weighted average. Any other choice would silently change
   * the total value of stock on hand: the reversal must be the exact
   * mirror of what left, or the ledger stops reconciling to the INVENTORY
   * account — which is the whole point of the stamped line cost.
   */
  async reverseConsumption(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<InventoryConsumptionSummary> {
    if (!input.reason.trim()) throwAppError('VALIDATION_FAILED', 'A reason is required to reverse a stock consumption.');

    const requestHash = hashRequest({ id: input.id, reason: input.reason, accountingDate: input.accountingDate });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: {
        organizationId_commandType_idempotencyKey: {
          organizationId: input.organizationId,
          commandType: REVERSE_CONSUMPTION_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) {
        throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      }
      return existingKey.resultReference as unknown as InventoryConsumptionSummary;
    }

    const consumption = await this.prisma.client.inventoryConsumption.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: consumptionInclude,
    });
    if (!consumption) throwAppError('NOT_FOUND', 'Stock consumption not found.');
    if (consumption.status !== 'POSTED') throwAppError('INVALID_STATE_TRANSITION', 'This stock consumption is already reversed.');

    for (const line of consumption.lines) {
      await this.ledger.assertCanAcceptMovementOn(input.organizationId, line.inventoryItemId, toDate(input.accountingDate));
    }

    const reversalJournal = await this.posting.reverseJournal({
      organizationId: input.organizationId,
      id: consumption.journalEntryId,
      accountingDate: input.accountingDate,
      reason: input.reason,
      idempotencyKey: `${REVERSE_CONSUMPTION_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.inventoryConsumption.updateMany({
        where: { id: consumption.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'POSTED' },
        data: {
          status: 'REVERSED',
          reversalJournalEntryId: reversalJournal.id,
          reversedAt: new Date(),
          reversedBy: input.actorId,
          reversalReason: input.reason,
          updatedBy: input.actorId,
          version: { increment: 1 },
        },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This stock consumption was changed by someone else. Reload and try again.');

      for (const line of consumption.lines) {
        await this.ledger.recordMovement(tx, {
          organizationId: input.organizationId,
          inventoryItemId: line.inventoryItemId,
          movementType: 'REVERSAL',
          movementDate: toDate(input.accountingDate),
          quantityIn: line.quantity,
          unitCost: line.unitCostAmount,
          inventoryConsumptionId: consumption.id,
          actorId: input.actorId,
        });
      }

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: consumption.legalEntityId,
        entityType: 'INVENTORY_CONSUMPTION',
        entityId: consumption.id,
        action: 'INVENTORY_CONSUMPTION_REVERSED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        reason: input.reason,
        newValues: { reversalJournalEntryId: reversalJournal.id },
      });

      const updated = await tx.inventoryConsumption.findFirstOrThrow({ where: { id: consumption.id }, include: consumptionInclude });
      const summary = toConsumptionSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: REVERSE_CONSUMPTION_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'INVENTORY_CONSUMPTION',
          sourceRecordId: consumption.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }
}
