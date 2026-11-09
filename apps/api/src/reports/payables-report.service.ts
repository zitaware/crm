import { Injectable } from '@nestjs/common';
import { Prisma } from '@zitaware/database';
import { AGING_BUCKETS } from '@zitaware/contracts';
import type {
  AgingBucket,
  EmployeeAdvanceReport,
  EmployeeAdvanceRow,
  ExpenseReport,
  ExpenseRow,
  LedgerReconciliation,
  PayablesAgingReport,
  PayablesAgingRow,
  ReimbursementReport,
  ReimbursementRow,
  ReportReadInput,
  TaxDeductionAmounts,
  VendorPaymentAllocationLine,
  VendorPaymentReport,
  VendorPaymentRow,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { agingBucket, daysBetween } from './aging.util';
import { LedgerControlService } from './ledger-control.service';
import { notComparable, reconciled, reconciliationLine as line } from './reconciliation.util';
import { REPORT_CATALOG } from './report-catalog';
import { ReportScopeService } from './report-scope.service';

const ZERO = new Prisma.Decimal(0);
const AP_CODE = 'ACCOUNTS_PAYABLE_VENDOR';
const ADVANCE_CODE = 'EMPLOYEE_ADVANCE_RECEIVABLE';
const TAX_PAYABLE_CODES = { TDS: 'TDS_PAYABLE', CGST_TDS: 'GST_TDS_PAYABLE_CGST', SGST_TDS: 'GST_TDS_PAYABLE_SGST', IGST_TDS: 'GST_TDS_PAYABLE_IGST' } as const;
const REVERSAL_SOURCE_TYPE = 'journal_entry_reversal';

const dateOf = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const zeroDeductions = () => ({ TDS: ZERO, CGST_TDS: ZERO, SGST_TDS: ZERO, IGST_TDS: ZERO });
const deductionStrings = (d: Record<keyof TaxDeductionAmounts, Prisma.Decimal>): TaxDeductionAmounts => ({ TDS: d.TDS.toFixed(2), CGST_TDS: d.CGST_TDS.toFixed(2), SGST_TDS: d.SGST_TDS.toFixed(2), IGST_TDS: d.IGST_TDS.toFixed(2) });

/**
 * Payables and employee-spend reports (Phase 8.7, ADR-116): Payables Aging,
 * Vendor Payments, Expenses, Reimbursements and Employee Advances. Each reads
 * the documents and compares its totals with the postings those documents
 * made.
 */
@Injectable()
export class PayablesReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ReportScopeService,
    private readonly ledger: LedgerControlService,
  ) {}

  /** Owed to vendors on the as-of date, aged from the document date (vendor bills carry no due date). */
  async payablesAging(input: ReportReadInput): Promise<PayablesAgingReport> {
    const { scope, projects } = await this.scopes.resolve({ ...input, filters: { ...input.filters, dateFrom: undefined } });
    const db = this.prisma.client;
    const asOf = scope.asOfDate;
    const standing = (payment: { paymentDate: Date; reversalJournalEntry: { accountingDate: Date } | null }) =>
      dateOf(payment.paymentDate) <= asOf && !(payment.reversalJournalEntry && dateOf(payment.reversalJournalEntry.accountingDate) <= asOf);

    const bills = await db.vendorBill.findMany({
      where: {
        organizationId: input.organizationId,
        journalEntry: { accountingDate: { lte: asDate(asOf) } },
        ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}),
        ...(scope.restricted ? { projectId: { in: projects.map((p) => p.id) } } : {}),
      },
      select: {
        id: true,
        vendorBillNumber: true,
        vendorBillDate: true,
        totalAmount: true,
        projectId: true,
        project: { select: { name: true } },
        vendor: { select: { id: true, name: true } },
        voidJournalEntry: { select: { accountingDate: true } },
        paymentRequestLines: {
          select: {
            requestedAmount: true,
            paymentRequest: { select: { status: true } },
            allocations: { select: { settledAmount: true, payment: { select: { paymentDate: true, reversalJournalEntry: { select: { accountingDate: true } } } } } },
          },
        },
      },
    });

    const rows: PayablesAgingRow[] = [];
    for (const b of bills) {
      if (b.voidJournalEntry && dateOf(b.voidJournalEntry.accountingDate) <= asOf) continue;
      let settled = ZERO;
      let approvedForPayment = ZERO;
      for (const l of b.paymentRequestLines) {
        const lineSettled = l.allocations.filter((a) => standing(a.payment)).reduce((s, a) => s.plus(a.settledAmount), ZERO);
        settled = settled.plus(lineSettled);
        if (l.paymentRequest.status === 'APPROVED') approvedForPayment = approvedForPayment.plus(Prisma.Decimal.max(ZERO, l.requestedAmount.minus(lineSettled)));
      }
      const total = b.totalAmount ?? ZERO;
      const outstanding = total.minus(settled);
      if (outstanding.isZero()) continue;
      const documentDate = dateOf(b.vendorBillDate);
      const ageDays = daysBetween(documentDate, asOf);
      rows.push({
        documentType: 'VENDOR_BILL', documentId: b.id, number: b.vendorBillNumber, documentDate, vendorId: b.vendor.id, vendorName: b.vendor.name,
        projectId: b.projectId, projectName: b.project?.name ?? null, totalAmount: total.toFixed(2), settledAmount: settled.toFixed(2), outstandingAmount: outstanding.toFixed(2),
        approvedForPayment: Prisma.Decimal.min(approvedForPayment, outstanding).toFixed(2), ageDays, bucket: agingBucket(ageDays),
      });
    }

    if (!scope.restricted) {
      // A direct stock receipt from a named supplier is booked to Accounts Payable too.
      const receipts = await db.inventoryReceipt.findMany({
        where: { organizationId: input.organizationId, receiptType: 'DIRECT', partyId: { not: null }, receivedDate: { lte: asDate(asOf) }, ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}) },
        select: { id: true, receiptNumber: true, receivedDate: true, totalValueAmount: true, reversalJournalEntryId: true, party: { select: { id: true, name: true } } },
      });
      const reversals = new Map(
        (await db.journalEntry.findMany({ where: { id: { in: receipts.map((r) => r.reversalJournalEntryId).filter((id): id is string => Boolean(id)) } }, select: { id: true, accountingDate: true } })).map((j) => [j.id, dateOf(j.accountingDate)]),
      );
      for (const r of receipts) {
        const reversedOn = r.reversalJournalEntryId ? reversals.get(r.reversalJournalEntryId) : undefined;
        if (reversedOn && reversedOn <= asOf) continue;
        const documentDate = dateOf(r.receivedDate);
        const ageDays = daysBetween(documentDate, asOf);
        rows.push({
          documentType: 'STOCK_RECEIPT', documentId: r.id, number: r.receiptNumber, documentDate, vendorId: r.party?.id ?? null, vendorName: r.party?.name ?? '—',
          projectId: null, projectName: null, totalAmount: r.totalValueAmount.toFixed(2), settledAmount: '0.00', outstandingAmount: r.totalValueAmount.toFixed(2),
          approvedForPayment: '0.00', ageDays, bucket: agingBucket(ageDays),
        });
      }
    }
    rows.sort((a, b) => a.documentDate.localeCompare(b.documentDate) || a.number.localeCompare(b.number));

    const total = rows.reduce((s, r) => s.plus(r.outstandingAmount), ZERO);
    const buckets = AGING_BUCKETS.map((bucket) => {
      const inBucket = rows.filter((r) => r.bucket === bucket);
      return { bucket, amount: inBucket.reduce((s, r) => s.plus(r.outstandingAmount), ZERO).toFixed(2), count: inBucket.length };
    });
    const vendorMap = new Map<string, { vendorId: string | null; vendorName: string; outstanding: Prisma.Decimal; byBucket: Record<AgingBucket, Prisma.Decimal> }>();
    for (const r of rows) {
      const key = r.vendorId ?? r.vendorName;
      const v = vendorMap.get(key) ?? { vendorId: r.vendorId, vendorName: r.vendorName, outstanding: ZERO, byBucket: Object.fromEntries(AGING_BUCKETS.map((b) => [b, ZERO])) as Record<AgingBucket, Prisma.Decimal> };
      v.outstanding = v.outstanding.plus(r.outstandingAmount);
      v.byBucket[r.bucket] = v.byBucket[r.bucket].plus(r.outstandingAmount);
      vendorMap.set(key, v);
    }

    let reconciliation: LedgerReconciliation;
    if (scope.restricted) {
      reconciliation = notComparable(input, 'Filtered to one client or project. Accounts Payable also holds stock receipts and other projects\' bills, so it is compared only on the unfiltered view.');
    } else {
      const ap = (await this.ledger.periodMovementByCode({ organizationId: input.organizationId, legalEntityId: scope.legalEntityId, dateFrom: null, dateTo: asOf, codes: [AP_CODE] })).get(AP_CODE);
      reconciliation = reconciled([line('ACCOUNTS_PAYABLE', 'Owed to vendors', ap?.account, total, ap ? ap.debitMinusCredit.negated() : ZERO)]);
    }

    return {
      catalog: REPORT_CATALOG['payables-aging'],
      scope,
      rows,
      buckets,
      vendors: [...vendorMap.values()]
        .map((v) => ({ vendorId: v.vendorId, vendorName: v.vendorName, outstanding: v.outstanding.toFixed(2), byBucket: Object.fromEntries(AGING_BUCKETS.map((b) => [b, v.byBucket[b].toFixed(2)])) as Record<AgingBucket, string> }))
        .sort((a, b) => a.vendorName.localeCompare(b.vendorName)),
      total: total.toFixed(2),
      approvedForPaymentTotal: rows.reduce((s, r) => s.plus(r.approvedForPayment), ZERO).toFixed(2),
      reconciliation,
    };
  }

  /** Vendor payments in the period, a reversal as a negative row in its own period; reconciled to the payable, bank and TDS postings. */
  async vendorPayments(input: ReportReadInput): Promise<VendorPaymentReport> {
    const { scope, projects } = await this.scopes.resolve(input);
    const db = this.prisma.client;
    const range = { lte: asDate(scope.asOfDate), ...(scope.dateFrom ? { gte: asDate(scope.dateFrom) } : {}) };
    const inRange = (d: Date) => dateOf(d) <= scope.asOfDate && (!scope.dateFrom || dateOf(d) >= scope.dateFrom);
    const selected = new Set(projects.map((p) => p.id));

    const payments = await db.vendorPayment.findMany({
      where: { organizationId: input.organizationId, ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}), OR: [{ journalEntry: { accountingDate: range } }, { reversalJournalEntry: { accountingDate: range } }] },
      select: {
        id: true,
        paymentDate: true,
        utrReference: true,
        actualAmount: true,
        bankAccount: { select: { accountName: true } },
        cardAccount: { select: { displayName: true, maskedLastFour: true, cardNumber: true } },
        journalEntry: { select: { id: true, accountingDate: true } },
        reversalJournalEntry: { select: { id: true, accountingDate: true } },
        allocations: {
          select: {
            cashPaid: true,
            settledAmount: true,
            requestedAmountSnapshot: true,
            deductions: { select: { type: true, amount: true } },
            paymentRequestLine: { select: { vendorBill: { select: { id: true, vendorBillNumber: true, projectId: true, project: { select: { name: true } }, vendor: { select: { name: true } } } } } },
          },
        },
      },
    });

    const rows: VendorPaymentRow[] = [];
    for (const p of payments) {
      const allocations = p.allocations.filter((a) => !scope.restricted || selected.has(a.paymentRequestLine.vendorBill.projectId ?? ''));
      if (!allocations.length) continue;
      const build = (entryType: VendorPaymentRow['entryType'], je: { id: string; accountingDate: Date }, sign: 1 | -1): VendorPaymentRow => {
        const deductions = zeroDeductions();
        const lines: VendorPaymentAllocationLine[] = allocations.map((a) => {
          const own = zeroDeductions();
          for (const d of a.deductions) own[d.type] = own[d.type].plus(d.amount.times(sign));
          for (const k of Object.keys(deductions) as Array<keyof TaxDeductionAmounts>) deductions[k] = deductions[k].plus(own[k]);
          const bill = a.paymentRequestLine.vendorBill;
          return {
            vendorBillId: bill.id, vendorBillNumber: bill.vendorBillNumber, projectId: bill.projectId, projectName: bill.project?.name ?? null, vendorName: bill.vendor.name,
            requestedAmount: a.requestedAmountSnapshot.times(sign).toFixed(2), cashPaid: a.cashPaid.times(sign).toFixed(2), deductions: deductionStrings(own), settledAmount: a.settledAmount.times(sign).toFixed(2),
          };
        });
        const cash = scope.restricted ? allocations.reduce((s, a) => s.plus(a.cashPaid), ZERO) : p.actualAmount;
        return {
          paymentId: p.id, entryType, ledgerDate: dateOf(je.accountingDate), paymentDate: dateOf(p.paymentDate), utrReference: p.utrReference, bankAccountName: p.bankAccount?.accountName ?? (p.cardAccount ? `${p.cardAccount.displayName.trim()} · ${p.cardAccount.cardNumber ?? `•••• ${p.cardAccount.maskedLastFour}`}` : '—'),
          vendorNames: [...new Set(allocations.map((a) => a.paymentRequestLine.vendorBill.vendor.name))].sort(),
          cashPaid: cash.times(sign).toFixed(2), deductions: deductionStrings(deductions), settledAmount: allocations.reduce((s, a) => s.plus(a.settledAmount), ZERO).times(sign).toFixed(2), allocations: lines, journalEntryId: je.id,
        };
      };
      if (p.journalEntry && inRange(p.journalEntry.accountingDate)) rows.push(build('PAYMENT', p.journalEntry, 1));
      if (p.reversalJournalEntry && inRange(p.reversalJournalEntry.accountingDate)) rows.push(build('REVERSAL', p.reversalJournalEntry, -1));
    }
    rows.sort((a, b) => a.ledgerDate.localeCompare(b.ledgerDate) || a.entryType.localeCompare(b.entryType));

    const totalDeductions = zeroDeductions();
    let cash = ZERO;
    let settled = ZERO;
    const vendors = new Map<string, { cash: Prisma.Decimal; deducted: Prisma.Decimal; settled: Prisma.Decimal }>();
    for (const r of rows) {
      cash = cash.plus(r.cashPaid);
      settled = settled.plus(r.settledAmount);
      for (const k of Object.keys(totalDeductions) as Array<keyof TaxDeductionAmounts>) totalDeductions[k] = totalDeductions[k].plus(r.deductions[k]);
      for (const a of r.allocations) {
        const v = vendors.get(a.vendorName) ?? { cash: ZERO, deducted: ZERO, settled: ZERO };
        v.cash = v.cash.plus(a.cashPaid);
        v.deducted = v.deducted.plus([a.deductions.TDS, a.deductions.CGST_TDS, a.deductions.SGST_TDS, a.deductions.IGST_TDS].reduce((s, x) => s.plus(x), ZERO));
        v.settled = v.settled.plus(a.settledAmount);
        vendors.set(a.vendorName, v);
      }
    }

    let reconciliation: LedgerReconciliation;
    if (scope.restricted) {
      reconciliation = notComparable(input, 'Filtered to one client or project. A payment\'s postings cover every bill it paid, so they are compared only on the unfiltered view.');
    } else {
      const bankAccounts = await db.bankAccount.findMany({ where: { organizationId: input.organizationId }, select: { ledgerAccount: { select: { code: true } } } });
      const bankCodes = [...new Set(bankAccounts.map((b) => b.ledgerAccount.code))];
      const movement = await this.ledger.movementBySource({
        organizationId: input.organizationId, legalEntityId: scope.legalEntityId, dateFrom: scope.dateFrom, dateTo: scope.asOfDate,
        codes: [AP_CODE, ...Object.values(TAX_PAYABLE_CODES), ...bankCodes], sourceTypes: ['vendor_payment_post'],
      });
      const bank = bankCodes.map((c) => movement.get(c)).filter((m): m is NonNullable<typeof m> => Boolean(m));
      const taxAccounts = Object.values(TAX_PAYABLE_CODES).map((c) => movement.get(c)).filter((m): m is NonNullable<typeof m> => Boolean(m));
      const deducted = Object.values(totalDeductions).reduce((s, x) => s.plus(x), ZERO);
      reconciliation = reconciled([
        line('PAYABLE_SETTLED', 'Payables settled (cash + deductions)', movement.get(AP_CODE)?.account, settled, movement.get(AP_CODE)?.debitMinusCredit ?? ZERO),
        line('BANK_PAID', 'Cash paid from the bank', undefined, cash, bank.reduce((s, m) => s.minus(m.debitMinusCredit), ZERO), bank.map((m) => m.account)),
        line('TAX_WITHHELD', 'TDS and GST-TDS withheld', undefined, deducted, taxAccounts.reduce((s, m) => s.minus(m.debitMinusCredit), ZERO), taxAccounts.map((m) => m.account)),
      ]);
    }

    return {
      catalog: REPORT_CATALOG['vendor-payments'],
      scope,
      rows,
      totals: { cashPaid: cash.toFixed(2), deductions: deductionStrings(totalDeductions), settledAmount: settled.toFixed(2) },
      byVendor: [...vendors.entries()].map(([vendorName, v]) => ({ vendorName, cashPaid: v.cash.toFixed(2), deducted: v.deducted.toFixed(2), settledAmount: v.settled.toFixed(2) })).sort((a, b) => a.vendorName.localeCompare(b.vendorName)),
      reconciliation,
    };
  }

  /** Posted spend in the period: vendor-bill expense lines, direct expenses and approved claims — never requests or forecasts. */
  async expenses(input: ReportReadInput): Promise<ExpenseReport> {
    const { scope, projects } = await this.scopes.resolve(input);
    const db = this.prisma.client;
    const range = { lte: asDate(scope.asOfDate), ...(scope.dateFrom ? { gte: asDate(scope.dateFrom) } : {}) };
    const inRange = (d: Date) => dateOf(d) <= scope.asOfDate && (!scope.dateFrom || dateOf(d) >= scope.dateFrom);
    const common = { organizationId: input.organizationId, ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}), ...(scope.restricted ? { projectId: { in: projects.map((p) => p.id) } } : {}) };

    const [bills, directExpenses, claims] = await Promise.all([
      db.vendorBill.findMany({
        where: { ...common, OR: [{ journalEntry: { accountingDate: range } }, { voidJournalEntry: { accountingDate: range } }] },
        select: {
          id: true, vendorBillNumber: true, projectId: true, project: { select: { name: true } }, vendor: { select: { name: true } },
          journalEntry: { select: { id: true, accountingDate: true } }, voidJournalEntry: { select: { id: true, accountingDate: true } },
          lines: { where: { inventoryItemId: null }, select: { description: true, taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true, itcEligible: true, expenseCategory: { select: { name: true } } } },
        },
      }),
      db.directExpense.findMany({
        where: { ...common, OR: [{ journalEntry: { accountingDate: range } }, { reversalJournalEntry: { accountingDate: range } }] },
        select: {
          id: true, title: true, amount: true, cgstAmount: true, sgstAmount: true, igstAmount: true, itcEligible: true, projectId: true, project: { select: { name: true } }, vendor: { select: { name: true } },
          expenseCategory: { select: { name: true } }, journalEntry: { select: { id: true, accountingDate: true } }, reversalJournalEntry: { select: { id: true, accountingDate: true } },
        },
      }),
      db.employeeExpenseClaim.findMany({
        where: { ...common, journalEntry: { accountingDate: range } },
        select: { id: true, title: true, amount: true, gstCreditAmount: true, projectId: true, project: { select: { name: true } }, employee: { select: { fullName: true } }, expenseCategory: { select: { name: true } }, journalEntry: { select: { id: true, accountingDate: true } } },
      }),
    ]);

    const rows: ExpenseRow[] = [];
    const push = (row: Omit<ExpenseRow, 'grossAmount' | 'eligibleGst' | 'recognizedAmount' | 'ledgerDate' | 'journalEntryId'>, je: { id: string; accountingDate: Date }, gross: Prisma.Decimal, eligible: Prisma.Decimal, sign: 1 | -1) =>
      rows.push({ ...row, ledgerDate: dateOf(je.accountingDate), journalEntryId: je.id, grossAmount: gross.times(sign).toFixed(2), eligibleGst: eligible.times(sign).toFixed(2), recognizedAmount: gross.minus(eligible).times(sign).toFixed(2) });

    for (const b of bills) {
      for (const l of b.lines) {
        const gst = l.cgstAmount.plus(l.sgstAmount).plus(l.igstAmount);
        const base = { documentId: b.id, documentLabel: `${b.vendorBillNumber} · ${l.description}`, category: l.expenseCategory?.name ?? 'Uncategorised', projectId: b.projectId, projectName: b.project?.name ?? null, counterparty: b.vendor.name };
        if (b.journalEntry && inRange(b.journalEntry.accountingDate)) push({ ...base, sourceType: 'VENDOR_BILL_LINE' }, b.journalEntry, l.taxableAmount.plus(gst), l.itcEligible ? gst : ZERO, 1);
        if (b.voidJournalEntry && inRange(b.voidJournalEntry.accountingDate)) push({ ...base, sourceType: 'VENDOR_BILL_VOID' }, b.voidJournalEntry, l.taxableAmount.plus(gst), l.itcEligible ? gst : ZERO, -1);
      }
    }
    for (const e of directExpenses) {
      const gst = e.cgstAmount.plus(e.sgstAmount).plus(e.igstAmount);
      const base = { documentId: e.id, documentLabel: e.title, category: e.expenseCategory.name, projectId: e.projectId, projectName: e.project?.name ?? null, counterparty: e.vendor?.name ?? null };
      if (e.journalEntry && inRange(e.journalEntry.accountingDate)) push({ ...base, sourceType: 'DIRECT_EXPENSE' }, e.journalEntry, e.amount, e.itcEligible ? gst : ZERO, 1);
      if (e.reversalJournalEntry && inRange(e.reversalJournalEntry.accountingDate)) push({ ...base, sourceType: 'DIRECT_EXPENSE_REVERSAL' }, e.reversalJournalEntry, e.amount, e.itcEligible ? gst : ZERO, -1);
    }
    for (const c of claims) {
      push({ sourceType: 'EXPENSE_CLAIM', documentId: c.id, documentLabel: c.title, category: c.expenseCategory.name, projectId: c.projectId, projectName: c.project?.name ?? null, counterparty: c.employee.fullName }, c.journalEntry!, c.amount, c.gstCreditAmount, 1);
    }
    rows.sort((a, b) => a.ledgerDate.localeCompare(b.ledgerDate) || a.documentLabel.localeCompare(b.documentLabel));

    const sum = (list: ExpenseRow[], k: 'grossAmount' | 'eligibleGst' | 'recognizedAmount') => list.reduce((s, r) => s.plus(r[k]), ZERO);
    const group = <K extends string>(keyOf: (r: ExpenseRow) => K) => {
      const m = new Map<K, ExpenseRow[]>();
      for (const r of rows) m.set(keyOf(r), [...(m.get(keyOf(r)) ?? []), r]);
      return m;
    };
    const recognized = sum(rows, 'recognizedAmount');

    let reconciliation: LedgerReconciliation;
    if (scope.restricted) {
      reconciliation = notComparable(input, 'Filtered to one client or project. The expense accounts also hold spend with no project, so they are compared only on the unfiltered view.');
    } else {
      const movement = await this.ledger.movementBySource({
        organizationId: input.organizationId, legalEntityId: scope.legalEntityId, dateFrom: scope.dateFrom, dateTo: scope.asOfDate,
        codes: [], accountTypes: ['EXPENSE'], sourceTypes: ['vendor_bill_approve', 'direct_expense.post', 'employee_expense_claim.approve'],
      });
      const touched = [...movement.values()].filter((m) => !m.debitMinusCredit.isZero());
      reconciliation = reconciled([line('EXPENSE', 'Expense recognized', undefined, recognized, touched.reduce((s, m) => s.plus(m.debitMinusCredit), ZERO), touched.map((m) => m.account))]);
    }

    return {
      catalog: REPORT_CATALOG.expenses,
      scope,
      rows,
      byCategory: [...group((r) => r.category).entries()].map(([category, list]) => ({ category, recognizedAmount: sum(list, 'recognizedAmount').toFixed(2), grossAmount: sum(list, 'grossAmount').toFixed(2) })).sort((a, b) => a.category.localeCompare(b.category)),
      byProject: [...group((r) => r.projectId ?? '').entries()]
        .map(([projectId, list]) => ({ projectId: projectId || null, projectName: list[0]!.projectName ?? 'Not assigned to a project', recognizedAmount: sum(list, 'recognizedAmount').toFixed(2) }))
        .sort((a, b) => Number(a.projectId === null) - Number(b.projectId === null) || a.projectName.localeCompare(b.projectName)),
      totals: { grossAmount: sum(rows, 'grossAmount').toFixed(2), eligibleGst: sum(rows, 'eligibleGst').toFixed(2), recognizedAmount: recognized.toFixed(2) },
      reconciliation,
    };
  }

  /** Employee claims with activity in the period, each with its status on the end date. */
  async reimbursements(input: ReportReadInput): Promise<ReimbursementReport> {
    const { scope, projects } = await this.scopes.resolve(input);
    const db = this.prisma.client;
    const asOf = scope.asOfDate;
    const inPeriod = (d: string | null) => Boolean(d) && d! <= asOf && (!scope.dateFrom || d! >= scope.dateFrom);

    const claims = await db.employeeExpenseClaim.findMany({
      where: {
        organizationId: input.organizationId,
        status: { not: 'DRAFT' },
        expenseDate: { lte: asDate(asOf) },
        ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}),
        ...(scope.restricted ? { projectId: { in: projects.map((p) => p.id) } } : {}),
      },
      select: {
        id: true, title: true, amount: true, gstCreditAmount: true, status: true, expenseDate: true, employeeId: true, projectId: true,
        employee: { select: { fullName: true } }, expenseCategory: { select: { name: true } }, project: { select: { name: true } },
        journalEntry: { select: { accountingDate: true } }, reimbursementJournalEntry: { select: { accountingDate: true } }, reimbursementReversalJournalEntry: { select: { accountingDate: true } },
      },
    });

    const rows: ReimbursementRow[] = [];
    for (const c of claims) {
      const approvedOn = c.journalEntry && dateOf(c.journalEntry.accountingDate) <= asOf ? dateOf(c.journalEntry.accountingDate) : null;
      const reimbursed = c.reimbursementJournalEntry && dateOf(c.reimbursementJournalEntry.accountingDate) <= asOf;
      const reversedByAsOf = c.reimbursementReversalJournalEntry && dateOf(c.reimbursementReversalJournalEntry.accountingDate) <= asOf;
      const reimbursedOn = reimbursed && !reversedByAsOf ? dateOf(c.reimbursementJournalEntry!.accountingDate) : null;
      const status: ReimbursementRow['status'] = reimbursedOn ? 'REIMBURSED' : approvedOn ? 'APPROVED' : c.status === 'REJECTED' || c.status === 'CANCELLED' ? c.status : 'SUBMITTED';
      const expenseDate = dateOf(c.expenseDate);
      if (scope.dateFrom && !inPeriod(expenseDate) && !inPeriod(approvedOn) && !inPeriod(reimbursedOn) && status !== 'APPROVED' && status !== 'SUBMITTED') continue;
      rows.push({
        claimId: c.id, employeeId: c.employeeId, employeeName: c.employee.fullName, title: c.title, category: c.expenseCategory.name, projectId: c.projectId, projectName: c.project?.name ?? null,
        expenseDate, amount: c.amount.toFixed(2), gstCreditAmount: c.gstCreditAmount.toFixed(2), status, approvedOn, reimbursedOn,
      });
    }
    rows.sort((a, b) => a.expenseDate.localeCompare(b.expenseDate) || a.employeeName.localeCompare(b.employeeName));

    const tally = (list: ReimbursementRow[]) => ({ count: list.length, amount: list.reduce((s, r) => s.plus(r.amount), ZERO).toFixed(2) });
    const approvedInPeriod = rows.filter((r) => inPeriod(r.approvedOn));
    const reimbursedInPeriod = rows.filter((r) => inPeriod(r.reimbursedOn));
    const employees = new Map<string, { employeeName: string; approved: Prisma.Decimal; reimbursed: Prisma.Decimal; awaiting: Prisma.Decimal }>();
    for (const r of rows) {
      const e = employees.get(r.employeeId) ?? { employeeName: r.employeeName, approved: ZERO, reimbursed: ZERO, awaiting: ZERO };
      if (inPeriod(r.approvedOn)) e.approved = e.approved.plus(r.amount);
      if (inPeriod(r.reimbursedOn)) e.reimbursed = e.reimbursed.plus(r.amount);
      if (r.status === 'APPROVED') e.awaiting = e.awaiting.plus(r.amount);
      employees.set(r.employeeId, e);
    }

    let reconciliation: LedgerReconciliation;
    if (scope.restricted) {
      reconciliation = notComparable(input, 'Filtered to one client or project. The advance account holds every employee\'s claims, so it is compared only on the unfiltered view.');
    } else {
      const movementFor = async (sourceTypes: string[]) =>
        (await this.ledger.movementBySource({ organizationId: input.organizationId, legalEntityId: scope.legalEntityId, dateFrom: scope.dateFrom, dateTo: asOf, codes: [ADVANCE_CODE], sourceTypes })).get(ADVANCE_CODE);
      const [approvals, reimbursements] = await Promise.all([movementFor(['employee_expense_claim.approve']), movementFor(['employee_expense_claim.reimburse'])]);
      reconciliation = reconciled([
        line('CLAIMS_APPROVED', 'Claims approved in the period', approvals?.account, new Prisma.Decimal(tally(approvedInPeriod).amount), approvals ? approvals.debitMinusCredit.negated() : ZERO),
        line('CLAIMS_REIMBURSED', 'Claims reimbursed in the period', reimbursements?.account, new Prisma.Decimal(tally(reimbursedInPeriod).amount), reimbursements?.debitMinusCredit ?? ZERO),
      ]);
    }

    return {
      catalog: REPORT_CATALOG.reimbursements,
      scope,
      rows,
      totals: {
        approvedInPeriod: tally(approvedInPeriod),
        reimbursedInPeriod: tally(reimbursedInPeriod),
        awaitingReimbursement: tally(rows.filter((r) => r.status === 'APPROVED')),
        awaitingApproval: tally(rows.filter((r) => r.status === 'SUBMITTED')),
        rejected: tally(rows.filter((r) => r.status === 'REJECTED')),
      },
      byEmployee: [...employees.entries()].map(([employeeId, e]) => ({ employeeId, employeeName: e.employeeName, approved: e.approved.toFixed(2), reimbursed: e.reimbursed.toFixed(2), awaitingReimbursement: e.awaiting.toFixed(2) })).sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
      reconciliation,
    };
  }

  /** docs/04 §16 "Employee Advance Report": opening + advances − approved adjustments ± settlements = closing, per employee. */
  async employeeAdvances(input: ReportReadInput): Promise<EmployeeAdvanceReport> {
    const companyInput: ReportReadInput = { ...input, canSeeAllProjects: true, filters: { ...input.filters, clientId: undefined, projectId: undefined } };
    const { scope } = await this.scopes.resolve(companyInput);
    const db = this.prisma.client;
    const account = await db.ledgerAccount.findFirst({ where: { organizationId: input.organizationId, code: ADVANCE_CODE }, select: { id: true } });
    const lines = account
      ? await db.journalLine.findMany({
          where: { ledgerAccountId: account.id, journalEntry: { accountingDate: { lte: asDate(scope.asOfDate) }, ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}) } },
          select: { employeeId: true, debitAmount: true, creditAmount: true, employee: { select: { fullName: true } }, journalEntry: { select: { accountingDate: true, sourceType: true, reversalOf: { select: { sourceType: true } } } } },
        })
      : [];

    type Acc = { employeeName: string; opening: Prisma.Decimal; advances: Prisma.Decimal; claims: Prisma.Decimal; reimbursements: Prisma.Decimal; other: Prisma.Decimal };
    const byEmployee = new Map<string, Acc>();
    for (const l of lines) {
      const key = l.employeeId ?? '';
      const acc = byEmployee.get(key) ?? { employeeName: l.employee?.fullName ?? 'No employee on the entry', opening: ZERO, advances: ZERO, claims: ZERO, reimbursements: ZERO, other: ZERO };
      const net = l.debitAmount.minus(l.creditAmount);
      const date = dateOf(l.journalEntry.accountingDate);
      if (scope.dateFrom && date < scope.dateFrom) {
        acc.opening = acc.opening.plus(net);
      } else {
        const origin = l.journalEntry.sourceType === REVERSAL_SOURCE_TYPE && l.journalEntry.reversalOf ? l.journalEntry.reversalOf.sourceType : l.journalEntry.sourceType;
        if (origin === 'employee_advance.issue') acc.advances = acc.advances.plus(net);
        else if (origin === 'employee_expense_claim.approve') acc.claims = acc.claims.minus(net);
        else if (origin === 'employee_expense_claim.reimburse') acc.reimbursements = acc.reimbursements.plus(net);
        else acc.other = acc.other.plus(net);
      }
      byEmployee.set(key, acc);
    }

    const rows: EmployeeAdvanceRow[] = [...byEmployee.entries()]
      .map(([employeeId, a]) => {
        const closing = a.opening.plus(a.advances).minus(a.claims).plus(a.reimbursements).plus(a.other);
        return { employeeId: employeeId || null, employeeName: a.employeeName, opening: a.opening.toFixed(2), advances: a.advances.toFixed(2), claimsAdjusted: a.claims.toFixed(2), reimbursements: a.reimbursements.toFixed(2), other: a.other.toFixed(2), closing: closing.toFixed(2) };
      })
      .filter((r) => [r.opening, r.advances, r.claimsAdjusted, r.reimbursements, r.other, r.closing].some((v) => v !== '0.00'))
      .sort((a, b) => Number(a.employeeId === null) - Number(b.employeeId === null) || a.employeeName.localeCompare(b.employeeName));

    const total = (k: keyof Omit<EmployeeAdvanceRow, 'employeeId' | 'employeeName'>) => rows.reduce((s, r) => s.plus(r[k]), ZERO);
    const closing = total('closing');
    const ledgerLines = await this.ledger.reconcile({
      organizationId: input.organizationId,
      legalEntityId: scope.legalEntityId,
      asOfDate: scope.asOfDate,
      requests: [{ key: 'EMPLOYEE_ADVANCES', label: 'Employee advance balances (closing)', ledgerCodes: [ADVANCE_CODE], reportAmount: closing }],
    });

    return {
      catalog: REPORT_CATALOG['employee-advances'],
      scope,
      rows,
      totals: { opening: total('opening').toFixed(2), advances: total('advances').toFixed(2), claimsAdjusted: total('claimsAdjusted').toFixed(2), reimbursements: total('reimbursements').toFixed(2), other: total('other').toFixed(2), closing: closing.toFixed(2) },
      reconciliation: reconciled(ledgerLines),
    };
  }
}
