import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialYearService } from '../organization/financial-year.service';
import { PostingService } from '../accounting/posting.service';
import { ProjectsService } from '../projects/projects.service';
import { EmployeeSalaryRevisionsService } from '../employees/employee-salary-revisions.service';
import { SalaryImportsService } from '../salary-imports/salary-imports.service';
import { EmployeeAllocationsService } from './employee-allocations.service';

const prisma = new PrismaService();
const financialYears = new FinancialYearService(prisma);
const posting = new PostingService(prisma);
const projects = new ProjectsService(prisma);
const salaryRevisions = new EmployeeSalaryRevisionsService(prisma);
const salaryImports = new SalaryImportsService(prisma, posting, salaryRevisions);
const allocations = new EmployeeAllocationsService(prisma, projects);

const MONTH = '2026-03-01';

let organizationId: string;
let otherOrganizationId: string;
let legalEntityId: string;
let employeeAId: string;
let employeeBId: string;
let projectAId: string;
let projectBId: string;
let benchTargetId: string;
let inactiveTargetId: string;
const actorId = generateId();

beforeAll(async () => {
  const org = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Allocation Test Org', code: `ALLOCTEST-${generateId()}` },
  });
  organizationId = org.id;
  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Allocation Other Org', code: `ALLOCOTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  const legalEntity = await prisma.client.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'Alloc Test Legal Entity', panNumber: 'ALCCD1234P', registeredAddress: 'Gandhinagar, Gujarat' },
  });
  legalEntityId = legalEntity.id;

  await financialYears.create({
    organizationId, legalEntityId, label: 'FY2026', startDate: '2026-01-01', endDate: '2026-12-31',
    setCurrent: true, actorId, correlationId: generateId(),
  });

  const expenseGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'ALLOC_EXPENSES', name: 'Expenses', accountType: 'EXPENSE', normalBalance: 'DEBIT', isSystemDefined: true },
  });
  const liabilityGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'ALLOC_LIABILITIES', name: 'Liabilities', accountType: 'LIABILITY', normalBalance: 'CREDIT', isSystemDefined: true },
  });
  await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: expenseGroup.id, code: 'SALARIES_WAGES_EXPENSE', name: 'Salaries & Wages Expense', allowManualPosting: true, isActive: true },
  });
  await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: liabilityGroup.id, code: 'SALARY_PAYABLE', name: 'Salary Payable', allowManualPosting: true, isActive: true },
  });

  const employeeA = await prisma.client.employee.create({
    data: { id: generateId(), organizationId, employeeCode: 'ALC-001', fullName: 'Asha Patel', joiningDate: new Date('2025-01-01T00:00:00.000Z') },
  });
  employeeAId = employeeA.id;
  const employeeB = await prisma.client.employee.create({
    data: { id: generateId(), organizationId, employeeCode: 'ALC-002', fullName: 'Ravi Shah', joiningDate: new Date('2025-01-01T00:00:00.000Z') },
  });
  employeeBId = employeeB.id;

  const client = await prisma.client.party.create({ data: { id: generateId(), organizationId, name: 'Alloc Test Client' } });
  const projectA = await prisma.client.project.create({
    data: { id: generateId(), organizationId, clientId: client.id, legalEntityId, name: 'Alloc Project A' },
  });
  projectAId = projectA.id;
  const projectB = await prisma.client.project.create({
    data: { id: generateId(), organizationId, clientId: client.id, legalEntityId, name: 'Alloc Project B' },
  });
  projectBId = projectB.id;

  const bench = await prisma.client.allocationTarget.create({
    data: { id: generateId(), organizationId, code: 'bench', name: 'Bench / Unallocated' },
  });
  benchTargetId = bench.id;
  const retired = await prisma.client.allocationTarget.create({
    data: { id: generateId(), organizationId, code: 'retired', name: 'Retired Target', isActive: false },
  });
  inactiveTargetId = retired.id;

  // 100,000.00 for A and 60,000.00 for B in March, on record as salary
  // revisions and then generated + committed as the month's batch (ADR-098).
  await salaryRevisions.revise({
    organizationId, employeeId: employeeAId, grossAmount: '100000.00', effectiveFrom: '2025-01-01',
    reason: undefined, actorId, correlationId: generateId(),
  });
  await salaryRevisions.revise({
    organizationId, employeeId: employeeBId, grossAmount: '60000.00', effectiveFrom: '2025-01-01',
    reason: undefined, actorId, correlationId: generateId(),
  });
  const salaryDraft = await salaryImports.generateDraft({
    organizationId, legalEntityId, salaryMonth: MONTH, actorId, correlationId: generateId(),
  });
  await salaryImports.commit({
    organizationId, id: salaryDraft.id, accountingDate: '2026-03-31',
    idempotencyKey: generateId(), actorId, correlationId: generateId(),
  });
});

