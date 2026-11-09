import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { Prisma, generateId, recordAuditEvent } from '@zitaware/database';
import { CASH_CATEGORIES } from '@zitaware/contracts';
import type { ReportFilters, ReportReadInput } from '@zitaware/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerControlService } from '../../reports/ledger-control.service';
import { ReceivablesReportService } from '../../reports/receivables-report.service';
import { ProfitabilityReportService } from '../../reports/profitability-report.service';
import { PerformanceReportService } from '../../reports/performance-report.service';
import { GstReportService } from '../../reports/gst-report.service';
import { TdsReportService } from '../../reports/tds-report.service';
import { CashFlowReportService } from '../../reports/cash-flow-report.service';
import { PayablesReportService } from '../../reports/payables-report.service';
import { OperationsReportService } from '../../reports/operations-report.service';
import { ResourceReportService } from '../../reports/resource-report.service';
import { DashboardService } from '../../reports/dashboard.service';
import { ControlsReportService } from '../../reports/controls-report.service';
import { ReportScopeService } from '../../reports/report-scope.service';
import { ReportExportService } from '../../reports/report-export.service';
import { ReportsService } from '../../reports/reports.service';
import { SecurityInstrumentsService } from '../../security-instruments/security-instruments.service';
import { PostingService } from '../../accounting/posting.service';
import { buildMoneyFlowScenario, createScenarioServices, SCENARIO_CHART, type MoneyFlowScenario } from './build';
import { makeClaimApprover } from '../claim-approver.test-util';
import {
  BANK_RECONCILIATION_JUN_AUG,
  BANK_RECONCILIATION_STATEMENTS,
  BILLING,
  BUSINESS_OVERVIEW_ALL_TIME,
  CASH_PROFITABILITY_ALL_TIME,
  CASH_FLOW_JUN_SEP,
  DASHBOARD_JUN_AUG,
  CASH_PROFITABILITY_JULY,
  CLIENT_FIGURES,
  CLIENT_KEYS,
  CLIENT_PAYMENTS_JUN_AUG,
  EMD_SD,
  EXCEPTIONS_END,
  EMPLOYEE_ADVANCES,
  EXPENSES_ALL_TIME,
  CONTRACT_PERFORMANCE_ALL_TIME,
  COST_TO_COMPANY_ALL_TIME,
  GST_INPUT_ALL_TIME,
  HDFC_STATEMENT_CSV,
  INTRODUCER_STATEMENT,
  GST_NET_ALL_TIME,
  GST_OUTPUT_ALL_TIME,
  GST_REGISTER_ALL_TIME,
  DOCUMENT_TOTALS,
  LEDGER_BALANCES,
  MANPOWER,
  MANPOWER_UTILIZATION_JUL_AUG,
  MILESTONE_POOLS,
  NOTE_TOTALS,
  OPEX_SCHEDULES,
  OUTSTANDING_SUMMARY_AUG_31,
  P3_AGING_AUG_31,
  PAYABLES_AGING,
  PAYMENT_HOLDS,
  PENALTIES,
  PENDING_INVOICES_AUG_31,
  PL_ALL_TIME_TO,
  PROJECT_FIGURES,
  PROJECT_KEYS,
  PROJECT_PL_ACCOUNTS,
  PROJECT_PL_ALL_TIME,
  PROJECT_PL_JULY,
  PURCHASE_ROW_COUNTS,
  RECEIVABLE_AGING_AUG_31,
  REIMBURSEMENTS_JULY,
  REPORT_AS_OF,
  SALARY,
  SPEND_FIGURES,
  STOCK,
  TDS_INWARD_ALL_TIME,
  TDS_OUTWARD_ALL_TIME,
  TDS_RECONCILIATION_ALL_TIME,
  VENDOR_PAYMENTS_JUNE,
} from './expected';
import { purgeOrganization } from './purge';

/**
 * The whole project money flow — three clients, five projects, CAPEX and
 * OPEX billing, receipts carrying every deduction type, releases, a reversal,
 * notes, purchases, stock, claims, direct expenses, two salary months and an
 * introducer — checked against hand-computed figures to the paisa.
 *
 * The expected values live in `expected.ts` with their arithmetic; see that
 * file's header for why they must never be copied from a test run.
 */
const prisma = new PrismaService();
const services = createScenarioServices(prisma);
const makerId = generateId();

function createReports(): ReportsService {
  const ledger = new LedgerControlService(prisma);
  const scopes = new ReportScopeService(prisma, services.projects);
  const profitability = new ProfitabilityReportService(prisma, scopes, services.allocations, ledger);
  const performance = new PerformanceReportService(prisma, scopes, profitability, ledger);
  const receivables = new ReceivablesReportService(prisma, services.projects, ledger);
  const tds = new TdsReportService(prisma, scopes, ledger, services.tdsDeposits);
  const cashFlow = new CashFlowReportService(prisma, scopes, ledger, performance);
  const payables = new PayablesReportService(prisma, scopes, ledger);
  const operations = new OperationsReportService(prisma, scopes, ledger);
  return new ReportsService(
    prisma,
    receivables,
    profitability,
    performance,
    new GstReportService(prisma, scopes, ledger),
    tds,
    cashFlow,
    payables,
    operations,
    new ResourceReportService(prisma, scopes, ledger),
    new ControlsReportService(prisma, scopes, receivables, payables, tds, cashFlow, operations),
    new ReportExportService(),
  );
}
const checkerId = generateId();
let organizationId: string | undefined;
let scenario: MoneyFlowScenario;

/**
 * The scenario's hand-computed figures are as of this day. Payment alerts
 * open against today's date when a milestone is created, and recurring
 * cycles are generated up to today, so with the real clock the figures
 * drifted as the calendar moved on. Only Date is faked, and it keeps ticking
 * from here; timers stay real.
 */
const SCENARIO_TODAY = '2026-09-15T06:30:00.000Z';

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(SCENARIO_TODAY), shouldAdvanceTime: true });
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Money Flow Scenario Test Org', code: `MFLOW-${generateId()}` },
  });
  // Recorded before building, so a build that fails halfway is still purged.
  organizationId = organization.id;
  // The maker approves the claims, so it approves every legal entity's, as Admin does (ADR-182).
  await makeClaimApprover(prisma, organizationId, makerId);
  scenario = await buildMoneyFlowScenario(prisma, { organizationId, makerId, checkerId, emailSuffix: generateId() });
}, 300_000);

afterAll(async () => {
  if (organizationId) await purgeOrganization(prisma, organizationId);
  await prisma.client.$disconnect();
  vi.useRealTimers();
}, 120_000);

const read = { actorId: makerId, canSeeAll: true };

describe('Money-flow scenario — project Financials tab', () => {
  it.each(PROJECT_KEYS)('%s: every billing, collection, receivable and expense figure', async (key) => {
    const summary = await services.financials.getFinancialSummary({ organizationId: scenario.organizationId, projectId: scenario.projectIds[key], ...read });
    expect(summary).toEqual(expect.objectContaining({ projectId: scenario.projectIds[key], ...PROJECT_FIGURES[key] }));
  });

  it.each(PROJECT_KEYS)('%s: the project-page figures agree with the rest (ADR-166)', async (key) => {
    const projectId = scenario.projectIds[key];
    const s = await services.financials.getFinancialSummary({ organizationId: scenario.organizationId, projectId, ...read });
    const money = (v: string) => Math.round(Number(v) * 100);
    expect(money(s.profit)).toBe(money(s.billedExclGst) - money(s.recognizedProjectExpense));
    expect(money(s.serverExpense) + money(s.subscriptionExpense) + money(s.otherDirectExpense)).toBe(money(s.directExpense));
    const over = money(s.billedExclGst) - money(s.contractValueExclGst ?? '0');
    expect(s.billedOverContract).toBe(s.contractValueExclGst && over > 0 ? (over / 100).toFixed(2) : null);
    // Billed before GST never exceeds billed with GST.
    expect(money(s.billedExclGst)).toBeLessThanOrEqual(money(s.netBilled));
    expect(s.billedPercent).toBe(s.contractValueExclGst && Number(s.contractValueExclGst) > 0 ? ((Number(s.billedExclGst) / Number(s.contractValueExclGst)) * 100).toFixed(1) : null);

    const emd = await createReports().getEmdSdRecovery({
      organizationId: scenario.organizationId,
      actorId: makerId,
      canSeeAllProjects: true,
      filters: { legalEntityId: undefined, dateFrom: undefined, asOfDate: '2099-12-31', clientId: undefined, projectId: undefined },
    });
    const { tenderId } = await prisma.client.project.findUniqueOrThrow({ where: { id: projectId }, select: { tenderId: true } });
    const ours = (r: (typeof emd.rows)[number]) => r.projectId === projectId || (r.projectId === null && tenderId !== null && r.tenderId === tenderId);
    const lodged = (category: 'EMD' | 'SD') =>
      emd.rows.filter((r) => r.category === category && r.status !== 'RETURNED' && ours(r)).reduce((t, r) => t + money(r.amount), 0);
    expect([money(s.emdLodged), money(s.sdLodged)]).toEqual([lodged('EMD'), lodged('SD')]);
  });

  it('the portfolio list returns the same figures as each project on its own', async () => {
    const rows = await services.financials.listFinancialSummaries({ organizationId: scenario.organizationId, projectIds: PROJECT_KEYS.map((k) => scenario.projectIds[k]), ...read });
    for (const key of PROJECT_KEYS) {
      const single = await services.financials.getFinancialSummary({ organizationId: scenario.organizationId, projectId: scenario.projectIds[key], ...read });
      expect(rows.find((r) => r.projectId === scenario.projectIds[key])).toEqual(single);
    }
  });
});

describe('Money-flow scenario — client Financials', () => {
  it.each(CLIENT_KEYS)('%s: its projects summed field by field', async (key) => {
    const summary = await services.financials.getClientFinancialSummary({ organizationId: scenario.organizationId, clientId: scenario.clientIds[key], ...read });
    expect(summary).toEqual({ clientId: scenario.clientIds[key], ...CLIENT_FIGURES[key] });
  });
});

describe('Money-flow scenario — project Spend tab', () => {
  it.each(PROJECT_KEYS)('%s: category totals and grand total', async (key) => {
    const spend = await services.projects.getExpenseLedger({
      organizationId: scenario.organizationId, projectId: scenario.projectIds[key], ...read,
      hasVendorBillReadPermission: true, hasEmployeeClaimReadPermission: true, hasDirectExpenseReadPermission: true,
      hasInventoryReadPermission: true, hasProjectCostReadPermission: true, hasIntroducerFeeReadPermission: true,
      category: undefined, dateFrom: undefined, dateTo: undefined,
    });
    const { total, ...categories } = SPEND_FIGURES[key];
    expect(Object.fromEntries(spend.categoryTotals.map((c) => [c.category, c.amount]))).toEqual(categories);
    expect(spend.totalAmount).toBe(total);
    // An all-stock bill (P2's VB4) has no project cost of its own, so no row (ADR-103).
    expect(spend.rows.filter((r) => r.category === 'PURCHASE')).toHaveLength(PURCHASE_ROW_COUNTS[key]);
  });
});

describe('Money-flow scenario — milestones (CAPEX and OPEX)', () => {
  it.each(PROJECT_KEYS)('%s: CAPEX and OPEX pool totals', async (key) => {
    const overview = await services.milestones.listForProject({ organizationId: scenario.organizationId, projectId: scenario.projectIds[key], ...read });
    expect({ capexTotalAmount: overview.capexTotalAmount, opexTotalAmount: overview.opexTotalAmount }).toEqual(MILESTONE_POOLS[key]);
  });

  it('P3 carries both: three CAPEX events and one OPEX schedule on the same project', async () => {
    const overview = await services.milestones.listForProject({ organizationId: scenario.organizationId, projectId: scenario.projectIds.P3, ...read });
    expect(overview.capexEvents.map((e) => [e.name, e.amount])).toEqual([['Phase 1', '600000.00'], ['Phase 2', '400000.00'], ['Phase 3', '500000.00']]);
    expect(overview.opexMilestones.map((m) => m.name)).toEqual([OPEX_SCHEDULES.P3.name]);
  });

  it.each(['P2', 'P3'] as const)('%s: OPEX installments, rounding remainder on the last, dates clamped to month-end', async (key) => {
    const expected = OPEX_SCHEDULES[key];
    const overview = await services.milestones.listForProject({ organizationId: scenario.organizationId, projectId: scenario.projectIds[key], ...read });
    const rows = overview.opexMilestones[0]!.installments!;
    const pick = (r: (typeof rows)[number]) => ({ servicePeriodStart: r.servicePeriodStart, servicePeriodEnd: r.servicePeriodEnd, plannedInvoiceDate: r.plannedInvoiceDate, scheduledAmount: r.scheduledAmount });

    expect(rows).toHaveLength(expected.installmentCount);
    expect(rows.slice(0, -1).every((r) => r.scheduledAmount === expected.regularAmount)).toBe(true);
    expect(rows.reduce((sum, r) => sum.plus(r.scheduledAmount), new Prisma.Decimal(0)).toFixed(2)).toBe(expected.total);
    expect([pick(rows[0]!), pick(rows[1]!), pick(rows[2]!), pick(rows[rows.length - 1]!)]).toEqual([expected.first, expected.second, expected.third, expected.last]);
  });

  async function invoiceNumberOf(key: keyof typeof DOCUMENT_TOTALS): Promise<string> {
    return (await prisma.client.invoice.findUniqueOrThrow({ where: { id: scenario.invoiceIds[key] } })).invoiceNumber!;
  }

  it('derives each CAPEX event\'s billing status from its finalized invoice — a voided one does not count', async () => {
    for (const expected of BILLING.capexEvents) {
      const overview = await services.milestones.listForProject({ organizationId: scenario.organizationId, projectId: scenario.projectIds[expected.project], ...read });
      const event = overview.capexEvents.find((e) => e.name === expected.event)!;
      expect({ event: event.name, billingStatus: event.billingStatus, invoiceNumber: event.invoiceNumber }).toEqual({
        event: expected.event,
        billingStatus: expected.billingStatus,
        invoiceNumber: expected.invoice ? await invoiceNumberOf(expected.invoice) : null,
      });
    }
  });

  it.each(['P2', 'P3'] as const)('%s: an OPEX schedule with two installments invoiced is partly invoiced, with progress', async (key) => {
    const expected = BILLING.opex[key];
    const overview = await services.milestones.listForProject({ organizationId: scenario.organizationId, projectId: scenario.projectIds[key], ...read });
    const milestone = overview.opexMilestones[0]!;
    expect({ billingStatus: milestone.billingStatus, invoicedCount: milestone.invoicedCount, billableCount: milestone.billableCount })
      .toEqual({ billingStatus: expected.billingStatus, invoicedCount: expected.invoicedCount, billableCount: expected.billableCount });

    const invoiced = milestone.installments!.filter((i) => i.invoiceNumber !== null).map((i) => ({ sequenceNumber: i.sequenceNumber, invoiceNumber: i.invoiceNumber }));
    const expectedInvoiced = await Promise.all(expected.invoicedInstallments.map(async (i) => ({ sequenceNumber: i.sequenceNumber, invoiceNumber: await invoiceNumberOf(i.invoice) })));
    expect(invoiced).toEqual(expectedInvoiced);
  });
});

