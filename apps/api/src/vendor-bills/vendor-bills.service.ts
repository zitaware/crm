import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  VendorBillPort,
  VendorBillPriority,
  VendorBillSummary,
  VendorBillDetail,
  VendorBillFilters,
  VendorBillLineInput,
  VendorBillLinesPreview,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryLedgerService } from '../inventory/inventory-ledger.service';
import { PostingService } from '../accounting/posting.service';
import { ProjectsService } from '../projects/projects.service';
import { computeLines, type ComputedLine } from '../invoices/invoices.service';

const CREATE_DRAFT_COMMAND_TYPE = 'vendor_bill.create_draft';
const SUBMIT_COMMAND_TYPE = 'vendor_bill.submit';
const APPROVE_COMMAND_TYPE = 'vendor_bill.approve';
const REJECT_COMMAND_TYPE = 'vendor_bill.reject';
const CANCEL_COMMAND_TYPE = 'vendor_bill.cancel';
const VOID_COMMAND_TYPE = 'vendor_bill.void';
const TERMINAL_PROJECT_STATUSES = new Set(['CANCELLED', 'CLOSED']);
const OPEN_STATUSES = new Set(['DRAFT', 'SUBMITTED']);

/** docs/06 "Finalize vendor bill for expense": Dr Expense (grouped by the
 * resolved ExpenseCategory ledger account, ITC-ineligible GST folded in) +
 * Dr Input {C/S/I}GST Receivable (eligible only) — Cr Accounts Payable —
 * Vendor. */
const LEDGER_CODES = {
  accountsPayable: 'ACCOUNTS_PAYABLE_VENDOR',
  inputCgst: 'INPUT_CGST_RECEIVABLE',
  inputSgst: 'INPUT_SGST_RECEIVABLE',
  inputIgst: 'INPUT_IGST_RECEIVABLE',
  defaultExpense: 'OTHER_EXPENSES',
  /** Phase 7.2 (ADR-092): a stock line debits Inventory instead of an
   * expense account -- docs/06's "Finalize vendor bill for inventory".
   */
  inventory: 'INVENTORY',
} as const;

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Prisma requires a full ISO-8601 DateTime (or a Date instance) for
 * @db.Date columns — a bare 'YYYY-MM-DD' string is rejected. Same local
 * helper as invoices.service.ts/posting.service.ts. */
function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** Same shallow-sorted-keys sha256 shape as hashRequest in every prior
 * slice's own service — reimplemented locally per that established
 * precedent. */
function hashRequest(input: unknown): string {
  const normalized = JSON.stringify(input, Object.keys(input as object).sort());
  return createHash('sha256').update(normalized).digest('hex');
}

const summaryInclude = {
  project: true,
  vendor: true,
  legalEntity: true,
  gstRegistration: true,
} satisfies Prisma.VendorBillInclude;

const detailInclude = {
  ...summaryInclude,
  lines: { orderBy: { sequence: 'asc' }, include: { expenseCategory: true, unitOfMeasure: true, inventoryItem: true } },
  decisions: { orderBy: { decidedAt: 'desc' } },
} satisfies Prisma.VendorBillInclude;

type SummaryRow = Prisma.VendorBillGetPayload<{ include: typeof summaryInclude }>;
type DetailRow = Prisma.VendorBillGetPayload<{ include: typeof detailInclude }>;

/**
 * ADR-178: a bill's own GST amount, as printed on it, split the way it was
 * charged (half CGST and half SGST within the state, else IGST), instead of
 * the rate's rounding. The stored rate is the one that amount works out to.
 */
export function withStatedGst(
  lines: ComputedLine[],
  stated: Array<{ gstAmount?: string | undefined; gstSplit?: 'CGST_SGST' | 'IGST' | undefined }>,
  vendorInSameState: boolean,
): ComputedLine[] {
  return lines.map((line, index) => {
    const statedGst = stated[index]?.gstAmount;
    if (statedGst === undefined) return line;
    // The importer may say how it was charged; otherwise the vendor's state decides.
    const sameState = stated[index]?.gstSplit ? stated[index].gstSplit === 'CGST_SGST' : vendorInSameState;
    const stateCheck = sameState;
    const gst = new Prisma.Decimal(statedGst);
    if (gst.isNegative()) throwAppError('VALIDATION_FAILED', 'GST amount must not be negative.');
    const cgstAmount = stateCheck ? gst.dividedBy(2).toDecimalPlaces(2) : new Prisma.Decimal(0);
    const sgstAmount = stateCheck ? gst.minus(cgstAmount) : new Prisma.Decimal(0);
    const igstAmount = stateCheck ? new Prisma.Decimal(0) : gst;
    const gstRatePercent = line.taxableAmount.greaterThan(0) ? gst.times(50).dividedBy(line.taxableAmount).toDecimalPlaces(2) : new Prisma.Decimal(0);
    return { ...line, gstRatePercent, cgstAmount, sgstAmount, igstAmount, lineTotal: line.taxableAmount.plus(gst) };
  });
}

function toSummary(row: SummaryRow): VendorBillSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.project?.name ?? null,
    billUrl: row.billUrl,
    paymentReceiptUrl: row.paymentReceiptUrl,
    vendorId: row.vendorId,
    vendorName: row.vendor.name,
    priority: row.priority,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    gstRegistrationId: row.gstRegistrationId,
    gstRegistrationGstin: row.gstRegistration.gstin,
    vendorBillNumber: row.vendorBillNumber,
    vendorBillDate: toDateStr(row.vendorBillDate),
    status: row.status,
    taxableAmount: row.taxableAmount?.toFixed(2) ?? null,
    cgstAmount: row.cgstAmount?.toFixed(2) ?? null,
    sgstAmount: row.sgstAmount?.toFixed(2) ?? null,
    igstAmount: row.igstAmount?.toFixed(2) ?? null,
    totalAmount: row.totalAmount?.toFixed(2) ?? null,
    journalEntryId: row.journalEntryId,
    voidJournalEntryId: row.voidJournalEntryId,
    voidReason: row.voidReason,
    voidedBy: row.voidedBy,
    voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    createdBy: row.createdBy,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelledBy: row.cancelledBy,
    cancelledReason: row.cancelledReason,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