afterAll(async () => {
  const orgIds = [organizationId, otherOrganizationId];
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.idempotencyKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.employeeAllocationLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.employeeMonthlyAllocation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.allocationTarget.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.salaryImportLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.salaryImport.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalEntry.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.project.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.employeeSalaryRevision.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.employee.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountingPeriod.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.financialYear.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.party.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.legalEntity.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.client.$disconnect();
});

function line(overrides: Record<string, unknown> = {}) {
  return { projectId: undefined, allocationTargetId: undefined, percentage: '50', contributionNote: undefined, ...overrides };
}

describe('EmployeeAllocationsService — entry, totals and submission', () => {
  it('returns an empty month for an employee who has not started, already carrying their imported gross', async () => {
    const month = await allocations.getMonth({ organizationId, employeeId: employeeBId, allocationMonth: MONTH });
    expect(month.id).toBeNull();
    expect(month.status).toBe('DRAFT');
    expect(month.lines).toHaveLength(0);
    expect(month.totalPercentage).toBe('0.0000');
    expect(month.isSubmittable).toBe(false);
    // The costing source is the salary import, not Employee.displayedSalaryAmount.
    expect(month.grossSalaryAmount).toBe('60000.00');
  });

  it('normalizes any day of the month to the first, so one employee-month is one record', async () => {
    const saved = await allocations.saveDraft({
      organizationId, employeeId: employeeBId, allocationMonth: '2026-03-19', note: 'mid-month save',
      lines: [line({ projectId: projectAId, percentage: '100' })],
      expectedVersion: undefined, actorId, correlationId: generateId(),
    });
    expect(saved.allocationMonth).toBe('2026-03-01');

    // Saving again against a different day of the same month must update the
    // same record, not create a second one.
    const again = await allocations.saveDraft({
      organizationId, employeeId: employeeBId, allocationMonth: '2026-03-28', note: undefined,
      lines: [line({ projectId: projectAId, percentage: '100' })],
      expectedVersion: saved.version, actorId, correlationId: generateId(),
    });
    expect(again.id).toBe(saved.id);

    const count = await prisma.client.employeeMonthlyAllocation.count({ where: { organizationId, employeeId: employeeBId } });
    expect(count).toBe(1);
  });

  it('computes each line’s share of the imported gross, server-side', async () => {
    const saved = await allocations.saveDraft({
      organizationId, employeeId: employeeAId, allocationMonth: MONTH, note: undefined,
      lines: [
        line({ projectId: projectAId, percentage: '60', contributionNote: 'Site rollout' }),
        line({ projectId: projectBId, percentage: '25' }),
        line({ allocationTargetId: benchTargetId, percentage: '15' }),
      ],
      expectedVersion: undefined, actorId, correlationId: generateId(),
    });

    expect(saved.totalPercentage).toBe('100.0000');
    expect(saved.isSubmittable).toBe(true);
    expect(saved.lines.map((l) => l.allocatedAmount)).toEqual(['60000.00', '25000.00', '15000.00']);
    expect(saved.allocatedTotalAmount).toBe('100000.00');
    expect(saved.lines[0]!.contributionNote).toBe('Site rollout');
    // The contribution note lives on the row that owns the percentage —
    // docs/04 §13's RETIRE of the separate contribution screen.
    expect(saved.lines[0]!.projectName).toBe('Alloc Project A');
    expect(saved.lines[2]!.allocationTargetName).toBe('Bench / Unallocated');
  });

  it('refuses to submit anything that is not exactly 100%, in either direction', async () => {
    const short = await allocations.saveDraft({
      organizationId, employeeId: employeeAId, allocationMonth: MONTH, note: undefined,
      lines: [line({ projectId: projectAId, percentage: '99.9999' })],
      expectedVersion: undefined, actorId, correlationId: generateId(),
    });
    expect(short.isSubmittable).toBe(false);
    await expect(
      allocations.submit({ organizationId, employeeId: employeeAId, allocationMonth: MONTH, expectedVersion: short.version, actorId, correlationId: generateId() }),
    ).rejects.toThrow(/exactly 100%/i);

    const over = await allocations.saveDraft({
      organizationId, employeeId: employeeAId, allocationMonth: MONTH, note: undefined,
      lines: [line({ projectId: projectAId, percentage: '60' }), line({ projectId: projectBId, percentage: '60' })],
      expectedVersion: short.version, actorId, correlationId: generateId(),
    });
    await expect(
      allocations.submit({ organizationId, employeeId: employeeAId, allocationMonth: MONTH, expectedVersion: over.version, actorId, correlationId: generateId() }),
    ).rejects.toThrow(/exactly 100%/i);
  });

  it('submits at exactly 100%, then locks editing until reopened', async () => {
    const current = await allocations.getMonth({ organizationId, employeeId: employeeAId, allocationMonth: MONTH });
    const ready = await allocations.saveDraft({
      organizationId, employeeId: employeeAId, allocationMonth: MONTH, note: undefined,
      lines: [line({ projectId: projectAId, percentage: '70' }), line({ allocationTargetId: benchTargetId, percentage: '30' })],
      expectedVersion: current.version, actorId, correlationId: generateId(),
    });

    const submitted = await allocations.submit({
      organizationId, employeeId: employeeAId, allocationMonth: MONTH, expectedVersion: ready.version, actorId, correlationId: generateId(),
    });
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.submittedAt).not.toBeNull();

    await expect(
      allocations.saveDraft({
        organizationId, employeeId: employeeAId, allocationMonth: MONTH, note: undefined,
        lines: [line({ projectId: projectAId, percentage: '100' })],
        expectedVersion: submitted.version, actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow(/Reopen it before editing/i);

    await expect(
      allocations.submit({ organizationId, employeeId: employeeAId, allocationMonth: MONTH, expectedVersion: submitted.version, actorId, correlationId: generateId() }),
    ).rejects.toThrow(/already submitted/i);

    await expect(
      allocations.reopen({ organizationId, employeeId: employeeAId, allocationMonth: MONTH, expectedVersion: submitted.version, reason: '  ', actorId, correlationId: generateId() }),
    ).rejects.toThrow(/reason is required/i);

    const reopened = await allocations.reopen({
      organizationId, employeeId: employeeAId, allocationMonth: MONTH, expectedVersion: submitted.version,
      reason: 'Corrected split after PM review', actorId, correlationId: generateId(),
    });
    expect(reopened.status).toBe('DRAFT');
    expect(reopened.submittedAt).toBeNull();
    // Nothing is reversed, because nothing was ever posted — but the change
    // is audited, because project cost derived from this month will move.
    const audit = await prisma.client.auditEvent.findFirst({
      where: { organizationId, action: 'EMPLOYEE_ALLOCATION_REOPENED' },
    });
    expect(audit?.reason).toBe('Corrected split after PM review');
  });

  it('rejects a line with both targets, neither target, a repeated target, or an inactive target', async () => {
    const base = { organizationId, employeeId: employeeBId, allocationMonth: MONTH, note: undefined, expectedVersion: undefined, actorId, correlationId: generateId() };

    await expect(
      allocations.saveDraft({ ...base, lines: [line({ projectId: projectAId, allocationTargetId: benchTargetId, percentage: '100' })] }),
    ).rejects.toThrow(/not both and not neither/i);

    await expect(allocations.saveDraft({ ...base, lines: [line({ percentage: '100' })] })).rejects.toThrow(/not both and not neither/i);

    await expect(
      allocations.saveDraft({ ...base, lines: [line({ projectId: projectAId, percentage: '50' }), line({ projectId: projectAId, percentage: '50' })] }),
    ).rejects.toThrow(/more than one line/i);

    await expect(
      allocations.saveDraft({ ...base, lines: [line({ allocationTargetId: inactiveTargetId, percentage: '100' })] }),
    ).rejects.toThrow(/is inactive/i);

    await expect(
      allocations.saveDraft({ ...base, lines: [line({ projectId: projectAId, percentage: '0' })] }),
    ).rejects.toThrow(/greater than zero/i);
  });
});

describe('EmployeeAllocationsService — summary and project manpower cost', () => {
  it('reports every active employee, including the ones who have not started the month', async () => {
    const summary = await allocations.getSummary({ organizationId, allocationMonth: MONTH, filters: { status: undefined } });
    expect(summary.rows).toHaveLength(2);
    const asha = summary.rows.find((r) => r.employeeId === employeeAId)!;
    expect(asha.grossSalaryAmount).toBe('100000.00');
    expect(asha.projectPercentage).toBe('70.0000');
    expect(asha.nonProjectPercentage).toBe('30.0000');

    const notStarted = await allocations.getSummary({ organizationId, allocationMonth: '2026-05-01', filters: { status: 'NOT_STARTED' } });
    // Nobody has touched May — the point of this screen is to find exactly them.
    expect(notStarted.rows).toHaveLength(2);
    expect(notStarted.rows.every((r) => r.status === 'NOT_STARTED')).toBe(true);
  });

  it('computes manpower cost as imported gross x percentage, counting only SUBMITTED months', async () => {
    // Asha: 70% Project A of 100,000 -> 70,000. Currently DRAFT (reopened above).
    const draftOnly = await allocations.getProjectManpowerCost({
      organizationId, fromMonth: MONTH, toMonth: MONTH, projectId: undefined, actorId, canSeeAllProjects: true,
    });
    expect(draftOnly.rows).toHaveLength(0);
    // The excluded drafts are counted, so a total that looks low is explainable.
    expect(draftOnly.excludedDraftEmployeeMonths).toBeGreaterThan(0);

    const ashaMonth = await allocations.getMonth({ organizationId, employeeId: employeeAId, allocationMonth: MONTH });
    await allocations.submit({ organizationId, employeeId: employeeAId, allocationMonth: MONTH, expectedVersion: ashaMonth.version, actorId, correlationId: generateId() });

    const ravi = await allocations.getMonth({ organizationId, employeeId: employeeBId, allocationMonth: MONTH });
    const raviReady = await allocations.saveDraft({
      organizationId, employeeId: employeeBId, allocationMonth: MONTH, note: undefined,
      lines: [line({ projectId: projectAId, percentage: '50' }), line({ projectId: projectBId, percentage: '50' })],
      expectedVersion: ravi.version, actorId, correlationId: generateId(),
    });
    await allocations.submit({ organizationId, employeeId: employeeBId, allocationMonth: MONTH, expectedVersion: raviReady.version, actorId, correlationId: generateId() });

    const report = await allocations.getProjectManpowerCost({
      organizationId, fromMonth: MONTH, toMonth: MONTH, projectId: undefined, actorId, canSeeAllProjects: true,
    });
    const a = report.rows.find((r) => r.projectId === projectAId)!;
    const b = report.rows.find((r) => r.projectId === projectBId)!;
    // A: Asha 70% of 100,000 + Ravi 50% of 60,000 = 70,000 + 30,000.
    expect(a.manpowerCostAmount).toBe('100000.00');
    expect(a.employeeCount).toBe(2);
    // B: Ravi 50% of 60,000.
    expect(b.manpowerCostAmount).toBe('30000.00');
    expect(b.employeeCount).toBe(1);
    expect(report.totalManpowerCostAmount).toBe('130000.00');
    expect(report.excludedDraftEmployeeMonths).toBe(0);

    // Filtering to one project returns only that project's cost.
    const filtered = await allocations.getProjectManpowerCost({
      organizationId, fromMonth: MONTH, toMonth: MONTH, projectId: projectBId, actorId, canSeeAllProjects: true,
    });
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.totalManpowerCostAmount).toBe('30000.00');
  });

  it('reconciles to the salary import: every rupee of an allocated month lands somewhere', async () => {
    // Phase 7's "project cost uses imported gross salary" exit criterion,
    // asserted end to end. Asha is 70% project / 30% bench, Ravi is 100%
    // project, so project cost plus bench must equal the imported total.
    const report = await allocations.getProjectManpowerCost({
      organizationId, fromMonth: MONTH, toMonth: MONTH, projectId: undefined, actorId, canSeeAllProjects: true,
    });
    const ashaMonth = await allocations.getMonth({ organizationId, employeeId: employeeAId, allocationMonth: MONTH });
    const benchLine = ashaMonth.lines.find((l) => l.allocationTargetId === benchTargetId)!;

    const projectCost = Number(report.totalManpowerCostAmount);
    const bench = Number(benchLine.allocatedAmount);
    expect(projectCost + bench).toBe(100000 + 60000);
  });

  it('rejects an end month before the start month, and isolates other organizations', async () => {
    await expect(
      allocations.getProjectManpowerCost({ organizationId, fromMonth: '2026-05-01', toMonth: '2026-03-01', projectId: undefined, actorId, canSeeAllProjects: true }),
    ).rejects.toThrow(/cannot be before/i);

    await expect(
      allocations.getMonth({ organizationId: otherOrganizationId, employeeId: employeeAId, allocationMonth: MONTH }),
    ).rejects.toThrow(/not found/i);

    const otherReport = await allocations.getProjectManpowerCost({
      organizationId: otherOrganizationId, fromMonth: MONTH, toMonth: MONTH, projectId: undefined, actorId, canSeeAllProjects: true,
    });
    expect(otherReport.rows).toHaveLength(0);

    const otherSummary = await allocations.getSummary({ organizationId: otherOrganizationId, allocationMonth: MONTH, filters: { status: undefined } });
    expect(otherSummary.rows).toHaveLength(0);
  });

  it("sends an employee's cost only to their own legal entity's projects", async () => {
    const otherEntity = await prisma.client.legalEntity.create({
      data: { id: generateId(), organizationId, legalName: 'Alloc Other Entity', panNumber: 'ALCPO1234Q', registeredAddress: 'Surat' },
    });
    const client = await prisma.client.party.findFirstOrThrow({ where: { organizationId, name: 'Alloc Test Client' } });
    const otherProject = await prisma.client.project.create({
      data: { id: generateId(), organizationId, clientId: client.id, legalEntityId: otherEntity.id, name: 'Other Entity Project' },
    });
    const employee = await prisma.client.employee.create({
      data: { id: generateId(), organizationId, legalEntityId, employeeCode: 'ALC-LE', fullName: 'Entity Bound', joiningDate: new Date('2025-01-01T00:00:00.000Z') },
    });

    await expect(
      allocations.saveDraft({
        organizationId, employeeId: employee.id, allocationMonth: '2026-05-01', note: undefined,
        lines: [line({ projectId: otherProject.id, percentage: '100' })],
        expectedVersion: undefined, actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow('belongs to another legal entity');

    const saved = await allocations.saveDraft({
      organizationId, employeeId: employee.id, allocationMonth: '2026-05-01', note: undefined,
      lines: [line({ projectId: projectAId, percentage: '100' })],
      expectedVersion: undefined, actorId, correlationId: generateId(),
    });
    expect(saved.lines).toHaveLength(1);
  });
});

