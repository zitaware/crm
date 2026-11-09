import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  TaxDeductionType,
  TdsDepositAllocationRow,
  TdsDepositDetail,
  TdsDepositPort,
  TdsDepositStatus,
  TdsDepositSummary,
  TdsOutwardItem,
  TdsOutwardSourceKind,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';
import { tdsDepositDueDate } from './tds-due-date.util';

const ZERO = new Prisma.Decimal(0);
const POST_COMMAND_TYPE = 'tds_deposit.post';
const REVERSE_COMMAND_TYPE = 'tds_deposit.reverse';
const PAYABLE_CODES: Record<TaxDeductionType, string> = {
  TDS: 'TDS_PAYABLE',
  CGST_TDS: 'GST_TDS_PAYABLE_CGST',
  SGST_TDS: 'GST_TDS_PAYABLE_SGST',
  IGST_TDS: 'GST_TDS_PAYABLE_IGST',
};

const dateOf = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
function hashRequest(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}
const sourceKey = (kind: TdsOutwardSourceKind, id: string) => `${kind}|${id}`;

const depositInclude = {
  legalEntity: { select: { legalName: true } },
  bankAccount: { select: { accountName: true } },
  _count: { select: { allocations: true } },
} satisfies Prisma.TdsDepositInclude;

function toSummary(row: Prisma.TdsDepositGetPayload<{ include: typeof depositInclude }>): TdsDepositSummary {
  return {
    id: row.id,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    bankAccountId: row.bankAccountId,
    bankAccountName: row.bankAccount.accountName,
    deductionType: row.deductionType,
    challanNumber: row.challanNumber,
    depositDate: dateOf(row.depositDate),
    amount: row.amount.toFixed(2),
    remarks: row.remarks,
    status: row.status,
    journalEntryId: row.journalEntryId,
    reversalJournalEntryId: row.reversalJournalEntryId,
    reversedAt: row.reversedAt?.toISOString() ?? null,
    reversalReason: row.reversalReason,
    allocationCount: row._count.allocations,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

interface WithheldAmount {
  sourceKind: TdsOutwardSourceKind;
  sourceId: string;
  deductionType: TaxDeductionType;
  legalEntityId: string;
  projectId: string | null;
  documentId: string;
  documentLabel: string;
  deductionDate: string;
  deducteeName: string;
  amount: Prisma.Decimal;
  /** The date its payment was reversed, if it was. */
  reversedOn: string | null;
}

/**
 * TDS and GST-TDS deposits (Phase 8.5b, ADR-113) and the withheld amounts
 * they pay. Four kinds of payment withhold tax into the payable accounts:
 * vendor payments (per deduction line), direct expenses, introducer payments
 * and salary payments (per employee line). A deposit posts Dr payable /
 * Cr bank for exactly what it allocates, so the payable account always
 * equals withheld minus deposited.
 */
@Injectable()
export class TdsDepositsService implements TdsDepositPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  async list(input: { organizationId: string; status: TdsDepositStatus | undefined; deductionType: TaxDeductionType | undefined }): Promise<TdsDepositSummary[]> {
    const rows = await this.prisma.client.tdsDeposit.findMany({
      where: { organizationId: input.organizationId, ...(input.status ? { status: input.status } : {}), ...(input.deductionType ? { deductionType: input.deductionType } : {}) },
      include: depositInclude,
      orderBy: [{ depositDate: 'desc' }, { challanNumber: 'asc' }],
    });
    return rows.map(toSummary);
  }

  async getDetail(input: { organizationId: string; id: string }): Promise<TdsDepositDetail> {
    const row = await this.prisma.client.tdsDeposit.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: { ...depositInclude, allocations: { select: { id: true, sourceKind: true, sourceId: true, amount: true } } },
    });
    if (!row) throwAppError('NOT_FOUND', 'TDS deposit not found.');
    const withheld = await this.withheldAmounts({ organizationId: input.organizationId, legalEntityId: row.legalEntityId, deductionType: row.deductionType, only: row.allocations });
    const byKey = new Map(withheld.map((w) => [sourceKey(w.sourceKind, w.sourceId), w]));
    const allocations: TdsDepositAllocationRow[] = row.allocations.map((a) => {
      const w = byKey.get(sourceKey(a.sourceKind, a.sourceId));
      return {
        id: a.id,
        sourceKind: a.sourceKind,
        sourceId: a.sourceId,
        documentId: w?.documentId ?? a.sourceId,
        documentLabel: w?.documentLabel ?? 'Document no longer found',
        deductionDate: w?.deductionDate ?? '',
        deducteeName: w?.deducteeName ?? '',
        amount: a.amount.toFixed(2),
      };
    });
    return { ...toSummary(row), allocations };
  }

  async listOutstanding(input: { organizationId: string; legalEntityId: string; deductionType: TaxDeductionType }): Promise<TdsOutwardItem[]> {
    const items = await this.outwardItems({ organizationId: input.organizationId, legalEntityId: input.legalEntityId, deductionType: input.deductionType, asOfDate: null, projectIds: null });
    return items.filter((i) => new Prisma.Decimal(i.remaining).greaterThan(0));
  }

  /**
   * Every amount withheld, with what deposits have paid of it. As of a date
   * (asOfDate), payments count from their date and stop counting from their
   * reversal's date, and deposits likewise; with no date, as things stand now.
   * `projectIds` limits to withholding tied to those projects (vendor
   * payments through their bill, direct expenses through their own project).
   */
  async outwardItems(input: { organizationId: string; legalEntityId: string | null; deductionType: TaxDeductionType | undefined; asOfDate: string | null; projectIds: string[] | null }): Promise<TdsOutwardItem[]> {
    const withheld = (await this.withheldAmounts({ organizationId: input.organizationId, legalEntityId: input.legalEntityId, deductionType: input.deductionType, only: null })).filter(
      (w) =>
        (!input.asOfDate || (w.deductionDate <= input.asOfDate && !(w.reversedOn && w.reversedOn <= input.asOfDate))) &&
        (input.asOfDate || !w.reversedOn) &&
        (!input.projectIds || (w.projectId !== null && input.projectIds.includes(w.projectId))),
    );
    const paid = await this.depositedBySource(input.organizationId, withheld, input.asOfDate);
    return withheld
      .map((w): TdsOutwardItem => {
        const p = paid.get(sourceKey(w.sourceKind, w.sourceId)) ?? { amount: ZERO, challans: [] as string[] };
        const remaining = w.amount.minus(p.amount);
        const dueDate = tdsDepositDueDate(w.deductionType, w.deductionDate);
        return {
          sourceKind: w.sourceKind,
          sourceId: w.sourceId,
          deductionType: w.deductionType,
          documentId: w.documentId,
          documentLabel: w.documentLabel,
          deductionDate: w.deductionDate,
          deducteeName: w.deducteeName,
          amount: w.amount.toFixed(2),
          deposited: p.amount.toFixed(2),
          remaining: remaining.toFixed(2),
          challanNumbers: [...new Set(p.challans)].sort(),
          dueDate,
          overdue: remaining.greaterThan(0) && (input.asOfDate ?? dateOf(new Date())) > dueDate,
        };
      })
      .sort((a, b) => a.deductionDate.localeCompare(b.deductionDate) || a.documentLabel.localeCompare(b.documentLabel) || a.deducteeName.localeCompare(b.deducteeName));
  }

  /** Σ deposit amounts by type standing on a date (posted by then, not reversed by then). */
  async depositTotals(input: { organizationId: string; legalEntityId: string | null; asOfDate: string }): Promise<Map<TaxDeductionType, Prisma.Decimal>> {
    const deposits = await this.prisma.client.tdsDeposit.findMany({
      where: { organizationId: input.organizationId, depositDate: { lte: asDate(input.asOfDate) }, ...(input.legalEntityId ? { legalEntityId: input.legalEntityId } : {}) },
      select: { deductionType: true, amount: true, reversalJournalEntry: { select: { accountingDate: true } } },
    });
    const totals = new Map<TaxDeductionType, Prisma.Decimal>();
    for (const d of deposits) {
      if (d.reversalJournalEntry && dateOf(d.reversalJournalEntry.accountingDate) <= input.asOfDate) continue;
      totals.set(d.deductionType, (totals.get(d.deductionType) ?? ZERO).plus(d.amount));
    }
    return totals;
  }

  async post(input: {
    organizationId: string;
    legalEntityId: string;
    bankAccountId: string;
    deductionType: TaxDeductionType;
    challanNumber: string;
    depositDate: string;
    remarks: string | undefined;
    allocations: Array<{ sourceKind: TdsOutwardSourceKind; sourceId: string; amount: string }>;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<TdsDepositDetail> {
    const db = this.prisma.client;
    const requestHash = hashRequest({ ...input, idempotencyKey: undefined, actorId: undefined, correlationId: undefined });
    const existingKey = await db.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: POST_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return this.getDetail({ organizationId: input.organizationId, id: existingKey.sourceRecordId! });
    }

    const keys = input.allocations.map((a) => sourceKey(a.sourceKind, a.sourceId));
    if (new Set(keys).size !== keys.length) throwAppError('VALIDATION_FAILED', 'A withheld amount appears more than once.');
    const [legalEntity, bankAccount] = await Promise.all([
      db.legalEntity.findFirst({ where: { id: input.legalEntityId, organizationId: input.organizationId, deletedAt: null }, select: { id: true } }),
      db.bankAccount.findFirst({ where: { id: input.bankAccountId, organizationId: input.organizationId }, select: { legalEntityId: true, ledgerAccountId: true, isActive: true, accountName: true } }),
    ]);
    if (!legalEntity) throwAppError('NOT_FOUND', 'Legal entity not found.');
    if (!bankAccount) throwAppError('NOT_FOUND', 'Bank account not found.');
    if (!bankAccount.isActive) throwAppError('VALIDATION_FAILED', 'This bank account is inactive.');
    if (bankAccount.legalEntityId !== input.legalEntityId) throwAppError('VALIDATION_FAILED', 'The bank account must belong to the same legal entity.');
    const payable = await db.ledgerAccount.findFirst({ where: { organizationId: input.organizationId, code: PAYABLE_CODES[input.deductionType] }, select: { id: true } });
    if (!payable) throwAppError('VALIDATION_FAILED', `The ledger account ${PAYABLE_CODES[input.deductionType]} is not set up.`);

    const depositId = generateId();
    try {
      await db.$transaction(async (tx) => {
        // One deposit of a type per legal entity at a time: two challans
        // paying the same withheld amount then serialise instead of both
        // passing the "remaining" check.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tds_deposit:${input.organizationId}:${input.legalEntityId}:${input.deductionType}`}, 0))`;
        const outstanding = await this.outwardItemsWithin(tx, { organizationId: input.organizationId, legalEntityId: input.legalEntityId, deductionType: input.deductionType });
        const byKey = new Map(outstanding.map((o) => [sourceKey(o.sourceKind, o.sourceId), o]));

        let total = ZERO;
        for (const a of input.allocations) {
          const item = byKey.get(sourceKey(a.sourceKind, a.sourceId));
          if (!item) throwAppError('VALIDATION_FAILED', `That withheld ${input.deductionType.replace('_', '-')} amount was not found for this legal entity, or its payment was reversed.`);
          const amount = new Prisma.Decimal(a.amount);
          if (!amount.greaterThan(0)) throwAppError('VALIDATION_FAILED', 'An allocated amount must be more than zero.');
          if (amount.greaterThan(item.remaining)) throwAppError('VALIDATION_FAILED', `Only ${item.remaining.toFixed(2)} of ${item.documentLabel} (${item.deducteeName}) is still to be deposited.`);
          total = total.plus(amount);
        }

        const line = { projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined };
        const journal = await this.posting.postJournalWithin(tx, {
          organizationId: input.organizationId,
          legalEntityId: input.legalEntityId,
          accountingDate: input.depositDate,
          sourceType: POST_COMMAND_TYPE,
          sourceId: depositId,
          postingEvent: 'tds_deposit.posted',
          description: `${input.deductionType.replace('_', '-')} deposited — challan ${input.challanNumber}`,
          lines: [
            { ledgerAccountId: payable.id, debit: total.toFixed(2), credit: '0', ...line },
            { ledgerAccountId: bankAccount.ledgerAccountId, debit: '0', credit: total.toFixed(2), ...line },
          ],
          idempotencyKey: `${POST_COMMAND_TYPE}:${input.idempotencyKey}`,
          actorId: input.actorId,
          correlationId: input.correlationId,
        });

        await tx.tdsDeposit.create({
          data: {
            id: depositId,
            organizationId: input.organizationId,
            legalEntityId: input.legalEntityId,
            bankAccountId: input.bankAccountId,
            deductionType: input.deductionType,
            challanNumber: input.challanNumber.trim(),
            depositDate: asDate(input.depositDate),
            amount: total,
            remarks: input.remarks ?? null,
            journalEntryId: journal.id,
            createdBy: input.actorId,
            updatedBy: input.actorId,
          },
        });
        await tx.tdsDepositAllocation.createMany({
          data: input.allocations.map((a) => ({ id: generateId(), organizationId: input.organizationId, depositId, sourceKind: a.sourceKind, sourceId: a.sourceId, amount: new Prisma.Decimal(a.amount) })),
        });
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          legalEntityId: input.legalEntityId,
          entityType: 'TDS_DEPOSIT',
          entityId: depositId,
          action: 'TDS_DEPOSIT_POSTED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { challanNumber: input.challanNumber, deductionType: input.deductionType, depositDate: input.depositDate, amount: total.toFixed(2), journalEntryId: journal.id, allocations: input.allocations },
        });
        await tx.idempotencyKey.create({
          data: { id: generateId(), organizationId: input.organizationId, commandType: POST_COMMAND_TYPE, idempotencyKey: input.idempotencyKey, requestHash, sourceRecordType: 'TDS_DEPOSIT', sourceRecordId: depositId },
        });
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002') {
        throwAppError('VALIDATION_FAILED', `Challan ${input.challanNumber} is already recorded for ${input.deductionType.replace('_', '-')}.`);
      }
      throw error;
    }
    return this.getDetail({ organizationId: input.organizationId, id: depositId });
  }

  async reverse(input: { organizationId: string; id: string; reason: string; accountingDate: string; expectedVersion: number; idempotencyKey: string; actorId: string; correlationId: string }): Promise<TdsDepositDetail> {
    const deposit = await this.prisma.client.tdsDeposit.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!deposit) throwAppError('NOT_FOUND', 'TDS deposit not found.');
    if (deposit.status === 'REVERSED') return this.getDetail({ organizationId: input.organizationId, id: deposit.id });
    if (deposit.version !== input.expectedVersion) throwAppError('VERSION_CONFLICT', 'This deposit was changed by someone else. Reload and try again.');
    if (input.accountingDate < dateOf(deposit.depositDate)) throwAppError('VALIDATION_FAILED', 'A reversal cannot be dated before the deposit.');

    const reversal = await this.posting.reverseJournal({
      organizationId: input.organizationId,
      id: deposit.journalEntryId,
      accountingDate: input.accountingDate,
      reason: input.reason,
      idempotencyKey: `${REVERSE_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });
    await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.tdsDeposit.updateMany({
        where: { id: deposit.id, status: 'POSTED', version: input.expectedVersion },
        data: { status: 'REVERSED', reversalJournalEntryId: reversal.id, reversedAt: new Date(), reversedBy: input.actorId, reversalReason: input.reason, updatedAt: new Date(), updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (updated.count !== 1) throwAppError('VERSION_CONFLICT', 'This deposit was changed by someone else. Reload and try again.');
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: deposit.legalEntityId,
        entityType: 'TDS_DEPOSIT',
        entityId: deposit.id,
        action: 'TDS_DEPOSIT_REVERSED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { status: 'POSTED' },
        newValues: { status: 'REVERSED', reversalJournalEntryId: reversal.id, accountingDate: input.accountingDate },
        reason: input.reason,
      });
    });
    return this.getDetail({ organizationId: input.organizationId, id: deposit.id });
  }

  // ---------------------------------------------------------------- private

  /** Current outstanding items read on the posting transaction, after its lock. */
  private async outwardItemsWithin(tx: Prisma.TransactionClient, input: { organizationId: string; legalEntityId: string; deductionType: TaxDeductionType }): Promise<Array<{ sourceKind: TdsOutwardSourceKind; sourceId: string; remaining: Prisma.Decimal; documentLabel: string; deducteeName: string }>> {
    const withheld = (await this.withheldAmounts({ ...input, only: null }, tx)).filter((w) => !w.reversedOn);
    const paid = await this.depositedBySource(input.organizationId, withheld, null, tx);
    return withheld.map((w) => ({
      sourceKind: w.sourceKind,
      sourceId: w.sourceId,
      remaining: w.amount.minus(paid.get(sourceKey(w.sourceKind, w.sourceId))?.amount ?? ZERO),
      documentLabel: w.documentLabel,
      deducteeName: w.deducteeName,
    }));
  }

  private async depositedBySource(organizationId: string, withheld: WithheldAmount[], asOfDate: string | null, db: Prisma.TransactionClient = this.prisma.client): Promise<Map<string, { amount: Prisma.Decimal; challans: string[] }>> {
    if (!withheld.length) return new Map();
    const allocations = await db.tdsDepositAllocation.findMany({
      where: { organizationId, sourceId: { in: [...new Set(withheld.map((w) => w.sourceId))] } },
      select: {
        sourceKind: true,
        sourceId: true,
        amount: true,
        deposit: { select: { challanNumber: true, depositDate: true, status: true, reversalJournalEntry: { select: { accountingDate: true } } } },
      },
    });
    const paid = new Map<string, { amount: Prisma.Decimal; challans: string[] }>();
    for (const a of allocations) {
      const d = a.deposit;
      const standing = asOfDate
        ? dateOf(d.depositDate) <= asOfDate && !(d.reversalJournalEntry && dateOf(d.reversalJournalEntry.accountingDate) <= asOfDate)
        : d.status === 'POSTED';
      if (!standing) continue;
      const key = sourceKey(a.sourceKind, a.sourceId);
      const entry = paid.get(key) ?? { amount: ZERO, challans: [] };
      entry.amount = entry.amount.plus(a.amount);
      entry.challans.push(d.challanNumber);
      paid.set(key, entry);
    }
    return paid;
  }

  /** Every withheld amount from the four sources, with its reversal date. `only` narrows to specific sources. */
  private async withheldAmounts(
    input: { organizationId: string; legalEntityId: string | null; deductionType: TaxDeductionType | undefined; only: Array<{ sourceKind: TdsOutwardSourceKind; sourceId: string }> | null },
    db: Prisma.TransactionClient = this.prisma.client,
  ): Promise<WithheldAmount[]> {
    const { organizationId } = input;
    const le = input.legalEntityId ? { legalEntityId: input.legalEntityId } : {};
    const idsOf = (kind: TdsOutwardSourceKind) => (input.only ? { id: { in: input.only.filter((o) => o.sourceKind === kind).map((o) => o.sourceId) } } : {});
    const wantsTds = !input.deductionType || input.deductionType === 'TDS';

    const [vendorDeductions, directExpenses, introducerPayments, salaryLines] = await Promise.all([
      db.vendorPaymentDeduction.findMany({
        where: {
          organizationId,
          ...idsOf('VENDOR_PAYMENT_DEDUCTION'),
          ...(input.deductionType ? { type: input.deductionType } : {}),
          allocation: { payment: { ...le } },
        },
        select: {
          id: true,
          type: true,
          amount: true,
          allocation: {
            select: {
              payment: { select: { id: true, legalEntityId: true, paymentDate: true, utrReference: true, reversalJournalEntry: { select: { accountingDate: true } } } },
              paymentRequestLine: { select: { vendorBill: { select: { vendorBillNumber: true, projectId: true, vendor: { select: { name: true } } } } } },
            },
          },
        },
      }),
      wantsTds
        ? db.directExpense.findMany({
            where: { organizationId, ...le, ...idsOf('DIRECT_EXPENSE'), tdsAmount: { gt: 0 }, journalEntryId: { not: null } },
            select: { id: true, legalEntityId: true, projectId: true, title: true, tdsAmount: true, journalEntry: { select: { accountingDate: true } }, reversalJournalEntry: { select: { accountingDate: true } }, vendor: { select: { name: true } } },
          })
        : [],
      wantsTds
        ? db.introducerPayment.findMany({
            where: { organizationId, ...le, ...idsOf('INTRODUCER_PAYMENT'), tdsAmount: { gt: 0 } },
            select: { id: true, legalEntityId: true, paymentNumber: true, paymentDate: true, tdsAmount: true, reversalJournalEntryId: true, introducer: { select: { name: true } } },
          })
        : [],
      wantsTds
        ? db.salaryPaymentLine.findMany({
            where: { organizationId, ...idsOf('SALARY_PAYMENT_LINE'), tdsAmount: { gt: 0 }, payment: { ...le } },
            select: {
              id: true,
              tdsAmount: true,
              employee: { select: { fullName: true } },
              payment: { select: { salaryImportId: true, legalEntityId: true, paymentNumber: true, paymentDate: true, reversalJournalEntryId: true } },
            },
          })
        : [],
    ]);

    // Introducer and salary payments hold only their reversal's id.
    const reversalIds = [...introducerPayments.map((p) => p.reversalJournalEntryId), ...salaryLines.map((l) => l.payment.reversalJournalEntryId)].filter((id): id is string => Boolean(id));
    const reversalDates = new Map(
      reversalIds.length ? (await db.journalEntry.findMany({ where: { id: { in: [...new Set(reversalIds)] } }, select: { id: true, accountingDate: true } })).map((j) => [j.id, dateOf(j.accountingDate)]) : [],
    );

    return [
      ...vendorDeductions.map((d): WithheldAmount => {
        const { payment, paymentRequestLine } = d.allocation;
        const bill = paymentRequestLine.vendorBill;
        return {
          sourceKind: 'VENDOR_PAYMENT_DEDUCTION',
          sourceId: d.id,
          deductionType: d.type,
          legalEntityId: payment.legalEntityId,
          projectId: bill.projectId,
          documentId: payment.id,
          documentLabel: `Vendor payment ${payment.utrReference ?? ''} · bill ${bill.vendorBillNumber}`.replace('  ', ' '),
          deductionDate: dateOf(payment.paymentDate),
          deducteeName: bill.vendor.name,
          amount: d.amount,
          reversedOn: payment.reversalJournalEntry ? dateOf(payment.reversalJournalEntry.accountingDate) : null,
        };
      }),
      ...directExpenses.map(
        (e): WithheldAmount => ({
          sourceKind: 'DIRECT_EXPENSE',
          sourceId: e.id,
          deductionType: 'TDS',
          legalEntityId: e.legalEntityId,
          projectId: e.projectId,
          documentId: e.id,
          documentLabel: `Direct expense · ${e.title}`,
          deductionDate: dateOf(e.journalEntry!.accountingDate),
          deducteeName: e.vendor?.name ?? e.title,
          amount: e.tdsAmount,
          reversedOn: e.reversalJournalEntry ? dateOf(e.reversalJournalEntry.accountingDate) : null,
        }),
      ),
      ...introducerPayments.map(
        (p): WithheldAmount => ({
          sourceKind: 'INTRODUCER_PAYMENT',
          sourceId: p.id,
          deductionType: 'TDS',
          legalEntityId: p.legalEntityId,
          projectId: null,
          documentId: p.id,
          documentLabel: `Introducer payment ${p.paymentNumber}`,
          deductionDate: dateOf(p.paymentDate),
          deducteeName: p.introducer.name,
          amount: p.tdsAmount,
          reversedOn: p.reversalJournalEntryId ? (reversalDates.get(p.reversalJournalEntryId) ?? null) : null,
        }),
      ),
      ...salaryLines.map(
        (l): WithheldAmount => ({
          sourceKind: 'SALARY_PAYMENT_LINE',
          sourceId: l.id,
          deductionType: 'TDS',
          legalEntityId: l.payment.legalEntityId,
          projectId: null,
          documentId: l.payment.salaryImportId,
          documentLabel: `Salary payment ${l.payment.paymentNumber}`,
          deductionDate: dateOf(l.payment.paymentDate),
          deducteeName: l.employee.fullName,
          amount: l.tdsAmount,
          reversedOn: l.payment.reversalJournalEntryId ? (reversalDates.get(l.payment.reversalJournalEntryId) ?? null) : null,
        }),
      ),
    ];
  }
}