describe('Money-flow scenario — documents', () => {
  it('stores every invoice with the exact GST split and total, CGST+SGST and IGST never together', async () => {
    for (const [key, expected] of Object.entries(DOCUMENT_TOTALS)) {
      const invoice = await prisma.client.invoice.findUniqueOrThrow({ where: { id: scenario.invoiceIds[key as keyof typeof DOCUMENT_TOTALS] } });
      expect({
        project: invoice.projectId, taxable: invoice.taxableAmount?.toFixed(2), cgst: invoice.cgstAmount?.toFixed(2), sgst: invoice.sgstAmount?.toFixed(2),
        igst: invoice.igstAmount?.toFixed(2), total: invoice.totalAmount?.toFixed(2), status: invoice.status,
      }).toEqual({ ...expected, project: scenario.projectIds[expected.project] });
    }
  });

  it('stores the debit and credit note totals', async () => {
    for (const [key, expected] of Object.entries(NOTE_TOTALS)) {
      const note = await prisma.client.creditDebitNote.findUniqueOrThrow({ where: { id: scenario.noteIds[key as keyof typeof NOTE_TOTALS] } });
      expect({ type: note.type, taxable: note.taxableAmount?.toFixed(2), cgst: note.cgstAmount?.toFixed(2), sgst: note.sgstAmount?.toFixed(2), igst: note.igstAmount?.toFixed(2), total: note.totalAmount?.toFixed(2) })
        .toEqual({ type: expected.type, taxable: expected.taxable, cgst: expected.cgst, sgst: expected.sgst, igst: expected.igst, total: expected.total });
    }
  });
});

describe('Money-flow scenario — salary and manpower', () => {
  it('posts both salary months and the July payment', async () => {
    const [july, august] = await Promise.all([
      prisma.client.salaryImport.findUniqueOrThrow({ where: { id: scenario.salaryImportIds.july } }),
      prisma.client.salaryImport.findUniqueOrThrow({ where: { id: scenario.salaryImportIds.august } }),
    ]);
    expect({ employeeCount: july.employeeCount, totalGrossAmount: july.totalGrossAmount.toFixed(2) }).toEqual(SALARY.july);
    expect({ employeeCount: august.employeeCount, totalGrossAmount: august.totalGrossAmount.toFixed(2) }).toEqual(SALARY.august);

    const payment = await prisma.client.salaryPayment.findFirstOrThrow({ where: { salaryImportId: scenario.salaryImportIds.july } });
    expect({ grossAmount: payment.grossAmount.toFixed(2), tdsAmount: payment.tdsAmount.toFixed(2), netAmount: payment.netAmount.toFixed(2) }).toEqual(SALARY.julyPayment);
  });

  it('builds the Manpower cost report from submitted months only', async () => {
    const report = await services.allocations.getProjectManpowerCost({
      organizationId: scenario.organizationId, fromMonth: '2026-07-01', toMonth: '2026-08-01', projectId: undefined, actorId: makerId, canSeeAllProjects: true,
    });
    const actual = report.rows
      .map((r) => ({ projectId: r.projectId, month: r.allocationMonth, employeeCount: r.employeeCount, totalPercentage: r.totalPercentage, amount: r.manpowerCostAmount }))
      .sort((a, b) => `${a.month}${a.projectId}`.localeCompare(`${b.month}${b.projectId}`));
    const expected = MANPOWER.rows
      .map((r) => ({ projectId: scenario.projectIds[r.project], month: r.month, employeeCount: r.employeeCount, totalPercentage: r.totalPercentage, amount: r.amount }))
      .sort((a, b) => `${a.month}${a.projectId}`.localeCompare(`${b.month}${b.projectId}`));
    expect(actual).toEqual(expected);
    expect(report.totalManpowerCostAmount).toBe(MANPOWER.totalManpowerCostAmount);
    expect(report.excludedDraftEmployeeMonths).toBe(MANPOWER.excludedDraftEmployeeMonths);
  });

  it('puts the one-paisa rounding remainder on the largest share of a three-way split', async () => {
    const month = await services.allocations.getMonth({ organizationId: scenario.organizationId, employeeId: scenario.employeeIds.E4, allocationMonth: '2026-07-01' });
    expect(month.grossSalaryAmount).toBe('55555.55');
    expect(month.allocatedTotalAmount).toBe('55555.55');
    expect(month.lines.map((l) => ({ projectId: l.projectId, percentage: l.percentage, allocatedAmount: l.allocatedAmount, carriesRoundingRemainder: l.carriesRoundingRemainder })))
      .toEqual(MANPOWER.e4July.map((l) => ({ projectId: scenario.projectIds[l.project], percentage: l.percentage, allocatedAmount: l.allocatedAmount, carriesRoundingRemainder: l.carriesRoundingRemainder })));
  });
});

describe('Money-flow scenario — ledger', () => {
  async function balancesByCode(): Promise<Map<string, Prisma.Decimal>> {
    const sums = await prisma.client.journalLine.groupBy({
      by: ['ledgerAccountId'],
      where: { organizationId: scenario.organizationId },
      _sum: { debitAmount: true, creditAmount: true },
    });
    const codeById = new Map([...scenario.ledgerAccountIdByCode].map(([code, id]) => [id, code]));
    return new Map(sums.map((s) => [codeById.get(s.ledgerAccountId) ?? s.ledgerAccountId, (s._sum.debitAmount ?? new Prisma.Decimal(0)).minus(s._sum.creditAmount ?? 0)]));
  }

  it('balances: total debits equal total credits across every journal line', async () => {
    const totals = await prisma.client.journalLine.aggregate({ where: { organizationId: scenario.organizationId }, _sum: { debitAmount: true, creditAmount: true } });
    expect(totals._sum.debitAmount?.toFixed(2)).toBe(totals._sum.creditAmount?.toFixed(2));
  });

  it('lands every account on its hand-computed balance, and nothing anywhere else', async () => {
    const balances = await balancesByCode();
    const actual = Object.fromEntries(SCENARIO_CHART.map((a) => [a.code, (balances.get(a.code) ?? new Prisma.Decimal(0)).toFixed(2)]));
    const expected = Object.fromEntries(SCENARIO_CHART.map((a) => [a.code, LEDGER_BALANCES[a.code] ?? '0.00']));
    expect(actual).toEqual(expected);
    expect([...balances.keys()].filter((code) => !scenario.ledgerAccountIdByCode.has(code))).toEqual([]);
  });

  it('reconciles the screens to the ledger: receivable, stock and salary', async () => {
    const balances = await balancesByCode();
    const outstanding = PROJECT_KEYS.reduce((sum, k) => sum.plus(PROJECT_FIGURES[k].invoiceOutstanding), new Prisma.Decimal(0));
    expect(balances.get('ACCOUNTS_RECEIVABLE')!.toFixed(2)).toBe(outstanding.toFixed(2));

    const stock = await services.inventoryLedger.getBalance(scenario.organizationId, scenario.inventoryItemId);
    expect({ quantity: stock.quantity.toFixed(4), valueAmount: stock.valueAmount.toFixed(2), weightedAverageRate: stock.weightedAverageRate.toFixed(4) }).toEqual(STOCK);
    expect(balances.get('INVENTORY')!.toFixed(2)).toBe(STOCK.valueAmount);

    const salaryTotal = new Prisma.Decimal(SALARY.july.totalGrossAmount).plus(SALARY.august.totalGrossAmount);
    expect(balances.get('SALARIES_WAGES_EXPENSE')!.toFixed(2)).toBe(salaryTotal.toFixed(2));
  });

  it('keeps manpower analytical: project manpower plus bench plus drafts equals the salary expense', () => {
    // Allocation moves cost between dimensions without changing total salary
    // expense (docs/06). Bench 15,000 (Jul) + 18,000 (Aug); E4's August draft 55,555.55.
    const projectManpower = PROJECT_KEYS.reduce((sum, k) => sum.plus(PROJECT_FIGURES[k].manpowerExpense), new Prisma.Decimal(0));
    expect(projectManpower.plus('33000').plus('55555.55').toFixed(2)).toBe(LEDGER_BALANCES.SALARIES_WAGES_EXPENSE);
  });
});

