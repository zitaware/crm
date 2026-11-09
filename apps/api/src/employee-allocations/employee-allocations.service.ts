import { Injectable } from '@nestjs/common';
import { Prisma, generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  EmployeeAllocationLineInput,
  EmployeeAllocationLineRow,
  EmployeeAllocationMonth,
  EmployeeAllocationPort,
  EmployeeAllocationSummaryRow,
  ProjectManpowerCostReport,
  ProjectManpowerCostRow,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { allocateSalary, isExactlyHundred, totalPercentage, type AllocationShare } from './allocation-cost.util';

const MAX_LINES = 50;

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}
/** The month is part of this record's identity, so it is normalised on write
 * rather than trusted — see SalaryImportsService for the same rule. */
function normalizeMonth(month: string): Date {
  const d = toDate(month);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

const allocationInclude = {
  employee: true,
  lines: { orderBy: { sequence: 'asc' }, include: { project: true, allocationTarget: true } },
} satisfies Prisma.EmployeeMonthlyAllocationInclude;

type AllocationRow = Prisma.EmployeeMonthlyAllocationGetPayload<{ include: typeof allocationInclude }>;

/**
 * Monthly employee allocation, and the project manpower cost derived from it
 * (Phase 7.5, ADR-095).
 *
 * Posts no journal and holds no money. Every amount this service returns is
 * computed on read from the month's salary import (ADR-094) times the stored
 * percentages, through the one shared `allocateSalary` util — so a corrected
 * salary import immediately and automatically corrects every project cost
 * derived from it, with nothing to re-run and nothing to reconcile.
 */
@Injectable()
export class EmployeeAllocationsService implements EmployeeAllocationPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  /** The employee's imported gross for a month, or null if no POSTED salary
   * import covers it. A REVERSED import deliberately does not count — its
   * cost is no longer in the ledger, so no project may still be charged it. */
  private async findImportedGross(
    organizationId: string,
    employeeId: string,
    month: Date,
  ): Promise<{ grossSalaryAmount: Prisma.Decimal; salaryImportId: string } | null> {
    const line = await this.prisma.client.salaryImportLine.findFirst({
      where: {
        organizationId,
        employeeId,
        salaryImport: { salaryMonth: month, status: 'POSTED' },
      },
      select: { grossSalaryAmount: true, salaryImportId: true },
    });
    return line ? { grossSalaryAmount: line.grossSalaryAmount, salaryImportId: line.salaryImportId } : null;
  }

  private toMonth(
    row: AllocationRow | null,
    fallback: { employeeId: string; employeeCode: string; employeeName: string; month: Date },
    salary: { grossSalaryAmount: Prisma.Decimal; salaryImportId: string } | null,
  ): EmployeeAllocationMonth {
    const rawLines = row?.lines ?? [];
    const shares: AllocationShare[] = rawLines.map((l) => ({ key: l.id, sequence: l.sequence, percentage: l.percentage }));
    const allocated = salary ? allocateSalary(salary.grossSalaryAmount, shares) : [];
    const allocatedByKey = new Map(allocated.map((a) => [a.key, a]));

    const lines: EmployeeAllocationLineRow[] = rawLines.map((l) => {
      const a = allocatedByKey.get(l.id);
      return {
        id: l.id,
        sequence: l.sequence,
        projectId: l.projectId,
        projectName: l.project?.name ?? null,
        allocationTargetId: l.allocationTargetId,
        allocationTargetName: l.allocationTarget?.name ?? null,
        percentage: l.percentage.toFixed(4),
        contributionNote: l.contributionNote,
        allocatedAmount: a ? a.amount.toFixed(2) : null,
        carriesRoundingRemainder: a?.carriesRemainder ?? false,
      };
    });

    const total = totalPercentage(rawLines);
    return {
      id: row?.id ?? null,
      employeeId: fallback.employeeId,
      employeeCode: fallback.employeeCode,
      employeeName: fallback.employeeName,
      allocationMonth: toDateStr(fallback.month),
      status: row?.status ?? 'DRAFT',
      note: row?.note ?? null,
      lines,
      totalPercentage: total.toFixed(4),
      isSubmittable: rawLines.length > 0 && isExactlyHundred(rawLines),
      grossSalaryAmount: salary ? salary.grossSalaryAmount.toFixed(2) : null,
      salaryImportId: salary?.salaryImportId ?? null,
      allocatedTotalAmount: salary ? allocated.reduce((s, a) => s.plus(a.amount), new Prisma.Decimal(0)).toFixed(2) : null,
      submittedAt: row?.submittedAt?.toISOString() ?? null,
      version: row?.version ?? 0,
    };
  }

  async getMonth(input: { organizationId: string; employeeId: string; allocationMonth: string }): Promise<EmployeeAllocationMonth> {
    const employee = await this.prisma.client.employee.findFirst({
      where: { id: input.employeeId, organizationId: input.organizationId, deletedAt: null },
    });
    if (!employee) throwAppError('NOT_FOUND', 'Employee not found.');

    const month = normalizeMonth(input.allocationMonth);
    const row = await this.prisma.client.employeeMonthlyAllocation.findFirst({
      where: { organizationId: input.organizationId, employeeId: input.employeeId, allocationMonth: month },
      include: allocationInclude,
    });
    const salary = await this.findImportedGross(input.organizationId, input.employeeId, month);

    return this.toMonth(row, { employeeId: employee.id, employeeCode: employee.employeeCode, employeeName: employee.fullName, month }, salary);
  }

  /**
   * Validates the submitted lines and resolves their targets.
   *
   * Deliberately strict about the either/or: a line naming both a project and
   * a non-project target, or neither, is refused here as well as by the
   * database CHECK, so the caller gets a sentence rather than a constraint
   * name.
   */
  private async validateLines(
    organizationId: string,
    lines: EmployeeAllocationLineInput[],
    employeeLegalEntityId: string | null,
  ): Promise<Array<{ projectId: string | null; allocationTargetId: string | null; percentage: Prisma.Decimal; contributionNote: string | null }>> {
    if (lines.length > MAX_LINES) throwAppError('VALIDATION_FAILED', `An employee's month cannot be split more than ${MAX_LINES} ways.`);

    const projectIds = [...new Set(lines.map((l) => l.projectId).filter((v): v is string => Boolean(v)))];
    const targetIds = [...new Set(lines.map((l) => l.allocationTargetId).filter((v): v is string => Boolean(v)))];

    const projects = projectIds.length
      ? await this.prisma.client.project.findMany({ where: { id: { in: projectIds }, organizationId } })
      : [];
    if (projects.length !== projectIds.length) throwAppError('NOT_FOUND', 'One or more projects were not found.');
    // ADR-154: an employee's cost goes only to their own legal entity's
    // projects. An employee whose legal entity is not set yet is not held to it.
    const otherEntityProject = employeeLegalEntityId ? projects.find((p) => p.legalEntityId !== employeeLegalEntityId) : undefined;
    if (otherEntityProject) {
      throwAppError('VALIDATION_FAILED', `Project "${otherEntityProject.name}" belongs to another legal entity than this employee's.`);
    }

    const targets = targetIds.length
      ? await this.prisma.client.allocationTarget.findMany({ where: { id: { in: targetIds }, organizationId, deletedAt: null } })
      : [];
    if (targets.length !== targetIds.length) throwAppError('NOT_FOUND', 'One or more allocation targets were not found.');
    const inactiveTarget = targets.find((t) => !t.isActive);
    if (inactiveTarget) throwAppError('VALIDATION_FAILED', `Allocation target "${inactiveTarget.name}" is inactive.`);

    const seen = new Set<string>();
    return lines.map((line, index) => {
      const hasProject = Boolean(line.projectId);
      const hasTarget = Boolean(line.allocationTargetId);
      if (hasProject === hasTarget) {
        throwAppError('VALIDATION_FAILED', `Line ${index + 1}: choose either a project or a non-project target, not both and not neither.`);
      }
      const percentage = new Prisma.Decimal(line.percentage);
      if (!percentage.greaterThan(0)) throwAppError('VALIDATION_FAILED', `Line ${index + 1}: percentage must be greater than zero.`);
      if (percentage.greaterThan(100)) throwAppError('VALIDATION_FAILED', `Line ${index + 1}: percentage cannot exceed 100.`);

      // One line per target: two rows for the same project are not two facts,
      // they are one percentage entered twice, and would make the summary's
      // per-project figure ambiguous.
      const key = line.projectId ?? line.allocationTargetId!;
      if (seen.has(key)) throwAppError('VALIDATION_FAILED', 'The same project or target appears on more than one line — combine them into one.');
      seen.add(key);

      return {
        projectId: line.projectId ?? null,
        allocationTargetId: line.allocationTargetId ?? null,
        percentage,
        contributionNote: line.contributionNote?.trim() || null,
      };
    });
  }

  async saveDraft(input: {
    organizationId: string;
    employeeId: string;
    allocationMonth: string;
    note: string | undefined;
    lines: EmployeeAllocationLineInput[];
    expectedVersion: number | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeAllocationMonth> {
    const employee = await this.prisma.client.employee.findFirst({
      where: { id: input.employeeId, organizationId: input.organizationId, deletedAt: null },
    });
    if (!employee) throwAppError('NOT_FOUND', 'Employee not found.');

    const month = normalizeMonth(input.allocationMonth);
    const validated = await this.validateLines(input.organizationId, input.lines, employee.legalEntityId);

    const existing = await this.prisma.client.employeeMonthlyAllocation.findFirst({
      where: { organizationId: input.organizationId, employeeId: input.employeeId, allocationMonth: month },
    });
    if (existing && existing.status === 'SUBMITTED') {
      throwAppError('INVALID_STATE_TRANSITION', 'This month has been submitted. Reopen it before editing.');
    }

    await this.prisma.client.$transaction(async (tx) => {
      let allocationId: string;
      if (existing) {
        if (input.expectedVersion !== undefined) {
          const { count } = await tx.employeeMonthlyAllocation.updateMany({
            where: { id: existing.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'DRAFT' },
            data: { note: input.note ?? null, updatedBy: input.actorId, version: { increment: 1 } },
          });
          if (count === 0) throwAppError('VERSION_CONFLICT', 'This allocation was changed by someone else. Reload and try again.');
        } else {
          await tx.employeeMonthlyAllocation.update({
            where: { id: existing.id },
            data: { note: input.note ?? null, updatedBy: input.actorId, version: { increment: 1 } },
          });
        }
        allocationId = existing.id;
        // A draft's lines are replaced wholesale rather than diffed: they
        // carry no identity of their own and nothing references them, so a
        // diff would be complexity with no observable benefit.
        await tx.employeeAllocationLine.deleteMany({ where: { employeeMonthlyAllocationId: allocationId } });
      } else {
        allocationId = generateId();
        await tx.employeeMonthlyAllocation.create({
          data: {
            id: allocationId,
            organizationId: input.organizationId,
            employeeId: input.employeeId,
            allocationMonth: month,
            status: 'DRAFT',
            note: input.note ?? null,
            createdBy: input.actorId,
          },
        });
      }

      if (validated.length > 0) {
        await tx.employeeAllocationLine.createMany({
          data: validated.map((l, index) => ({
            id: generateId(),
            organizationId: input.organizationId,
            employeeMonthlyAllocationId: allocationId,
            projectId: l.projectId,
            allocationTargetId: l.allocationTargetId,
            sequence: index + 1,
            percentage: l.percentage,
            contributionNote: l.contributionNote,
          })),
        });
      }

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'EMPLOYEE_ALLOCATION',
        entityId: allocationId,
        action: 'EMPLOYEE_ALLOCATION_SAVED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: {
          employeeId: input.employeeId,
          allocationMonth: toDateStr(month),
          lineCount: validated.length,
          totalPercentage: totalPercentage(validated).toFixed(4),
        },
      });
    });

    return this.getMonth({ organizationId: input.organizationId, employeeId: input.employeeId, allocationMonth: input.allocationMonth });
  }

  /**
   * Moves a month to SUBMITTED, which requires the lines to total EXACTLY
   * 100% — Phase 7's own exit criterion.
   *
   * "Exactly" is meant literally: 99.9999 is refused. Anything looser would
   * make project manpower cost silently under- or over-state the month, and
   * the tolerance would have to be invented here with no rule behind it.
   */
  async submit(input: {
    organizationId: string;
    employeeId: string;
    allocationMonth: string;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeAllocationMonth> {
    const month = normalizeMonth(input.allocationMonth);
    const existing = await this.prisma.client.employeeMonthlyAllocation.findFirst({
      where: { organizationId: input.organizationId, employeeId: input.employeeId, allocationMonth: month },
      include: allocationInclude,
    });
    if (!existing) throwAppError('NOT_FOUND', 'This month has not been started yet.');
    if (existing.status === 'SUBMITTED') throwAppError('INVALID_STATE_TRANSITION', 'This month is already submitted.');
    if (existing.lines.length === 0) throwAppError('VALIDATION_FAILED', 'Add at least one allocation line before submitting.');

    const total = totalPercentage(existing.lines);
    if (!isExactlyHundred(existing.lines)) {
      throwAppError('VALIDATION_FAILED', `Allocation totals ${total.toFixed(4)}% — it must be exactly 100% to submit.`);
    }

    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.employeeMonthlyAllocation.updateMany({
        where: { id: existing.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'DRAFT' },
        data: { status: 'SUBMITTED', submittedAt: new Date(), submittedBy: input.actorId, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This allocation was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'EMPLOYEE_ALLOCATION',
        entityId: existing.id,
        action: 'EMPLOYEE_ALLOCATION_SUBMITTED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { employeeId: input.employeeId, allocationMonth: toDateStr(month), totalPercentage: total.toFixed(4) },
      });
    });

    return this.getMonth({ organizationId: input.organizationId, employeeId: input.employeeId, allocationMonth: input.allocationMonth });
  }

  /**
   * Returns a submitted month to DRAFT so it can be corrected.
   *
   * A reason is required and audited. Nothing is reversed because nothing was
   * posted — that is the whole point of allocation being analytical — but the
   * project cost derived from this month WILL change, so the change is
   * recorded rather than left silent.
   */
  async reopen(input: {
    organizationId: string;
    employeeId: string;
    allocationMonth: string;
    expectedVersion: number;
    reason: string;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeAllocationMonth> {
    if (!input.reason.trim()) throwAppError('VALIDATION_FAILED', 'A reason is required to reopen a submitted allocation.');

    const month = normalizeMonth(input.allocationMonth);
    const existing = await this.prisma.client.employeeMonthlyAllocation.findFirst({
      where: { organizationId: input.organizationId, employeeId: input.employeeId, allocationMonth: month },
    });
    if (!existing) throwAppError('NOT_FOUND', 'This month has not been started yet.');
    if (existing.status !== 'SUBMITTED') throwAppError('INVALID_STATE_TRANSITION', 'This month is not submitted.');

    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.employeeMonthlyAllocation.updateMany({
        where: { id: existing.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'SUBMITTED' },
        data: { status: 'DRAFT', submittedAt: null, submittedBy: null, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This allocation was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'EMPLOYEE_ALLOCATION',
        entityId: existing.id,
        action: 'EMPLOYEE_ALLOCATION_REOPENED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        reason: input.reason,
        newValues: { employeeId: input.employeeId, allocationMonth: toDateStr(month) },
      });
    });

    return this.getMonth({ organizationId: input.organizationId, employeeId: input.employeeId, allocationMonth: input.allocationMonth });
  }

  /**
   * The Allocation Summary screen: every active employee's month, including
   * the ones nobody has started.
   *
   * A month with no record at all is reported as NOT_STARTED rather than
   * omitted — the point of this screen is to find the people whose month is
   * missing, and a list of only the people who already filled it in cannot
   * do that.
   */
  async getSummary(input: {
    organizationId: string;
    allocationMonth: string;
    filters: { status: 'DRAFT' | 'SUBMITTED' | 'NOT_STARTED' | undefined };
  }): Promise<{ rows: EmployeeAllocationSummaryRow[] }> {
    const month = normalizeMonth(input.allocationMonth);

    const employees = await this.prisma.client.employee.findMany({
      where: { organizationId: input.organizationId, deletedAt: null, status: 'ACTIVE' },
      orderBy: { fullName: 'asc' },
    });
    const allocations = await this.prisma.client.employeeMonthlyAllocation.findMany({
      where: { organizationId: input.organizationId, allocationMonth: month },
      include: allocationInclude,
    });
    const byEmployee = new Map(allocations.map((a) => [a.employeeId, a]));

    const salaryLines = await this.prisma.client.salaryImportLine.findMany({
      where: { organizationId: input.organizationId, salaryImport: { salaryMonth: month, status: 'POSTED' } },
      select: { employeeId: true, grossSalaryAmount: true },
    });
    const grossByEmployee = new Map(salaryLines.map((l) => [l.employeeId, l.grossSalaryAmount]));

    let rows: EmployeeAllocationSummaryRow[] = employees.map((employee) => {
      const allocation = byEmployee.get(employee.id);
      const lines = allocation?.lines ?? [];
      const gross = grossByEmployee.get(employee.id) ?? null;
      const allocated = gross
        ? allocateSalary(gross, lines.map((l) => ({ key: l.id, sequence: l.sequence, percentage: l.percentage })))
        : [];

      return {
        employeeId: employee.id,
        employeeCode: employee.employeeCode,
        employeeName: employee.fullName,
        legalEntityId: employee.legalEntityId,
        allocationMonth: toDateStr(month),
        status: allocation ? allocation.status : ('NOT_STARTED' as const),
        totalPercentage: totalPercentage(lines).toFixed(4),
        projectPercentage: totalPercentage(lines.filter((l) => l.projectId)).toFixed(4),
        nonProjectPercentage: totalPercentage(lines.filter((l) => l.allocationTargetId)).toFixed(4),
        grossSalaryAmount: gross ? gross.toFixed(2) : null,
        allocatedTotalAmount: gross ? allocated.reduce((s, a) => s.plus(a.amount), new Prisma.Decimal(0)).toFixed(2) : null,
      };
    });

    if (input.filters.status) rows = rows.filter((r) => r.status === input.filters.status);
    return { rows };
  }

  /**
   * Project manpower cost — docs/04 §13: "Formula is imported gross salary x
   * allocation percentage. Totals reconcile to salary import and allocation
   * records."
   *
   * Only SUBMITTED months contribute. A draft is by definition not yet the
   * employee's answer, and including one would make a project's cost change
   * as somebody types. The count of excluded drafts is returned alongside, so
   * a total that looks low is explainable instead of merely doubted.
   */
  async getProjectManpowerCost(input: {
    organizationId: string;
    fromMonth: string;
    toMonth: string;
    projectId: string | undefined;
    legalEntityId?: string | undefined;
    actorId: string;
    canSeeAllProjects: boolean;
  }): Promise<ProjectManpowerCostReport> {
    const from = normalizeMonth(input.fromMonth);
    const to = normalizeMonth(input.toMonth);
    if (to < from) throwAppError('VALIDATION_FAILED', 'The end month cannot be before the start month.');

    // Project scoping reuses ProjectsService's own list, so a scoped Project
    // Manager sees manpower cost for exactly the projects they can already
    // see — never a second, divergent definition of scope (ADR-058).
    const visible = await this.projects.list({
      organizationId: input.organizationId,
      actorId: input.actorId,
      canSeeAll: input.canSeeAllProjects,
    });
    const visibleIds = new Set(visible.filter((p) => !input.legalEntityId || p.legalEntityId === input.legalEntityId).map((p) => p.id));
    if (input.projectId && !visibleIds.has(input.projectId)) throwAppError('NOT_FOUND', 'Project not found.');
    const wantedIds = input.projectId ? [input.projectId] : [...visibleIds];
    if (wantedIds.length === 0) return { rows: [], totalManpowerCostAmount: '0.00', excludedDraftEmployeeMonths: 0 };

    const allocations = await this.prisma.client.employeeMonthlyAllocation.findMany({
      where: {
        organizationId: input.organizationId,
        allocationMonth: { gte: from, lte: to },
        lines: { some: { projectId: { in: wantedIds } } },
      },
      include: allocationInclude,
    });

    const excludedDraftEmployeeMonths = allocations.filter((a) => a.status === 'DRAFT').length;
    const submitted = allocations.filter((a) => a.status === 'SUBMITTED');

    const salaryLines = await this.prisma.client.salaryImportLine.findMany({
      where: {
        organizationId: input.organizationId,
        salaryImport: { salaryMonth: { gte: from, lte: to }, status: 'POSTED' },
      },
      select: { employeeId: true, grossSalaryAmount: true, salaryImport: { select: { salaryMonth: true } } },
    });
    const grossByKey = new Map(
      salaryLines.map((l) => [`${l.employeeId}|${toDateStr(l.salaryImport.salaryMonth)}`, l.grossSalaryAmount]),
    );

    const projectNames = new Map(visible.map((p) => [p.id, p.name]));
    const buckets = new Map<string, { projectId: string; allocationMonth: string; employees: Set<string>; percentage: Prisma.Decimal; amount: Prisma.Decimal }>();

    for (const allocation of submitted) {
      const monthStr = toDateStr(allocation.allocationMonth);
      const gross = grossByKey.get(`${allocation.employeeId}|${monthStr}`) ?? null;
      // The whole month is split, then only the project lines are kept — the
      // rounding remainder must be decided against the complete allocation,
      // or two projects' figures would depend on which report ran.
      const allocated = gross
        ? allocateSalary(gross, allocation.lines.map((l) => ({ key: l.id, sequence: l.sequence, percentage: l.percentage })))
        : [];
      const amountByLine = new Map(allocated.map((a) => [a.key, a.amount]));

      for (const line of allocation.lines) {
        if (!line.projectId || !wantedIds.includes(line.projectId)) continue;
        const key = `${line.projectId}|${monthStr}`;
        const bucket = buckets.get(key) ?? {
          projectId: line.projectId,
          allocationMonth: monthStr,
          employees: new Set<string>(),
          percentage: new Prisma.Decimal(0),
          amount: new Prisma.Decimal(0),
        };
        bucket.employees.add(allocation.employeeId);
        bucket.percentage = bucket.percentage.plus(line.percentage);
        bucket.amount = bucket.amount.plus(amountByLine.get(line.id) ?? new Prisma.Decimal(0));
        buckets.set(key, bucket);
      }
    }

    const rows: ProjectManpowerCostRow[] = [...buckets.values()]
      .map((b) => ({
        projectId: b.projectId,
        projectName: projectNames.get(b.projectId) ?? 'Unknown project',
        allocationMonth: b.allocationMonth,
        employeeCount: b.employees.size,
        totalPercentage: b.percentage.toFixed(4),
        manpowerCostAmount: b.amount.toFixed(2),
      }))
      .sort((a, b) => (a.allocationMonth === b.allocationMonth ? a.projectName.localeCompare(b.projectName) : a.allocationMonth.localeCompare(b.allocationMonth)));

    const totalManpowerCostAmount = rows.reduce((s, r) => s.plus(r.manpowerCostAmount), new Prisma.Decimal(0)).toFixed(2);
    return { rows, totalManpowerCostAmount, excludedDraftEmployeeMonths };
  }
}
