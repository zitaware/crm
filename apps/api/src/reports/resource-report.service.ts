import { Injectable } from '@nestjs/common';
import { Prisma } from '@zitaware/database';
import type { LedgerReconciliation, ManpowerAllocationState, ManpowerUtilizationReport, ManpowerUtilizationRow, ReportReadInput } from '@zitaware/contracts';
import { allocateSalary, totalPercentage } from '../employee-allocations/allocation-cost.util';
import { PrismaService } from '../prisma/prisma.service';
import { monthsBetween } from './cash-flow-report.service';
import { LedgerControlService } from './ledger-control.service';
import { notComparable, reconciled, reconciliationLine } from './reconciliation.util';
import { REPORT_CATALOG } from './report-catalog';
import { ReportScopeService } from './report-scope.service';

const ZERO = new Prisma.Decimal(0);
const dateOf = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const sum = (values: Array<Prisma.Decimal | string>) => values.reduce<Prisma.Decimal>((s, v) => s.plus(v), ZERO);
const monthEnd = (month: string) => {
  const d = asDate(`${month}-01`);
  return dateOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
};

/**
 * Manpower Utilization (Phase 8.8b, ADR-118): the operations report built on
 * monthly allocations rather than on posted documents alone. Recurring
 * Spend went with the server/subscription cycles (ADR-169).
 */
