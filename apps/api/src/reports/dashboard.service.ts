import { Injectable } from '@nestjs/common';
import { Prisma } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  DashboardAttentionItem,
  DashboardCard,
  DashboardFilters,
  DashboardOverview,
  DashboardPort,
  LedgerReconciliation,
  ReportCatalogEntry,
  ReportReadInput,
} from '@zitaware/contracts';
import { REPORT_CATEGORY_PERMISSIONS } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';
import { buildDashboardFinance } from './dashboard-finance.util';

/** How many items of each kind the attention list shows; the linked report has the rest. */
const ATTENTION_LIMIT = 5;
const TOP_PROJECT_LIMIT = 6;

type CardInput = Omit<DashboardCard, 'basis' | 'reportKey' | 'reportTitle' | 'reportPath'>;

function card(catalog: ReportCatalogEntry, input: CardInput): DashboardCard {
  return { ...input, basis: catalog.basis, reportKey: catalog.key, reportTitle: catalog.title, reportPath: catalog.path };
}

const count = (label: string, value: number) => ({ label, value: String(value), kind: 'COUNT' as const });
const money = (label: string, value: string) => ({ label, value, kind: 'MONEY' as const });

/**
 * The main Dashboard (Phase 8.9a, ADR-119). It computes nothing of its own:
 * each card is a figure a report returns for the same filters, so the card
 * and the report it links to can only agree. Sections the viewer may not read
 * are left out rather than shown empty.
 */
