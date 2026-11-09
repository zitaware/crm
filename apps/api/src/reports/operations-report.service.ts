import { Injectable } from '@nestjs/common';
import { Prisma } from '@zitaware/database';
import type {
  ClientPaymentAllocationLine,
  ClientPaymentReport,
  ClientPaymentRow,
  EmdSdRecoveryReport,
  EmdSdRow,
  HoldReportStatus,
  IntroducerStatementAccount,
  IntroducerStatementLine,
  IntroducerStatementPayment,
  IntroducerStatementReport,
  LedgerReconciliation,
  PaymentHoldReport,
  PaymentHoldRow,
  PenaltyReport,
  PenaltyRow,
  ReceiptDeductionType,
  ReportReadInput,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { daysBetween } from './aging.util';
import { LedgerControlService } from './ledger-control.service';
import { notComparable, reconciled, reconciliationLine } from './reconciliation.util';
import { REPORT_CATALOG } from './report-catalog';
import { ReportScopeService } from './report-scope.service';

const ZERO = new Prisma.Decimal(0);
const INTRODUCER_PAYABLE_CODE = 'INTRODUCER_PAYABLE';
const INTRODUCER_ADVANCE_CODE = 'INTRODUCER_ADVANCE_RECEIVABLE';
// ReceiptsService's fallbacks when a penalty category names no account of its own.
const DEFAULT_ACCEPTED_PENALTY_CODE = 'PENALTY_REVENUE_DEDUCTION';
const DEFAULT_DISPUTED_PENALTY_CODE = 'DISPUTED_DEDUCTION_RECEIVABLE';

/** Same-day movements: what was accrued before what paid it, originals before their reversals. */
const ENTRY_ORDER: Record<IntroducerStatementLine['entryType'], number> = { ACCRUAL: 0, PAYMENT: 1, ACCRUAL_REVERSAL: 2, PAYMENT_REVERSAL: 3 };

const RECEIPT_DEDUCTION_TYPES: ReceiptDeductionType[] = ['TDS', 'CGST_TDS', 'SGST_TDS', 'IGST_TDS', 'HOLD', 'RETENTION', 'ACCEPTED_PENALTY', 'DISPUTED_PENALTY', 'OTHER'];
const zeroReceiptDeductions = (): Record<ReceiptDeductionType, Prisma.Decimal> => Object.fromEntries(RECEIPT_DEDUCTION_TYPES.map((t) => [t, ZERO])) as Record<ReceiptDeductionType, Prisma.Decimal>;
const receiptDeductionStrings = (d: Record<ReceiptDeductionType, Prisma.Decimal>) => Object.fromEntries(RECEIPT_DEDUCTION_TYPES.map((t) => [t, d[t].toFixed(2)])) as Record<ReceiptDeductionType, string>;

const dateOf = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const sum = (values: Array<Prisma.Decimal | string>) => values.reduce<Prisma.Decimal>((s, v) => s.plus(v), ZERO);

/** Accounting dates of the given journal entries, by id. */
async function journalDates(prisma: PrismaService, organizationId: string, ids: Array<string | null>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return new Map();
  const rows = await prisma.client.journalEntry.findMany({ where: { organizationId, id: { in: wanted } }, select: { id: true, accountingDate: true } });
  return new Map(rows.map((r) => [r.id, dateOf(r.accountingDate)]));
}

/**
 * Operations reports, part one (Phase 8.8a, ADR-117): EMD/SD Recovery,
 * Introducer Statement, Penalties and Payment Holds. Documents are read as
 * they stood on their own journal dates; reversals count from theirs.
 */
@Injectable()
export class OperationsReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ReportScopeService,
    private readonly ledger: LedgerControlService,
  ) {}

  /** docs/04 §16: instrument lifecycle, lodged/returned/outstanding and due dates; cash kept apart from guarantee exposure. */
  async emdSdRecovery(input: ReportReadInput): Promise<EmdSdRecoveryReport> {
    const { scope, projects } = await this.scopes.resolve({ ...input, filters: { ...input.filters, dateFrom: undefined } });
    const asOf = scope.asOfDate;
    const instruments = await this.prisma.client.securityInstrument.findMany({
      where: {
        organizationId: input.organizationId,
        submittedOn: { lte: asDate(asOf) },
        ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}),
        // A tender-only instrument belongs to no project, so a filtered view leaves it out.
        ...(scope.restricted ? { projectId: { in: projects.map((p) => p.id) } } : {}),
      },
      select: {
        id: true, amount: true, instrumentReferenceNo: true, issuingBank: true, lodgedWithAuthority: true, submittedOn: true, returnDueOn: true, returnedOn: true, projectId: true, tenderId: true,
        project: { select: { name: true } },
        tender: { select: { tenderNumber: true, title: true } },
        purpose: { select: { name: true, category: true } },
        type: { select: { name: true, requiresCashPosting: true } },
      },
    });

    const rows: EmdSdRow[] = instruments.map((i) => {
      const returnedOn = i.returnedOn && dateOf(i.returnedOn) <= asOf ? dateOf(i.returnedOn) : null;
      const returnDueOn = dateOf(i.returnDueOn);
      const overdueDays = daysBetween(returnDueOn, asOf);
      const status = returnedOn ? 'RETURNED' : overdueDays > 0 ? 'OVERDUE' : 'LODGED';
      return {
        instrumentId: i.id,
        category: i.purpose.category,
        purposeName: i.purpose.name,
        typeName: i.type.name,
        exposure: i.type.requiresCashPosting ? 'CASH' : 'GUARANTEE',
        projectId: i.projectId,
        projectName: i.project?.name ?? null,
        tenderId: i.tenderId,
        tenderLabel: i.tender ? `${i.tender.tenderNumber} — ${i.tender.title}` : null,
        referenceNo: i.instrumentReferenceNo,
        issuingBank: i.issuingBank,
        lodgedWithAuthority: i.lodgedWithAuthority,
        amount: i.amount.toFixed(2),
        submittedOn: dateOf(i.submittedOn),
        returnDueOn,
        returnedOn,
        status,
        outstandingAmount: returnedOn ? '0.00' : i.amount.toFixed(2),
        daysOverdue: status === 'OVERDUE' ? overdueDays : null,
      };
    });
    rows.sort((a, b) => a.returnDueOn.localeCompare(b.returnDueOn) || a.submittedOn.localeCompare(b.submittedOn));

    const outstanding = (list: EmdSdRow[], exposure: EmdSdRow['exposure']) => sum(list.filter((r) => r.exposure === exposure).map((r) => r.outstandingAmount));
    const returned = (list: EmdSdRow[]) => sum(list.filter((r) => r.status === 'RETURNED').map((r) => r.amount));
    const overdue = rows.filter((r) => r.status === 'OVERDUE');
    const cashOutstanding = outstanding(rows, 'CASH');

    let reconciliation: LedgerReconciliation;
    if (scope.restricted) {
      reconciliation = notComparable(input, 'Filtered to one client or project. The EMD/SD recoverable accounts hold every project\'s deposits, so they are compared only on the unfiltered view.');
    } else {
      const purposes = await this.prisma.client.securityInstrumentPurpose.findMany({
        where: { organizationId: input.organizationId, defaultRecoverableLedgerAccountId: { not: null } },
        select: { defaultRecoverableLedgerAccountId: true },
      });
      const lines = await this.ledger.reconcile({
        organizationId: input.organizationId,
        legalEntityId: scope.legalEntityId,
        asOfDate: asOf,
        requests: [
          { key: 'CASH_DEPOSITS', label: 'Cash EMD/SD still lodged', ledgerCodes: [], ledgerAccountIds: purposes.map((p) => p.defaultRecoverableLedgerAccountId!), reportAmount: cashOutstanding },
        ],
      });
      reconciliation = reconciled(lines);
    }

    return {
      catalog: REPORT_CATALOG['emd-sd-recovery'],
      scope,
      rows,
      byCategory: (['EMD', 'SD', 'UNCLASSIFIED'] as const)
        .map((category) => {
          const list = rows.filter((r) => (r.category ?? 'UNCLASSIFIED') === category);
          return { category, count: list.length, cashOutstanding: outstanding(list, 'CASH').toFixed(2), guaranteeOutstanding: outstanding(list, 'GUARANTEE').toFixed(2), returned: returned(list).toFixed(2) };
        })
        .filter((c) => c.count > 0),
      totals: {
        cashOutstanding: cashOutstanding.toFixed(2),
        guaranteeOutstanding: outstanding(rows, 'GUARANTEE').toFixed(2),
        returned: returned(rows).toFixed(2),
        overdueCount: overdue.length,
        overdueAmount: sum(overdue.map((r) => r.amount)).toFixed(2),
      },
      reconciliation,
    };
  }

  /** docs/04 §16: accrual, TDS, payment allocation, unallocated advance and balance by introducer and project. */
  async introducerStatement(input: ReportReadInput): Promise<IntroducerStatementReport> {
    const { scope, projects } = await this.scopes.resolve(input);
    const db = this.prisma.client;
    const asOf = scope.asOfDate;
    const projectById = new Map(projects.map((p) => [p.id, p]));

    const agreements = await db.introducerAgreement.findMany({
      where: { organizationId: input.organizationId, projectId: { in: [...projectById.keys()] }, ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}) },
      select: {
        id: true, basisType: true, ratePercent: true, fixedAmount: true, projectId: true,
        introducer: { select: { id: true, name: true } },
        accruals: {
          select: {
            id: true, accrualNumber: true, amount: true, narrative: true, journalEntryId: true, reversalJournalEntryId: true,
            allocations: { select: { allocatedAmount: true, payment: { select: { id: true, paymentNumber: true, narrative: true, journalEntryId: true, reversalJournalEntryId: true } } } },
          },
        },
      },
    });
    const payments = await db.introducerPayment.findMany({
      where: { organizationId: input.organizationId, ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}) },
      select: {
        id: true, paymentNumber: true, referenceNumber: true, grossAmount: true, tdsAmount: true, netAmount: true, advanceAmount: true, journalEntryId: true, reversalJournalEntryId: true,
        introducer: { select: { name: true } },
        allocations: { select: { allocatedAmount: true, accrual: { select: { agreement: { select: { projectId: true } } } } } },
      },
    });
    const dates = await journalDates(this.prisma, input.organizationId, [
      ...agreements.flatMap((a) => a.accruals.flatMap((c) => [c.journalEntryId, c.reversalJournalEntryId])),
      ...payments.flatMap((p) => [p.journalEntryId, p.reversalJournalEntryId]),
    ]);
    const byAsOf = (id: string | null) => (id ? dates.get(id) : undefined) ?? null;
    const standingOn = (posted: string | null, reversed: string | null) => posted !== null && posted <= asOf && !(reversed !== null && reversed <= asOf);

    const accounts: IntroducerStatementAccount[] = agreements.map((a) => {
      const project = projectById.get(a.projectId)!;
      const movements: Array<Omit<IntroducerStatementLine, 'balance'> & { signed: Prisma.Decimal }> = [];
      for (const c of a.accruals) {
        const posted = byAsOf(c.journalEntryId);
        const reversed = byAsOf(c.reversalJournalEntryId);
        if (posted && posted <= asOf) movements.push({ ledgerDate: posted, entryType: 'ACCRUAL', documentId: c.id, documentNumber: c.accrualNumber, narrative: c.narrative, accrued: c.amount.toFixed(2), paid: '0.00', journalEntryId: c.journalEntryId, signed: c.amount });
        if (reversed && reversed <= asOf) movements.push({ ledgerDate: reversed, entryType: 'ACCRUAL_REVERSAL', documentId: c.id, documentNumber: c.accrualNumber, narrative: c.narrative, accrued: c.amount.negated().toFixed(2), paid: '0.00', journalEntryId: c.reversalJournalEntryId!, signed: c.amount.negated() });
      }
      // One payment settling several accruals of this agreement is one line.
      const byPayment = new Map<string, { payment: (typeof a.accruals)[number]['allocations'][number]['payment']; amount: Prisma.Decimal }>();
      for (const al of a.accruals.flatMap((c) => c.allocations)) {
        const entry = byPayment.get(al.payment.id) ?? { payment: al.payment, amount: ZERO };
        entry.amount = entry.amount.plus(al.allocatedAmount);
        byPayment.set(al.payment.id, entry);
      }
      for (const { payment, amount } of byPayment.values()) {
        const paidOn = byAsOf(payment.journalEntryId);
        const unpaidOn = byAsOf(payment.reversalJournalEntryId);
        if (paidOn && paidOn <= asOf) movements.push({ ledgerDate: paidOn, entryType: 'PAYMENT', documentId: payment.id, documentNumber: payment.paymentNumber, narrative: payment.narrative, accrued: '0.00', paid: amount.toFixed(2), journalEntryId: payment.journalEntryId, signed: amount.negated() });
        if (unpaidOn && unpaidOn <= asOf) movements.push({ ledgerDate: unpaidOn, entryType: 'PAYMENT_REVERSAL', documentId: payment.id, documentNumber: payment.paymentNumber, narrative: payment.narrative, accrued: '0.00', paid: amount.negated().toFixed(2), journalEntryId: payment.reversalJournalEntryId!, signed: amount });
      }
      movements.sort((x, y) => x.ledgerDate.localeCompare(y.ledgerDate) || ENTRY_ORDER[x.entryType] - ENTRY_ORDER[y.entryType] || x.documentNumber.localeCompare(y.documentNumber));
      const before = movements.filter((m) => scope.dateFrom && m.ledgerDate < scope.dateFrom);
      const within = movements.filter((m) => !scope.dateFrom || m.ledgerDate >= scope.dateFrom);
      const opening = sum(before.map((m) => m.signed));
      let balance = opening;
      const lines: IntroducerStatementLine[] = within.map(({ signed, ...m }) => {
        balance = balance.plus(signed);
        return { ...m, balance: balance.toFixed(2) };
      });
      const accruedToDate = sum(movements.map((m) => m.accrued));
      const entitlement =
        a.basisType === 'FIXED_AMOUNT' ? (a.fixedAmount ?? null) : project.value !== null && a.ratePercent ? new Prisma.Decimal(project.value).times(a.ratePercent).dividedBy(100).toDecimalPlaces(2) : null;
      return {
        introducerId: a.introducer.id,
        introducerName: a.introducer.name,
        projectId: a.projectId,
        projectName: project.name,
        clientName: project.clientName,
        basisDescription: a.basisType === 'FIXED_AMOUNT' ? 'Fixed amount' : `${a.ratePercent ? new Prisma.Decimal(a.ratePercent).toString() : '—'}% of project value`,
        entitlement: entitlement ? entitlement.toFixed(2) : null,
        accruedToDate: accruedToDate.toFixed(2),
        notYetAccrued: entitlement ? entitlement.minus(accruedToDate).toFixed(2) : null,
        opening: opening.toFixed(2),
        accrued: sum(within.map((m) => m.accrued)).toFixed(2),
        paid: sum(within.map((m) => m.paid)).toFixed(2),
        closing: balance.toFixed(2),
        lines,
      };
    });
    accounts.sort((x, y) => x.introducerName.localeCompare(y.introducerName) || x.projectName.localeCompare(y.projectName));

    const inPeriod = (d: string | null) => d !== null && d <= asOf && (!scope.dateFrom || d >= scope.dateFrom);
    const paymentRows: IntroducerStatementPayment[] = [];
    for (const p of payments) {
      const allocated = sum(p.allocations.filter((al) => projectById.has(al.accrual.agreement.projectId)).map((al) => al.allocatedAmount));
      const inScope = p.allocations.some((al) => projectById.has(al.accrual.agreement.projectId));
      if (scope.restricted && !inScope) continue;
      const build = (entryType: IntroducerStatementPayment['entryType'], ledgerDate: string, sign: 1 | -1): IntroducerStatementPayment => ({
        paymentId: p.id,
        paymentNumber: p.paymentNumber,
        entryType,
        ledgerDate,
        introducerName: p.introducer.name,
        referenceNumber: p.referenceNumber,
        allocatedAmount: allocated.times(sign).toFixed(2),
        grossAmount: scope.restricted ? null : p.grossAmount.times(sign).toFixed(2),
        advanceAmount: scope.restricted ? null : p.advanceAmount.times(sign).toFixed(2),
        tdsAmount: scope.restricted ? null : p.tdsAmount.times(sign).toFixed(2),
        netAmount: scope.restricted ? null : p.netAmount.times(sign).toFixed(2),
      });
      const posted = byAsOf(p.journalEntryId);
      const reversed = byAsOf(p.reversalJournalEntryId);
      if (inPeriod(posted)) paymentRows.push(build('PAYMENT', posted!, 1));
      if (inPeriod(reversed)) paymentRows.push(build('REVERSAL', reversed!, -1));
    }
    paymentRows.sort((x, y) => x.ledgerDate.localeCompare(y.ledgerDate) || x.paymentNumber.localeCompare(y.paymentNumber));

    const total = (k: 'opening' | 'accrued' | 'paid' | 'closing') => sum(accounts.map((a) => a[k]));
    const closing = total('closing');
    const advanceOutstanding = scope.restricted ? null : sum(payments.filter((p) => standingOn(byAsOf(p.journalEntryId), byAsOf(p.reversalJournalEntryId))).map((p) => p.advanceAmount));

    let reconciliation: LedgerReconciliation;
    if (scope.restricted) {
      reconciliation = notComparable(input, 'Filtered to one client or project. Introducer Payable holds every project\'s commission and advances are not assigned to a project, so they are compared only on the unfiltered view.');
    } else {
      const balances = await this.ledger.periodMovementByCode({ organizationId: input.organizationId, legalEntityId: scope.legalEntityId, dateFrom: null, dateTo: asOf, codes: [INTRODUCER_PAYABLE_CODE, INTRODUCER_ADVANCE_CODE] });
      const payable = balances.get(INTRODUCER_PAYABLE_CODE);
      const advance = balances.get(INTRODUCER_ADVANCE_CODE);
      reconciliation = reconciled([
        reconciliationLine('INTRODUCER_PAYABLE', 'Commission still payable (closing)', payable?.account, closing, payable ? payable.debitMinusCredit.negated() : ZERO),
        reconciliationLine('INTRODUCER_ADVANCE', 'Unallocated advance paid', advance?.account, advanceOutstanding!, advance?.debitMinusCredit ?? ZERO),
      ]);
    }

    return {
      catalog: REPORT_CATALOG['introducer-statement'],
      scope,
      accounts,
      payments: paymentRows,
      totals: {
        opening: total('opening').toFixed(2),
        accrued: total('accrued').toFixed(2),
        paid: total('paid').toFixed(2),
        closing: closing.toFixed(2),
        entitlement: sum(accounts.flatMap((a) => (a.entitlement ? [a.entitlement] : []))).toFixed(2),
        notYetAccrued: sum(accounts.flatMap((a) => (a.notYetAccrued ? [a.notYetAccrued] : []))).toFixed(2),
      },
      advanceOutstanding: advanceOutstanding ? advanceOutstanding.toFixed(2) : null,
      reconciliation,
    };
  }

  /** docs/04 §16: typed penalties with their accepted/disputed state and accounting treatment, in the period of the receipt. */
  async penalties(input: ReportReadInput): Promise<PenaltyReport> {
    const { scope, projects } = await this.scopes.resolve(input);
    const db = this.prisma.client;
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const range = { lte: asDate(scope.asOfDate), ...(scope.dateFrom ? { gte: asDate(scope.dateFrom) } : {}) };
    const inPeriod = (d: string | null) => d !== null && d <= scope.asOfDate && (!scope.dateFrom || d >= scope.dateFrom);

    const deductions = await db.allocationDeduction.findMany({
      where: {
        organizationId: input.organizationId,
        type: { in: ['ACCEPTED_PENALTY', 'DISPUTED_PENALTY'] },
        allocation: {
          invoice: { projectId: { in: [...projectById.keys()] } },
          receipt: { ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}), OR: [{ journalEntry: { accountingDate: range } }, { reversalJournalEntry: { accountingDate: range } }] },
        },
      },
      select: {
        id: true, type: true, amount: true, narrative: true,
        penaltyCategory: { select: { name: true, acceptedLedgerAccount: { select: { id: true, code: true, name: true } }, disputedLedgerAccount: { select: { id: true, code: true, name: true } } } },
        allocation: {
          select: {
            invoice: { select: { id: true, invoiceNumber: true, projectId: true } },
            receipt: { select: { id: true, utrReference: true, journalEntry: { select: { id: true, accountingDate: true } }, reversalJournalEntry: { select: { id: true, accountingDate: true } } } },
          },
        },
      },
    });
    const defaults = new Map(
      (await db.ledgerAccount.findMany({ where: { organizationId: input.organizationId, code: { in: [DEFAULT_ACCEPTED_PENALTY_CODE, DEFAULT_DISPUTED_PENALTY_CODE] } }, select: { id: true, code: true, name: true } })).map((a) => [a.code, a]),
    );

    const rows: PenaltyRow[] = [];
    const accountsUsed = new Map<string, { id: string; code: string; name: string }>();
    for (const d of deductions) {
      const accepted = d.type === 'ACCEPTED_PENALTY';
      const account = (accepted ? d.penaltyCategory?.acceptedLedgerAccount : d.penaltyCategory?.disputedLedgerAccount) ?? defaults.get(accepted ? DEFAULT_ACCEPTED_PENALTY_CODE : DEFAULT_DISPUTED_PENALTY_CODE);
      if (account) accountsUsed.set(account.code, account);
      const { invoice, receipt } = d.allocation;
      const project = projectById.get(invoice.projectId)!;
      const base = {
        deductionId: d.id, status: accepted ? ('ACCEPTED' as const) : ('DISPUTED' as const), categoryName: d.penaltyCategory?.name ?? null,
        invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber ?? '', projectId: invoice.projectId, projectName: project.name, clientName: project.clientName ?? '',
        receiptId: receipt.id, utrReference: receipt.utrReference, narrative: d.narrative, ledgerAccountName: account?.name ?? '—',
      };
      const posted = receipt.journalEntry ? dateOf(receipt.journalEntry.accountingDate) : null;
      const reversed = receipt.reversalJournalEntry ? dateOf(receipt.reversalJournalEntry.accountingDate) : null;
      if (inPeriod(posted)) rows.push({ ...base, entryType: 'DEDUCTION', ledgerDate: posted!, amount: d.amount.toFixed(2) });
      if (inPeriod(reversed)) rows.push({ ...base, entryType: 'REVERSAL', ledgerDate: reversed!, amount: d.amount.negated().toFixed(2) });
    }
    rows.sort((a, b) => a.ledgerDate.localeCompare(b.ledgerDate) || a.invoiceNumber.localeCompare(b.invoiceNumber));

    const ofStatus = (list: PenaltyRow[], status: PenaltyRow['status']) => sum(list.filter((r) => r.status === status).map((r) => r.amount));
    const accepted = ofStatus(rows, 'ACCEPTED');
    const disputed = ofStatus(rows, 'DISPUTED');
    const categories = [...new Set(rows.map((r) => r.categoryName ?? 'Uncategorised'))].sort();

    let reconciliation: LedgerReconciliation;
    if (scope.restricted) {
      reconciliation = notComparable(input, 'Filtered to one client or project. The penalty accounts hold every project\'s deductions, so they are compared only on the unfiltered view.');
    } else {
      const acceptedCodes = new Set<string>([DEFAULT_ACCEPTED_PENALTY_CODE]);
      const disputedCodes = new Set<string>([DEFAULT_DISPUTED_PENALTY_CODE]);
      for (const d of deductions) {
        if (d.penaltyCategory?.acceptedLedgerAccount) acceptedCodes.add(d.penaltyCategory.acceptedLedgerAccount.code);
        if (d.penaltyCategory?.disputedLedgerAccount) disputedCodes.add(d.penaltyCategory.disputedLedgerAccount.code);
      }
      const movement = await this.ledger.movementBySource({
        organizationId: input.organizationId, legalEntityId: scope.legalEntityId, dateFrom: scope.dateFrom, dateTo: scope.asOfDate,
        codes: [...acceptedCodes, ...disputedCodes], sourceTypes: ['receipt_post'],
      });
      const side = (codes: Set<string>) => [...codes].map((c) => movement.get(c)).filter((m): m is NonNullable<typeof m> => Boolean(m));
      reconciliation = reconciled([
        reconciliationLine('ACCEPTED', 'Accepted penalties deducted', undefined, accepted, sum(side(acceptedCodes).map((m) => m.debitMinusCredit)), side(acceptedCodes).map((m) => m.account)),
        reconciliationLine('DISPUTED', 'Disputed penalties deducted', undefined, disputed, sum(side(disputedCodes).map((m) => m.debitMinusCredit)), side(disputedCodes).map((m) => m.account)),
      ]);
    }

    return {
      catalog: REPORT_CATALOG.penalties,
      scope,
      rows,
      byCategory: categories.map((categoryName) => {
        const list = rows.filter((r) => (r.categoryName ?? 'Uncategorised') === categoryName);
        return { categoryName, accepted: ofStatus(list, 'ACCEPTED').toFixed(2), disputed: ofStatus(list, 'DISPUTED').toFixed(2) };
      }),
      totals: {
        accepted: accepted.toFixed(2),
        disputed: disputed.toFixed(2),
        acceptedCount: rows.filter((r) => r.status === 'ACCEPTED' && r.entryType === 'DEDUCTION').length,
        disputedCount: rows.filter((r) => r.status === 'DISPUTED' && r.entryType === 'DEDUCTION').length,
      },
      reconciliation,
    };
  }

  /** docs/04 §16: hold and retention withheld, each release against its original deduction, and what is still to recover. */
  async paymentHolds(input: ReportReadInput): Promise<PaymentHoldReport> {
    const { scope, projects } = await this.scopes.resolve({ ...input, filters: { ...input.filters, dateFrom: undefined } });
    const db = this.prisma.client;
    const asOf = scope.asOfDate;
    const projectById = new Map(projects.map((p) => [p.id, p]));

    const deductions = await db.allocationDeduction.findMany({
      where: {
        organizationId: input.organizationId,
        type: { in: ['HOLD', 'RETENTION'] },
        allocation: {
          invoice: { projectId: { in: [...projectById.keys()] } },
          receipt: { receiptDate: { lte: asDate(asOf) }, ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}) },
        },
      },
      select: {
        id: true, type: true, amount: true, narrative: true,
        releases: { select: { releasedAmount: true, releasedOn: true, utrReference: true }, orderBy: { releasedOn: 'asc' } },
        allocation: {
          select: {
            invoice: { select: { id: true, invoiceNumber: true, projectId: true } },
            receipt: { select: { id: true, receiptDate: true, reversalJournalEntry: { select: { accountingDate: true } } } },
          },
        },
      },
    });

    const rows: PaymentHoldRow[] = [];
    for (const d of deductions) {
      const { invoice, receipt } = d.allocation;
      if (receipt.reversalJournalEntry && dateOf(receipt.reversalJournalEntry.accountingDate) <= asOf) continue;
      const releases = d.releases.filter((r) => dateOf(r.releasedOn) <= asOf);
      const released = sum(releases.map((r) => r.releasedAmount));
      const outstanding = d.amount.minus(released);
      const status: HoldReportStatus = released.isZero() ? 'OUTSTANDING' : outstanding.isZero() ? 'RELEASED' : 'PARTIALLY_RELEASED';
      const project = projectById.get(invoice.projectId)!;
      rows.push({
        deductionId: d.id, type: d.type as 'HOLD' | 'RETENTION', invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber ?? '', projectId: invoice.projectId, projectName: project.name, clientName: project.clientName ?? '',
        receiptId: receipt.id, receiptDate: dateOf(receipt.receiptDate), narrative: d.narrative, amount: d.amount.toFixed(2), releasedAmount: released.toFixed(2), outstandingAmount: outstanding.toFixed(2), status,
        lastReleasedOn: releases.length ? dateOf(releases[releases.length - 1]!.releasedOn) : null,
        releases: releases.map((r) => ({ releasedOn: dateOf(r.releasedOn), amount: r.releasedAmount.toFixed(2), utrReference: r.utrReference })),
      });
    }
    rows.sort((a, b) => a.receiptDate.localeCompare(b.receiptDate) || a.invoiceNumber.localeCompare(b.invoiceNumber) || a.type.localeCompare(b.type));

    const totalsOf = (type: 'HOLD' | 'RETENTION') => {
      const list = rows.filter((r) => r.type === type);
      return { withheld: sum(list.map((r) => r.amount)).toFixed(2), released: sum(list.map((r) => r.releasedAmount)).toFixed(2), outstanding: sum(list.map((r) => r.outstandingAmount)).toFixed(2), count: list.length };
    };
    const totals = { HOLD: totalsOf('HOLD'), RETENTION: totalsOf('RETENTION') };

    const reconciliation = scope.restricted
      ? notComparable(input, 'Filtered to one client or project. The hold and retention accounts hold every project\'s deductions, so they are compared only on the unfiltered view.')
      : reconciled(
          await this.ledger.reconcile({
            organizationId: input.organizationId,
            legalEntityId: scope.legalEntityId,
            asOfDate: asOf,
            requests: [
              { key: 'HOLD', label: 'Hold still to recover', ledgerCodes: ['HOLD_RECEIVABLE'], reportAmount: new Prisma.Decimal(totals.HOLD.outstanding) },
              { key: 'RETENTION', label: 'Retention still to recover', ledgerCodes: ['RETENTION_RECEIVABLE'], reportAmount: new Prisma.Decimal(totals.RETENTION.outstanding) },
            ],
          }),
        );

    return { catalog: REPORT_CATALOG['payment-holds'], scope, rows, totals, reconciliation };
  }

  /** docs/04 §16 (report-payment): client receipts — actual cash, invoice settled, each deduction type and unallocated cash kept separate. */
  async clientPayments(input: ReportReadInput): Promise<ClientPaymentReport> {
    const { scope, projects } = await this.scopes.resolve(input);
    const db = this.prisma.client;
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const range = { lte: asDate(scope.asOfDate), ...(scope.dateFrom ? { gte: asDate(scope.dateFrom) } : {}) };
    const inPeriod = (d: string | null) => d !== null && d <= scope.asOfDate && (!scope.dateFrom || d >= scope.dateFrom);

    const receipts = await db.clientReceipt.findMany({
      where: {
        organizationId: input.organizationId,
        ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}),
        allocations: { some: { invoice: { projectId: { in: [...projectById.keys()] } } } },
        OR: [{ journalEntry: { accountingDate: range } }, { reversalJournalEntry: { accountingDate: range } }],
      },
      select: {
        id: true, receiptDate: true, utrReference: true, actualAmount: true,
        bankAccount: { select: { accountName: true, ledgerAccount: { select: { code: true } } } },
        paymentMode: { select: { label: true } },
        journalEntry: { select: { accountingDate: true } },
        reversalJournalEntry: { select: { accountingDate: true } },
        allocations: {
          select: { cashAllocated: true, settledAmount: true, invoice: { select: { id: true, invoiceNumber: true, projectId: true } }, deductions: { select: { type: true, amount: true } } },
        },
      },
    });

    const rows: ClientPaymentRow[] = [];
    for (const r of receipts) {
      const allocations = r.allocations.filter((a) => projectById.has(a.invoice.projectId));
      const build = (entryType: ClientPaymentRow['entryType'], ledgerDate: string, sign: 1 | -1): ClientPaymentRow => {
        const deductions = zeroReceiptDeductions();
        const lines: ClientPaymentAllocationLine[] = allocations.map((a) => {
          const own = zeroReceiptDeductions();
          for (const d of a.deductions) own[d.type] = own[d.type].plus(d.amount.times(sign));
          for (const t of RECEIPT_DEDUCTION_TYPES) deductions[t] = deductions[t].plus(own[t]);
          const project = projectById.get(a.invoice.projectId)!;
          return {
            invoiceId: a.invoice.id, invoiceNumber: a.invoice.invoiceNumber ?? '', projectId: a.invoice.projectId, projectName: project.name, clientName: project.clientName,
            cashAllocated: a.cashAllocated.times(sign).toFixed(2), deductions: receiptDeductionStrings(own), settledAmount: a.settledAmount.times(sign).toFixed(2),
          };
        });
        const cashAllocated = sum(allocations.map((a) => a.cashAllocated));
        const actual = scope.restricted ? cashAllocated : r.actualAmount;
        return {
          receiptId: r.id, entryType, ledgerDate, receiptDate: dateOf(r.receiptDate), utrReference: r.utrReference, bankAccountName: r.bankAccount.accountName, paymentModeName: r.paymentMode.label,
          clientNames: [...new Set(lines.map((l) => l.clientName ?? '—'))].sort(),
          actualAmount: actual.times(sign).toFixed(2),
          invoiceSettled: sum(allocations.map((a) => a.settledAmount)).times(sign).toFixed(2),
          deductions: receiptDeductionStrings(deductions),
          deductionTotal: sum(RECEIPT_DEDUCTION_TYPES.map((t) => deductions[t])).toFixed(2),
          unallocatedCash: scope.restricted ? '0.00' : r.actualAmount.minus(cashAllocated).times(sign).toFixed(2),
          allocations: lines,
        };
      };
      const posted = r.journalEntry ? dateOf(r.journalEntry.accountingDate) : null;
      const reversed = r.reversalJournalEntry ? dateOf(r.reversalJournalEntry.accountingDate) : null;
      if (inPeriod(posted)) rows.push(build('RECEIPT', posted!, 1));
      if (inPeriod(reversed)) rows.push(build('REVERSAL', reversed!, -1));
    }
    rows.sort((a, b) => a.ledgerDate.localeCompare(b.ledgerDate) || a.entryType.localeCompare(b.entryType) || (a.utrReference ?? '').localeCompare(b.utrReference ?? ''));

    const totalDeductions = zeroReceiptDeductions();
    for (const r of rows) for (const t of RECEIPT_DEDUCTION_TYPES) totalDeductions[t] = totalDeductions[t].plus(r.deductions[t]);
    const actual = sum(rows.map((r) => r.actualAmount));
    const settled = sum(rows.map((r) => r.invoiceSettled));
    const clients = new Map<string, { actual: Prisma.Decimal; settled: Prisma.Decimal; deducted: Prisma.Decimal }>();
    for (const r of rows) {
      for (const l of r.allocations) {
        const key = l.clientName ?? '—';
        const c = clients.get(key) ?? { actual: ZERO, settled: ZERO, deducted: ZERO };
        c.actual = c.actual.plus(l.cashAllocated);
        c.settled = c.settled.plus(l.settledAmount);
        c.deducted = c.deducted.plus(sum(RECEIPT_DEDUCTION_TYPES.map((t) => l.deductions[t])));
        clients.set(key, c);
      }
    }

    let reconciliation: LedgerReconciliation;
    if (scope.restricted) {
      reconciliation = notComparable(input, 'Filtered to one client or project. A receipt\'s postings cover every invoice it settled, so they are compared only on the unfiltered view.');
    } else {
      const bankCodes = [...new Set((await db.bankAccount.findMany({ where: { organizationId: input.organizationId }, select: { ledgerAccount: { select: { code: true } } } })).map((b) => b.ledgerAccount.code))];
      const movement = await this.ledger.movementBySource({
        organizationId: input.organizationId, legalEntityId: scope.legalEntityId, dateFrom: scope.dateFrom, dateTo: scope.asOfDate, codes: ['ACCOUNTS_RECEIVABLE', ...bankCodes], sourceTypes: ['receipt_post'],
      });
      const bank = bankCodes.map((c) => movement.get(c)).filter((m): m is NonNullable<typeof m> => Boolean(m));
      const ar = movement.get('ACCOUNTS_RECEIVABLE');
      reconciliation = reconciled([
        reconciliationLine('CASH_RECEIVED', 'Actual cash received', undefined, actual, sum(bank.map((m) => m.debitMinusCredit)), bank.map((m) => m.account)),
        reconciliationLine('INVOICE_SETTLED', 'Invoices settled (cash + deductions)', ar?.account, settled, ar ? ar.debitMinusCredit.negated() : ZERO),
      ]);
    }

    return {
      catalog: REPORT_CATALOG['client-payments'],
      scope,
      rows,
      totals: {
        actualAmount: actual.toFixed(2),
        invoiceSettled: settled.toFixed(2),
        deductions: receiptDeductionStrings(totalDeductions),
        deductionTotal: sum(RECEIPT_DEDUCTION_TYPES.map((t) => totalDeductions[t])).toFixed(2),
        unallocatedCash: sum(rows.map((r) => r.unallocatedCash)).toFixed(2),
      },
      byClient: [...clients.entries()]
        .map(([clientName, c]) => ({ clientName, actualAmount: c.actual.toFixed(2), invoiceSettled: c.settled.toFixed(2), deductionTotal: c.deducted.toFixed(2) }))
        .sort((a, b) => a.clientName.localeCompare(b.clientName)),
      reconciliation,
    };
  }
}
