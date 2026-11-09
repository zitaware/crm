import { Injectable } from '@nestjs/common';
import { Prisma } from '@zitaware/database';
import { CASH_CATEGORIES, CASH_INFLOW_CATEGORIES, COST_CATEGORIES } from '@zitaware/contracts';
import type {
  BusinessOverviewCard,
  BusinessOverviewProjectRow,
  BusinessOverviewReport,
  CashCategory,
  CashProfitabilityReport,
  CashProfitabilityRow,
  ContractPerformanceReport,
  ContractPerformanceRow,
  CostCategory,
  LedgerReconciliation,
  ReportReadInput,
  ReportScope,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { apportion, naturalCashAmount, percentOf } from './cash-attribution.util';
import { LedgerControlService } from './ledger-control.service';
import { ProfitabilityReportService } from './profitability-report.service';
import { REPORT_CATALOG } from './report-catalog';
import { ReportScopeService, type ScopedProject } from './report-scope.service';

const ZERO = new Prisma.Decimal(0);
const REVERSAL_SOURCE_TYPE = 'journal_entry_reversal';
const SOURCE_TYPE_CATEGORIES: Record<string, CashCategory> = {
  salary_payment: 'SALARY_PAYMENT',
  'tds_deposit.post': 'TAX_DEPOSIT',
  'card_account.settle': 'CARD_SETTLEMENT',
};

/** One journal entry's bank movement, and how much of it each project's document accounts for. */
interface CashEntry {
  category: CashCategory;
  /** Money in (inflow category) or money out (other categories); negative for a reversal. */
  natural: Prisma.Decimal;
  parts: Array<{ projectId: string; amount: Prisma.Decimal }>;
}

function emptyCash(): Record<CashCategory, Prisma.Decimal> {
  return Object.fromEntries(CASH_CATEGORIES.map((c) => [c, ZERO])) as Record<CashCategory, Prisma.Decimal>;
}
function decimalOrNull(value: string | null): Prisma.Decimal | null {
  return value === null ? null : new Prisma.Decimal(value);
}

function notComparable(input: ReportReadInput, filteredReason: string): LedgerReconciliation {
  return {
    applicable: false,
    notApplicableReason: input.canSeeAllProjects ? filteredReason : 'You can see only the projects assigned to you, so these totals cannot be compared with the whole ledger.',
    lines: [],
    allReconciled: false,
  };
}

/**
 * Cash Profitability, Contract/Budget Performance and the Business Overview
 * (Phase 8.3, ADR-110). Each keeps to one basis — cash, contract/budget — and
 * the overview shows every figure under its own basis rather than blending
 * them into one "profit" (docs/04 §16, docs/06 "Reports").
 */
@Injectable()
export class PerformanceReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ReportScopeService,
    private readonly profitability: ProfitabilityReportService,
    private readonly ledger: LedgerControlService,
  ) {}

  /**
   * Bank movement in the period, attributed to projects by the document that
   * moved it: net cash = cash in (client receipts, hold/retention released) −
   * cash out (vendor payments, direct expenses, reimbursements, advances,
   * introducer payments, deposits). Projects + not assigned = the bank
   * accounts' movement, which is what it reconciles to.
   */
  async cashProfitability(input: ReportReadInput): Promise<CashProfitabilityReport> {
    const { scope, projects } = await this.scopes.resolve(input);
    const entries = await this.cashEntries(input, scope);

    const byProject = new Map(projects.map((p) => [p.id, emptyCash()]));
    const unassigned = emptyCash();
    for (const entry of entries) {
      let attributed = ZERO;
      for (const part of entry.parts) {
        const amounts = byProject.get(part.projectId);
        if (!amounts) continue; // another project's cash: outside this view, or (unrestricted) left in "not assigned" below
        amounts[entry.category] = amounts[entry.category].plus(part.amount);
        attributed = attributed.plus(part.amount);
      }
      unassigned[entry.category] = unassigned[entry.category].plus(entry.natural.minus(attributed));
    }

    const row = (project: ScopedProject | null, projectName: string, amounts: Record<CashCategory, Prisma.Decimal>): CashProfitabilityRow => {
      const cashIn = CASH_CATEGORIES.filter((c) => CASH_INFLOW_CATEGORIES.includes(c)).reduce((s, c) => s.plus(amounts[c]), ZERO);
      const cashOut = CASH_CATEGORIES.filter((c) => !CASH_INFLOW_CATEGORIES.includes(c)).reduce((s, c) => s.plus(amounts[c]), ZERO);
      const netCash = cashIn.minus(cashOut);
      return {
        projectId: project?.id ?? null,
        projectName,
        clientName: project?.clientName ?? null,
        contractValue: project?.value ? new Prisma.Decimal(project.value).toFixed(2) : null,
        amounts: Object.fromEntries(CASH_CATEGORIES.map((c) => [c, amounts[c].toFixed(2)])) as Record<CashCategory, string>,
        cashIn: cashIn.toFixed(2),
        cashOut: cashOut.toFixed(2),
        netCash: netCash.toFixed(2),
        cashMarginPercent: percentOf(netCash, cashIn),
      };
    };

    const totalAmounts = emptyCash();
    for (const amounts of [...byProject.values(), ...(scope.restricted ? [] : [unassigned])]) {
      for (const c of CASH_CATEGORIES) totalAmounts[c] = totalAmounts[c].plus(amounts[c]);
    }
    const totals = row(null, 'Total', totalAmounts);

    let reconciliation: LedgerReconciliation;
    if (scope.restricted) {
      reconciliation = notComparable(input, 'Filtered to one client or project. The bank accounts also carry cash no project owns, so they are compared only on the unfiltered view.');
    } else {
      const bank = await this.ledger.bankMovement({ organizationId: input.organizationId, legalEntityId: scope.legalEntityId, dateFrom: scope.dateFrom, dateTo: scope.asOfDate });
      const reportAmount = new Prisma.Decimal(totals.netCash);
      const difference = reportAmount.minus(bank.movement);
      reconciliation = {
        applicable: true,
        notApplicableReason: null,
        lines: [
          {
            key: 'BANK_MOVEMENT',
            label: 'Net cash (projects + not assigned)',
            ledgerAccounts: bank.accounts,
            reportAmount: reportAmount.toFixed(2),
            ledgerAmount: bank.movement.toFixed(2),
            difference: difference.toFixed(2),
            reconciled: difference.isZero(),
          },
        ],
        allReconciled: difference.isZero(),
      };
    }

    return {
      catalog: REPORT_CATALOG['cash-profitability'],
      scope,
      projects: projects.map((p) => row(p, p.name, byProject.get(p.id)!)),
      unassigned: scope.restricted ? null : row(null, 'Not assigned to a project', unassigned),
      totals,
      reconciliation,
    };
  }

  /**
   * Contract value and budget against what is billed and spent up to the
   * as-of date. Billed is the Accrual Project P&L income; cost is the Cost to
   * Company total (posted + analytical manpower) — this report adds no
   * formula of its own for either.
   */
  async contractPerformance(input: ReportReadInput): Promise<ContractPerformanceReport> {
    const toDate: ReportReadInput = { ...input, filters: { ...input.filters, dateFrom: undefined } };
    const [{ scope, projects }, pl, ctc] = await Promise.all([this.scopes.resolve(toDate), this.profitability.projectPl(toDate), this.profitability.costToCompany(toDate)]);
    const plById = new Map(pl.projects.map((r) => [r.projectId, r]));
    const ctcById = new Map(ctc.rows.map((r) => [r.projectId, r]));

    const sums = { value: ZERO, valuedBilled: ZERO, billed: ZERO, budget: ZERO, budgetedCost: ZERO, posted: ZERO, manpower: ZERO, cost: ZERO, withoutValue: 0, withoutBudget: 0 };
    const rows: ContractPerformanceRow[] = projects.map((p) => {
      const billed = new Prisma.Decimal(plById.get(p.id)?.income ?? '0');
      const cost = ctcById.get(p.id);
      const posted = new Prisma.Decimal(cost?.postedTotal ?? '0');
      const manpower = new Prisma.Decimal(cost?.amounts.MANPOWER ?? '0');
      const costToDate = posted.plus(manpower);
      const value = decimalOrNull(p.value);
      const budget = decimalOrNull(p.budget);

      sums.billed = sums.billed.plus(billed);
      sums.posted = sums.posted.plus(posted);
      sums.manpower = sums.manpower.plus(manpower);
      sums.cost = sums.cost.plus(costToDate);
      if (value) {
        sums.value = sums.value.plus(value);
        sums.valuedBilled = sums.valuedBilled.plus(billed);
      } else sums.withoutValue += 1;
      if (budget) {
        sums.budget = sums.budget.plus(budget);
        sums.budgetedCost = sums.budgetedCost.plus(costToDate);
      } else sums.withoutBudget += 1;

      return {
        projectId: p.id,
        projectName: p.name,
        clientName: p.clientName,
        stage: p.stage,
        operationalStatus: p.operationalStatus,
        contractValue: value ? value.toFixed(2) : null,
        billedToDate: billed.toFixed(2),
        billedPercent: percentOf(billed, value),
        remainingToBill: value ? value.minus(billed).toFixed(2) : null,
        budget: budget ? budget.toFixed(2) : null,
        postedCostToDate: posted.toFixed(2),
        manpowerToDate: manpower.toFixed(2),
        costToDate: costToDate.toFixed(2),
        budgetUsedPercent: percentOf(costToDate, budget),
        budgetRemaining: budget ? budget.minus(costToDate).toFixed(2) : null,
        overBudget: budget ? costToDate.greaterThan(budget) : false,
      };
    });

    const anyValue = rows.length > sums.withoutValue;
    const anyBudget = rows.length > sums.withoutBudget;
    return {
      catalog: REPORT_CATALOG['contract-performance'],
      scope,
      rows,
      totals: {
        contractValue: anyValue ? sums.value.toFixed(2) : null,
        billedToDate: sums.billed.toFixed(2),
        billedPercent: anyValue ? percentOf(sums.valuedBilled, sums.value) : null,
        remainingToBill: anyValue ? sums.value.minus(sums.valuedBilled).toFixed(2) : null,
        budget: anyBudget ? sums.budget.toFixed(2) : null,
        postedCostToDate: sums.posted.toFixed(2),
        manpowerToDate: sums.manpower.toFixed(2),
        costToDate: sums.cost.toFixed(2),
        budgetUsedPercent: anyBudget ? percentOf(sums.budgetedCost, sums.budget) : null,
        budgetRemaining: anyBudget ? sums.budget.minus(sums.budgetedCost).toFixed(2) : null,
        projectsWithoutValue: sums.withoutValue,
        projectsWithoutBudget: sums.withoutBudget,
      },
      reconciliation: {
        applicable: false,
        notApplicableReason:
          'Contract value and budget are project agreements, not ledger balances. Billed and posted cost are the Accrual Project P&L and Cost to Company figures, which are reconciled to the ledger on those reports.',
        lines: [],
        allReconciled: false,
      },
    };
  }

  /** Every figure under its own basis; nothing added across bases. */
  async businessOverview(input: ReportReadInput): Promise<BusinessOverviewReport> {
    const [pl, ctc, cash, contract] = await Promise.all([
      this.profitability.projectPl(input),
      this.profitability.costToCompany(input),
      this.cashProfitability(input),
      this.contractPerformance(input),
    ]);
    const scope = pl.scope;
    const bank = scope.restricted
      ? null
      : await this.ledger.bankMovement({ organizationId: input.organizationId, legalEntityId: scope.legalEntityId, dateFrom: scope.dateFrom, dateTo: scope.asOfDate });

    const period = scope.dateFrom ? 'in the period' : `up to ${scope.asOfDate}`;
    const bankNote = 'Bank balances are company-wide, so they are shown only on the unfiltered view.';
    const cards: BusinessOverviewCard[] = [
      { key: 'ACCRUAL_INCOME', label: 'Income', basis: 'ACCRUAL', amount: pl.totals.income, note: `Income posted ${period}.` },
      {
        key: 'ACCRUAL_EXPENSE',
        label: 'Expense',
        basis: 'ACCRUAL',
        amount: pl.totals.expense,
        note: scope.restricted ? `Expense posted to these projects ${period}.` : `All expense posted ${period}, including salary and overheads not assigned to a project.`,
      },
      { key: 'ACCRUAL_CONTRIBUTION', label: 'Accrual contribution', basis: 'ACCRUAL', amount: pl.totals.contribution, note: 'Income − expense. Not cash.' },
      { key: 'CASH_IN', label: 'Cash in', basis: 'CASH', amount: cash.totals.cashIn, note: `Client receipts and hold/retention released ${period}.` },
      { key: 'CASH_OUT', label: 'Cash out', basis: 'CASH', amount: cash.totals.cashOut, note: `Payments out of the bank ${period}.` },
      { key: 'NET_CASH', label: 'Net cash', basis: 'CASH', amount: cash.totals.netCash, note: 'Cash in − cash out. Not profit: GST, TDS and advances move cash too.' },
      { key: 'CONTRACT_VALUE', label: 'Contract value', basis: 'CONTRACT_BUDGET', amount: contract.totals.contractValue, note: 'Project value, excluding GST.' },
      { key: 'BILLED_TO_DATE', label: 'Billed to date', basis: 'CONTRACT_BUDGET', amount: contract.totals.billedToDate, note: `Revenue posted up to ${scope.asOfDate}.` },
      { key: 'REMAINING_TO_BILL', label: 'Remaining to bill', basis: 'CONTRACT_BUDGET', amount: contract.totals.remainingToBill, note: 'Contract value − billed, for projects with a contract value.' },
      { key: 'BUDGET', label: 'Budget', basis: 'CONTRACT_BUDGET', amount: contract.totals.budget, note: 'Sum of project budgets.' },
      { key: 'COST_TO_DATE', label: 'Cost to date', basis: 'CONTRACT_BUDGET', amount: contract.totals.costToDate, note: `Posted project cost and manpower up to ${scope.asOfDate}.` },
      { key: 'BANK_OPENING', label: 'Bank opening balance', basis: 'BANK', amount: bank ? bank.opening.toFixed(2) : null, note: bank ? (scope.dateFrom ? `Before ${scope.dateFrom}.` : 'Nothing before the first entry.') : bankNote },
      { key: 'BANK_MOVEMENT', label: 'Bank movement', basis: 'BANK', amount: bank ? bank.movement.toFixed(2) : null, note: bank ? `Debits − credits ${period}.` : bankNote },
      { key: 'BANK_CLOSING', label: 'Bank closing balance', basis: 'BANK', amount: bank ? bank.closing.toFixed(2) : null, note: bank ? `On ${scope.asOfDate}.` : bankNote },
    ];

    const plById = new Map(pl.projects.map((r) => [r.projectId, r]));
    const cashById = new Map(cash.projects.map((r) => [r.projectId, r]));
    const postedCategories = COST_CATEGORIES.filter((c): c is Exclude<CostCategory, 'MANPOWER'> => c !== 'MANPOWER');
    const projects: BusinessOverviewProjectRow[] = ctc.rows.map((c) => {
      const p = plById.get(c.projectId)!;
      const k = cashById.get(c.projectId)!;
      return {
        projectId: c.projectId,
        projectName: c.projectName,
        clientName: c.clientName,
        income: p.income,
        costs: Object.fromEntries(postedCategories.map((cat) => [cat, c.amounts[cat]])) as BusinessOverviewProjectRow['costs'],
        postedCost: c.postedTotal,
        manpower: c.amounts.MANPOWER,
        accrualContribution: p.contribution,
        cashIn: k.cashIn,
        cashOut: k.cashOut,
        netCash: k.netCash,
      };
    });

    const reconciliation: LedgerReconciliation =
      pl.reconciliation.applicable && cash.reconciliation.applicable
        ? {
            applicable: true,
            notApplicableReason: null,
            lines: [...pl.reconciliation.lines, ...cash.reconciliation.lines],
            allReconciled: pl.reconciliation.allReconciled && cash.reconciliation.allReconciled,
          }
        : pl.reconciliation;

    return { catalog: REPORT_CATALOG['business-overview'], scope, cards, projects, reconciliation };
  }

  /** Every bank movement in the period, grouped by journal entry and matched to the document that made it. */
  private async cashEntries(input: ReportReadInput, scope: ReportScope): Promise<CashEntry[]> {
    const { organizationId } = input;
    const db = this.prisma.client;
    const bankAccounts = await db.bankAccount.findMany({ where: { organizationId }, select: { ledgerAccountId: true } });
    if (!bankAccounts.length) return [];

    const lines = await db.journalLine.findMany({
      where: {
        organizationId,
        ledgerAccountId: { in: [...new Set(bankAccounts.map((b) => b.ledgerAccountId))] },
        journalEntry: {
          accountingDate: { lte: new Date(`${scope.asOfDate}T00:00:00.000Z`), ...(scope.dateFrom ? { gte: new Date(`${scope.dateFrom}T00:00:00.000Z`) } : {}) },
          ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}),
        },
      },
      select: {
        debitAmount: true,
        creditAmount: true,
        journalEntry: { select: { id: true, sourceType: true, reversalOf: { select: { id: true, sourceType: true } } } },
      },
    });

    // One entry's bank lines (a transfer may have two) net to one movement.
    const byEntry = new Map<string, { originId: string; originType: string; movement: Prisma.Decimal }>();
    for (const l of lines) {
      const je = l.journalEntry;
      const reversed = je.sourceType === REVERSAL_SOURCE_TYPE && je.reversalOf !== null;
      const current = byEntry.get(je.id) ?? {
        originId: reversed ? je.reversalOf!.id : je.id,
        originType: reversed ? je.reversalOf!.sourceType : je.sourceType,
        movement: ZERO,
      };
      current.movement = current.movement.plus(l.debitAmount.minus(l.creditAmount));
      byEntry.set(je.id, current);
    }
    const originIds = [...new Set([...byEntry.values()].map((e) => e.originId))];
    if (!originIds.length) return [];
    const ids = { in: originIds };

    const [receipts, vendorPayments, directExpenses, claims, releases, introducerPayments, advances, instruments] = await Promise.all([
      db.clientReceipt.findMany({ where: { organizationId, journalEntryId: ids }, select: { journalEntryId: true, allocations: { select: { cashAllocated: true, invoice: { select: { projectId: true } } } } } }),
      db.vendorPayment.findMany({
        where: { organizationId, journalEntryId: ids },
        select: { journalEntryId: true, allocations: { select: { cashPaid: true, paymentRequestLine: { select: { vendorBill: { select: { projectId: true } } } } } } },
      }),
      db.directExpense.findMany({ where: { organizationId, journalEntryId: ids }, select: { journalEntryId: true, projectId: true } }),
      db.employeeExpenseClaim.findMany({ where: { organizationId, reimbursementJournalEntryId: ids }, select: { reimbursementJournalEntryId: true, projectId: true } }),
      db.deductionRelease.findMany({ where: { organizationId, journalEntryId: ids }, select: { journalEntryId: true, deduction: { select: { allocation: { select: { invoice: { select: { projectId: true } } } } } } } }),
      db.introducerPayment.findMany({
        where: { organizationId, journalEntryId: ids },
        select: { journalEntryId: true, advanceAmount: true, allocations: { select: { allocatedAmount: true, accrual: { select: { agreement: { select: { projectId: true } } } } } } },
      }),
      db.employeeAdvance.findMany({ where: { organizationId, journalEntryId: ids }, select: { journalEntryId: true, projectId: true } }),
      db.securityInstrument.findMany({
        where: { organizationId, OR: [{ lodgeJournalEntryId: ids }, { returnJournalEntryId: ids }] },
        select: { lodgeJournalEntryId: true, returnJournalEntryId: true, projectId: true },
      }),
    ]);

    type Attribution = { category: CashCategory; whole: string | null } | { category: CashCategory; split: (natural: Prisma.Decimal) => Array<{ projectId: string; amount: Prisma.Decimal }> };
    const byOrigin = new Map<string, Attribution>();
    for (const r of receipts) {
      byOrigin.set(r.journalEntryId!, {
        category: 'CLIENT_RECEIPT',
        split: (natural) => r.allocations.map((a) => ({ projectId: a.invoice.projectId, amount: natural.isNegative() ? a.cashAllocated.negated() : a.cashAllocated })),
      });
    }
    for (const p of vendorPayments) {
      byOrigin.set(p.journalEntryId!, {
        category: 'VENDOR_PAYMENT',
        // A company-overhead bill's payment stays unassigned (ADR-177).
        split: (natural) => p.allocations.flatMap((a) => (a.paymentRequestLine.vendorBill.projectId ? [{ projectId: a.paymentRequestLine.vendorBill.projectId, amount: natural.isNegative() ? a.cashPaid.negated() : a.cashPaid }] : [])),
      });
    }
    for (const p of introducerPayments) {
      byOrigin.set(p.journalEntryId, {
        category: 'INTRODUCER_PAYMENT',
        // The bank pays the net of TDS in one sum; each accrual's project gets
        // its share of that net by gross allocated, any advance the rest.
        split: (natural) => {
          const weights = [...p.allocations.map((a) => a.allocatedAmount), ...(p.advanceAmount.greaterThan(0) ? [p.advanceAmount] : [])];
          const parts = apportion(natural, weights);
          return p.allocations.map((a, i) => ({ projectId: a.accrual.agreement.projectId, amount: parts[i]! }));
        },
      });
    }
    for (const d of directExpenses) byOrigin.set(d.journalEntryId!, { category: 'DIRECT_EXPENSE', whole: d.projectId });
    for (const c of claims) byOrigin.set(c.reimbursementJournalEntryId!, { category: 'REIMBURSEMENT', whole: c.projectId });
    for (const r of releases) byOrigin.set(r.journalEntryId!, { category: 'DEDUCTION_RELEASE', whole: r.deduction.allocation.invoice.projectId });
    for (const a of advances) byOrigin.set(a.journalEntryId!, { category: 'EMPLOYEE_ADVANCE', whole: a.projectId });
    for (const s of instruments) {
      for (const entryId of [s.lodgeJournalEntryId, s.returnJournalEntryId]) if (entryId) byOrigin.set(entryId, { category: 'SECURITY_DEPOSIT', whole: s.projectId });
    }

    return [...byEntry.values()].map((e) => {
      const attribution = byOrigin.get(e.originId);
      const category = attribution?.category ?? SOURCE_TYPE_CATEGORIES[e.originType] ?? 'OTHER';
      const natural = naturalCashAmount(category, e.movement);
      if (!attribution) return { category, natural, parts: [] };
      if ('split' in attribution) return { category, natural, parts: attribution.split(natural) };
      return { category, natural, parts: attribution.whole ? [{ projectId: attribution.whole, amount: natural }] : [] };
    });
  }
}