function toDetail(row: DetailRow): VendorBillDetail {
  return {
    ...toSummary(row),
    lines: row.lines.map((l) => ({
      id: l.id,
      sequence: l.sequence,
      description: l.description,
      expenseCategoryId: l.expenseCategoryId,
      expenseCategoryName: l.expenseCategory?.name ?? null,
      inventoryItemId: l.inventoryItemId,
      inventoryItemName: l.inventoryItem?.name ?? null,
      inventoryItemCode: l.inventoryItem?.code ?? null,
      unitOfMeasureId: l.unitOfMeasureId,
      unitOfMeasureName: l.unitOfMeasure?.name ?? null,
      hsnSac: l.hsnSac,
      quantity: l.quantity.toFixed(2),
      unitPrice: l.unitPrice.toFixed(2),
      taxableAmount: l.taxableAmount.toFixed(2),
      gstRatePercent: l.gstRatePercent.toFixed(2),
      cgstAmount: l.cgstAmount.toFixed(2),
      sgstAmount: l.sgstAmount.toFixed(2),
      igstAmount: l.igstAmount.toFixed(2),
      itcEligible: l.itcEligible,
      lineTotal: l.lineTotal.toFixed(2),
    })),
    decisions: row.decisions.map((d) => ({
      id: d.id,
      decision: d.decision,
      actorId: d.actorId,
      decidedAt: d.decidedAt.toISOString(),
      note: d.note,
      isSelfApproval: d.isSelfApproval,
    })),
  };
}