@Injectable()
export class ResourceReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ReportScopeService,
    private readonly ledger: LedgerControlService,
  ) {}

  /** docs/04 §16: submitted/draft monthly allocation percentages against 100% capacity, with the salary cost they attribute. */
  async manpowerUtilization(input: ReportReadInput): Promise<ManpowerUtilizationReport> {
    const { scope, projects } = await this.scopes.resolve(input);
    const db = this.prisma.client;
    const projectIds = new Set(projects.map((p) => p.id));
    const months = monthsBetween(scope.dateFrom ?? scope.asOfDate, scope.asOfDate);
    const firstDay = `${months[0]}-01`;
    const lastDay = monthEnd(months[months.length - 1]!);

    const [employees, allocations, salaryLines] = await Promise.all([
      db.employee.findMany({
        // An employee with no joining date counts from the start (ADR-170).
        where: { organizationId: input.organizationId, deletedAt: null, OR: [{ joiningDate: null }, { joiningDate: { lte: asDate(lastDay) } }] },
        select: { id: true, employeeCode: true, fullName: true, status: true, internalDepartment: { select: { name: true } } },
        orderBy: { fullName: 'asc' },
      }),
      db.employeeMonthlyAllocation.findMany({
        where: { organizationId: input.organizationId, allocationMonth: { gte: asDate(firstDay), lte: asDate(lastDay) } },
        select: {
          employeeId: true, allocationMonth: true, status: true,
          lines: { select: { id: true, sequence: true, percentage: true, projectId: true, project: { select: { name: true } }, allocationTarget: { select: { name: true } } }, orderBy: { sequence: 'asc' } },
        },
      }),
      db.salaryImportLine.findMany({
        where: { organizationId: input.organizationId, salaryImport: { status: 'POSTED', salaryMonth: { gte: asDate(firstDay), lte: asDate(lastDay) }, ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}) } },
        select: { employeeId: true, grossSalaryAmount: true, salaryImport: { select: { salaryMonth: true } } },
      }),
    ]);
    const allocationByKey = new Map(allocations.map((a) => [`${a.employeeId}|${dateOf(a.allocationMonth)}`, a]));
    const grossByKey = new Map<string, Prisma.Decimal>();
    for (const l of salaryLines) {
      const key = `${l.employeeId}|${dateOf(l.salaryImport.salaryMonth)}`;
      grossByKey.set(key, (grossByKey.get(key) ?? ZERO).plus(l.grossSalaryAmount));
    }

    const rows: ManpowerUtilizationRow[] = [];
    for (const month of months) {
      const monthStart = `${month}-01`;
      for (const e of employees) {
        const key = `${e.id}|${monthStart}`;
        const allocation = allocationByKey.get(key);
        const gross = grossByKey.get(key) ?? null;
        // Someone who has left still counts in a month they were paid or allocated for.
        if (e.status !== 'ACTIVE' && !allocation && !gross) continue;
        const lines = allocation?.lines ?? [];
        const state: ManpowerAllocationState = allocation ? allocation.status : 'NOT_STARTED';
        // The whole month is split before any line is kept, so rounding never depends on the view (ADR-095).
        const amounts = gross && state === 'SUBMITTED' ? new Map(allocateSalary(gross, lines.map((l) => ({ key: l.id, sequence: l.sequence, percentage: l.percentage }))).map((a) => [a.key, a.amount])) : null;
        const shown = scope.restricted ? lines.filter((l) => l.projectId && projectIds.has(l.projectId)) : lines;
        if (scope.restricted && shown.length === 0) continue;
        const projectLines = shown.filter((l) => l.projectId);
        const nonProjectLines = shown.filter((l) => !l.projectId);
        const cost = (list: typeof lines) => (amounts ? sum(list.map((l) => amounts.get(l.id) ?? ZERO)).toFixed(2) : null);
        const total = totalPercentage(lines);
        rows.push({
          employeeId: e.id,
          employeeCode: e.employeeCode,
          employeeName: e.fullName,
          departmentName: e.internalDepartment?.name ?? null,
          month: monthStart,
          state,
          projectPercentage: totalPercentage(projectLines).toFixed(4),
          nonProjectPercentage: scope.restricted ? null : totalPercentage(nonProjectLines).toFixed(4),
          totalPercentage: scope.restricted ? null : total.toFixed(4),
          variancePercentage: scope.restricted ? null : total.minus(100).toFixed(4),
          grossSalary: scope.restricted || !gross ? null : gross.toFixed(2),
          projectCost: cost(projectLines),
          nonProjectCost: scope.restricted ? null : cost(nonProjectLines),
          shares: shown.map((l) => ({ projectId: l.projectId, targetName: l.project?.name ?? l.allocationTarget?.name ?? '—', percentage: l.percentage.toFixed(4), amount: amounts ? (amounts.get(l.id) ?? ZERO).toFixed(2) : null })),
        });
      }
    }

    const byMonth = months.map((m) => {
      const list = rows.filter((r) => r.month === `${m}-01`);
      const gross = sum(list.flatMap((r) => (r.grossSalary ? [r.grossSalary] : [])));
      const projectCost = sum(list.flatMap((r) => (r.projectCost ? [r.projectCost] : [])));
      const nonProjectCost = sum(list.flatMap((r) => (r.nonProjectCost ? [r.nonProjectCost] : [])));
      return {
        month: `${m}-01`,
        employees: list.length,
        submitted: list.filter((r) => r.state === 'SUBMITTED').length,
        draft: list.filter((r) => r.state === 'DRAFT').length,
        notStarted: list.filter((r) => r.state === 'NOT_STARTED').length,
        grossSalary: gross.toFixed(2),
        projectCost: projectCost.toFixed(2),
        nonProjectCost: nonProjectCost.toFixed(2),
        // Salary no submitted allocation attributes yet — drafts, months not started.
        unallocatedSalary: scope.restricted ? '0.00' : gross.minus(projectCost).minus(nonProjectCost).toFixed(2),
      };
    });
    const grossTotal = sum(byMonth.map((m) => m.grossSalary));

    let reconciliation: LedgerReconciliation;
    if (scope.restricted) {
      reconciliation = notComparable(input, 'Filtered to one client or project. Salary expense is not split by project in the ledger — manpower cost is analytical (ADR-095) — so it is compared only on the unfiltered view.');
    } else {
      const movement = await this.ledger.movementBySource({
        organizationId: input.organizationId, legalEntityId: scope.legalEntityId, dateFrom: firstDay, dateTo: lastDay, codes: [], accountTypes: ['EXPENSE'], sourceTypes: ['salary_import'],
      });
      const touched = [...movement.values()].filter((m) => !m.debitMinusCredit.isZero());
      reconciliation = reconciled([
        reconciliationLine('GROSS_SALARY', 'Gross salary imported for these months', undefined, grossTotal, sum(touched.map((m) => m.debitMinusCredit)), touched.map((m) => m.account)),
      ]);
    }

    return {
      catalog: REPORT_CATALOG['manpower-utilization'],
      scope,
      months: months.map((m) => `${m}-01`),
      rows,
      byMonth,
      totals: {
        grossSalary: grossTotal.toFixed(2),
        projectCost: sum(byMonth.map((m) => m.projectCost)).toFixed(2),
        nonProjectCost: sum(byMonth.map((m) => m.nonProjectCost)).toFixed(2),
        unallocatedSalary: sum(byMonth.map((m) => m.unallocatedSalary)).toFixed(2),
      },
      reconciliation,
    };
  }
}