describe('Money-flow scenario — receivables reports (Phase 8.1, ADR-108)', () => {
  const reports = createReports();
  const input = (filters: Partial<ReportFilters> = {}, canSeeAllProjects = true): ReportReadInput => ({
    organizationId: scenario.organizationId,
    actorId: makerId,
    canSeeAllProjects,
    filters: { legalEntityId: undefined, dateFrom: undefined, asOfDate: REPORT_AS_OF, clientId: undefined, projectId: undefined, ...filters },
  });
  const reconciliationOf = (lines: Array<{ key: string; reportAmount: string; ledgerAmount: string; reconciled: boolean }>) =>
    Object.fromEntries(lines.map((l) => [l.key, { reportAmount: l.reportAmount, ledgerAmount: l.ledgerAmount, reconciled: l.reconciled }]));

  it('ages every open invoice by its due date on 31 Aug, to the paisa', async () => {
    const report = await reports.getReceivableAging(input());
    expect(report.catalog.basis).toBe('ACCRUAL');
    expect(
      report.invoices.map((r) => ({
        invoiceId: r.invoiceId,
        invoiceDate: r.invoiceDate,
        dueDate: r.dueDate,
        totalAmount: r.totalAmount,
        settledAmount: r.settledAmount,
        noteAdjustmentAmount: r.noteAdjustmentAmount,
        outstandingAmount: r.outstandingAmount,
        daysPastDue: r.daysPastDue,
        bucket: r.bucket,
      })),
    ).toEqual(RECEIVABLE_AGING_AUG_31.invoices.map(({ invoice, ...row }) => ({ invoiceId: scenario.invoiceIds[invoice], ...row })));
    expect(report.invoiceBuckets).toEqual(RECEIVABLE_AGING_AUG_31.invoiceBuckets);
    expect(report.invoiceTotal).toBe(RECEIVABLE_AGING_AUG_31.invoiceTotal);
  });

  it('ages hold and retention separately, by the receipt that withheld them', async () => {
    const report = await reports.getReceivableAging(input());
    expect(
      report.heldDeductions.map((h) => ({
        type: h.type,
        invoiceId: h.invoiceId,
        receiptDate: h.receiptDate,
        amount: h.amount,
        releasedAmount: h.releasedAmount,
        outstandingAmount: h.outstandingAmount,
        daysHeld: h.daysHeld,
        bucket: h.bucket,
      })),
    ).toEqual(RECEIVABLE_AGING_AUG_31.held.map(({ invoice, ...row }) => ({ invoiceId: scenario.invoiceIds[invoice], ...row })));
    expect(report.heldTotal).toBe(RECEIVABLE_AGING_AUG_31.heldTotal);
  });

  it('reconciles the aging totals to the AR, hold and retention control accounts on 31 Aug', async () => {
    const { reconciliation } = await reports.getReceivableAging(input());
    expect(reconciliation.applicable).toBe(true);
    expect(reconciliationOf(reconciliation.lines)).toEqual(
      Object.fromEntries(Object.entries(RECEIVABLE_AGING_AUG_31.reconciliation).map(([key, amount]) => [key, { reportAmount: amount, ledgerAmount: amount, reconciled: true }])),
    );
    expect(reconciliation.allReconciled).toBe(true);
  });

  it('counts both notes once their date has passed, and still agrees with the ledger', async () => {
    // Far enough ahead to include the notes, whatever day the suite runs.
    const report = await reports.getReceivableAging(input({ asOfDate: '2099-12-31' }));
    expect(report.invoiceTotal).toBe(LEDGER_BALANCES.ACCOUNTS_RECEIVABLE);
    const noteOf = (key: 'INV2' | 'INV5') => report.invoices.find((r) => r.invoiceId === scenario.invoiceIds[key])?.noteAdjustmentAmount;
    expect(noteOf('INV2')).toBe('11800.00');
    expect(noteOf('INV5')).toBe('-59000.00');
    expect(report.reconciliation.allReconciled).toBe(true);
  });

  it('keeps each outstanding measure separate, each agreeing with its own ledger account', async () => {
    const report = await reports.getOutstandingSummary(input());
    expect(report.measures.map((m) => ({ key: m.key, amount: m.amount, itemCount: m.itemCount }))).toEqual(OUTSTANDING_SUMMARY_AUG_31);
    expect(report.deductions.every((d) => new Prisma.Decimal(d.outstandingAmount).greaterThan(0))).toBe(true);
    expect(reconciliationOf(report.reconciliation.lines)).toEqual(
      Object.fromEntries(OUTSTANDING_SUMMARY_AUG_31.map((m) => [m.key, { reportAmount: m.amount, ledgerAmount: m.amount, reconciled: true }])),
    );
  });

  it('filters to one project, and then makes no ledger comparison', async () => {
    const report = await reports.getReceivableAging(input({ projectId: scenario.projectIds.P3 }));
    expect(report.invoices.map((r) => r.invoiceId).sort()).toEqual(P3_AGING_AUG_31.invoices.map((k) => scenario.invoiceIds[k]).sort());
    expect(report.invoiceTotal).toBe(P3_AGING_AUG_31.invoiceTotal);
    expect(report.scope.restricted).toBe(true);
    expect(report.reconciliation).toMatchObject({ applicable: false, lines: [] });
  });

  it('shows an actor without project.read_all only their own projects — here none — and no ledger comparison', async () => {
    const report = await reports.getOutstandingSummary(input({}, false));
    expect(report.measures.every((m) => m.amount === '0.00' && m.itemCount === 0)).toBe(true);
    expect(report.reconciliation.applicable).toBe(false);
  });

  it('exports the figures on screen to Excel and records the export in the audit trail', async () => {
    const result = await reports.exportReport({ ...input(), key: 'receivable-aging', format: 'XLSX', correlationId: generateId(), ipAddress: undefined, userAgent: undefined });
    expect(result.filename).toBe(`receivable-aging-${REPORT_AS_OF}.xlsx`);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(result.base64, 'base64') as unknown as ArrayBuffer);
    const rows = workbook.getWorksheet('Invoices')!.getSheetValues().filter(Boolean).map((row) => (row as unknown[]).slice(1));
    expect(rows.find((row) => row[0] === 'Total')).toContain(Number(RECEIVABLE_AGING_AUG_31.invoiceTotal));

    const audit = await prisma.client.auditEvent.findFirst({
      where: { organizationId: scenario.organizationId, action: 'REPORT_EXPORTED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toMatchObject({ entityType: 'REPORT', actorId: makerId });
    expect(audit?.newValues).toMatchObject({ report: 'receivable-aging', format: 'XLSX', filename: result.filename });
  });

  it('exports a PDF too', async () => {
    const result = await reports.exportReport({ ...input(), key: 'outstanding-summary', format: 'PDF', correlationId: generateId(), ipAddress: undefined, userAgent: undefined });
    expect(result.mimeType).toBe('application/pdf');
    expect(Buffer.from(result.base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('lists only the reports the caller may open', async () => {
    expect((await reports.getCatalog({ permissions: ['report.receivables.read'] })).map((r) => r.key)).toEqual(['receivable-aging', 'outstanding-summary']);
    expect(await reports.getCatalog({ permissions: ['report.export'] })).toEqual([]);
  });
});

describe('Money-flow scenario — Accrual Project P&L and Cost to Company (Phase 8.2, ADR-109)', () => {
  const reports = createReports();
  const input = (filters: Partial<ReportFilters> = {}, canSeeAllProjects = true): ReportReadInput => ({
    organizationId: scenario.organizationId,
    actorId: makerId,
    canSeeAllProjects,
    filters: { legalEntityId: undefined, dateFrom: undefined, asOfDate: PL_ALL_TIME_TO, clientId: undefined, projectId: undefined, ...filters },
  });
  const figures = (r: { income: string; expense: string; contribution: string; manpower: string | null; contributionAfterManpower: string | null }) => ({
    income: r.income, expense: r.expense, contribution: r.contribution, manpower: r.manpower, contributionAfterManpower: r.contributionAfterManpower,
  });

  it('tags each receipt deduction line with its invoice\'s project, one line per project', async () => {
    const lines = await prisma.client.journalLine.findMany({
      where: { organizationId: scenario.organizationId, journalEntry: { sourceType: 'receipt_post', accountingDate: new Date('2026-07-10T00:00:00.000Z') }, ledgerAccount: { code: 'TDS_RECEIVABLE' } },
      select: { projectId: true, debitAmount: true },
    });
    // R1 settled INV1 (P1, TDS 10,000) and INV3 (P2, TDS 2,000) in one receipt.
    expect(lines.map((l) => [l.projectId, l.debitAmount.toFixed(2)]).sort()).toEqual(
      [[scenario.projectIds.P1, '10000.00'], [scenario.projectIds.P2, '2000.00']].sort(),
    );
  });

  it('gives every project its income, expense, contribution and manpower over all dates', async () => {
    const report = await reports.getProjectPl(input());
    expect(report.catalog.basis).toBe('ACCRUAL');
    expect(Object.fromEntries(report.projects.map((r) => [r.projectId, figures(r)]))).toEqual(
      Object.fromEntries(PROJECT_KEYS.map((k) => [scenario.projectIds[k], PROJECT_PL_ALL_TIME.projects[k]])),
    );
    expect(figures(report.unassigned!)).toEqual(PROJECT_PL_ALL_TIME.unassigned);
    expect(figures(report.totals)).toEqual(PROJECT_PL_ALL_TIME.totals);
  });

  it('splits each ledger account between project lines and unassigned lines', async () => {
    const report = await reports.getProjectPl(input());
    expect(report.accounts.map(({ code, accountType, assignedAmount, unassignedAmount, totalAmount }) => ({ code, accountType, assignedAmount, unassignedAmount, totalAmount }))).toEqual(PROJECT_PL_ACCOUNTS);
  });

  it('reconciles total income and expense to the ledger\'s income and expense accounts', async () => {
    const { reconciliation } = await reports.getProjectPl(input());
    expect(reconciliation.lines.map((l) => [l.key, l.reportAmount, l.ledgerAmount, l.reconciled])).toEqual([
      ['INCOME', PROJECT_PL_ALL_TIME.totals.income, PROJECT_PL_ALL_TIME.totals.income, true],
      ['EXPENSE', PROJECT_PL_ALL_TIME.totals.expense, PROJECT_PL_ALL_TIME.totals.expense, true],
    ]);
  });

  it('limits every figure, manpower included, to a period', async () => {
    const report = await reports.getProjectPl(input({ dateFrom: PROJECT_PL_JULY.dateFrom, asOfDate: PROJECT_PL_JULY.dateTo }));
    expect(Object.fromEntries(report.projects.map((r) => [r.projectId, figures(r)]))).toEqual(
      Object.fromEntries(PROJECT_KEYS.map((k) => [scenario.projectIds[k], PROJECT_PL_JULY.projects[k]])),
    );
    expect({ income: report.totals.income, expense: report.totals.expense }).toEqual(PROJECT_PL_JULY.totals);
    expect(report.scope.dateFrom).toBe(PROJECT_PL_JULY.dateFrom);
    expect(report.reconciliation.allReconciled).toBe(true);
  });

  it('refuses a period that starts after it ends', async () => {
    await expect(reports.getProjectPl(input({ dateFrom: '2026-08-01', asOfDate: '2026-07-31' }))).rejects.toThrow(/cannot start after it ends/);
  });

  it('shows one client\'s projects without the unassigned row or a ledger comparison', async () => {
    const report = await reports.getProjectPl(input({ clientId: scenario.clientIds.C3 }));
    expect(report.projects.map((r) => r.projectId).sort()).toEqual([scenario.projectIds.P4, scenario.projectIds.P5].sort());
    expect(report.unassigned).toBeNull();
    expect(report.reconciliation.applicable).toBe(false);
  });

  it('breaks each project\'s cost down by kind, summary equal to the detail rows', async () => {
    const report = await reports.getCostToCompany(input());
    expect(Object.fromEntries(report.rows.map((r) => [r.projectId, { amounts: r.amounts, postedTotal: r.postedTotal, total: r.total }]))).toEqual(
      Object.fromEntries(PROJECT_KEYS.map((k) => [scenario.projectIds[k], COST_TO_COMPANY_ALL_TIME.rows[k]])),
    );
    expect(report.totals).toEqual(COST_TO_COMPANY_ALL_TIME.totals);
    expect(report.unassignedPostedCost).toBe(COST_TO_COMPANY_ALL_TIME.unassignedPostedCost);
    expect(report.reconciliation.lines.map((l) => [l.reportAmount, l.ledgerAmount, l.reconciled])).toEqual([[PROJECT_PL_ALL_TIME.totals.expense, PROJECT_PL_ALL_TIME.totals.expense, true]]);
  });

  it('exports the P&L to Excel and Cost to Company to PDF', async () => {
    const xlsx = await reports.exportReport({ ...input({ dateFrom: '2026-07-01', asOfDate: '2026-07-31' }), key: 'project-pl', format: 'XLSX', correlationId: generateId(), ipAddress: undefined, userAgent: undefined });
    expect(xlsx.filename).toBe('project-pl-2026-07-01-to-2026-07-31.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(xlsx.base64, 'base64') as unknown as ArrayBuffer);
    const rows = workbook.getWorksheet('Projects')!.getSheetValues().filter(Boolean).map((row) => (row as unknown[]).slice(1));
    expect(rows.find((row) => row[0] === 'Total')).toContain(Number(PROJECT_PL_JULY.totals.income));

    const pdf = await reports.exportReport({ ...input(), key: 'cost-to-company', format: 'PDF', correlationId: generateId(), ipAddress: undefined, userAgent: undefined });
    expect(Buffer.from(pdf.base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('Money-flow scenario — Cash Profitability, Contract & Budget Performance, Business Overview (Phase 8.3, ADR-110)', () => {
  const reports = createReports();
  const input = (filters: Partial<ReportFilters> = {}, canSeeAllProjects = true): ReportReadInput => ({
    organizationId: scenario.organizationId,
    actorId: makerId,
    canSeeAllProjects,
    filters: { legalEntityId: undefined, dateFrom: undefined, asOfDate: PL_ALL_TIME_TO, clientId: undefined, projectId: undefined, ...filters },
  });
  const allCategories = (amounts: Partial<Record<string, string>>) => Object.fromEntries(CASH_CATEGORIES.map((c) => [c, amounts[c] ?? '0.00']));
  const cashFigures = (r: { amounts: Record<string, string>; cashIn: string; cashOut: string; netCash: string; cashMarginPercent: string | null }) => ({
    amounts: r.amounts, cashIn: r.cashIn, cashOut: r.cashOut, netCash: r.netCash, cashMarginPercent: r.cashMarginPercent,
  });
  const expectedCash = (r: (typeof CASH_PROFITABILITY_ALL_TIME)['totals']) => ({ ...r, amounts: allCategories(r.amounts) });

  it('attributes every bank movement to the project its document names, to the paisa', async () => {
    const report = await reports.getCashProfitability(input());
    expect(report.catalog.basis).toBe('CASH');
    expect(Object.fromEntries(report.projects.map((r) => [r.projectId, cashFigures(r)]))).toEqual(
      Object.fromEntries(PROJECT_KEYS.map((k) => [scenario.projectIds[k], expectedCash(CASH_PROFITABILITY_ALL_TIME.projects[k])])),
    );
    expect(cashFigures(report.unassigned!)).toEqual(expectedCash(CASH_PROFITABILITY_ALL_TIME.unassigned));
    expect(cashFigures(report.totals)).toEqual(expectedCash(CASH_PROFITABILITY_ALL_TIME.totals));
  });

  it('reconciles net cash to the bank account\'s ledger movement', async () => {
    const { reconciliation } = await reports.getCashProfitability(input());
    expect(reconciliation.lines.map((l) => [l.key, l.reportAmount, l.ledgerAmount, l.reconciled, l.ledgerAccounts.map((a) => a.code)])).toEqual([
      ['BANK_MOVEMENT', LEDGER_BALANCES.BANK_HDFC_CURRENT, LEDGER_BALANCES.BANK_HDFC_CURRENT, true, ['BANK_HDFC_CURRENT']],
    ]);
  });

  it('limits cash to a period, and still reconciles', async () => {
    const report = await reports.getCashProfitability(input({ dateFrom: CASH_PROFITABILITY_JULY.dateFrom, asOfDate: CASH_PROFITABILITY_JULY.dateTo }));
    expect(Object.fromEntries(report.projects.map((r) => [r.projectId, r.netCash]))).toEqual(
      Object.fromEntries(PROJECT_KEYS.map((k) => [scenario.projectIds[k], CASH_PROFITABILITY_JULY.netCash[k]])),
    );
    expect(report.unassigned!.netCash).toBe(CASH_PROFITABILITY_JULY.unassignedNetCash);
    expect({ cashIn: report.totals.cashIn, cashOut: report.totals.cashOut, netCash: report.totals.netCash }).toEqual(CASH_PROFITABILITY_JULY.totals);
    expect(report.reconciliation.allReconciled).toBe(true);
  });

  it('shows a project-limited actor only their projects\' cash, with no unassigned row or bank comparison', async () => {
    const report = await reports.getCashProfitability(input({ projectId: scenario.projectIds.P3 }));
    expect(report.projects.map((r) => [r.projectId, r.netCash])).toEqual([[scenario.projectIds.P3, CASH_PROFITABILITY_ALL_TIME.projects.P3.netCash]]);
    expect(report.unassigned).toBeNull();
    expect(report.totals.netCash).toBe(CASH_PROFITABILITY_ALL_TIME.projects.P3.netCash);
    expect(report.reconciliation.applicable).toBe(false);
  });

  it('measures each contract and budget against billed revenue and cost to date', async () => {
    const report = await reports.getContractPerformance(input());
    expect(report.catalog.basis).toBe('CONTRACT_BUDGET');
    expect(
      Object.fromEntries(
        report.rows.map(({ projectId, contractValue, billedToDate, billedPercent, remainingToBill, budget, postedCostToDate, manpowerToDate, costToDate, budgetUsedPercent, budgetRemaining, overBudget }) => [
          projectId,
          { contractValue, billedToDate, billedPercent, remainingToBill, budget, postedCostToDate, manpowerToDate, costToDate, budgetUsedPercent, budgetRemaining, overBudget },
        ]),
      ),
    ).toEqual(Object.fromEntries(PROJECT_KEYS.map((k) => [scenario.projectIds[k], CONTRACT_PERFORMANCE_ALL_TIME.rows[k]])));
    expect(report.totals).toEqual(CONTRACT_PERFORMANCE_ALL_TIME.totals);
    expect(report.scope.dateFrom).toBeNull();
    expect(report.reconciliation.applicable).toBe(false);
  });

  it('labels every overview figure with its own basis and never blends them', async () => {
    const report = await reports.getBusinessOverview(input());
    expect(report.catalog.basis).toBe('MULTIPLE');
    expect(Object.fromEntries(report.cards.map((c) => [c.key, c.amount]))).toEqual(BUSINESS_OVERVIEW_ALL_TIME);
    expect(Object.fromEntries(report.cards.map((c) => [c.key, c.basis]))).toEqual({
      ACCRUAL_INCOME: 'ACCRUAL', ACCRUAL_EXPENSE: 'ACCRUAL', ACCRUAL_CONTRIBUTION: 'ACCRUAL',
      CASH_IN: 'CASH', CASH_OUT: 'CASH', NET_CASH: 'CASH',
      CONTRACT_VALUE: 'CONTRACT_BUDGET', BILLED_TO_DATE: 'CONTRACT_BUDGET', REMAINING_TO_BILL: 'CONTRACT_BUDGET', BUDGET: 'CONTRACT_BUDGET', COST_TO_DATE: 'CONTRACT_BUDGET',
      BANK_OPENING: 'BANK', BANK_MOVEMENT: 'BANK', BANK_CLOSING: 'BANK',
    });
    const p1 = report.projects.find((r) => r.projectId === scenario.projectIds.P1)!;
    expect([p1.income, p1.postedCost, p1.manpower, p1.accrualContribution, p1.netCash]).toEqual([
      PROJECT_PL_ALL_TIME.projects.P1.income, COST_TO_COMPANY_ALL_TIME.rows.P1.postedTotal, PROJECT_PL_ALL_TIME.projects.P1.manpower, PROJECT_PL_ALL_TIME.projects.P1.contribution, CASH_PROFITABILITY_ALL_TIME.projects.P1.netCash,
    ]);
    expect(report.reconciliation.lines.map((l) => [l.key, l.reconciled])).toEqual([['INCOME', true], ['EXPENSE', true], ['BANK_MOVEMENT', true]]);
  });

  it('gives the bank\'s opening and closing balance around a period, and hides it on a filtered view', async () => {
    const july = await reports.getBusinessOverview(input({ dateFrom: CASH_PROFITABILITY_JULY.dateFrom, asOfDate: CASH_PROFITABILITY_JULY.dateTo }));
    const card = (key: string) => july.cards.find((c) => c.key === key)!.amount;
    expect({ opening: card('BANK_OPENING'), movement: card('BANK_MOVEMENT'), closing: card('BANK_CLOSING') }).toEqual(CASH_PROFITABILITY_JULY.bank);
    expect(card('NET_CASH')).toBe(CASH_PROFITABILITY_JULY.totals.netCash);

    const filtered = await reports.getBusinessOverview(input({ clientId: scenario.clientIds.C1 }));
    expect(filtered.cards.filter((c) => c.basis === 'BANK').map((c) => c.amount)).toEqual([null, null, null]);
    expect(filtered.projects.map((r) => r.projectId).sort()).toEqual([scenario.projectIds.P1, scenario.projectIds.P2].sort());
  });

  it('exports Cash Profitability to Excel and the overview and contract report to PDF', async () => {
    const xlsx = await reports.exportReport({ ...input(), key: 'cash-profitability', format: 'XLSX', correlationId: generateId(), ipAddress: undefined, userAgent: undefined });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(xlsx.base64, 'base64') as unknown as ArrayBuffer);
    const rows = workbook.getWorksheet('Projects')!.getSheetValues().filter(Boolean).map((row) => (row as unknown[]).slice(1));
    expect(rows.find((row) => row[0] === 'Total')).toContain(Number(CASH_PROFITABILITY_ALL_TIME.totals.netCash));

    for (const key of ['business-overview', 'contract-performance'] as const) {
      const pdf = await reports.exportReport({ ...input(), key, format: 'PDF', correlationId: generateId(), ipAddress: undefined, userAgent: undefined });
      expect(Buffer.from(pdf.base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    }
  });
});

describe('Money-flow scenario — GST Output, Input, Net and Document Register (Phase 8.4, ADR-111)', () => {
  const reports = createReports();
  const input = (filters: Partial<ReportFilters> = {}, canSeeAllProjects = true): ReportReadInput => ({
    organizationId: scenario.organizationId,
    actorId: makerId,
    canSeeAllProjects,
    filters: { legalEntityId: undefined, dateFrom: undefined, asOfDate: PL_ALL_TIME_TO, clientId: undefined, projectId: undefined, ...filters },
  });
  const tax = (r: { taxable: string; cgst: string; sgst: string; igst: string; total: string }) => ({ taxable: r.taxable, cgst: r.cgst, sgst: r.sgst, igst: r.igst, total: r.total });
  const documentIdOf = (key: string) => (key === 'DN1' || key === 'CN1' ? scenario.noteIds[key] : scenario.invoiceIds[key as keyof typeof scenario.invoiceIds]);
  const notesMonth = async () => {
    const note = await prisma.client.creditDebitNote.findUniqueOrThrow({ where: { id: scenario.noteIds.CN1 }, select: { journalEntry: { select: { accountingDate: true } } } });
    return note.journalEntry!.accountingDate.toISOString().slice(0, 7);
  };

  it('lists every output document in the month of its own journal, the void netting its invoice, to the paisa', async () => {
    const report = await reports.getGstOutput(input());
    expect(report.documents.map((r) => ({ documentId: r.documentId, documentType: r.documentType, ...tax(r) }))).toEqual(
      GST_OUTPUT_ALL_TIME.documents.map((r) => ({ documentId: documentIdOf(r.key), documentType: r.documentType, ...tax(r) })),
    );
    expect(report.documents.filter((r) => r.documentType.includes('INVOICE')).map((r) => r.ledgerDate)).toEqual(GST_OUTPUT_ALL_TIME.documents.filter((r) => r.ledgerDate).map((r) => r.ledgerDate));
    expect(tax(report.totals)).toEqual(GST_OUTPUT_ALL_TIME.totals);
  });

  it('summarises output by registration and tax period, and reconciles each component to its output GST account', async () => {
    const report = await reports.getGstOutput(input());
    const month = await notesMonth();
    const notes = GST_OUTPUT_ALL_TIME.notesPeriod;
    const expected = month === '2026-08' ? null : [...GST_OUTPUT_ALL_TIME.periods, { taxPeriod: month, ...notes }];
    expect(new Set(report.periods.map((p) => p.gstin)).size).toBe(1);
    if (expected) expect(report.periods.map(({ taxPeriod, documentCount, ...rest }) => ({ taxPeriod, documentCount, ...tax(rest) }))).toEqual(expected);
    expect(report.reconciliation.lines.map((l) => [l.key, l.reportAmount, l.ledgerAmount, l.reconciled])).toEqual([
      ['OUTPUT_CGST', '75011.11', '75011.11', true],
      ['OUTPUT_SGST', '75011.11', '75011.11', true],
      ['OUTPUT_IGST', '212000.00', '212000.00', true],
    ]);
  });

  it('counts a void in the month it was voided: August output IGST is INV10\'s 2,500 alone', async () => {
    const august = await reports.getGstOutput(input({ dateFrom: '2026-08-01', asOfDate: '2026-08-31' }));
    expect(august.totals.igst).toBe('2500.00');
    expect(august.documents.map((r) => r.documentType)).toEqual(['INVOICE', 'INVOICE_VOID', 'INVOICE']);
    expect(august.reconciliation.allReconciled).toBe(true);

    const fifth = await reports.getGstOutput(input({ dateFrom: '2026-08-01', asOfDate: '2026-08-05' }));
    expect(fifth.totals.igst).toBe('108000.00'); // INV8, not yet voided
  });

  it('limits output to a project without a ledger comparison', async () => {
    const report = await reports.getGstOutput(input({ projectId: scenario.projectIds.P3 }));
    expect(report.totals.igst).toBe('176000.00'); // INV5 1,08,000 + INV6 72,000 + INV9 2,500 + INV10 2,500 − CN1 9,000
    expect(report.reconciliation.applicable).toBe(false);
  });

  it('separates eligible, ineligible and pending input GST, and reconciles eligible input to the input GST accounts', async () => {
    const report = await reports.getGstInput(input());
    expect(report.documents.map(({ number, documentType, ledgerDate, taxable, eligible, ineligible }) => ({ number, documentType, ledgerDate, taxable, eligible, ineligible }))).toEqual(GST_INPUT_ALL_TIME.documents);
    expect(report.periods.map((p) => ({ registered: p.gstin !== null, taxPeriod: p.taxPeriod, documentCount: p.documentCount, taxable: p.taxable, eligibleTotal: p.eligible.total, ineligibleTotal: p.ineligible.total }))).toEqual(GST_INPUT_ALL_TIME.periods);
    expect(report.totals).toEqual(GST_INPUT_ALL_TIME.totals);
    expect(report.pending.map(({ number, documentDate, taxable, eligible }) => ({ number, documentDate, taxable, eligible }))).toEqual(GST_INPUT_ALL_TIME.pending);
    expect(report.reconciliation.lines.map((l) => [l.key, l.reportAmount, l.ledgerAmount, l.reconciled])).toEqual([
      ['INPUT_CGST', '9000.00', '9000.00', true],
      ['INPUT_SGST', '9000.00', '9000.00', true],
      ['INPUT_IGST', '1800.00', '1800.00', true],
      ['INPUT_NOT_SPLIT', '1800.00', '1800.00', true],
    ]);

    const july = await reports.getGstInput(input({ dateFrom: '2026-07-01', asOfDate: '2026-07-31' }));
    expect(july.totals.eligible.total).toBe('3600.00');
    expect(july.pending).toEqual([]); // AN-1002 is dated 1 Aug
  });

  it('nets output against eligible input per component and month, each component agreeing with its GST accounts', async () => {
    const report = await reports.getGstNet(input());
    expect(report.components.map(({ component, output, eligibleInput, adjustments, net }) => ({ component, output, eligibleInput, adjustments, net }))).toEqual(GST_NET_ALL_TIME.components);
    const { output, eligibleInput, adjustments, net } = report.totals;
    expect({ output, eligibleInput, adjustments, net }).toEqual(GST_NET_ALL_TIME.totals);
    const month = await notesMonth();
    if (month !== '2026-08') expect(report.periods).toEqual([...GST_NET_ALL_TIME.periods, { taxPeriod: month, ...GST_NET_ALL_TIME.notesPeriod }]);
    expect(report.adjustments).toEqual([]);
    expect(report.reconciliation.lines.map((l) => [l.key, l.reportAmount, l.ledgerAmount, l.reconciled])).toEqual(
      GST_NET_ALL_TIME.components.map((c) => [`NET_${c.component}`, c.net, c.net, true]),
    );
  });

  it('lists document tax lines with each document\'s status on the end date', async () => {
    const report = await reports.getGstRegister(input());
    expect(report.totals).toEqual(GST_REGISTER_ALL_TIME);
    const inv8 = report.lines.find((l) => l.documentId === scenario.invoiceIds.INV8)!;
    expect([inv8.status, inv8.hsnSac, inv8.ratePercent, inv8.igst]).toEqual(['VOID', '998314', '18.00', '108000.00']);
    expect(report.lines.filter((l) => l.direction === 'INWARD').map((l) => [l.number, l.itcEligible])).toEqual([
      ['AN-1001', true], ['AN-1001', true], ['PHT-77', false], ['AN-1003', true],
    ]);

    const beforeVoid = await reports.getGstRegister(input({ asOfDate: '2026-08-05' }));
    expect(beforeVoid.lines.find((l) => l.documentId === scenario.invoiceIds.INV8)!.status).toBe('FINALIZED');
  });

  it('exports every GST report to Excel and PDF', async () => {
    for (const key of ['gst-output', 'gst-input', 'gst-net', 'gst-register'] as const) {
      const xlsx = await reports.exportReport({ ...input(), key, format: 'XLSX', correlationId: generateId(), ipAddress: undefined, userAgent: undefined });
      expect(xlsx.base64.length).toBeGreaterThan(0);
      const pdf = await reports.exportReport({ ...input(), key, format: 'PDF', correlationId: generateId(), ipAddress: undefined, userAgent: undefined });
      expect(Buffer.from(pdf.base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    }
  });

  // Last: it posts to the ledger. Dated before the notes, in a period nothing else uses.
  it('shows a GST posting no document explains as an adjustment, and still reconciles', async () => {
    const accounts = scenario.ledgerAccountIdByCode;
    const adjustment = await services.posting.postJournal({
      organizationId: scenario.organizationId,
      legalEntityId: scenario.legalEntityId,
      accountingDate: '2026-09-10',
      sourceType: 'test_gst_adjustment',
      sourceId: generateId(),
      postingEvent: 'test.gst_adjustment',
      description: 'GST-TDS credit utilised against output CGST',
      lines: [
        { ledgerAccountId: accounts.get('OUTPUT_CGST_PAYABLE')!, debit: '1000.00', credit: '0', projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
        { ledgerAccountId: accounts.get('GST_TDS_RECEIVABLE_CGST')!, debit: '0', credit: '1000.00', projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
      ],
      idempotencyKey: generateId(),
      actorId: makerId,
      correlationId: generateId(),
    });
    const report = await reports.getGstNet(input({ dateFrom: '2026-09-10', asOfDate: '2026-09-10' }));
    expect(report.adjustments.map((a) => [a.component, a.amount, a.sourceType])).toEqual([['CGST', '-1000.00', 'test_gst_adjustment']]);
    expect(report.components.find((c) => c.component === 'CGST')!.net).toBe('-1000.00');
    expect(report.reconciliation.allReconciled).toBe(true);

    // Leave the scenario's ledger as it was: later suites reconcile GST-TDS receivable to it.
    await services.posting.reverseJournal({
      organizationId: scenario.organizationId, id: adjustment.id, accountingDate: '2026-09-10', reason: 'Test adjustment undone',
      idempotencyKey: generateId(), actorId: makerId, correlationId: generateId(),
    });
    const undone = await reports.getGstNet(input({ dateFrom: '2026-09-10', asOfDate: '2026-09-10' }));
    expect([undone.components.find((c) => c.component === 'CGST')!.net, undone.adjustments.length, undone.reconciliation.allReconciled]).toEqual(['0.00', 2, true]);
  });
});

describe('Money-flow scenario — TDS certificates, TDS Inward and reconciliation (Phase 8.5a, ADR-112)', () => {
  const reports = createReports();
  const certificates = services.tdsCertificates;
  const input = (filters: Partial<ReportFilters> = {}, canSeeAllProjects = true): ReportReadInput => ({
    organizationId: scenario.organizationId,
    actorId: makerId,
    canSeeAllProjects,
    filters: { legalEntityId: undefined, dateFrom: undefined, asOfDate: PL_ALL_TIME_TO, clientId: undefined, projectId: undefined, ...filters },
  });
  const ctx = () => ({ organizationId: scenario.organizationId, actorId: makerId, correlationId: generateId() });
  const deductionOf = async (invoice: keyof typeof scenario.invoiceIds, type: 'TDS' | 'CGST_TDS' | 'SGST_TDS' | 'IGST_TDS') =>
    (await prisma.client.allocationDeduction.findFirstOrThrow({ where: { type, allocation: { invoiceId: scenario.invoiceIds[invoice], receipt: { status: 'POSTED' } } } })).id;

  it('gives every client deduction its certificate status on the end date, to the paisa', async () => {
    const report = await reports.getTdsInward(input());
    expect(report.catalog.category).toBe('TDS');
    expect(report.rows.map((r) => ({ invoiceId: r.invoiceId, type: r.deductionType, receiptDate: r.receiptDate, amount: r.amount, certificateMatched: r.certificateMatched, statementMatched: r.statementMatched, lifecycle: r.lifecycle, partiallyMatched: r.partiallyMatched }))).toEqual(
      TDS_INWARD_ALL_TIME.rows.map(({ invoice, ...rest }) => ({ invoiceId: scenario.invoiceIds[invoice], ...rest })),
    );
    expect(report.rows.find((r) => r.invoiceId === scenario.invoiceIds.INV1 && r.deductionType === 'TDS')!.certificateReferences).toEqual(['GIL/16A/Q2/0001']);
    for (const s of report.summary) {
      const e = TDS_INWARD_ALL_TIME.summary[s.deductionType];
      expect({ count: s.count, amount: s.amount, certificateMatched: s.certificateMatched, statementMatched: s.statementMatched, pending: s.byLifecycle.CERTIFICATE_PENDING.amount, received: s.byLifecycle.CERTIFICATE_RECEIVED.amount, reconciled: s.byLifecycle.RECONCILED.amount }).toEqual(e);
    }
  });

  it('reconciles each deduction type to its receivable account', async () => {
    const { reconciliation } = await reports.getTdsInward(input());
    expect(reconciliation.lines.map((l) => [l.key, l.reportAmount, l.ledgerAmount, l.reconciled])).toEqual([
      ['TDS', LEDGER_BALANCES.TDS_RECEIVABLE, LEDGER_BALANCES.TDS_RECEIVABLE, true],
      ['CGST_TDS', LEDGER_BALANCES.GST_TDS_RECEIVABLE_CGST, LEDGER_BALANCES.GST_TDS_RECEIVABLE_CGST, true],
      ['SGST_TDS', LEDGER_BALANCES.GST_TDS_RECEIVABLE_SGST, LEDGER_BALANCES.GST_TDS_RECEIVABLE_SGST, true],
      ['IGST_TDS', LEDGER_BALANCES.GST_TDS_RECEIVABLE_IGST, LEDGER_BALANCES.GST_TDS_RECEIVABLE_IGST, true],
    ]);
  });

  it('dates the lifecycle: on 31 Aug no certificate had been matched, TDS was inside its quarter and July GST-TDS was overdue', async () => {
    const report = await reports.getTdsInward(input({ asOfDate: '2026-08-31' }));
    const status = (invoice: keyof typeof scenario.invoiceIds, type: string) => report.rows.find((r) => r.invoiceId === scenario.invoiceIds[invoice] && r.deductionType === type)!.lifecycle;
    expect(report.rows.every((r) => r.certificateMatched === '0.00')).toBe(true); // matched when the scenario was built, after 31 Aug
    expect([status('INV1', 'TDS'), status('INV1', 'CGST_TDS'), status('INV5', 'IGST_TDS'), status('INV7', 'IGST_TDS'), status('INV6', 'IGST_TDS')]).toEqual([
      'RECORDED', 'CERTIFICATE_PENDING', 'CERTIFICATE_PENDING', 'RECORDED', 'RECORDED',
    ]);
  });

  it('queues every exception: overdue, partial, unexplained credits — and ignores the cancelled certificate', async () => {
    const report = await reports.getTdsReconciliation(input());
    expect(report.summary).toEqual(TDS_RECONCILIATION_ALL_TIME.summary);
    expect(report.pendingCertificates).toHaveLength(TDS_RECONCILIATION_ALL_TIME.pendingCount);
    expect(report.partialMatches.map((r) => [r.invoiceId, r.deductionType])).toEqual(TDS_RECONCILIATION_ALL_TIME.partial.map((p) => [scenario.invoiceIds[p.invoice], p.type]));
    expect(report.unmatchedCredits.map((c) => ({ reference: c.referenceNumber, unmatchedAmount: c.unmatchedAmount }))).toEqual(TDS_RECONCILIATION_ALL_TIME.unmatchedCredits);
    expect(report.reversedReceiptMatches).toEqual([]);
    expect(report.totals).toEqual(TDS_RECONCILIATION_ALL_TIME.totals);
  });

  it('shows one client only its own certificates and deductions', async () => {
    const report = await reports.getTdsReconciliation(input({ clientId: scenario.clientIds.C2 }));
    expect(report.unmatchedCredits.map((c) => c.referenceNumber)).toEqual(['MAHA/16A/Q2/0007']);
    expect(new Set(report.pendingCertificates.map((r) => r.clientId))).toEqual(new Set([scenario.clientIds.C2]));
  });

  it('offers only same-client, same-type deductions with something left to match', async () => {
    const candidates = await certificates.listMatchCandidates({ organizationId: scenario.organizationId, certificateId: scenario.tdsCertificateIds.MAHA_16A_Q2 });
    // INV5's TDS is fully matched to certificates; INV6 and INV9 (R7, 31 Aug) remain, both inside Q2.
    expect(candidates.map((c) => [c.invoiceId, c.remaining, c.inPeriod])).toEqual([
      [scenario.invoiceIds.INV6, '8000.00', true],
      [scenario.invoiceIds.INV9, '277.78', true],
    ]);
  });

  it('refuses a match beyond the certificate, beyond the deduction, to another client or another type', async () => {
    const maha = scenario.tdsCertificateIds.MAHA_16A_Q2; // 3,000 unmatched
    await expect(certificates.match({ ...ctx(), certificateId: maha, matches: [{ deductionId: await deductionOf('INV6', 'TDS'), amount: '3000.01' }] })).rejects.toThrow(/only 3000.00 of this certificate is unmatched/);
    await expect(certificates.match({ ...ctx(), certificateId: maha, matches: [{ deductionId: await deductionOf('INV9', 'TDS'), amount: '277.79' }] })).rejects.toThrow(/Only 277.78 of this deduction/);
    await expect(certificates.match({ ...ctx(), certificateId: maha, matches: [{ deductionId: await deductionOf('INV7', 'TDS'), amount: '100' }] })).rejects.toThrow(/different client/);
    await expect(certificates.match({ ...ctx(), certificateId: maha, matches: [{ deductionId: await deductionOf('INV6', 'IGST_TDS'), amount: '100' }] })).rejects.toThrow(/can only match TDS deductions/);
    await expect(certificates.cancel({ ...ctx(), id: maha, reason: 'test', expectedVersion: 1 })).rejects.toThrow(/Unmatch this certificate/);
  });

  it('matches, unmatches with a reason, and audits both', async () => {
    const rscl = scenario.tdsCertificateIds.RSCL_7A_AUG; // 1,500 unmatched; INV7 IGST-TDS has 1,500 left
    const matched = await certificates.match({ ...ctx(), certificateId: rscl, matches: [{ deductionId: await deductionOf('INV7', 'IGST_TDS'), amount: '1500' }] });
    expect([matched.matchedAmount, matched.unmatchedAmount]).toEqual(['4000.00', '0.00']);
    const afterMatch = await reports.getTdsInward(input());
    expect(afterMatch.rows.find((r) => r.invoiceId === scenario.invoiceIds.INV7 && r.deductionType === 'IGST_TDS')).toMatchObject({ lifecycle: 'CERTIFICATE_RECEIVED', partiallyMatched: false });

    const latest = matched.matches.find((m) => m.amount === '1500.00' && !m.unmatchedAt)!;
    const undone = await certificates.unmatch({ ...ctx(), matchId: latest.id, reason: 'Matched to the wrong deduction' });
    expect(undone.unmatchedAmount).toBe('1500.00');
    expect(undone.matches.find((m) => m.id === latest.id)!.unmatchReason).toBe('Matched to the wrong deduction');
    const audit = await prisma.client.auditEvent.findMany({ where: { organizationId: scenario.organizationId, entityId: rscl }, select: { action: true } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['TDS_CERTIFICATE_RECORDED', 'TDS_CERTIFICATE_MATCHED', 'TDS_CERTIFICATE_UNMATCHED']));
  });

  it('previews a CSV row by row and imports nothing while any row is bad', async () => {
    const row = (overrides: Record<string, string>) => ({
      source: '26AS', deductionType: 'TDS', client: 'Rajasthan Smart City Ltd', deductorTan: 'JPRR01234A', deductorGstin: '', referenceNumber: '26AS-RSCL-0828',
      periodStart: '01/08/2026', periodEnd: '31/08/2026', creditDate: '28/08/2026', amount: '4,000', remarks: '', ...overrides,
    });
    const rows = [row({}), row({ referenceNumber: '26AS-GIL-202607', client: 'Gujarat Informatics Ltd' }), row({ referenceNumber: 'X', client: 'Nobody Ltd', amount: '0' })];
    const preview = await certificates.previewImport({ organizationId: scenario.organizationId, legalEntityId: scenario.legalEntityId, rows });
    expect(preview.rows.map((r) => [r.rowNumber, r.errors])).toEqual([
      [1, []],
      [2, ['This reference is already recorded.']],
      [3, ['Amount must be a positive number with at most 2 decimals.', 'No client matches "Nobody Ltd".']],
    ]);
    await expect(certificates.importRows({ ...ctx(), legalEntityId: scenario.legalEntityId, rows })).rejects.toThrow(/2 row\(s\) have errors/);
    expect(await prisma.client.tdsCertificate.count({ where: { organizationId: scenario.organizationId, referenceNumber: '26AS-RSCL-0828' } })).toBe(0);

    expect(await certificates.importRows({ ...ctx(), legalEntityId: scenario.legalEntityId, rows: [row({})] })).toEqual({ created: 1 });
    const imported = (await certificates.list({ organizationId: scenario.organizationId, status: undefined, partyId: scenario.clientIds.C3, source: 'STATEMENT' }))[0]!;
    expect([imported.referenceNumber, imported.deductionType, imported.periodStart, imported.amount, imported.deductorTan]).toEqual(['26AS-RSCL-0828', 'TDS', '2026-08-01', '4000.00', 'JPRR01234A']);
  });

  it('exports both TDS reports', async () => {
    for (const key of ['tds-inward', 'tds-reconciliation'] as const) {
      const pdf = await reports.exportReport({ ...input(), key, format: 'PDF', correlationId: generateId(), ipAddress: undefined, userAgent: undefined });
      expect(Buffer.from(pdf.base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
      const xlsx = await reports.exportReport({ ...input(), key, format: 'XLSX', correlationId: generateId(), ipAddress: undefined, userAgent: undefined });
      expect(xlsx.base64.length).toBeGreaterThan(0);
    }
  });
});

describe('Money-flow scenario — TDS deposits and TDS Outward (Phase 8.5b, ADR-113)', () => {
  const reports = createReports();
  const deposits = services.tdsDeposits;
  const input = (filters: Partial<ReportFilters> = {}, canSeeAllProjects = true): ReportReadInput => ({
    organizationId: scenario.organizationId,
    actorId: makerId,
    canSeeAllProjects,
    filters: { legalEntityId: undefined, dateFrom: undefined, asOfDate: PL_ALL_TIME_TO, clientId: undefined, projectId: undefined, ...filters },
  });
  const ctx = () => ({ organizationId: scenario.organizationId, actorId: makerId, correlationId: generateId(), idempotencyKey: generateId() });
  const salaryLine = async (key: 'E2' | 'E3') => (await prisma.client.salaryPaymentLine.findFirstOrThrow({ where: { organizationId: scenario.organizationId, employeeId: scenario.employeeIds[key] } })).id;
  const bankAccountId = async () => (await prisma.client.bankAccount.findFirstOrThrow({ where: { organizationId: scenario.organizationId } })).id;

  it('lists every amount withheld with what the challans deposited, to the paisa', async () => {
    const report = await reports.getTdsOutward(input());
    expect(report.rows.map(({ deductionDate, deducteeName, sourceKind, amount, deposited, remaining, challanNumbers, dueDate, overdue }) => ({ deductionDate, deducteeName, sourceKind, amount, deposited, remaining, challanNumbers, dueDate, overdue }))).toEqual(TDS_OUTWARD_ALL_TIME.rows);
    const tds = report.summary.find((s) => s.deductionType === 'TDS')!;
    expect({ count: tds.count, deducted: tds.deducted, deposited: tds.deposited, payable: tds.payable, overdueCount: tds.overdueCount, overdueAmount: tds.overdueAmount }).toEqual(TDS_OUTWARD_ALL_TIME.tds);
  });

  it('reconciles what is still payable to the TDS and GST-TDS payable accounts', async () => {
    const { reconciliation } = await reports.getTdsOutward(input());
    expect(reconciliation.lines.map((l) => [l.key, l.reportAmount, l.ledgerAmount, l.reconciled])).toEqual([
      ['TDS', '8000.00', '8000.00', true],
      ['CGST_TDS', '0.00', '0.00', true],
      ['SGST_TDS', '0.00', '0.00', true],
      ['IGST_TDS', '0.00', '0.00', true],
    ]);
    expect(LEDGER_BALANCES.TDS_PAYABLE).toBe('-8000.00');
  });

  it('dates deposits and their reversal: on 5 Sep the reversed challan still counted', async () => {
    const report = await reports.getTdsOutward(input({ asOfDate: '2026-09-05' }));
    const tds = report.summary.find((s) => s.deductionType === 'TDS')!;
    expect({ deposited: tds.deposited, payable: tds.payable, overdueCount: tds.overdueCount, raviRemaining: report.rows.find((r) => r.deducteeName === 'Ravi Shah')!.remaining }).toEqual(TDS_OUTWARD_ALL_TIME.sept5);
    expect(report.reconciliation.allReconciled).toBe(true);
  });

  it('offers only what is still to be deposited, and refuses more than that', async () => {
    const legalEntityId = scenario.legalEntityId;
    const outstanding = await deposits.listOutstanding({ organizationId: scenario.organizationId, legalEntityId, deductionType: 'TDS' });
    expect(outstanding.map((o) => [o.deducteeName, o.remaining])).toEqual([['Neha Desai', '3000.00'], ['Ravi Shah', '5000.00']]);
    const common = { legalEntityId, bankAccountId: await bankAccountId(), deductionType: 'TDS' as const, depositDate: '2026-09-10', remarks: undefined };
    await expect(deposits.post({ ...ctx(), ...common, challanNumber: 'CIN-TEST-A', allocations: [{ sourceKind: 'SALARY_PAYMENT_LINE', sourceId: await salaryLine('E3'), amount: '3000.01' }] })).rejects.toThrow(/Only 3000.00 of Salary payment/);
    await expect(deposits.post({ ...ctx(), ...common, challanNumber: 'CIN-0002', allocations: [{ sourceKind: 'SALARY_PAYMENT_LINE', sourceId: await salaryLine('E3'), amount: '100' }] })).rejects.toThrow(/already recorded/);
    await expect(deposits.post({ ...ctx(), ...common, deductionType: 'IGST_TDS', challanNumber: 'GST-TEST', allocations: [{ sourceKind: 'SALARY_PAYMENT_LINE', sourceId: await salaryLine('E3'), amount: '100' }] })).rejects.toThrow(/not found for this legal entity/);
  });

  it('posts a deposit as Dr TDS Payable / Cr Bank, idempotently, and a reversal restores the payable', async () => {
    const key = generateId();
    const request = {
      ...ctx(), idempotencyKey: key, legalEntityId: scenario.legalEntityId, bankAccountId: await bankAccountId(), deductionType: 'TDS' as const,
      challanNumber: 'CIN-TEST-B', depositDate: '2026-09-10', remarks: undefined, allocations: [{ sourceKind: 'SALARY_PAYMENT_LINE' as const, sourceId: await salaryLine('E3'), amount: '3000' }],
    };
    const posted = await deposits.post(request);
    expect(await deposits.post({ ...request, correlationId: generateId() })).toMatchObject({ id: posted.id });
    const lines = await prisma.client.journalLine.findMany({ where: { journalEntryId: posted.journalEntryId }, select: { debitAmount: true, creditAmount: true, ledgerAccount: { select: { code: true } } } });
    expect(lines.map((l) => [l.ledgerAccount.code, l.debitAmount.toFixed(2), l.creditAmount.toFixed(2)]).sort()).toEqual([['BANK_HDFC_CURRENT', '0.00', '3000.00'], ['TDS_PAYABLE', '3000.00', '0.00']]);
    expect((await reports.getTdsOutward(input())).summary.find((s) => s.deductionType === 'TDS')!.payable).toBe('5000.00');

    const reversed = await deposits.reverse({ ...ctx(), id: posted.id, reason: 'Test deposit undone', accountingDate: '2026-09-10', expectedVersion: posted.version });
    expect(reversed.status).toBe('REVERSED');
    const after = await reports.getTdsOutward(input());
    expect([after.summary.find((s) => s.deductionType === 'TDS')!.payable, after.reconciliation.allReconciled]).toEqual(['8000.00', true]);
    const audit = await prisma.client.auditEvent.findMany({ where: { entityId: posted.id }, select: { action: true } });
    expect(audit.map((a) => a.action).sort()).toEqual(['TDS_DEPOSIT_POSTED', 'TDS_DEPOSIT_REVERSED']);
  });

  it('exports TDS Outward', async () => {
    const pdf = await reports.exportReport({ ...input(), key: 'tds-outward', format: 'PDF', correlationId: generateId(), ipAddress: undefined, userAgent: undefined });
    expect(Buffer.from(pdf.base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('Money-flow scenario — bank statement import and reconciliation matching (Phase 8.6a, ADR-114)', () => {
  const bank = services.bankReconciliation;
  const { from, to } = BANK_RECONCILIATION_JUN_AUG;
  const ctx = (actorId = makerId) => ({ organizationId: scenario.organizationId, actorId, correlationId: generateId() });
  let bankAccountId: string;
  const workspace = () => bank.getWorkspace({ organizationId: scenario.organizationId, bankAccountId, from, to });
  const statementLine = async (date: string, amount: string) => (await workspace()).statementLines.find((l) => l.transactionDate === date && l.amount === amount)!;
  const bookLine = async (date: string, amount: string) =>
    (await bank.getWorkspace({ organizationId: scenario.organizationId, bankAccountId, from, to: '2026-09-30' })).bookLines.find((l) => l.accountingDate === date && l.amount === amount)!;
  const csv = () => ({ organizationId: scenario.organizationId, bankAccountId, ...HDFC_STATEMENT_CSV });

  beforeAll(async () => {
    bankAccountId = (await prisma.client.bankAccount.findFirstOrThrow({ where: { organizationId: scenario.organizationId } })).id;
  });

  it('needs the columns mapped first, and a mapping whose columns the file has', async () => {
    await expect(bank.previewImport(csv())).rejects.toThrow(/Map this bank account/);
    const mapping = {
      dateColumn: 'Txn Date', dateFormat: 'DD_MM_YYYY_SLASH' as const, descriptionColumn: 'Narration', referenceColumn: 'Chq/Ref No', amountMode: 'DEBIT_CREDIT_COLUMNS' as const,
      debitColumn: 'Withdrawal Amt', creditColumn: 'Deposit Amt', amountColumn: undefined, indicatorColumn: undefined, creditIndicator: undefined, balanceColumn: 'Balance',
    };
    const saved = await bank.saveProfile({ ...ctx(), bankAccountId, expectedVersion: undefined, ...mapping });
    await expect(bank.previewImport(csv())).rejects.toThrow(/no "Balance" column/);
    await bank.saveProfile({ ...ctx(), bankAccountId, expectedVersion: saved.version, ...mapping, balanceColumn: undefined });
  });

  it('previews every row — ready, skipped or in error — and imports nothing while a row is bad', async () => {
    const preview = await bank.previewImport(csv());
    const { rows, ...totals } = preview;
    expect(rows).toHaveLength(HDFC_STATEMENT_CSV.rows.length);
    expect(totals).toEqual(BANK_RECONCILIATION_JUN_AUG.preview);
    expect(preview.rows.filter((r) => r.outcome === 'SKIPPED').map((r) => r.rowNumber)).toEqual([15, 25]);

    const bad = { ...csv(), rows: [...HDFC_STATEMENT_CSV.rows, ['31/09/2026', 'BAD DATE', '', '100.00', '']] };
    const badPreview = await bank.previewImport(bad);
    expect(badPreview.rows.at(-1)).toMatchObject({ outcome: 'ERROR', errors: ['"31/09/2026" is not a date in the mapped format.'] });
    await expect(bank.importStatement({ ...bad, actorId: makerId, correlationId: generateId() })).rejects.toThrow(/1 row\(s\) cannot be read/);
  });

  it('imports the statement once — the same file again is all duplicates', async () => {
    expect(await bank.importStatement({ ...csv(), actorId: makerId, correlationId: generateId() })).toMatchObject({ created: 23, duplicates: 0, skipped: 2 });
    const again = await bank.previewImport(csv());
    expect([again.readyCount, again.duplicateCount]).toEqual([0, 23]);
    await expect(bank.importStatement({ ...csv(), actorId: makerId, correlationId: generateId() })).rejects.toThrow(/already imported/);
  });

  it('auto-matches only unique same-amount pairs within five days, leaving the ambiguous and the unrecorded', async () => {
    expect(await bank.autoMatch({ ...ctx(), bankAccountId, from, to })).toEqual({ matchCount: BANK_RECONCILIATION_JUN_AUG.autoMatched });
    const w = await workspace();
    expect(w.summary).toEqual(BANK_RECONCILIATION_JUN_AUG.afterAutoMatch);
    expect(w.statementLines.filter((l) => l.status !== 'MATCHED').map((l) => [l.transactionDate, l.amount])).toEqual([['2026-07-12', '-11800.00'], ['2026-07-15', '-11800.00'], ['2026-08-31', '-590.00']]);
    // Running it again finds nothing new.
    expect(await bank.autoMatch({ ...ctx(), bankAccountId, from, to })).toEqual({ matchCount: 0 });
  });

  it('matches chosen lines by hand only when their totals agree and their directions do', async () => {
    const stmt12 = await statementLine('2026-07-12', '-11800.00');
    const stmt15 = await statementLine('2026-07-15', '-11800.00');
    const bookDe1 = await bookLine('2026-07-12', '-11800.00');
    const bookCl1 = await bookLine('2026-07-15', '-11800.00');
    await expect(bank.matchSelected({ ...ctx(), bankAccountId, statementLineIds: [stmt12.id, stmt15.id], journalLineIds: [bookDe1.journalLineId] })).rejects.toThrow(/total -23600.00 but the book entries total -11800.00/);
    const challanReversal = await bookLine('2026-09-06', '5000.00'); // money in, still unmatched
    await expect(bank.matchSelected({ ...ctx(), bankAccountId, statementLineIds: [stmt12.id], journalLineIds: [challanReversal.journalLineId] })).rejects.toThrow(/Money in and money out/);

    expect(await bank.matchSelected({ ...ctx(), bankAccountId, statementLineIds: [stmt12.id], journalLineIds: [bookDe1.journalLineId] })).toEqual({ matchCount: 1 });
    expect(await bank.matchSelected({ ...ctx(), bankAccountId, statementLineIds: [stmt15.id], journalLineIds: [bookCl1.journalLineId] })).toEqual({ matchCount: 1 });
    expect((await workspace()).summary).toMatchObject({ unmatchedStatementCount: 1, unmatchedStatementAmount: '-590.00', unmatchedBookCount: 0, unmatchedBookAmount: '0.00' });
  });

  it('explains the bank charge as an exception approved by someone else', async () => {
    const charge = await statementLine('2026-08-31', '-590.00');
    await expect(bank.matchSelected({ ...ctx(), bankAccountId, statementLineIds: [charge.id], journalLineIds: [(await bookLine('2026-09-05', '-5000.00')).journalLineId] })).rejects.toThrow(/totals? -590.00 but the book entries total -5000.00/);
    const marked = await bank.markException({ ...ctx(), statementLineId: charge.id, reason: 'SMS and account charges — to be booked in September' });
    expect(marked.exception).toBe('PENDING_APPROVAL');
    expect((await workspace()).summary.pendingExceptionCount).toBe(1);
    await expect(bank.approveException({ ...ctx(), statementLineId: charge.id })).rejects.toThrow(/cannot approve it/);
    expect((await bank.approveException({ ...ctx(checkerId), statementLineId: charge.id })).exception).toBe('APPROVED');
    await expect(bank.clearException({ ...ctx(), statementLineId: charge.id, reason: 'mistake', canApprove: false })).rejects.toThrow(/bank_reconciliation.approve/);
    expect((await workspace()).summary).toMatchObject({ unmatchedStatementCount: 0, pendingExceptionCount: 0 });
  });

  it('unmatches with a reason, carries the line forward, and lets auto-match find it again', async () => {
    const r1 = await statementLine('2026-07-10', '631500.00');
    expect(await bank.unmatchStatementLine({ ...ctx(), statementLineId: r1.id, reason: 'Checking the UTR' })).toEqual({ unmatchedCount: 1 });
    // Still listed as open when viewing August only: open older lines carry forward.
    const august = await bank.getWorkspace({ organizationId: scenario.organizationId, bankAccountId, from: '2026-08-01', to });
    expect(august.statementLines.some((l) => l.id === r1.id && l.status === 'UNMATCHED')).toBe(true);
    expect(await bank.autoMatch({ ...ctx(), bankAccountId, from, to })).toEqual({ matchCount: 1 });
    const audit = await prisma.client.auditEvent.findMany({ where: { organizationId: scenario.organizationId, action: { startsWith: 'BANK_STATEMENT_' } }, select: { action: true } });
    expect([...new Set(audit.map((a) => a.action))]).toEqual(
      expect.arrayContaining(['BANK_STATEMENT_PROFILE_CREATED', 'BANK_STATEMENT_IMPORTED', 'BANK_STATEMENT_AUTO_MATCHED', 'BANK_STATEMENT_MATCHED', 'BANK_STATEMENT_EXCEPTION_MARKED', 'BANK_STATEMENT_EXCEPTION_APPROVED', 'BANK_STATEMENT_UNMATCHED']),
    );
  });
});

describe('Money-flow scenario — bank reconciliation periods and Cash Flow (Phase 8.6b, ADR-115)', () => {
  const bank = services.bankReconciliation;
  const reports = createReports();
  const org = () => scenario.organizationId;
  const ctx = (actorId = makerId) => ({ organizationId: org(), actorId, correlationId: generateId() });
  let bankAccountId: string;
  const statement = (month: string, closing?: string, opening?: string) => bank.getStatement({ organizationId: org(), bankAccountId, month, statementOpeningBalance: opening, statementClosingBalance: closing });
  const figures = (s: { statementClosingBalance: string | null; bookClosingBalance: string; unclearedBookAmount: string; bankOnlyAmount: string; adjustedBookBalance: string | null }) => ({
    statementClosingBalance: s.statementClosingBalance, bookClosingBalance: s.bookClosingBalance, unclearedBookAmount: s.unclearedBookAmount, bankOnlyAmount: s.bankOnlyAmount, adjustedBookBalance: s.adjustedBookBalance,
  });
  const statusOf = async (month: string) => (await bank.listPeriods({ organizationId: org(), bankAccountId })).find((p) => p.month === month)?.status;

  beforeAll(async () => {
    bankAccountId = (await prisma.client.bankAccount.findFirstOrThrow({ where: { organizationId: org() } })).id;
  });

  it('asks for the opening and closing balances before the first month can be reconciled', async () => {
    const june = await statement('2026-06');
    expect([june.status, june.isFirstPeriod, june.unexplainedDifference]).toEqual(['IN_PROGRESS', true, null]);
    expect(june.blockers).toEqual([
      "Enter the bank's opening balance for June 2026 — this is the account's first reconciled month.",
      "Enter the bank's closing balance from the statement.",
    ]);
    const previewed = await statement('2026-06', '-113250.00', '0');
    expect(figures(previewed)).toEqual(BANK_RECONCILIATION_STATEMENTS.june);
    expect([previewed.unexplainedDifference, previewed.blockers]).toEqual(['0.00', []]);
  });

  it('reconciles month by month, and refuses a month whose figures do not agree', async () => {
    const june = await bank.markReconciled({ ...ctx(), bankAccountId, month: '2026-06', statementOpeningBalance: '0', statementClosingBalance: '-113250.00' });
    expect([june.status, june.preparedBy]).toEqual(['RECONCILED', makerId]);
    await expect(bank.markReconciled({ ...ctx(), bankAccountId, month: '2026-08', statementOpeningBalance: undefined, statementClosingBalance: '1415537.77' })).rejects.toThrow(/Reconcile July 2026 first/);
    expect(figures(await bank.markReconciled({ ...ctx(), bankAccountId, month: '2026-07', statementOpeningBalance: undefined, statementClosingBalance: '1072850.00' }))).toEqual(BANK_RECONCILIATION_STATEMENTS.july);

    await expect(bank.markReconciled({ ...ctx(), bankAccountId, month: '2026-08', statementOpeningBalance: undefined, statementClosingBalance: '1416127.77' })).rejects.toThrow(/Unexplained difference of 590.00/);
    const august = await statement('2026-08', '1415537.77');
    expect({ ...figures(august), exceptionAmount: august.exceptionAmount, statementLinesTotal: august.statementLinesTotal, statementOpeningBalance: august.statementOpeningBalance }).toEqual({ ...BANK_RECONCILIATION_STATEMENTS.august, statementOpeningBalance: '1072850.00' });
    expect((await bank.markReconciled({ ...ctx(), bankAccountId, month: '2026-08', statementOpeningBalance: undefined, statementClosingBalance: '1415537.77' })).status).toBe('RECONCILED');
  });

  it('carries uncleared book entries into the next month: September reconciles with the challans still uncleared', async () => {
    const september = await bank.markReconciled({ ...ctx(), bankAccountId, month: '2026-09', statementOpeningBalance: undefined, statementClosingBalance: '1415537.77' });
    expect({ ...figures(september), unclearedBookCount: september.unclearedBookCount }).toEqual(BANK_RECONCILIATION_STATEMENTS.september);
  });

  it('locks only after reconciling, in month order, and never by the person who reconciled', async () => {
    const june = await statement('2026-06');
    await expect(bank.lockPeriod({ ...ctx(), bankAccountId, month: '2026-06', expectedVersion: june.version! })).rejects.toThrow(/cannot lock it/);
    const july = await statement('2026-07');
    await expect(bank.lockPeriod({ ...ctx(checkerId), bankAccountId, month: '2026-07', expectedVersion: july.version! })).rejects.toThrow(/Lock June 2026 first/);
    const locked = await bank.lockPeriod({ ...ctx(checkerId), bankAccountId, month: '2026-06', expectedVersion: june.version! });
    expect([locked.status, locked.lockedBy]).toEqual(['LOCKED', checkerId]);
    await expect(bank.markReconciled({ ...ctx(), bankAccountId, month: '2026-06', statementOpeningBalance: '0', statementClosingBalance: '-113250.00' })).rejects.toThrow(/already locked/);
  });

  it('freezes a locked month: its statement lines cannot be unmatched and a file cannot add to it', async () => {
    const juneLine = (await bank.getWorkspace({ organizationId: org(), bankAccountId, from: '2026-06-01', to: '2026-06-30' })).statementLines.find((l) => l.transactionDate === '2026-06-05')!;
    await expect(bank.unmatchStatementLine({ ...ctx(), statementLineId: juneLine.id, reason: 'Trying a locked month' })).rejects.toThrow(/June 2026 is locked/);
    const preview = await bank.previewImport({ organizationId: org(), bankAccountId, fileName: 'late.csv', headers: HDFC_STATEMENT_CSV.headers, rows: [['30/06/2026', 'LATE CHARGE', '', '10.00', '']] });
    expect(preview.rows[0]).toMatchObject({ outcome: 'ERROR', errors: ['June 2026 is locked for this bank account.'] });
  });

  it('returns a reconciled month, and every later one, to in progress when a statement line in it changes', async () => {
    const r1 = (await bank.getWorkspace({ organizationId: org(), bankAccountId, from: '2026-07-01', to: '2026-07-31' })).statementLines.find((l) => l.transactionDate === '2026-07-10')!;
    await bank.unmatchStatementLine({ ...ctx(), statementLineId: r1.id, reason: 'Re-checking the RTGS' });
    expect([await statusOf('2026-06'), await statusOf('2026-07'), await statusOf('2026-08'), await statusOf('2026-09')]).toEqual(['LOCKED', 'IN_PROGRESS', 'IN_PROGRESS', 'IN_PROGRESS']);
    expect((await statement('2026-07', '1072850.00')).blockers).toEqual(['1 statement line(s) in the month are not matched or explained.']);

    await bank.autoMatch({ ...ctx(), bankAccountId, from: '2026-07-01', to: '2026-07-31' });
    for (const [month, closing] of [['2026-07', '1072850.00'], ['2026-08', '1415537.77'], ['2026-09', '1415537.77']] as const) {
      expect((await bank.markReconciled({ ...ctx(), bankAccountId, month, statementOpeningBalance: undefined, statementClosingBalance: closing })).status).toBe('RECONCILED');
    }
    const actions = (await prisma.client.auditEvent.findMany({ where: { organizationId: org(), entityType: 'BANK_RECONCILIATION_PERIOD' }, select: { action: true } })).map((a) => a.action);
    expect(new Set(actions)).toEqual(new Set(['BANK_RECONCILIATION_RECONCILED', 'BANK_RECONCILIATION_LOCKED', 'BANK_RECONCILIATION_REOPENED']));
  });

  it('reports cash flow by month — opening + in − out = closing — with statement matching, status and kind, reconciled to the ledger', async () => {
    const read = { organizationId: org(), actorId: makerId, canSeeAllProjects: true, filters: { legalEntityId: undefined, dateFrom: CASH_FLOW_JUN_SEP.dateFrom, asOfDate: CASH_FLOW_JUN_SEP.asOfDate, clientId: undefined, projectId: undefined } };
    const report = await reports.getCashFlow(read);
    expect(report.catalog.basis).toBe('BANK');
    expect(report.months.map(({ month, opening, inflow, outflow, closing, matchedInflow, matchedOutflow }) => ({ month, opening, inflow, outflow, closing, matchedInflow, matchedOutflow }))).toEqual(CASH_FLOW_JUN_SEP.months);
    expect(report.months.map((m) => m.reconciliationStatus)).toEqual(['LOCKED', 'RECONCILED', 'RECONCILED', 'RECONCILED']);
    expect(report.totals).toEqual(CASH_FLOW_JUN_SEP.totals);
    expect(report.byCategory.map((c) => [c.category, c.amount])).toEqual(CASH_FLOW_JUN_SEP.byCategory);
    expect(report.reconciliation.lines.map((l) => [l.reportAmount, l.ledgerAmount, l.reconciled])).toEqual([['1404127.77', '1404127.77', true]]);
    const pdf = await reports.exportReport({ ...read, key: 'cash-flow', format: 'PDF', correlationId: generateId(), ipAddress: undefined, userAgent: undefined });
    expect(pdf.filename).toBe('cash-flow-2026-06-01-to-2026-09-30.pdf');
  });
});

describe('Money-flow scenario — Payables Aging, Vendor Payments, Expenses, Reimbursements, Employee Advances (Phase 8.7, ADR-116)', () => {
  const reports = createReports();
  const input = (filters: Partial<ReportFilters> = {}, canSeeAllProjects = true): ReportReadInput => ({
    organizationId: scenario.organizationId,
    actorId: makerId,
    canSeeAllProjects,
    filters: { legalEntityId: undefined, dateFrom: undefined, asOfDate: PL_ALL_TIME_TO, clientId: undefined, projectId: undefined, ...filters },
  });
  const reconciledLines = (r: { reconciliation: { lines: Array<{ key: string; reportAmount: string; ledgerAmount: string; reconciled: boolean }> } }) => r.reconciliation.lines.map((l) => [l.key, l.reportAmount, l.ledgerAmount, l.reconciled]);

  it('ages what is owed to vendors from the document date, reconciled to Accounts Payable', async () => {
    const report = await reports.getPayablesAging(input({ asOfDate: REPORT_AS_OF }));
    expect(report.rows.map(({ number, documentType, vendorName, outstandingAmount, ageDays, bucket }) => ({ number, documentType, vendorName, outstandingAmount, ageDays, bucket }))).toEqual(PAYABLES_AGING.aug31.rows);
    expect([report.total, report.approvedForPaymentTotal]).toEqual([PAYABLES_AGING.aug31.total, PAYABLES_AGING.aug31.approvedForPaymentTotal]);
    expect(report.vendors.map((v) => [v.vendorName, v.outstanding])).toEqual(PAYABLES_AGING.aug31.vendors);
    expect(reconciledLines(report)).toEqual([['ACCOUNTS_PAYABLE', '110600.00', '110600.00', true]]);
    expect(LEDGER_BALANCES.ACCOUNTS_PAYABLE_VENDOR).toBe('-110600.00');
  });

  it('counts a payment only from its own date: on 1 Jun AN-1001 was unpaid and on an approved request', async () => {
    const report = await reports.getPayablesAging(input({ asOfDate: '2026-06-01' }));
    expect({ total: report.total, approvedForPaymentTotal: report.approvedForPaymentTotal, numbers: report.rows.map((r) => r.number) }).toEqual(PAYABLES_AGING.jun1);
    expect(report.reconciliation.allReconciled).toBe(true);
  });

  it('limits a filtered view to the project\'s bills and does not compare it with the ledger', async () => {
    const report = await reports.getPayablesAging(input({ asOfDate: REPORT_AS_OF, projectId: scenario.projectIds.P3 }));
    expect(report.rows.map((r) => [r.number, r.outstandingAmount])).toEqual([['PHT-77', '70800.00']]);
    expect(report.reconciliation.applicable).toBe(false);
  });

  it('lists vendor payments with cash, tax withheld and bills settled, reconciled to the payment postings', async () => {
    const report = await reports.getVendorPayments(input({ dateFrom: VENDOR_PAYMENTS_JUNE.dateFrom, asOfDate: VENDOR_PAYMENTS_JUNE.asOfDate }));
    expect(report.totals).toEqual(VENDOR_PAYMENTS_JUNE.totals);
    expect(report.rows.map((r) => [r.entryType, r.utrReference, r.allocations.map((a) => a.vendorBillNumber)])).toEqual([['PAYMENT', 'AN-PAY-0605', ['AN-1001']]]);
    expect(reconciledLines(report)).toEqual([
      ['PAYABLE_SETTLED', '106200.00', '106200.00', true],
      ['BANK_PAID', '104400.00', '104400.00', true],
      ['TAX_WITHHELD', '1800.00', '1800.00', true],
    ]);
    expect((await reports.getVendorPayments(input({ dateFrom: '2026-07-01', asOfDate: '2026-07-31' }))).rows).toEqual([]);
  });

  it('reports posted spend by category and project — gross, recoverable GST and recognized — reconciled to the expense accounts', async () => {
    const report = await reports.getExpenses(input());
    expect(report.totals).toEqual(EXPENSES_ALL_TIME.totals);
    expect(report.byCategory.map((c) => [c.category, c.recognizedAmount])).toEqual(EXPENSES_ALL_TIME.byCategory);
    expect(report.byProject.map((p) => [p.projectName, p.recognizedAmount])).toEqual(EXPENSES_ALL_TIME.byProject);
    expect(report.rows.some((r) => r.documentLabel.includes('stock') || r.documentLabel.includes('Courier'))).toBe(false);
    expect(reconciledLines(report)).toEqual([['EXPENSE', '162100.00', '162100.00', true]]);
    expect((await reports.getExpenses(input({ projectId: scenario.projectIds.P1 }))).totals.recognizedAmount).toBe(EXPENSES_ALL_TIME.p1Recognized);
  });

  it('shows each claim\'s status on the end date, with approved and reimbursed totals reconciled to the advance account', async () => {
    const report = await reports.getReimbursements(input({ dateFrom: REIMBURSEMENTS_JULY.dateFrom, asOfDate: REIMBURSEMENTS_JULY.asOfDate }));
    expect(report.totals).toEqual(REIMBURSEMENTS_JULY.totals);
    expect(report.rows.map((r) => [r.title, r.status, r.approvedOn, r.reimbursedOn])).toEqual(REIMBURSEMENTS_JULY.statuses);
    expect(reconciledLines(report)).toEqual([
      ['CLAIMS_APPROVED', '14250.00', '14250.00', true],
      ['CLAIMS_REIMBURSED', '11800.00', '11800.00', true],
    ]);
    const midJuly = await reports.getReimbursements(input({ dateFrom: '2026-07-01', asOfDate: '2026-07-10' }));
    expect(midJuly.rows.map((r) => [r.title, r.status])).toEqual([['Travel to Mumbai client site', 'APPROVED']]);
  });

  it('moves each employee\'s advance balance from opening to closing, reconciled to Employee Advance Receivable', async () => {
    const report = await reports.getEmployeeAdvances(input());
    expect(report.rows.map(({ employeeName, opening, advances, claimsAdjusted, reimbursements, other, closing }) => ({ employeeName, opening, advances, claimsAdjusted, reimbursements, other, closing }))).toEqual(EMPLOYEE_ADVANCES.allTime);
    expect(reconciledLines(report)).toEqual([['EMPLOYEE_ADVANCES', '-2450.00', '-2450.00', true]]);

    const org = scenario.organizationId;
    const neha = scenario.employeeIds.E3;
    await prisma.client.employee.update({ where: { id: neha }, data: { isReimbursable: true } });
    const bankAccountId = (await prisma.client.bankAccount.findFirstOrThrow({ where: { organizationId: org } })).id;
    const paymentModeId = (await prisma.client.paymentMode.findFirstOrThrow({ where: { code: 'BANK_TRANSFER' } })).id;
    await services.employeeExpenses.issueAdvance({
      organizationId: org, employeeId: neha, projectId: undefined, legalEntityId: scenario.legalEntityId, amount: '5000', advanceDate: '2026-10-05', paymentModeId, bankAccountId,
      utrReference: 'ADV-NEHA-1', purpose: 'Site visit float', note: undefined, idempotencyKey: generateId(), actorId: makerId, correlationId: generateId(),
    });
    const october = await reports.getEmployeeAdvances(input({ dateFrom: '2026-10-01', asOfDate: '2026-10-31', projectId: scenario.projectIds.P1 }, false));
    expect(october.rows.map(({ employeeName, opening, advances, claimsAdjusted, reimbursements, other, closing }) => ({ employeeName, opening, advances, claimsAdjusted, reimbursements, other, closing }))).toEqual(EMPLOYEE_ADVANCES.october.rows);
    expect([october.totals.closing, october.reconciliation.allReconciled]).toEqual([EMPLOYEE_ADVANCES.october.closing, true]);
  });

  it('exports every payables report', async () => {
    for (const key of ['payables-aging', 'vendor-payments', 'expenses', 'reimbursements', 'employee-advances'] as const) {
      const xlsx = await reports.exportReport({ ...input(), key, format: 'XLSX', correlationId: generateId(), ipAddress: undefined, userAgent: undefined });
      expect(xlsx.filename).toBe(`${key}-${PL_ALL_TIME_TO}.xlsx`);
    }
  });
});

describe('Money-flow scenario — Payment Holds, Penalties, Introducer Statement, EMD/SD Recovery (Phase 8.8a, ADR-117)', () => {
  const reports = createReports();
  const input = (filters: Partial<ReportFilters> = {}, canSeeAllProjects = true): ReportReadInput => ({
    organizationId: scenario.organizationId,
    actorId: makerId,
    canSeeAllProjects,
    filters: { legalEntityId: undefined, dateFrom: undefined, asOfDate: PL_ALL_TIME_TO, clientId: undefined, projectId: undefined, ...filters },
  });
  const reconciledLines = (r: { reconciliation: { lines: Array<{ key: string; reportAmount: string; ledgerAmount: string; reconciled: boolean }> } }) => r.reconciliation.lines.map((l) => [l.key, l.reportAmount, l.ledgerAmount, l.reconciled]);

  it('lists hold and retention with each release against its deduction, reconciled to the receivables', async () => {
    const report = await reports.getPaymentHolds(input({ asOfDate: REPORT_AS_OF }));
    expect(report.rows.map((r) => ({ type: r.type, amount: r.amount, releasedAmount: r.releasedAmount, outstandingAmount: r.outstandingAmount, status: r.status, lastReleasedOn: r.lastReleasedOn, releases: r.releases.map((x) => [x.releasedOn, x.amount]) }))).toEqual(PAYMENT_HOLDS.aug31);
    expect(report.rows.every((r) => r.invoiceId === scenario.invoiceIds.INV1)).toBe(true);
    expect(reconciledLines(report)).toEqual([['HOLD', '0.00', '0.00', true], ['RETENTION', '15000.00', '15000.00', true]]);

    const aug10 = await reports.getPaymentHolds(input({ asOfDate: '2026-08-10' }));
    expect(aug10.rows.map((r) => [r.type, r.releasedAmount, r.outstandingAmount, r.status])).toEqual(PAYMENT_HOLDS.aug10);
    expect(aug10.reconciliation.allReconciled).toBe(true);
    expect((await reports.getPaymentHolds(input({ asOfDate: '2026-07-09' }))).rows).toEqual([]);
  });

  it('lists accepted and disputed penalties with their treatment, reconciled to the receipt postings', async () => {
    const report = await reports.getPenalties(input());
    expect(report.rows.map((r) => [r.ledgerDate, r.status, r.amount, r.ledgerAccountName])).toEqual(PENALTIES.allTime);
    expect(report.rows.map((r) => r.invoiceId)).toEqual([scenario.invoiceIds.INV1, scenario.invoiceIds.INV2]);
    expect([report.totals, report.byCategory]).toEqual([PENALTIES.totals, PENALTIES.byCategory]);
    expect(reconciledLines(report)).toEqual([['ACCEPTED', '7500.00', '7500.00', true], ['DISPUTED', '3000.00', '3000.00', true]]);

    const july = await reports.getPenalties(input({ dateFrom: '2026-07-01', asOfDate: '2026-07-31' }));
    expect([july.totals.accepted, july.totals.disputed, july.reconciliation.allReconciled]).toEqual(['7500.00', '0.00', true]);
    expect((await reports.getPenalties(input({ projectId: scenario.projectIds.P3 }))).rows).toEqual([]);
  });

  it('states each introducer\'s commission by project — entitlement, accruals, payments and balance — reconciled to the payable', async () => {
    const report = await reports.getIntroducerStatement(input());
    expect(report.accounts).toHaveLength(1);
    const { lines, ...account } = report.accounts[0]!;
    expect(account).toMatchObject(INTRODUCER_STATEMENT.allTime.account);
    expect(lines.map((l) => [l.ledgerDate, l.entryType, l.accrued, l.paid, l.balance])).toEqual(INTRODUCER_STATEMENT.allTime.lines);
    expect(report.payments).toHaveLength(1);
    expect(report.payments[0]).toMatchObject(INTRODUCER_STATEMENT.allTime.payment);
    expect([report.advanceOutstanding, reconciledLines(report)]).toEqual(['0.00', [['INTRODUCER_PAYABLE', '5000.00', '5000.00', true], ['INTRODUCER_ADVANCE', '0.00', '0.00', true]]]);

    const august = await reports.getIntroducerStatement(input({ dateFrom: '2026-08-01', asOfDate: '2026-08-31' }));
    const a = august.accounts[0]!;
    expect({ opening: a.opening, accrued: a.accrued, paid: a.paid, closing: a.closing, lineCount: a.lines.length }).toEqual(INTRODUCER_STATEMENT.august);

    const p1 = await reports.getIntroducerStatement(input({ projectId: scenario.projectIds.P1 }));
    expect([p1.accounts[0]!.closing, p1.payments[0]!.allocatedAmount, p1.payments[0]!.tdsAmount, p1.advanceOutstanding, p1.reconciliation.applicable]).toEqual(['5000.00', '30000.00', null, null, false]);
    expect((await reports.getIntroducerStatement(input({ projectId: scenario.projectIds.P2 }))).accounts).toEqual([]);
  });

  it('tracks EMD and security deposits: cash apart from guarantees, returned, lodged and overdue, reconciled to the recoverable accounts', async () => {
    const org = scenario.organizationId;
    const db = prisma.client;
    const hdfc = await db.ledgerAccount.findFirstOrThrow({ where: { organizationId: org, code: 'BANK_HDFC_CURRENT' }, select: { id: true, accountGroupId: true } });
    const account = async (code: string, name: string) => (await db.ledgerAccount.create({ data: { id: generateId(), organizationId: org, accountGroupId: hdfc.accountGroupId, code, name, allowManualPosting: true, isActive: true } })).id;
    const purpose = async (code: string, name: string, category: 'EMD' | 'SD', ledgerAccountId: string) =>
      (await db.securityInstrumentPurpose.create({ data: { id: generateId(), organizationId: org, code, name, category, defaultRecoverableLedgerAccountId: ledgerAccountId } })).id;
    const type = async (code: string, name: string, requiresCashPosting: boolean) => (await db.securityInstrumentType.create({ data: { id: generateId(), organizationId: org, code, name, requiresCashPosting } })).id;
    const emdPurpose = await purpose('MF-EMD', 'Tender EMD', 'EMD', await account('EMD_RECOVERABLE', 'EMD Recoverable'));
    const sdPurpose = await purpose('MF-SD', 'Performance Security', 'SD', await account('SECURITY_DEPOSIT_RECOVERABLE', 'Security Deposit Recoverable'));
    const dd = await type('MF-DD', 'Demand Draft', true);
    const bg = await type('MF-BG', 'Bank Guarantee', false);

    const instruments = new SecurityInstrumentsService(prisma, new PostingService(prisma));
    const lodge = (projectKey: 'P3' | 'P4' | 'P5', purposeId: string, typeId: string, amount: string, submittedOn: string, returnDueOn: string, reference: string) =>
      instruments.lodge({
        organizationId: org, legalEntityId: scenario.legalEntityId, projectId: scenario.projectIds[projectKey], tenderId: undefined, purposeId, typeId, amount, instrumentReferenceNo: reference, issuingBank: 'HDFC Bank',
        lodgedWithAuthority: undefined, bankLedgerAccountId: typeId === bg ? undefined : hdfc.id, submittedOn, returnDueOn, narrative: undefined,
        fundedByLegalEntityId: undefined, fundedByPartyId: undefined, fundedByBankAccountDetails: undefined, fundedByTransferAmount: undefined, fundedByTransferMode: undefined, fundedByNote: undefined,
        idempotencyKey: generateId(), actorId: makerId, correlationId: generateId(),
      });
    const a = await lodge('P5', emdPurpose, dd, '50000', '2026-10-01', '2026-10-15', 'DD-A');
    const b = await lodge('P3', sdPurpose, dd, '80000', '2026-10-02', '2026-12-31', 'DD-B');
    const c = await lodge('P4', emdPurpose, bg, '100000', '2026-10-03', '2026-10-10', 'BG-C');
    await instruments.recordReturn({ organizationId: org, id: a.id, returnedAmount: '50000', returnedOn: '2026-10-20', returnedToLegalEntityId: undefined, returnedToPartyId: undefined, returnedToBankAccountDetails: undefined, idempotencyKey: generateId(), actorId: makerId, correlationId: generateId() });
    const label = new Map([[a.id, 'A'], [b.id, 'B'], [c.id, 'C']]);

    const oct31 = await reports.getEmdSdRecovery(input({ asOfDate: '2026-10-31' }));
    expect(oct31.rows.map((r) => [label.get(r.instrumentId), r.category, r.exposure, r.status, r.outstandingAmount, r.daysOverdue])).toEqual(EMD_SD.oct31.rows);
    expect([oct31.totals, oct31.byCategory]).toEqual([EMD_SD.oct31.totals, EMD_SD.oct31.byCategory]);
    expect(reconciledLines(oct31)).toEqual([['CASH_DEPOSITS', '80000.00', '80000.00', true]]);

    const oct17 = await reports.getEmdSdRecovery(input({ asOfDate: '2026-10-17' }));
    expect({ statuses: oct17.rows.map((r) => [label.get(r.instrumentId), r.status, r.daysOverdue]), cashOutstanding: oct17.totals.cashOutstanding, overdueCount: oct17.totals.overdueCount, overdueAmount: oct17.totals.overdueAmount }).toEqual(EMD_SD.oct17);
    expect(reconciledLines(oct17)).toEqual([['CASH_DEPOSITS', '130000.00', '130000.00', true]]);

    const p3 = await reports.getEmdSdRecovery(input({ asOfDate: '2026-10-31', projectId: scenario.projectIds.P3 }));
    expect([p3.rows.map((r) => label.get(r.instrumentId)), p3.reconciliation.applicable]).toEqual([['B'], false]);
  });

  it('exports every operations report', async () => {
    for (const key of ['emd-sd-recovery', 'introducer-statement', 'penalties', 'payment-holds'] as const) {
      const pdf = await reports.exportReport({ ...input(), key, format: 'PDF', correlationId: generateId(), ipAddress: undefined, userAgent: undefined });
      expect(Buffer.from(pdf.base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    }
  });
});

describe('Money-flow scenario — Pending Invoices, Client Payments, Manpower Utilization (Phase 8.8b, ADR-118)', () => {
  const reports = createReports();
  const input = (filters: Partial<ReportFilters> = {}, canSeeAllProjects = true): ReportReadInput => ({
    organizationId: scenario.organizationId,
    actorId: makerId,
    canSeeAllProjects,
    filters: { legalEntityId: undefined, dateFrom: undefined, asOfDate: PL_ALL_TIME_TO, clientId: undefined, projectId: undefined, ...filters },
  });
  const reconciledLines = (r: { reconciliation: { lines: Array<{ key: string; reportAmount: string; ledgerAmount: string; reconciled: boolean }> } }) => r.reconciliation.lines.map((l) => [l.key, l.reportAmount, l.ledgerAmount, l.reconciled]);

  it('lists finalized invoices still outstanding, with billing not yet invoiced kept apart', async () => {
    const report = await reports.getPendingInvoices(input({ asOfDate: REPORT_AS_OF }));
    expect(report.invoices.map((r) => [r.invoiceId, r.settlementState])).toEqual(PENDING_INVOICES_AUG_31.invoices.map(([key, state]) => [scenario.invoiceIds[key], state]));
    expect([report.invoiceTotal, report.overdueTotal]).toEqual([PENDING_INVOICES_AUG_31.invoiceTotal, PENDING_INVOICES_AUG_31.overdueTotal]);
    expect(report.billingPending.map(({ projectName, sourceType, sourceLabel, amount, dueDate, alertStatus }) => ({ projectName, sourceType, sourceLabel, amount, dueDate, alertStatus }))).toEqual(PENDING_INVOICES_AUG_31.billingPending);
    expect([report.billingPendingTotal, report.draftInvoiceCount]).toEqual([PENDING_INVOICES_AUG_31.billingPendingTotal, 0]);
    expect(reconciledLines(report)).toEqual([['INVOICE_OUTSTANDING', '453598.74', '453598.74', true]]);

    // A draft raised from the reopened alert is billing still pending — never outstanding.
    const org = scenario.organizationId;
    const alert = await prisma.client.paymentAlert.findFirstOrThrow({ where: { organizationId: org, status: 'OPEN', projectId: scenario.projectIds.P4, sourceEvent: { name: 'Installation' } } });
    const gst = await prisma.client.gstRegistration.findFirstOrThrow({ where: { organizationId: org } });
    const draft = await services.invoices.createDraftFromAlert({
      organizationId: org, paymentAlertId: alert.id, gstRegistrationId: gst.id, dueDate: '2026-10-15', paymentTermsDays: 30, narrative: undefined,
      lines: [{ description: 'Installation', hsnSac: '998314', quantity: '1', unitPrice: '600000', gstRatePercent: '9' }], actorId: makerId, correlationId: generateId(), idempotencyKey: generateId(),
    });
    const after = await reports.getPendingInvoices(input({ asOfDate: REPORT_AS_OF }));
    expect([after.draftInvoiceCount, after.billingPending.find((r) => r.alertId === alert.id)!.draftInvoiceId, after.invoiceTotal]).toEqual([1, draft.id, '453598.74']);
    const p4 = await reports.getPendingInvoices(input({ asOfDate: REPORT_AS_OF, projectId: scenario.projectIds.P4 }));
    expect([p4.invoices.map((r) => r.invoiceId), p4.billingPending.length, p4.reconciliation.applicable]).toEqual([[scenario.invoiceIds.INV7], 1, false]);
  });

  it('lists client receipts with cash, invoice settled and every deduction type apart, reconciled to bank and receivables', async () => {
    const { dateFrom, asOfDate } = CLIENT_PAYMENTS_JUN_AUG;
    const report = await reports.getClientPayments(input({ dateFrom, asOfDate }));
    expect(report.rows.map((r) => [r.ledgerDate, r.entryType, r.utrReference, r.actualAmount, r.invoiceSettled])).toEqual(CLIENT_PAYMENTS_JUN_AUG.rows);
    expect([report.totals, report.byClient]).toEqual([CLIENT_PAYMENTS_JUN_AUG.totals, CLIENT_PAYMENTS_JUN_AUG.byClient]);
    expect(reconciledLines(report)).toEqual([['CASH_RECEIVED', '1835333.32', '1835333.32', true], ['INVOICE_SETTLED', '1966858.02', '1966858.02', true]]);
    const july = await reports.getClientPayments(input({ dateFrom: '2026-07-01', asOfDate: '2026-07-31' }));
    expect([july.totals.actualAmount, july.reconciliation.allReconciled]).toEqual(['1231500.00', true]);
  });

  it('shows each employee\'s monthly allocation against capacity with the salary it attributes, reconciled to the salary postings', async () => {
    const report = await reports.getManpowerUtilization(input({ dateFrom: '2026-07-01', asOfDate: '2026-08-31' }));
    expect(report.rows.map((r) => [r.month, r.employeeName, r.state, r.projectPercentage, r.nonProjectPercentage, r.variancePercentage, r.grossSalary, r.projectCost, r.nonProjectCost])).toEqual(MANPOWER_UTILIZATION_JUL_AUG.rows);
    expect([report.byMonth, report.totals]).toEqual([MANPOWER_UTILIZATION_JUL_AUG.byMonth, MANPOWER_UTILIZATION_JUL_AUG.totals]);
    expect(report.totals.projectCost).toBe(MANPOWER.totalManpowerCostAmount);
    expect(reconciledLines(report)).toEqual([['GROSS_SALARY', '567111.10', '567111.10', true]]);

    const p3 = await reports.getManpowerUtilization(input({ dateFrom: '2026-07-01', asOfDate: '2026-08-31', projectId: scenario.projectIds.P3 }));
    expect(p3.rows.map((r) => [r.month, r.employeeName, r.projectPercentage, r.projectCost])).toEqual(MANPOWER_UTILIZATION_JUL_AUG.p3);
    expect([p3.rows[0]!.grossSalary, p3.reconciliation.applicable]).toEqual([null, false]);
  });

  it('exports every 8.8b report', async () => {
    for (const key of ['pending-invoices', 'client-payments', 'manpower-utilization'] as const) {
      const xlsx = await reports.exportReport({ ...input({ dateFrom: '2026-07-01', asOfDate: '2026-12-31' }), key, format: 'XLSX', correlationId: generateId(), ipAddress: undefined, userAgent: undefined });
      expect(xlsx.filename).toBe(`${key}-2026-07-01-to-2026-12-31.xlsx`);
    }
  });
});

describe('Money-flow scenario — main Dashboard (Phase 8.9a, ADR-119)', () => {
  const reports = createReports();
  const dashboard = new DashboardService(prisma, reports);
  const everyReportKey = ['report.receivables.read', 'report.profitability.read', 'report.gst.read', 'report.tds.read', 'report.cash.read', 'report.payables.read', 'report.operations.read'];
  const overview = (permissions = everyReportKey, canSeeAllProjects = true) =>
    dashboard.getOverview({ organizationId: scenario.organizationId, actorId: makerId, canSeeAllProjects, permissions, filters: { legalEntityId: undefined, dateFrom: DASHBOARD_JUN_AUG.dateFrom, asOfDate: DASHBOARD_JUN_AUG.asOfDate } });
  const read = (period: boolean): ReportReadInput => ({
    organizationId: scenario.organizationId, actorId: makerId, canSeeAllProjects: true,
    filters: { legalEntityId: undefined, dateFrom: period ? DASHBOARD_JUN_AUG.dateFrom : undefined, asOfDate: DASHBOARD_JUN_AUG.asOfDate, clientId: undefined, projectId: undefined },
  });

  it('shows hand-computed figures on its cards, each linking to its source report', async () => {
    const result = await overview();
    const byKey = new Map(result.cards.map((c) => [c.key, c]));
    expect(Object.fromEntries(Object.keys(DASHBOARD_JUN_AUG.cards).map((k) => [k, byKey.get(k as never)?.value]))).toEqual(DASHBOARD_JUN_AUG.cards);
    expect([byKey.get('INVOICE_OUTSTANDING')!.reportPath, byKey.get('BANK_BALANCE')!.reportPath, byKey.get('BANK_BALANCE')!.measure]).toEqual(['/reports/receivable-aging', '/reports/cash-flow', 'AS_OF']);
    expect(result.cashTrend).toEqual(DASHBOARD_JUN_AUG.cashTrend);
  });

  it('builds the financial summary from the same reports, its parts adding up (ADR-159)', async () => {
    const { finance } = await overview();
    const headline = new Map(finance.headline.map((f) => [f.key, f.value]));
    const { INCOME, CONTRIBUTION, INVOICE_OUTSTANDING } = DASHBOARD_JUN_AUG.cards;
    // Net profit is accrual: P&L contribution, so income less every posted cost.
    expect(headline.get('NET_PROFIT')).toBe(CONTRIBUTION);
    expect(headline.get('TOTAL_EXPENSE')).toBe(new Prisma.Decimal(INCOME).minus(CONTRIBUTION).toFixed(2));
    expect(headline.get('INVOICED_NOT_RECEIVED')).toBe(INVOICE_OUTSTANDING);
    const payments = await reports.getClientPayments(read(true));
    expect(headline.get('PAYMENT_RECEIVED')).toBe(payments.totals.actualAmount);

    const sumRows = (key: string) => finance.breakdowns.find((b) => b.key === key)!.rows.reduce((s, r) => s.plus(r.amount), new Prisma.Decimal(0)).toFixed(2);
    const byCategory = finance.breakdowns.find((b) => b.key === 'EXPENSE_BY_CATEGORY')!;
    expect([byCategory.total, sumRows('EXPENSE_BY_CATEGORY')]).toEqual([headline.get('TOTAL_EXPENSE'), headline.get('TOTAL_EXPENSE')]);
    const composition = finance.breakdowns.find((b) => b.key === 'RECEIVABLE_COMPOSITION')!;
    expect(composition.rows[0]).toMatchObject({ label: 'Invoice unpaid', amount: INVOICE_OUTSTANDING });
    expect(composition.total).toBe(sumRows('RECEIVABLE_COMPOSITION'));
    const byType = finance.breakdowns.find((b) => b.key === 'EXPENSE_BY_PROJECT_TYPE')!;
    const c2c = await reports.getCostToCompany(read(true));
    expect(byType.total).toBe(c2c.totals.total);
    expect(finance.recover.map((f) => f.key)).toEqual(['INVOICE_UNPAID', 'EMD_TO_RECOVER', 'SD_TO_RECOVER', 'HOLD_OUTSTANDING', 'PENALTY_DEDUCTED', 'TDS_INWARD']);
  });

  it('agrees card by card with the report it links to, for the same filters', async () => {
    const result = await overview();
    const [aging, pending, pl, cash, gst, outward, inward, payables, expenses, emd] = await Promise.all([
      reports.getReceivableAging(read(false)), reports.getPendingInvoices(read(false)), reports.getProjectPl(read(true)), reports.getCashFlow(read(true)), reports.getGstNet(read(true)),
      reports.getTdsOutward(read(false)), reports.getTdsInward(read(false)), reports.getPayablesAging(read(false)), reports.getExpenses(read(true)), reports.getEmdSdRecovery(read(false)),
    ]);
    const fromReports: Record<string, string> = {
      INVOICE_OUTSTANDING: aging.invoiceTotal, HOLD_RETENTION: aging.heldTotal, PAST_DUE: pending.overdueTotal, BILLING_PENDING: pending.billingPendingTotal,
      INCOME: pl.totals.income, CONTRIBUTION: pl.totals.contribution, BANK_BALANCE: cash.totals.closing, GST_NET: gst.totals.net,
      TDS_PAYABLE: outward.summary.find((s) => s.deductionType === 'TDS')!.payable, TDS_CERTIFICATES_PENDING: inward.summary.find((s) => s.deductionType === 'TDS')!.byLifecycle.CERTIFICATE_PENDING.amount,
      OWED_TO_VENDORS: payables.total, EXPENSES: expenses.totals.recognizedAmount, EMD_SD_CASH: emd.totals.cashOutstanding,
    };
    expect(Object.fromEntries(result.cards.map((c) => [c.key, c.value]))).toEqual(fromReports);

    // The charts are the same reports' own breakdowns.
    expect(result.receivableAging).toEqual(aging.invoiceBuckets);
    expect(result.payablesAging).toEqual(payables.buckets);
    const topIncome = pl.projects.filter((p) => p.projectId !== null && Number(p.income) > 0).map((p) => p.income);
    expect(result.topProjects!.map((p) => p.income)).toEqual([...topIncome].sort((a, b) => Number(b) - Number(a)).slice(0, 6));
  });

  it('lists what needs attention: past-due invoices, billing due, and no ledger differences', async () => {
    const result = await overview();
    expect(result.attention.map((a) => [a.kind, a.amount, a.date])).toEqual(DASHBOARD_JUN_AUG.attention);
  });

  it('shows only the cards whose report the viewer may read', async () => {
    const receivablesOnly = await overview(['report.receivables.read']);
    expect([receivablesOnly.cards.map((c) => c.key), receivablesOnly.cashTrend, receivablesOnly.attention]).toEqual([['INVOICE_OUTSTANDING', 'HOLD_RETENTION'], null, []]);
    expect([receivablesOnly.receivableAging === null, receivablesOnly.payablesAging, receivablesOnly.topProjects]).toEqual([false, null, null]);
    expect((await overview([])).cards).toEqual([]);
  });
});

describe('Money-flow scenario — Audit Activity and Exceptions (Phase 8.9b, ADR-120)', () => {
  const reports = createReports();
  const input = (filters: Partial<ReportFilters> = {}): ReportReadInput => ({
    organizationId: scenario.organizationId,
    actorId: makerId,
    canSeeAllProjects: true,
    filters: { legalEntityId: undefined, dateFrom: undefined, asOfDate: PL_ALL_TIME_TO, clientId: undefined, projectId: undefined, ...filters },
  });

  it('groups the audit trail by control, calls out repeated sign-in failures and lists sensitive events', async () => {
    const org = scenario.organizationId;
    const user = await prisma.client.user.findFirstOrThrow({ where: { organizationId: org } });
    for (let i = 0; i < 3; i++) {
      await prisma.client.$transaction((tx) => recordAuditEvent(tx, { organizationId: org, entityType: 'USER', entityId: user.id, action: 'USER_LOGIN_FAILED', correlationId: generateId() }));
    }

    const report = await reports.getAuditActivity(input());
    const total = await prisma.client.auditEvent.count({ where: { organizationId: org } });
    const exports = await prisma.client.auditEvent.count({ where: { organizationId: org, action: 'REPORT_EXPORTED' } });
    const group = (g: string) => report.byGroup.find((x) => x.group === g)!.count;
    expect([report.totals.events, group('SIGN_IN'), group('EXPORT')]).toEqual([total, 3, exports]);
    expect(report.totals.sensitive).toBe(report.byGroup.filter((g) => g.group !== 'ROUTINE').reduce((n, g) => n + g.count, 0));
    expect(report.repeatedSignInFailures.map((f) => [f.email, f.failures])).toEqual([[user.email, 3]]);
    const actions = new Set(report.sensitiveEvents.map((e) => e.action));
    for (const action of ['RECEIPT_REVERSED', 'INVOICE_VOIDED', 'BANK_RECONCILIATION_LOCKED', 'BANK_STATEMENT_UNMATCHED', 'TDS_DEPOSIT_REVERSED']) expect(actions.has(action), action).toBe(true);
    expect(report.sensitiveEvents.some((e) => e.action === 'RECEIPT_POSTED')).toBe(false);
    expect(report.reconciliation.applicable).toBe(false);

    const future = await reports.getAuditActivity(input({ dateFrom: '2099-01-01' }));
    expect([future.totals.events, future.repeatedSignInFailures]).toEqual([0, []]);
  });

  it('gathers what is left open — ledger checks, bank, TDS, approvals, billing and allocations — with hand-computed counts', async () => {
    const report = await reports.getExceptions(input());
    expect(report.ledgerChecks).toHaveLength(EXCEPTIONS_END.ledgerCheckCount);
    expect(report.ledgerChecks.filter((c) => !c.allReconciled).map((c) => c.title)).toEqual([]);
    const byKey = Object.fromEntries(report.items.map((i) => [i.key, i]));
    for (const [key, expected] of Object.entries(EXCEPTIONS_END.items)) {
      expect({ key, count: byKey[key]!.count, amount: byKey[key]!.amount, ...('oldestDate' in expected ? { oldestDate: byKey[key]!.oldestDate } : {}) }).toEqual({ key, ...expected });
    }
    expect(report.openCount).toBe(EXCEPTIONS_END.openCount);
  });

  it('counts an approval queue only for what was submitted by the as-of date, and a month only once it has ended', async () => {
    const early = await reports.getExceptions(input({ asOfDate: '2026-07-31' }));
    const byKey = Object.fromEntries(early.items.map((i) => [i.key, i]));
    expect(byKey.SALARY_NOT_ALLOCATED!.count).toBe(0);
    expect(byKey.BILLING_OVERDUE!.count).toBe(0);
    const pdf = await reports.exportReport({ ...input(), key: 'exceptions', format: 'PDF', correlationId: generateId(), ipAddress: undefined, userAgent: undefined });
    expect(Buffer.from(pdf.base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  });
});
