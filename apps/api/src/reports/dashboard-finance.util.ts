import { Prisma } from '@zitaware/database';
import type {
  ClientPaymentReport,
  CostToCompanyReport,
  DashboardBreakdown,
  DashboardFigure,
  DashboardFinance,
  EmdSdRecoveryReport,
  GstNetReport,
  PaymentHoldReport,
  PenaltyReport,
  PendingInvoiceReport,
  ProjectPlReport,
  ReceivableAgingReport,
  TdsInwardReport,
} from '@zitaware/contracts';

const ZERO = new Prisma.Decimal(0);
/** Expense accounts shown on their own; the rest are summed as "Other". */
const EXPENSE_CATEGORY_LIMIT = 6;

const d = (v: string | null | undefined) => new Prisma.Decimal(v ?? '0');
const sum = (values: Array<string | Prisma.Decimal>) => values.reduce<Prisma.Decimal>((t, v) => t.plus(v), ZERO);
const money = (label: string, value: string | Prisma.Decimal) => ({ label, value: typeof value === 'string' ? value : value.toFixed(2), kind: 'MONEY' as const });
const count = (label: string, value: number) => ({ label, value: String(value), kind: 'COUNT' as const });
const percentOf = (part: Prisma.Decimal, whole: Prisma.Decimal): string | null => (whole.greaterThan(0) ? part.dividedBy(whole).times(100).toFixed(1) : null);

/** Each report the summary reads, or null when the viewer may not read it. */
export interface FinanceSources {
  clientPayments: ClientPaymentReport | null;
  projectPl: ProjectPlReport | null;
  costToCompany: CostToCompanyReport | null;
  aging: ReceivableAgingReport | null;
  pending: PendingInvoiceReport | null;
  emdSd: EmdSdRecoveryReport | null;
  holds: PaymentHoldReport | null;
  penalties: PenaltyReport | null;
  tdsInward: TdsInwardReport | null;
  gstNet: GstNetReport | null;
  /** Project type name by project id, for Cost to Company's rows. */
  projectTypeById: Map<string, string | null>;
}

function shares(rows: Array<{ label: string; amount: Prisma.Decimal; note: string | null }>, total: Prisma.Decimal): DashboardBreakdown['rows'] {
  return rows.map((r) => ({ label: r.label, amount: r.amount.toFixed(2), percent: percentOf(r.amount, total), note: r.note }));
}

/**
 * The financial summary at the top of the Dashboard (ADR-159). Every figure is
 * one report's own, for the same filters; the only work done here is grouping
 * Cost to Company's project rows by project type and stating shares as
 * percentages. Net profit is accrual (Project P&L's contribution): income
 * invoiced less every posted cost, salaries included.
 */