@Injectable()
export class DashboardService implements DashboardPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
  ) {}

  async getOverview(input: { organizationId: string; actorId: string; canSeeAllProjects: boolean; permissions: string[]; filters: DashboardFilters }): Promise<DashboardOverview> {
    const { filters } = input;
    if (filters.dateFrom > filters.asOfDate) throwAppError('VALIDATION_FAILED', 'The period cannot start after it ends.');
    const legalEntity = filters.legalEntityId
      ? await this.prisma.client.legalEntity.findFirst({ where: { id: filters.legalEntityId, organizationId: input.organizationId }, select: { legalName: true } })
      : null;
    if (filters.legalEntityId && !legalEntity) throwAppError('NOT_FOUND', 'Legal entity not found.');

    const held = new Set(input.permissions);
    const can = (category: keyof typeof REPORT_CATEGORY_PERMISSIONS) => held.has(REPORT_CATEGORY_PERMISSIONS[category]);
    const read = (period: boolean): ReportReadInput => ({
      organizationId: input.organizationId,
      actorId: input.actorId,
      canSeeAllProjects: input.canSeeAllProjects,
      filters: { legalEntityId: filters.legalEntityId, dateFrom: period ? filters.dateFrom : undefined, asOfDate: filters.asOfDate, clientId: undefined, projectId: undefined },
    });
    const when = <T>(allowed: boolean, load: () => Promise<T>) => (allowed ? load() : Promise.resolve(null));

    const [aging, pending, projectPl, cashFlow, gstNet, tdsOutward, tdsInward, payablesAging, expenses, , clientPayments, costToCompany, penalties, holds, tdsInwardPeriod] = await Promise.all([
      when(can('RECEIVABLES'), () => this.reports.getReceivableAging(read(false))),
      when(can('OPERATIONS'), () => this.reports.getPendingInvoices(read(false))),
      when(can('PROFITABILITY'), () => this.reports.getProjectPl(read(true))),
      when(can('CASH'), () => this.reports.getCashFlow(read(true))),
      when(can('GST'), () => this.reports.getGstNet(read(true))),
      when(can('TDS'), () => this.reports.getTdsOutward(read(false))),
      when(can('TDS'), () => this.reports.getTdsInward(read(false))),
      when(can('PAYABLES'), () => this.reports.getPayablesAging(read(false))),
      when(can('PAYABLES'), () => this.reports.getExpenses(read(true))),
      // No EMD/SD in Zitaware CRM (ADR-192): no card, alert or summary figure.
      Promise.resolve(null),
      // The financial summary's own reads (ADR-159).
      when(can('OPERATIONS'), () => this.reports.getClientPayments(read(true))),
      when(can('PROFITABILITY'), () => this.reports.getCostToCompany(read(true))),
      when(can('OPERATIONS'), () => this.reports.getPenalties(read(true))),
      when(can('OPERATIONS'), () => this.reports.getPaymentHolds(read(false))),
      when(can('TDS'), () => this.reports.getTdsInward(read(true))),
    ]);

    const projectTypeById = new Map<string, string | null>();
    if (costToCompany?.rows.length) {
      const rows = await this.prisma.client.project.findMany({
        where: { organizationId: input.organizationId, id: { in: costToCompany.rows.map((r) => r.projectId) } },
        select: { id: true, projectType: { select: { name: true } } },
      });
      for (const r of rows) projectTypeById.set(r.id, r.projectType?.name ?? null);
    }
    const finance = buildDashboardFinance({
      clientPayments, projectPl, costToCompany, aging, pending, emdSd: null, holds, penalties, tdsInward: tdsInwardPeriod, gstNet, projectTypeById,
    });

    const cards: DashboardCard[] = [];
    if (aging) {
      cards.push(card(aging.catalog, { key: 'INVOICE_OUTSTANDING', section: 'RECEIVABLES', label: 'Invoice Outstanding', value: aging.invoiceTotal, measure: 'AS_OF', details: [count('Invoices', aging.invoices.length)] }));
      cards.push(card(aging.catalog, { key: 'HOLD_RETENTION', section: 'RECEIVABLES', label: 'Hold & Retention to Recover', value: aging.heldTotal, measure: 'AS_OF', details: [count('Deductions', aging.heldDeductions.length)] }));
    }
    if (pending) {
      cards.push(card(pending.catalog, { key: 'PAST_DUE', section: 'RECEIVABLES', label: 'Past Due', value: pending.overdueTotal, measure: 'AS_OF', details: [count('Invoices', pending.invoices.filter((r) => r.daysPastDue > 0).length)] }));
      cards.push(
        card(pending.catalog, {
          key: 'BILLING_PENDING', section: 'RECEIVABLES', label: 'Billing Pending (before GST)', value: pending.billingPendingTotal, measure: 'AS_OF',
          details: [count('Milestones', pending.billingPending.length), count('Draft invoices', pending.draftInvoiceCount)],
        }),
      );
    }
    if (projectPl) {
      cards.push(card(projectPl.catalog, { key: 'INCOME', section: 'PERFORMANCE', label: 'Income', value: projectPl.totals.income, measure: 'PERIOD', details: [money('Expense', projectPl.totals.expense)] }));
      cards.push(card(projectPl.catalog, { key: 'CONTRIBUTION', section: 'PERFORMANCE', label: 'Contribution', value: projectPl.totals.contribution, measure: 'PERIOD', details: [] }));
    }
    if (cashFlow) {
      cards.push(
        card(cashFlow.catalog, {
          key: 'BANK_BALANCE', section: 'CASH_AND_TAX', label: 'Bank Balance', value: cashFlow.totals.closing, measure: 'AS_OF',
          details: [money('In', cashFlow.totals.inflow), money('Out', cashFlow.totals.outflow)],
        }),
      );
    }
    if (gstNet) {
      cards.push(card(gstNet.catalog, { key: 'GST_NET', section: 'CASH_AND_TAX', label: 'Net GST', value: gstNet.totals.net, measure: 'PERIOD', details: [money('Output', gstNet.totals.output), money('Eligible input', gstNet.totals.eligibleInput)] }));
    }
    const outwardTds = tdsOutward?.summary.find((s) => s.deductionType === 'TDS');
    if (tdsOutward && outwardTds) {
      cards.push(
        card(tdsOutward.catalog, {
          key: 'TDS_PAYABLE', section: 'CASH_AND_TAX', label: 'TDS to Deposit', value: outwardTds.payable, measure: 'AS_OF',
          details: [money('Overdue', outwardTds.overdueAmount), count('Overdue items', outwardTds.overdueCount)],
        }),
      );
    }
    const inwardTds = tdsInward?.summary.find((s) => s.deductionType === 'TDS');
    if (tdsInward && inwardTds) {
      cards.push(
        card(tdsInward.catalog, {
          key: 'TDS_CERTIFICATES_PENDING', section: 'CASH_AND_TAX', label: 'TDS Certificates Pending', value: inwardTds.byLifecycle.CERTIFICATE_PENDING.amount, measure: 'AS_OF',
          details: [count('Deductions', inwardTds.byLifecycle.CERTIFICATE_PENDING.count)],
        }),
      );
    }
    if (payablesAging) {
      cards.push(card(payablesAging.catalog, { key: 'OWED_TO_VENDORS', section: 'PAYABLES_AND_OPERATIONS', label: 'Owed to Vendors', value: payablesAging.total, measure: 'AS_OF', details: [money('Approved for payment', payablesAging.approvedForPaymentTotal)] }));
    }
    if (expenses) {
      cards.push(card(expenses.catalog, { key: 'EXPENSES', section: 'PAYABLES_AND_OPERATIONS', label: 'Expenses', value: expenses.totals.recognizedAmount, measure: 'PERIOD', details: [money('Gross', expenses.totals.grossAmount)] }));
    }

    const attention: DashboardAttentionItem[] = [];
    const reconciledReports: Array<{ catalog: ReportCatalogEntry; reconciliation: LedgerReconciliation } | null> = [aging, pending, projectPl, cashFlow, gstNet, tdsOutward, tdsInward, payablesAging, expenses];
    for (const report of reconciledReports) {
      if (!report || !report.reconciliation.applicable || report.reconciliation.allReconciled) continue;
      const differing = report.reconciliation.lines.filter((l) => !l.reconciled);
      attention.push({ kind: 'LEDGER_DIFFERENCE', title: `${report.catalog.title} does not agree with the ledger`, detail: differing.map((l) => l.label).join(', '), amount: differing[0]?.difference ?? null, date: null, href: report.catalog.path });
    }
    if (pending) {
      for (const r of pending.invoices.filter((i) => i.daysPastDue > 0).sort((a, b) => b.daysPastDue - a.daysPastDue).slice(0, ATTENTION_LIMIT)) {
        attention.push({ kind: 'OVERDUE_INVOICE', title: `Invoice ${r.invoiceNumber} — ${r.clientName}`, detail: `${r.daysPastDue} days past due`, amount: r.outstandingAmount, date: r.dueDate, href: `/projects/${r.projectId}/invoices/${r.invoiceId}` });
      }
      for (const b of pending.billingPending.filter((x) => x.dueDate <= filters.asOfDate).slice(0, ATTENTION_LIMIT)) {
        attention.push({ kind: 'BILLING_DUE', title: `${b.sourceLabel} — ${b.projectName}`, detail: b.draftInvoiceId ? 'Draft invoice not finalized' : 'Not yet invoiced', amount: b.amount, date: b.dueDate, href: `/projects/${b.projectId}` });
      }
    }
    if (tdsOutward) {
      for (const r of tdsOutward.rows.filter((x) => x.overdue && x.remaining !== '0.00').slice(0, ATTENTION_LIMIT)) {
        attention.push({ kind: 'TDS_DEPOSIT_OVERDUE', title: `${r.deducteeName} — ${r.documentLabel}`, detail: 'Withheld tax past its deposit due date', amount: r.remaining, date: r.dueDate, href: '/tds-deposits' });
      }
    }

    // Cash Flow reports each bank account's month; the trend is all accounts together.
    const cashTrend = cashFlow
      ? [...new Set(cashFlow.months.map((m) => m.month))].map((month) => {
          const rows = cashFlow.months.filter((m) => m.month === month);
          return { month, inflow: sumStrings(rows.map((r) => r.inflow)), outflow: sumStrings(rows.map((r) => r.outflow)) };
        })
      : null;

    // Each chart is one report's own breakdown, taken as computed; the
    // dashboard only picks which rows to show.
    const topProjects = projectPl
      ? projectPl.projects
          .filter((p): p is typeof p & { projectId: string } => p.projectId !== null && new Prisma.Decimal(p.income).greaterThan(0))
          .sort((a, b) => new Prisma.Decimal(b.income).comparedTo(a.income))
          .slice(0, TOP_PROJECT_LIMIT)
          .map((p) => ({ projectId: p.projectId, projectName: p.projectName, income: p.income, contribution: p.contribution }))
      : null;

    return {
      scope: { legalEntityId: filters.legalEntityId ?? null, legalEntityName: legalEntity?.legalName ?? null, dateFrom: filters.dateFrom, asOfDate: filters.asOfDate, currency: 'INR', restricted: !input.canSeeAllProjects },
      cards,
      cashTrend,
      receivableAging: aging ? aging.invoiceBuckets : null,
      payablesAging: payablesAging ? payablesAging.buckets : null,
      topProjects,
      attention,
      finance,
    };
  }
}

function sumStrings(values: string[]): string {
  return values.reduce((total, v) => total.plus(v), new Prisma.Decimal(0)).toFixed(2);
}