@Injectable()
export class VendorBillsService implements VendorBillPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
    private readonly projects: ProjectsService,
    private readonly inventoryLedger: InventoryLedgerService,
  ) {}

  /** Reuses ProjectsService.getDetail's existing scoped-NOT_FOUND check and
   * then rejects a CANCELLED/CLOSED project — docs/05: "Cancelled and Closed
   * are terminal for normal operations." `enforceOpenStatus` is false for
   * getDetail/approve/reject (deciding an already-submitted bill against a
   * since-cancelled project is not retroactively blocked — only new
   * creation/submission is). Ported from the deleted
   * PurchaseRequestsService.assertProjectAccessible — VendorBillsService
   * itself never had this check before Purchase Request was merged into it
   * (Phase 6.4, docs/12 ADR-079), since Purchase Request was previously the
   * sole gate for it. */
  private async assertProjectAccessible(input: {
    organizationId: string;
    projectId: string | null;
    actorId: string;
    canSeeAll: boolean;
    enforceOpenStatus: boolean;
    /** For a bill without a project (ADR-177): who entered it. */
    createdBy?: string | null;
  }): Promise<void> {
    // A bill without a project is company overhead: open to those who see
    // every project, and to whoever entered it.
    if (input.projectId === null) {
      if (!input.canSeeAll && input.createdBy !== undefined && input.createdBy !== input.actorId) throwAppError('NOT_FOUND', 'Vendor bill not found.');
      return;
    }
    const project = await this.projects.getDetail({
      organizationId: input.organizationId,
      id: input.projectId,
      actorId: input.actorId,
      canSeeAll: input.canSeeAll,
    });
    if (input.enforceOpenStatus && TERMINAL_PROJECT_STATUSES.has(project.operationalStatus)) {
      throwAppError('VALIDATION_FAILED', 'This project is cancelled or closed and cannot accept new vendor bills.');
    }
  }

  /** The bill's legal entity: its project's, or, with no project (ADR-177), the one named, which must be active. */
  private async billLegalEntity(organizationId: string, project: { legalEntityId: string } | null, legalEntityId: string | undefined): Promise<string> {
    if (project) return project.legalEntityId;
    if (!legalEntityId) throwAppError('VALIDATION_FAILED', 'Choose the legal entity for a bill without a project.');
    const entity = await this.prisma.client.legalEntity.findFirst({ where: { id: legalEntityId, organizationId, deletedAt: null } });
    if (!entity) throwAppError('NOT_FOUND', 'Legal entity not found.');
    if (!entity.isActive) throwAppError('VALIDATION_FAILED', 'This legal entity is inactive.');
    return entity.id;
  }

  /** Ported from the deleted PurchaseRequestsService — VendorBill now
   * accepts vendorId directly (no longer inherited from an approved
   * Purchase Request), so it must validate the vendor itself. */
  private async assertVendorActive(organizationId: string, vendorId: string): Promise<void> {
    const vendor = await this.prisma.client.party.findFirst({
      where: { id: vendorId, organizationId, deletedAt: null },
      include: { vendorProfile: true },
    });
    if (!vendor || !vendor.vendorProfile) throwAppError('NOT_FOUND', 'Vendor not found.');
    if (!vendor.isActive || !vendor.vendorProfile.isActive) {
      throwAppError('VALIDATION_FAILED', 'This vendor is inactive.');
    }
  }

  /** Enforces the either/or the DB's own
   * chk_vendor_bill_lines_expense_or_inventory backs, before any write, so
   * the user gets a real message instead of a constraint violation — and
   * enforces the one rule the CHECK cannot see: a stock line may only
   * reference an ACTIVE, stock-tracked item (docs/01's own discriminator).
   * Phase 7.2, ADR-092. */
  private async assertLineTargetsValid(
    organizationId: string,
    lines: Array<{ expenseCategoryId: string | undefined; inventoryItemId: string | undefined }>,
  ): Promise<void> {
    for (const [index, line] of lines.entries()) {
      const hasCategory = line.expenseCategoryId !== undefined;
      const hasItem = line.inventoryItemId !== undefined;
      if (hasCategory === hasItem) {
        throwAppError(
          'VALIDATION_FAILED',
          `Line ${index + 1} must have either an expense category or a stock item, not both and not neither.`,
        );
      }
    }

    await this.assertExpenseCategoriesActive(
      organizationId,
      lines.flatMap((l) => (l.expenseCategoryId === undefined ? [] : [l.expenseCategoryId])),
    );

    const itemIds = [...new Set(lines.flatMap((l) => (l.inventoryItemId === undefined ? [] : [l.inventoryItemId])))];
    if (itemIds.length === 0) return;
    const items = await this.prisma.client.inventoryItem.findMany({
      where: { id: { in: itemIds }, organizationId, deletedAt: null },
    });
    if (items.length !== itemIds.length) throwAppError('NOT_FOUND', 'One or more stock items were not found.');
    const inactive = items.find((i) => !i.isActive);
    if (inactive) throwAppError('VALIDATION_FAILED', `Item "${inactive.name}" is inactive.`);
    const nonStock = items.find((i) => !i.isStockTracked);
    if (nonStock) {
      throwAppError(
        'VALIDATION_FAILED',
        `"${nonStock.name}" is not a stock-tracked item — record it against an expense category instead.`,
      );
    }
  }

  private async assertExpenseCategoriesActive(organizationId: string, expenseCategoryIds: string[]): Promise<void> {
    const distinctIds = [...new Set(expenseCategoryIds)];
    if (distinctIds.length === 0) return;
    const categories = await this.prisma.client.expenseCategory.findMany({
      where: { id: { in: distinctIds }, organizationId, deletedAt: null },
    });
    if (categories.length !== distinctIds.length) throwAppError('NOT_FOUND', 'One or more expense categories were not found.');
    const inactive = categories.find((c) => !c.isActive);
    if (inactive) throwAppError('VALIDATION_FAILED', `Expense category "${inactive.name}" is inactive.`);
  }

  private async assertUnitsOfMeasureActive(organizationId: string, unitOfMeasureIds: string[]): Promise<void> {
    const distinctIds = [...new Set(unitOfMeasureIds)];
    const units = await this.prisma.client.unitOfMeasure.findMany({
      where: { id: { in: distinctIds }, organizationId, deletedAt: null },
    });
    if (units.length !== distinctIds.length) throwAppError('NOT_FOUND', 'One or more units of measure were not found.');
    const inactive = units.find((u) => !u.isActive);
    if (inactive) throwAppError('VALIDATION_FAILED', `Unit of measure "${inactive.name}" is inactive.`);
  }

  /** Pure preview — vendorId/gstRegistrationId are checked for existence
   * and organization-scope only (the full "GST registration must belong to
   * the selected project's legal entity" consistency check happens at
   * createDraft/updateDraft time, once a project is actually involved). */
  async calculatePreview(input: {
    organizationId: string;
    vendorId: string;
    gstRegistrationId: string;
    lines: VendorBillLineInput[];
    actorId: string;
    canSeeAll: boolean;
  }): Promise<VendorBillLinesPreview> {
    if (input.lines.length === 0) {
      return { lines: [], taxableAmount: '0.00', cgstAmount: '0.00', sgstAmount: '0.00', igstAmount: '0.00', totalAmount: '0.00' };
    }

    const vendor = await this.prisma.client.party.findFirst({ where: { id: input.vendorId, organizationId: input.organizationId } });
    if (!vendor) throwAppError('NOT_FOUND', 'Vendor not found.');
    if (!vendor.stateId) throwAppError('VALIDATION_FAILED', "The vendor's state must be set to compute GST — set it on the vendor's address.");

    const gstRegistration = await this.prisma.client.gstRegistration.findFirst({ where: { id: input.gstRegistrationId, organizationId: input.organizationId } });
    if (!gstRegistration) throwAppError('NOT_FOUND', 'GST registration not found.');

    const distinctCategoryIds = [...new Set(input.lines.flatMap((l) => (l.expenseCategoryId === undefined ? [] : [l.expenseCategoryId])))];
    const distinctItemIds = [...new Set(input.lines.flatMap((l) => (l.inventoryItemId === undefined ? [] : [l.inventoryItemId])))];
    const distinctUnitIds = [...new Set(input.lines.map((l) => l.unitOfMeasureId))];
    const [categories, units, items] = await Promise.all([
      this.prisma.client.expenseCategory.findMany({ where: { id: { in: distinctCategoryIds }, organizationId: input.organizationId } }),
      this.prisma.client.unitOfMeasure.findMany({ where: { id: { in: distinctUnitIds }, organizationId: input.organizationId } }),
      this.prisma.client.inventoryItem.findMany({ where: { id: { in: distinctItemIds }, organizationId: input.organizationId } }),
    ]);
    const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
    const itemNameById = new Map(items.map((i) => [i.id, i.name]));
    const unitNameById = new Map(units.map((u) => [u.id, u.name]));

    const sameState = vendor.stateId === gstRegistration.stateId;
    const computedLines = computeLines(input.lines, sameState);

    const lines = computedLines.map((l, index) => ({
      sequence: l.sequence,
      description: l.description,
      expenseCategoryId: input.lines[index]!.expenseCategoryId ?? null,
      expenseCategoryName:
        input.lines[index]!.expenseCategoryId === undefined
          ? null
          : (categoryNameById.get(input.lines[index]!.expenseCategoryId) ?? '—'),
      inventoryItemId: input.lines[index]!.inventoryItemId ?? null,
      inventoryItemName:
        input.lines[index]!.inventoryItemId === undefined
          ? null
          : (itemNameById.get(input.lines[index]!.inventoryItemId) ?? '—'),
      unitOfMeasureId: input.lines[index]!.unitOfMeasureId,
      unitOfMeasureName: unitNameById.get(input.lines[index]!.unitOfMeasureId) ?? '—',
      hsnSac: l.hsnSac,
      quantity: l.quantity.toFixed(2),
      unitPrice: l.unitPrice.toFixed(2),
      taxableAmount: l.taxableAmount.toFixed(2),
      gstRatePercent: l.gstRatePercent.toFixed(2),
      cgstAmount: l.cgstAmount.toFixed(2),
      sgstAmount: l.sgstAmount.toFixed(2),
      igstAmount: l.igstAmount.toFixed(2),
      itcEligible: input.lines[index]!.itcEligible,
      lineTotal: l.lineTotal.toFixed(2),
    }));

    const taxableAmount = computedLines.reduce((sum, l) => sum.plus(l.taxableAmount), new Prisma.Decimal(0));
    const cgstAmount = computedLines.reduce((sum, l) => sum.plus(l.cgstAmount), new Prisma.Decimal(0));
    const sgstAmount = computedLines.reduce((sum, l) => sum.plus(l.sgstAmount), new Prisma.Decimal(0));
    const igstAmount = computedLines.reduce((sum, l) => sum.plus(l.igstAmount), new Prisma.Decimal(0));
    const totalAmount = taxableAmount.plus(cgstAmount).plus(sgstAmount).plus(igstAmount);

    return {
      lines,
      taxableAmount: taxableAmount.toFixed(2),
      cgstAmount: cgstAmount.toFixed(2),
      sgstAmount: sgstAmount.toFixed(2),
      igstAmount: igstAmount.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
    };
  }

  async createDraft(input: {
    organizationId: string;
    /** Optional (ADR-177): without one the bill is company overhead and names its legal entity. */
    projectId: string | undefined;
    legalEntityId?: string | undefined;
    vendorId: string;
    priority: VendorBillPriority | undefined;
    gstRegistrationId: string;
    vendorBillNumber: string;
    vendorBillDate: string;
    /** ADR-178: an import may give each line's GST as printed on the bill. */
    lines: Array<VendorBillLineInput & { gstAmount?: string | undefined; gstSplit?: 'CGST_SGST' | 'IGST' | undefined }>;
    billUrl?: string | undefined;
    paymentReceiptUrl?: string | undefined;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<VendorBillSummary> {
    const requestHash = hashRequest({
      billUrl: input.billUrl,
      paymentReceiptUrl: input.paymentReceiptUrl,
      projectId: input.projectId,
      legalEntityId: input.legalEntityId,
      vendorId: input.vendorId,
      priority: input.priority,
      gstRegistrationId: input.gstRegistrationId,
      vendorBillNumber: input.vendorBillNumber,
      vendorBillDate: input.vendorBillDate,
      lines: input.lines,
    });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: CREATE_DRAFT_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as VendorBillSummary;
    }

    if (input.lines.length === 0) throwAppError('VALIDATION_FAILED', 'At least one line item is required.');

    await this.assertProjectAccessible({ organizationId: input.organizationId, projectId: input.projectId ?? null, actorId: input.actorId, canSeeAll: input.canSeeAll, enforceOpenStatus: true });
    await this.assertVendorActive(input.organizationId, input.vendorId);

    const project = input.projectId ? await this.prisma.client.project.findFirstOrThrow({ where: { id: input.projectId, organizationId: input.organizationId } }) : null;
    const legalEntityId = await this.billLegalEntity(input.organizationId, project, input.legalEntityId);
    const vendor = await this.prisma.client.party.findFirstOrThrow({ where: { id: input.vendorId, organizationId: input.organizationId } });
    if (!vendor.stateId) throwAppError('VALIDATION_FAILED', "The vendor's state must be set to compute GST — set it on the vendor's address.");

    const gstRegistration = await this.prisma.client.gstRegistration.findFirst({
      where: { id: input.gstRegistrationId, organizationId: input.organizationId, legalEntityId },
    });
    if (!gstRegistration) throwAppError('NOT_FOUND', "GST registration not found for this bill's legal entity.");

    const duplicateNumber = await this.prisma.client.vendorBill.findFirst({
      where: { organizationId: input.organizationId, vendorId: input.vendorId, vendorBillNumber: input.vendorBillNumber, status: { notIn: ['VOID', 'CANCELLED'] } },
    });
    if (duplicateNumber) throwAppError('VALIDATION_FAILED', 'A vendor bill with this number already exists for this vendor.');

    await this.assertLineTargetsValid(input.organizationId, input.lines);
    await this.assertUnitsOfMeasureActive(input.organizationId, input.lines.map((l) => l.unitOfMeasureId));

    const sameState = vendor.stateId === gstRegistration.stateId;
    const computedLines = withStatedGst(computeLines(input.lines, sameState), input.lines, sameState);

    const vendorBillId = generateId();
    return await this.prisma.client.$transaction(async (tx) => {
      await tx.vendorBill.create({
        data: {
          id: vendorBillId,
          organizationId: input.organizationId,
          projectId: project?.id ?? null,
          vendorId: input.vendorId,
          priority: input.priority ?? 'NORMAL',
          legalEntityId,
          gstRegistrationId: input.gstRegistrationId,
          vendorBillNumber: input.vendorBillNumber,
          vendorBillDate: toDate(input.vendorBillDate),
          billUrl: input.billUrl ?? null,
          paymentReceiptUrl: input.paymentReceiptUrl ?? null,
          status: 'DRAFT',
          createdBy: input.actorId,
        },
      });

      await tx.vendorBillLine.createMany({
        data: computedLines.map((l, index) => ({
          id: generateId(),
          organizationId: input.organizationId,
          vendorBillId,
          expenseCategoryId: input.lines[index]!.expenseCategoryId ?? null,
          inventoryItemId: input.lines[index]!.inventoryItemId ?? null,
          unitOfMeasureId: input.lines[index]!.unitOfMeasureId,
          sequence: l.sequence,
          description: l.description,
          hsnSac: l.hsnSac,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxableAmount: l.taxableAmount,
          gstRatePercent: l.gstRatePercent,
          cgstAmount: l.cgstAmount,
          sgstAmount: l.sgstAmount,
          igstAmount: l.igstAmount,
          itcEligible: input.lines[index]!.itcEligible,
          lineTotal: l.lineTotal,
        })),
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'VENDOR_BILL',
        entityId: vendorBillId,
        action: 'VENDOR_BILL_DRAFT_CREATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { projectId: input.projectId, vendorId: input.vendorId, vendorBillNumber: input.vendorBillNumber, lineCount: input.lines.length },
      });

      const created = await tx.vendorBill.findFirstOrThrow({ where: { id: vendorBillId }, include: summaryInclude });
      const summary = toSummary(created);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: CREATE_DRAFT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'VENDOR_BILL',
          sourceRecordId: vendorBillId,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async updateDraft(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    /** Null clears it: the bill becomes company overhead (ADR-177). */
    projectId: string | null | undefined;
    legalEntityId?: string | undefined;
    vendorId: string | undefined;
    priority: VendorBillPriority | undefined;
    gstRegistrationId: string | undefined;
    vendorBillNumber: string | undefined;
    vendorBillDate: string | undefined;
    lines: VendorBillLineInput[] | undefined;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<VendorBillSummary> {
    const existing = await this.prisma.client.vendorBill.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!existing) throwAppError('NOT_FOUND', 'Vendor bill not found.');
    if (existing.status !== 'DRAFT') throwAppError('INVALID_STATE_TRANSITION', 'Only a draft vendor bill can be updated.');

    const projectId = input.projectId !== undefined ? input.projectId : existing.projectId;
    const vendorId = input.vendorId ?? existing.vendorId;

    await this.assertProjectAccessible({ organizationId: input.organizationId, projectId, actorId: input.actorId, canSeeAll: input.canSeeAll, enforceOpenStatus: true, createdBy: existing.createdBy });
    await this.assertVendorActive(input.organizationId, vendorId);

    const project = projectId ? await this.prisma.client.project.findFirstOrThrow({ where: { id: projectId, organizationId: input.organizationId } }) : null;
    const legalEntityId = await this.billLegalEntity(input.organizationId, project, input.legalEntityId ?? existing.legalEntityId);
    const vendor = await this.prisma.client.party.findFirstOrThrow({ where: { id: vendorId, organizationId: input.organizationId } });
    if (!vendor.stateId) throwAppError('VALIDATION_FAILED', "The vendor's state must be set to compute GST.");

    const gstRegistrationId = input.gstRegistrationId ?? existing.gstRegistrationId;
    const gstRegistration = await this.prisma.client.gstRegistration.findFirst({
      where: { id: gstRegistrationId, organizationId: input.organizationId, legalEntityId },
    });
    if (!gstRegistration) throwAppError('NOT_FOUND', "GST registration not found for this bill's legal entity.");

    const vendorBillNumber = input.vendorBillNumber ?? existing.vendorBillNumber;
    if (vendorBillNumber !== existing.vendorBillNumber || vendorId !== existing.vendorId) {
      const duplicateNumber = await this.prisma.client.vendorBill.findFirst({
        where: { organizationId: input.organizationId, vendorId, vendorBillNumber, status: { notIn: ['VOID', 'CANCELLED'] }, id: { not: existing.id } },
      });
      if (duplicateNumber) throwAppError('VALIDATION_FAILED', 'A vendor bill with this number already exists for this vendor.');
    }

    let computedLines: ComputedLine[] | undefined;
    if (input.lines !== undefined) {
      if (input.lines.length === 0) throwAppError('VALIDATION_FAILED', 'At least one line item is required.');
      await this.assertLineTargetsValid(input.organizationId, input.lines);
      await this.assertUnitsOfMeasureActive(input.organizationId, input.lines.map((l) => l.unitOfMeasureId));
      const sameState = vendor.stateId === gstRegistration.stateId;
      computedLines = computeLines(input.lines, sameState);
    }

    // gstRegistrationId/vendorId/projectId/legalEntityId all sit behind
    // composite FKs (organizationId pairs), which Prisma's generated
    // VendorBillUpdateManyMutationInput type excludes entirely — handled
    // separately below via a real update() once the version check has
    // already claimed the row.
    const data: Prisma.VendorBillUpdateManyMutationInput = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.vendorBillNumber !== undefined) data.vendorBillNumber = input.vendorBillNumber;
    if (input.vendorBillDate !== undefined) data.vendorBillDate = toDate(input.vendorBillDate);

    return await this.prisma.client.$transaction(async (tx) => {
      if (computedLines) {
        await tx.vendorBillLine.deleteMany({ where: { vendorBillId: existing.id } });
        await tx.vendorBillLine.createMany({
          data: computedLines.map((l, index) => ({
            id: generateId(),
            organizationId: input.organizationId,
            vendorBillId: existing.id,
            expenseCategoryId: input.lines![index]!.expenseCategoryId ?? null,
            inventoryItemId: input.lines![index]!.inventoryItemId ?? null,
            unitOfMeasureId: input.lines![index]!.unitOfMeasureId,
            sequence: l.sequence,
            description: l.description,
            hsnSac: l.hsnSac,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            taxableAmount: l.taxableAmount,
            gstRatePercent: l.gstRatePercent,
            cgstAmount: l.cgstAmount,
            sgstAmount: l.sgstAmount,
            igstAmount: l.igstAmount,
            itcEligible: input.lines![index]!.itcEligible,
            lineTotal: l.lineTotal,
          })),
        });
      }

      const { count } = await tx.vendorBill.updateMany({ where: { id: existing.id, version: input.expectedVersion }, data });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This vendor bill was changed by someone else. Reload and try again.');

      // Safe unconditionally here (no separate version re-check needed):
      // the updateMany() above already atomically claimed this row — its
      // own version-bump took the row lock, which Postgres holds until
      // this transaction commits — so no concurrent writer can have
      // slipped in between.
      const relationUpdates: Prisma.VendorBillUpdateInput = {};
      if (input.projectId !== undefined) relationUpdates.project = project ? { connect: { id: project.id } } : { disconnect: true };
      if (legalEntityId !== existing.legalEntityId) relationUpdates.legalEntity = { connect: { id: legalEntityId } };
      if (input.vendorId !== undefined) relationUpdates.vendor = { connect: { id: vendorId } };
      if (input.gstRegistrationId !== undefined) relationUpdates.gstRegistration = { connect: { id: input.gstRegistrationId } };
      if (Object.keys(relationUpdates).length > 0) {
        await tx.vendorBill.update({ where: { id: existing.id }, data: relationUpdates });
      }

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'VENDOR_BILL',
        entityId: existing.id,
        action: 'VENDOR_BILL_UPDATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { vendorBillNumber: input.vendorBillNumber, vendorBillDate: input.vendorBillDate },
      });

      const updated = await tx.vendorBill.findFirstOrThrow({ where: { id: existing.id }, include: summaryInclude });
      return toSummary(updated);
    });
  }

  /** Flips DRAFT -> SUBMITTED, mirroring the deleted
   * PurchaseRequestsService.submit() structurally. Every field becomes
   * immutable afterward except status/cancellation/decision fields. */
  async submit(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<VendorBillSummary> {
    const requestHash = hashRequest({ id: input.id });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: SUBMIT_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as VendorBillSummary;
    }

    const existing = await this.prisma.client.vendorBill.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: { lines: true } });
    if (!existing) throwAppError('NOT_FOUND', 'Vendor bill not found.');
    if (existing.status !== 'DRAFT') throwAppError('INVALID_STATE_TRANSITION', 'Only a draft vendor bill can be submitted.');
    if (existing.lines.length === 0) throwAppError('VALIDATION_FAILED', 'At least one line item is required.');

    await this.assertProjectAccessible({ organizationId: input.organizationId, projectId: existing.projectId, actorId: input.actorId, canSeeAll: input.canSeeAll, enforceOpenStatus: true, createdBy: existing.createdBy });
    await this.assertVendorActive(input.organizationId, existing.vendorId);

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.vendorBill.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'DRAFT' },
        data: { status: 'SUBMITTED', submittedAt: new Date(), updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This vendor bill was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'VENDOR_BILL',
        entityId: input.id,
        action: 'VENDOR_BILL_SUBMITTED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { vendorBillNumber: existing.vendorBillNumber },
      });

      const updated = await tx.vendorBill.findFirstOrThrow({ where: { id: input.id }, include: summaryInclude });
      const summary = toSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: SUBMIT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'VENDOR_BILL',
          sourceRecordId: input.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  /** Only reachable from SUBMITTED. Runs the maker-checker decision (ported
   * from the deleted PurchaseRequestsService.approve() verbatim) AND posts
   * the docs/06 journal entry (ported from this file's own former
   * finalize()) in the same overall operation — approve and the ledger
   * posting are one combined action (docs/12 ADR-079). */
  async approve(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    note: string | undefined;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    hasSelfApprovePermission: boolean;
    correlationId: string;
  }): Promise<VendorBillSummary> {
    const requestHash = hashRequest({ id: input.id, note: input.note });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: APPROVE_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as VendorBillSummary;
    }

    const bill = await this.prisma.client.vendorBill.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: { lines: true },
    });
    if (!bill) throwAppError('NOT_FOUND', 'Vendor bill not found.');
    if (bill.status !== 'SUBMITTED') throwAppError('INVALID_STATE_TRANSITION', 'Only a submitted vendor bill can be approved.');
    if (bill.lines.length === 0) throwAppError('VALIDATION_FAILED', 'At least one line item is required.');

    await this.assertProjectAccessible({ organizationId: input.organizationId, projectId: bill.projectId, actorId: input.actorId, canSeeAll: input.canSeeAll, enforceOpenStatus: false, createdBy: bill.createdBy });

    // Maker-checker: the creator can never approve their own bill unless
    // they hold vendor_bill.self_approve AND supply a mandatory
    // justification note — checked unconditionally, before any posting
    // work, mirroring the deleted PurchaseRequestsService.approve() exactly.
    const isSelfApproval = bill.createdBy === input.actorId;
    if (isSelfApproval) {
      if (!input.hasSelfApprovePermission) throwAppError('FORBIDDEN', 'You cannot approve your own vendor bill.');
      if (!input.note?.trim()) throwAppError('VALIDATION_FAILED', 'A justification note is required to approve your own vendor bill.');
    }

    // Lines already carry their frozen GST split (computed once at
    // createDraft/updateDraft time) — approve aggregates from stored
    // amounts rather than recomputing, mirroring Invoice.finalize's own
    // precedent exactly.
    const resolvedExpenseCategoryIds = [...new Set(bill.lines.flatMap((l) => (l.expenseCategoryId === null ? [] : [l.expenseCategoryId])))];
    const expenseCategories = await this.prisma.client.expenseCategory.findMany({
      where: { id: { in: resolvedExpenseCategoryIds }, organizationId: input.organizationId },
    });
    const categoryLedgerMap = new Map(expenseCategories.map((c) => [c.id, c.ledgerAccountId]));

    const ledgerAccounts = await this.prisma.client.ledgerAccount.findMany({
      where: { organizationId: input.organizationId, code: { in: Object.values(LEDGER_CODES) } },
    });
    const byCode = new Map(ledgerAccounts.map((a) => [a.code, a]));
    const apAccount = byCode.get(LEDGER_CODES.accountsPayable);
    const defaultExpenseAccount = byCode.get(LEDGER_CODES.defaultExpense);
    if (!apAccount || !defaultExpenseAccount) throwAppError('VALIDATION_FAILED', 'Required ledger accounts (Accounts Payable — Vendor / Other Expenses) are not configured.');

    // Only demanded when the bill actually carries a stock line, so a
    // pure-expense bill still approves in an organization that has never
    // touched inventory.
    const hasStockLine = bill.lines.some((l) => l.inventoryItemId !== null);
    const inventoryAccount = byCode.get(LEDGER_CODES.inventory);
    if (hasStockLine && !inventoryAccount) throwAppError('VALIDATION_FAILED', 'Inventory ledger account is not configured.');

    const costByLedgerAccount = new Map<string, Prisma.Decimal>();
    const stockLines: Array<{ lineId: string; inventoryItemId: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal }> = [];
    let eligibleCgst = new Prisma.Decimal(0);
    let eligibleSgst = new Prisma.Decimal(0);
    let eligibleIgst = new Prisma.Decimal(0);
    let taxableAmount = new Prisma.Decimal(0);
    let cgstAmount = new Prisma.Decimal(0);
    let sgstAmount = new Prisma.Decimal(0);
    let igstAmount = new Prisma.Decimal(0);

    for (const line of bill.lines) {
      taxableAmount = taxableAmount.plus(line.taxableAmount);
      cgstAmount = cgstAmount.plus(line.cgstAmount);
      sgstAmount = sgstAmount.plus(line.sgstAmount);
      igstAmount = igstAmount.plus(line.igstAmount);

      // docs/06 gives two "Finalize vendor bill" tables. Both debit the
      // same figure — taxable value plus any ineligible tax — they differ
      // only in WHICH account it lands in: an expense line resolves its
      // category's account (OTHER_EXPENSES fallback), a stock line debits
      // Inventory. The costDebit formula below is therefore deliberately
      // shared, not duplicated per branch.
      const resolvedLedgerAccountId =
        line.inventoryItemId !== null
          ? inventoryAccount!.id
          : (categoryLedgerMap.get(line.expenseCategoryId!) ?? defaultExpenseAccount.id);
      const costDebit = line.itcEligible
        ? line.taxableAmount
        : line.taxableAmount.plus(line.cgstAmount).plus(line.sgstAmount).plus(line.igstAmount);
      costByLedgerAccount.set(resolvedLedgerAccountId, (costByLedgerAccount.get(resolvedLedgerAccountId) ?? new Prisma.Decimal(0)).plus(costDebit));

      // The per-unit landed cost the stock ledger will value this receipt
      // at — the same costDebit figure, divided by quantity. Computed here
      // so the movement can never disagree with the journal debit.
      if (line.inventoryItemId !== null) {
        stockLines.push({
          lineId: line.id,
          inventoryItemId: line.inventoryItemId,
          quantity: line.quantity,
          unitCost: line.quantity.isZero() ? new Prisma.Decimal(0) : costDebit.dividedBy(line.quantity),
        });
      }

      if (line.itcEligible) {
        eligibleCgst = eligibleCgst.plus(line.cgstAmount);
        eligibleSgst = eligibleSgst.plus(line.sgstAmount);
        eligibleIgst = eligibleIgst.plus(line.igstAmount);
      }
    }
    const totalAmount = taxableAmount.plus(cgstAmount).plus(sgstAmount).plus(igstAmount);

    if (eligibleCgst.greaterThan(0) && !byCode.get(LEDGER_CODES.inputCgst)) throwAppError('VALIDATION_FAILED', 'Input CGST Receivable ledger account is not configured.');
    if (eligibleSgst.greaterThan(0) && !byCode.get(LEDGER_CODES.inputSgst)) throwAppError('VALIDATION_FAILED', 'Input SGST Receivable ledger account is not configured.');
    if (eligibleIgst.greaterThan(0) && !byCode.get(LEDGER_CODES.inputIgst)) throwAppError('VALIDATION_FAILED', 'Input IGST Receivable ledger account is not configured.');

    const accountingDateStr = toDateStr(bill.vendorBillDate);
    const financialYear = await this.prisma.client.financialYear.findFirst({
      where: { organizationId: input.organizationId, legalEntityId: bill.legalEntityId, startDate: { lte: bill.vendorBillDate }, endDate: { gte: bill.vendorBillDate } },
    });
    if (!financialYear) throwAppError('VALIDATION_FAILED', 'No financial year covers this vendor bill date for the selected legal entity.');

    const journalLines = [
      ...[...costByLedgerAccount.entries()].map(([ledgerAccountId, amount]) => ({
        ledgerAccountId,
        debit: amount.toFixed(2),
        credit: '0',
        projectId: bill.projectId ?? undefined,
        partyId: undefined,
        employeeId: undefined,
        gstRegistrationId: bill.gstRegistrationId,
        taxCode: undefined,
        narrative: undefined,
      })),
      ...(eligibleCgst.greaterThan(0) ? [{ ledgerAccountId: byCode.get(LEDGER_CODES.inputCgst)!.id, debit: eligibleCgst.toFixed(2), credit: '0', projectId: bill.projectId ?? undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: bill.gstRegistrationId, taxCode: 'CGST', narrative: undefined }] : []),
      ...(eligibleSgst.greaterThan(0) ? [{ ledgerAccountId: byCode.get(LEDGER_CODES.inputSgst)!.id, debit: eligibleSgst.toFixed(2), credit: '0', projectId: bill.projectId ?? undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: bill.gstRegistrationId, taxCode: 'SGST', narrative: undefined }] : []),
      ...(eligibleIgst.greaterThan(0) ? [{ ledgerAccountId: byCode.get(LEDGER_CODES.inputIgst)!.id, debit: eligibleIgst.toFixed(2), credit: '0', projectId: bill.projectId ?? undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: bill.gstRegistrationId, taxCode: 'IGST', narrative: undefined }] : []),
      { ledgerAccountId: apAccount.id, debit: '0', credit: totalAmount.toFixed(2), projectId: bill.projectId ?? undefined, partyId: bill.vendorId, employeeId: undefined, gstRegistrationId: bill.gstRegistrationId, taxCode: undefined, narrative: undefined },
    ];

    const journal = await this.posting.postJournal({
      organizationId: input.organizationId,
      legalEntityId: bill.legalEntityId,
      accountingDate: accountingDateStr,
      sourceType: 'vendor_bill_approve',
      sourceId: bill.id,
      postingEvent: 'vendor_bill.approved',
      description: `Vendor bill ${bill.vendorBillNumber} approved`,
      lines: journalLines,
      idempotencyKey: `${APPROVE_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.vendorBill.updateMany({
        where: { id: bill.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'SUBMITTED' },
        data: {
          status: 'FINALIZED',
          financialYearId: financialYear.id,
          taxableAmount,
          cgstAmount,
          sgstAmount,
          igstAmount,
          totalAmount,
          journalEntryId: journal.id,
          updatedBy: input.actorId,
          version: { increment: 1 },
        },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This vendor bill was changed by someone else. Reload and try again.');

      await tx.vendorBillDecision.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          vendorBillId: bill.id,
          decision: 'APPROVED',
          actorId: input.actorId,
          note: input.note?.trim() || null,
          isSelfApproval,
        },
      });

      // docs/04:464 — "do not duplicate the vendor-bill liability journal".
      // Receiving the stock is part of approving the bill, not a second
      // document: the Inventory debit is already one of this journal's own
      // lines, so the movement here records quantity and running cost only
      // and posts nothing of its own. Inside the same transaction as the
      // status flip, so stock can never exist against an unapproved bill
      // (docs/02's "post inventory receipt/consumption + cost entry" boundary).
      for (const stockLine of stockLines) {
        await this.inventoryLedger.recordMovement(tx, {
          organizationId: input.organizationId,
          inventoryItemId: stockLine.inventoryItemId,
          movementType: 'RECEIPT',
          movementDate: bill.vendorBillDate,
          quantityIn: stockLine.quantity,
          unitCost: stockLine.unitCost,
          vendorBillLineId: stockLine.lineId,
          actorId: input.actorId,
        });
      }

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'VENDOR_BILL',
        entityId: bill.id,
        action: 'VENDOR_BILL_APPROVED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { vendorBillNumber: bill.vendorBillNumber, totalAmount: totalAmount.toFixed(2), journalEntryId: journal.id, isSelfApproval },
      });

      const updated = await tx.vendorBill.findFirstOrThrow({ where: { id: bill.id }, include: summaryInclude });
      const summary = toSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: APPROVE_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'VENDOR_BILL',
          sourceRecordId: bill.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  /** Only reachable from SUBMITTED. `reason` is mandatory. Terminal — no
   * resubmission path. Ported from the deleted
   * PurchaseRequestsService.reject(). */
  async reject(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<VendorBillSummary> {
    const reason = input.reason.trim();
    if (!reason) throwAppError('VALIDATION_FAILED', 'A reason is required to reject a vendor bill.');

    const requestHash = hashRequest({ id: input.id, reason });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: REJECT_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as VendorBillSummary;
    }

    const existing = await this.prisma.client.vendorBill.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!existing) throwAppError('NOT_FOUND', 'Vendor bill not found.');
    if (existing.status !== 'SUBMITTED') throwAppError('INVALID_STATE_TRANSITION', 'Only a submitted vendor bill can be rejected.');

    await this.assertProjectAccessible({ organizationId: input.organizationId, projectId: existing.projectId, actorId: input.actorId, canSeeAll: input.canSeeAll, enforceOpenStatus: false, createdBy: existing.createdBy });

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.vendorBill.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'SUBMITTED' },
        data: { status: 'REJECTED', updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This vendor bill was changed by someone else. Reload and try again.');

      await tx.vendorBillDecision.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          vendorBillId: input.id,
          decision: 'REJECTED',
          actorId: input.actorId,
          note: reason,
          isSelfApproval: false,
        },
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'VENDOR_BILL',
        entityId: input.id,
        action: 'VENDOR_BILL_REJECTED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { vendorBillNumber: existing.vendorBillNumber, reason },
      });

      const updated = await tx.vendorBill.findFirstOrThrow({ where: { id: input.id }, include: summaryInclude });
      const summary = toSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: REJECT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'VENDOR_BILL',
          sourceRecordId: input.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  /** Creator-only withdrawal, reachable from DRAFT or SUBMITTED. `reason`
   * is mandatory. Ported from the deleted PurchaseRequestsService.cancel()
   * — replaces what used to be a plain "Void Draft" status flip: Void is
   * now reserved for reversing an already-posted (FINALIZED) bill's journal
   * entry, never for withdrawing an unposted draft/submission. */
  async cancel(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<VendorBillSummary> {
    const reason = input.reason.trim();
    if (!reason) throwAppError('VALIDATION_FAILED', 'A reason is required to cancel a vendor bill.');

    const requestHash = hashRequest({ id: input.id, reason });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: CANCEL_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as VendorBillSummary;
    }

    const existing = await this.prisma.client.vendorBill.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!existing) throwAppError('NOT_FOUND', 'Vendor bill not found.');
    if (existing.createdBy !== input.actorId) throwAppError('FORBIDDEN', 'Only the creator can cancel this vendor bill.');
    if (!OPEN_STATUSES.has(existing.status)) throwAppError('INVALID_STATE_TRANSITION', 'Only a draft or submitted vendor bill can be cancelled.');

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.vendorBill.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: input.actorId, cancelledReason: reason, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This vendor bill was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'VENDOR_BILL',
        entityId: input.id,
        action: 'VENDOR_BILL_CANCELLED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { vendorBillNumber: existing.vendorBillNumber, reason },
      });

      const updated = await tx.vendorBill.findFirstOrThrow({ where: { id: input.id }, include: summaryInclude });
      const summary = toSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: CANCEL_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'VENDOR_BILL',
          sourceRecordId: input.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  /** Only reachable from FINALIZED — reverses the posted journal entry.
   * `accountingDate` is now always required (unlike before this merge, when
   * a DRAFT bill could also be "voided" with no journal to reverse — that
   * case is now `cancel()`). */
  async void(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<VendorBillSummary> {
    const requestHash = hashRequest({ id: input.id, reason: input.reason, accountingDate: input.accountingDate });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: VOID_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as VendorBillSummary;
    }

    const reason = input.reason.trim();
    if (!reason) throwAppError('VALIDATION_FAILED', 'A reason is required to void a vendor bill.');

    const bill = await this.prisma.client.vendorBill.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!bill) throwAppError('NOT_FOUND', 'Vendor bill not found.');
    if (bill.status !== 'FINALIZED') throwAppError('INVALID_STATE_TRANSITION', 'Only a finalized vendor bill can be voided.');

    await this.assertProjectAccessible({ organizationId: input.organizationId, projectId: bill.projectId, actorId: input.actorId, canSeeAll: input.canSeeAll, enforceOpenStatus: false, createdBy: bill.createdBy });

    if (!bill.journalEntryId) throwAppError('VALIDATION_FAILED', 'This finalized vendor bill has no journal entry to reverse.');
    const reversal = await this.posting.reverseJournal({
      organizationId: input.organizationId,
      id: bill.journalEntryId,
      accountingDate: input.accountingDate,
      reason,
      idempotencyKey: `${VOID_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.vendorBill.updateMany({
        where: { id: bill.id, version: input.expectedVersion, status: 'FINALIZED' },
        data: { status: 'VOID', voidReason: reason, voidedBy: input.actorId, voidedAt: new Date(), voidJournalEntryId: reversal.id, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This vendor bill was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'VENDOR_BILL',
        entityId: bill.id,
        action: 'VENDOR_BILL_VOIDED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { voidReason: reason, voidJournalEntryId: reversal.id },
      });

      const updated = await tx.vendorBill.findFirstOrThrow({ where: { id: bill.id }, include: summaryInclude });
      const summary = toSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: VOID_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'VENDOR_BILL',
          sourceRecordId: bill.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async list(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: VendorBillFilters;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<{ rows: VendorBillSummary[]; total: number }> {
    const where: Prisma.VendorBillWhereInput = { organizationId: input.organizationId };
    if (input.filters.projectId) where.projectId = input.filters.projectId;
    if (input.filters.vendorId) where.vendorId = input.filters.vendorId;
    if (input.filters.status) where.status = input.filters.status;

    if (!input.canSeeAll) {
      const assignedProjects = await this.projects.list({ organizationId: input.organizationId, actorId: input.actorId, canSeeAll: false });
      const assignedProjectIds = assignedProjects.map((p) => p.id);
      if (input.filters.projectId) where.projectId = assignedProjectIds.includes(input.filters.projectId) ? input.filters.projectId : '__none__';
      // Their projects' bills, and company-overhead bills they entered (ADR-177).
      else where.OR = [{ projectId: { in: assignedProjectIds } }, { projectId: null, createdBy: input.actorId }];
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.vendorBill.findMany({
        where,
        include: summaryInclude,
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.client.vendorBill.count({ where }),
    ]);

    return { rows: rows.map(toSummary), total };
  }

  async getDetail(input: { organizationId: string; id: string; actorId: string; canSeeAll: boolean }): Promise<VendorBillDetail> {
    const row = await this.prisma.client.vendorBill.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: detailInclude });
    if (!row) throwAppError('NOT_FOUND', 'Vendor bill not found.');
    await this.assertProjectAccessible({ organizationId: input.organizationId, projectId: row.projectId, actorId: input.actorId, canSeeAll: input.canSeeAll, enforceOpenStatus: false, createdBy: row.createdBy });
    return toDetail(row);
  }
}