export function buildDashboardFinance(s: FinanceSources): DashboardFinance {
  const headline: DashboardFigure[] = [];
  const recover: DashboardFigure[] = [];
  const breakdowns: DashboardBreakdown[] = [];

  if (s.clientPayments) {
    headline.push({
      key: 'PAYMENT_RECEIVED', label: 'Payment Received', value: s.clientPayments.totals.actualAmount, measure: 'PERIOD', reportPath: s.clientPayments.catalog.path,
      details: [{ label: 'Net of all deductions', value: '', kind: 'TEXT' }, money('Deducted', s.clientPayments.totals.deductionTotal)],
    });
  }
  if (s.projectPl) {
    const { income, expense, contribution } = s.projectPl.totals;
    headline.push({
      key: 'TOTAL_EXPENSE', label: 'Total Expense', value: expense, measure: 'PERIOD', reportPath: s.projectPl.catalog.path,
      details: [{ label: 'All heads combined, salaries included', value: '', kind: 'TEXT' }],
    });
    const margin = percentOf(d(contribution), d(income));
    headline.push({
      key: 'NET_PROFIT', label: 'Net Profit', value: contribution, measure: 'PERIOD', reportPath: s.projectPl.catalog.path,
      details: [...(margin !== null ? [{ label: 'margin', value: margin, kind: 'PERCENT' as const }] : []), money('Invoiced', income)],
    });
  }
  const overdue = s.pending ? s.pending.invoices.filter((r) => r.daysPastDue > 0).length : null;
  if (s.aging) {
    const unpaid: DashboardFigure = {
      key: 'INVOICED_NOT_RECEIVED', label: 'Invoiced, Not Received', value: s.aging.invoiceTotal, measure: 'AS_OF', reportPath: s.aging.catalog.path,
      details: [count('invoices outstanding', s.aging.invoices.length), ...(overdue !== null ? [count('overdue', overdue)] : [])],
    };
    headline.push(unpaid);
    recover.push({ ...unpaid, key: 'INVOICE_UNPAID', label: 'Invoice raised, payment not received' });
  }

  if (s.emdSd) {
    for (const category of ['EMD', 'SD'] as const) {
      const pending = s.emdSd.rows.filter((r) => r.category === category && d(r.outstandingAmount).greaterThan(0));
      recover.push({
        key: `${category}_TO_RECOVER`, label: `Total ${category} to take back`, value: sum(pending.map((r) => r.outstandingAmount)).toFixed(2), measure: 'AS_OF', reportPath: s.emdSd.catalog.path,
        details: [count('instruments pending', pending.length), count('overdue', pending.filter((r) => r.status === 'OVERDUE').length)],
      });
    }
  }
  if (s.holds) {
    const open = s.holds.rows.filter((r) => r.type === 'HOLD' && d(r.outstandingAmount).greaterThan(0));
    recover.push({
      key: 'HOLD_OUTSTANDING', label: 'Total Hold amount outstanding', value: s.holds.totals.HOLD.outstanding, measure: 'AS_OF', reportPath: s.holds.catalog.path,
      details: [count('invoices', new Set(open.map((r) => r.invoiceId)).size), money('Retention', s.holds.totals.RETENTION.outstanding)],
    });
  }
  if (s.penalties) {
    const categories = s.penalties.byCategory.map((c) => c.categoryName).filter(Boolean).join(' + ');
    recover.push({
      key: 'PENALTY_DEDUCTED', label: 'Total Penalty deducted', value: sum([s.penalties.totals.accepted, s.penalties.totals.disputed]).toFixed(2), measure: 'PERIOD', reportPath: s.penalties.catalog.path,
      details: [
        ...(categories ? [{ label: categories, value: '', kind: 'TEXT' as const }] : []),
        count('invoices', new Set(s.penalties.rows.filter((r) => r.entryType === 'DEDUCTION').map((r) => r.invoiceId)).size),
        money('Disputed', s.penalties.totals.disputed),
      ],
    });
  }
  if (s.tdsInward) {
    const tds = s.tdsInward.summary.find((t) => t.deductionType === 'TDS');
    const gstTds = sum(s.tdsInward.summary.filter((t) => t.deductionType !== 'TDS').map((t) => t.amount));
    recover.push({
      key: 'TDS_INWARD', label: 'TDS deducted by clients (inward)', value: tds?.amount ?? '0.00', measure: 'PERIOD', reportPath: s.tdsInward.catalog.path,
      details: [{ label: 'claimable with the authority', value: '', kind: 'TEXT' }, money('GST-TDS', gstTds)],
    });
  }

  if (s.projectPl) {
    const total = d(s.projectPl.totals.expense);
    const accounts = s.projectPl.accounts
      .filter((a) => a.accountType === 'EXPENSE' && !d(a.totalAmount).isZero())
      .map((a) => ({ label: a.name, amount: d(a.totalAmount), note: null }))
      .sort((a, b) => b.amount.comparedTo(a.amount));
    const shown = accounts.slice(0, EXPENSE_CATEGORY_LIMIT);
    const rest = accounts.slice(EXPENSE_CATEGORY_LIMIT);
    const rows = rest.length ? [...shown, { label: 'Other', amount: sum(rest.map((r) => r.amount)), note: `${rest.length} more heads` }] : shown;
    breakdowns.push({
      key: 'EXPENSE_BY_CATEGORY', title: 'Expense by Category', totalLabel: 'total', total: total.toFixed(2), note: null, measure: 'PERIOD',
      reportPath: s.projectPl.catalog.path, rows: shares(rows, total),
    });
  }
  if (s.costToCompany) {
    const byType = new Map<string, { amount: Prisma.Decimal; projects: number }>();
    for (const row of s.costToCompany.rows) {
      if (d(row.total).isZero()) continue;
      const type = s.projectTypeById.get(row.projectId) ?? 'No type';
      const entry = byType.get(type) ?? { amount: ZERO, projects: 0 };
      byType.set(type, { amount: entry.amount.plus(row.total), projects: entry.projects + 1 });
    }
    const total = sum([...byType.values()].map((v) => v.amount));
    const rows = [...byType.entries()]
      .map(([label, v]) => ({ label, amount: v.amount, note: `${v.projects} project${v.projects === 1 ? '' : 's'}` }))
      .sort((a, b) => b.amount.comparedTo(a.amount));
    breakdowns.push({
      key: 'EXPENSE_BY_PROJECT_TYPE', title: 'Expense by Project Type', totalLabel: 'charged to projects', total: total.toFixed(2),
      note: 'Costs charged to projects, salaries by allocation', measure: 'PERIOD', reportPath: s.costToCompany.catalog.path, rows: shares(rows, total),
    });
  }
  if (s.gstNet) {
    const { output, eligibleInput, net } = s.gstNet.totals;
    breakdowns.push({
      key: 'GST_POSITION', title: 'GST Position', totalLabel: d(net).isNegative() ? 'net credit' : 'net payable', total: d(net).abs().toFixed(2), note: null, measure: 'PERIOD',
      reportPath: s.gstNet.catalog.path,
      rows: [
        { label: 'Output GST (to pay)', amount: output, percent: null, note: null },
        { label: 'Input credit (claimable)', amount: eligibleInput, percent: null, note: null },
        { label: d(net).isNegative() ? 'Net GST credit' : 'Net GST payable', amount: d(net).abs().toFixed(2), percent: null, note: null },
      ],
    });
  }
  if (s.aging || s.emdSd) {
    const parts: Array<{ label: string; amount: Prisma.Decimal; note: string | null }> = [];
    if (s.aging) {
      parts.push({ label: 'Invoice unpaid', amount: d(s.aging.invoiceTotal), note: null });
      parts.push({ label: 'Hold & retention', amount: d(s.aging.heldTotal), note: null });
    }
    if (s.emdSd) {
      for (const category of ['EMD', 'SD'] as const) {
        parts.push({ label: `${category} lodged`, amount: sum(s.emdSd.rows.filter((r) => r.category === category).map((r) => r.outstandingAmount)), note: null });
      }
    }
    const total = sum(parts.map((p) => p.amount));
    breakdowns.push({
      key: 'RECEIVABLE_COMPOSITION', title: 'Receivable Composition', totalLabel: 'locked', total: total.toFixed(2), note: null, measure: 'AS_OF',
      reportPath: (s.aging ?? s.emdSd)!.catalog.path, rows: shares(parts, total),
    });
  }

  return { headline, recover, breakdowns };
}
