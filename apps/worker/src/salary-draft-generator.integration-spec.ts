import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, generateId } from '@zitaware/database';
import { previousMonthStart, runSalaryDraftGeneratorJob } from './salary-draft-generator';

const prisma = createPrismaClient();

// A fixed "today" so the job always targets the same month regardless of
// when the suite runs.
const NOW = new Date('2026-04-10T00:00:00.000Z');
const TARGET_MONTH = new Date('2026-03-01T00:00:00.000Z');

let organizationId: string;
let legalEntityId: string;
let employeeAId: string;
let employeeBId: string;

async function makeEmployee(code: string, name: string, status = 'ACTIVE'): Promise<string> {
  const row = await prisma.employee.create({
    data: {
      id: generateId(), organizationId, employeeCode: code, fullName: name,
      joiningDate: new Date('2025-01-01T00:00:00.000Z'), status,
    },
  });
  return row.id;
}

async function giveSalary(employeeId: string, gross: string, effectiveFrom = '2025-01-01') {
  await prisma.employeeSalaryRevision.create({
    data: {
      id: generateId(), organizationId, employeeId,
      grossAmount: gross, effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`), effectiveTo: null,
    },
  });
}

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { id: generateId(), name: 'Salary Draft Worker Test Org', code: `SDWTEST-${generateId()}` },
  });
  organizationId = org.id;
  const legalEntity = await prisma.legalEntity.create({
    data: {
      id: generateId(), organizationId, legalName: 'SDW Legal Entity',
      panNumber: 'SDWCD1234P', registeredAddress: 'Gandhinagar, Gujarat',
    },
  });
  legalEntityId = legalEntity.id;

  employeeAId = await makeEmployee('SDW-001', 'Asha Patel');
  employeeBId = await makeEmployee('SDW-002', 'Ravi Shah');
  const inactiveId = await makeEmployee('SDW-003', 'Former Person', 'INACTIVE');

  await giveSalary(employeeAId, '80000');
  await giveSalary(employeeBId, '50000');
  // Has a salary but is inactive — must not be drafted.
  await giveSalary(inactiveId, '40000');
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { organizationId } });
  // The outbox dispatcher spec runs in parallel and may already have turned
  // this spec's outbox events into notifications, which reference them.
  await prisma.notification.deleteMany({ where: { organizationId } });
  await prisma.outboxEvent.deleteMany({ where: { organizationId } });
  await prisma.salaryImportLine.deleteMany({ where: { organizationId } });
  await prisma.salaryImport.deleteMany({ where: { organizationId } });
  await prisma.employeeSalaryRevision.deleteMany({ where: { organizationId } });
  await prisma.employee.deleteMany({ where: { organizationId } });
  await prisma.legalEntity.deleteMany({ where: { organizationId } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
  await prisma.$disconnect();
});

describe('previousMonthStart', () => {
  it('returns the first of the month before, crossing a year boundary', () => {
    expect(previousMonthStart(new Date('2026-04-10T00:00:00.000Z')).toISOString().slice(0, 10)).toBe('2026-03-01');
    expect(previousMonthStart(new Date('2026-01-05T00:00:00.000Z')).toISOString().slice(0, 10)).toBe('2025-12-01');
    // The month that has ENDED, never the one still running.
    expect(previousMonthStart(new Date('2026-03-31T23:59:59.000Z')).toISOString().slice(0, 10)).toBe('2026-02-01');
  });
});

describe('runSalaryDraftGeneratorJob', () => {
  it('drafts the ended month from salary revisions, excluding inactive employees', async () => {
    await runSalaryDraftGeneratorJob(prisma, NOW);

    const batch = await prisma.salaryImport.findFirstOrThrow({
      where: { organizationId, legalEntityId, salaryMonth: TARGET_MONTH },
      include: { lines: true },
    });
    expect(batch.status).toBe('DRAFT');
    // A draft has posted nothing.
    expect(batch.journalEntryId).toBeNull();
    expect(batch.employeeCount).toBe(2);
    expect(batch.totalGrossAmount.toFixed(2)).toBe('130000.00');
    expect(new Set(batch.lines.map((l) => l.employeeId))).toEqual(new Set([employeeAId, employeeBId]));
  });

  it('is a no-op on every later tick — the month already has a batch', async () => {
    const before = await prisma.salaryImport.count({ where: { organizationId } });
    const result = await runSalaryDraftGeneratorJob(prisma, NOW);
    const after = await prisma.salaryImport.count({ where: { organizationId } });

    expect(after).toBe(before);
    expect(result.generated).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);
  });

  it('skips a month that has already been posted rather than drafting a duplicate', async () => {
    await prisma.salaryImport.updateMany({
      where: { organizationId, salaryMonth: TARGET_MONTH },
      data: { status: 'POSTED', journalEntryId: generateId() },
    });

    const result = await runSalaryDraftGeneratorJob(prisma, NOW);
    expect(result.generated).toBe(0);

    const count = await prisma.salaryImport.count({ where: { organizationId, salaryMonth: TARGET_MONTH } });
    expect(count).toBe(1);
  });

  it('creates nothing for a legal entity whose organization has no salaries on record', async () => {
    const emptyOrg = await prisma.organization.create({
      data: { id: generateId(), name: 'SDW Empty Org', code: `SDWEMPTY-${generateId()}` },
    });
    const emptyEntity = await prisma.legalEntity.create({
      data: {
        id: generateId(), organizationId: emptyOrg.id, legalName: 'SDW Empty Entity',
        panNumber: 'SDWEE1234P', registeredAddress: 'Ahmedabad, Gujarat',
      },
    });

    await runSalaryDraftGeneratorJob(prisma, NOW);

    // An empty batch would fail the head-count CHECK and, more to the point,
    // means nobody has a salary recorded — a setup problem, not a document.
    const count = await prisma.salaryImport.count({ where: { organizationId: emptyOrg.id } });
    expect(count).toBe(0);

    await prisma.legalEntity.deleteMany({ where: { id: emptyEntity.id } });
    await prisma.organization.deleteMany({ where: { id: emptyOrg.id } });
  });

  it("drafts each legal entity's own employees once the organization has several", async () => {
    // Runs last: a second legal entity means unassigned employees no longer count anywhere.
    const secondEntity = await prisma.legalEntity.create({
      data: { id: generateId(), organizationId, legalName: 'SDW Second Entity', panNumber: 'SDWSE1234P', registeredAddress: 'Surat, Gujarat' },
    });
    const secondEmployee = await prisma.employee.create({
      data: {
        id: generateId(), organizationId, legalEntityId: secondEntity.id, employeeCode: 'SDW-SECOND', fullName: 'Second Entity Person',
        joiningDate: new Date('2025-01-01T00:00:00.000Z'), status: 'ACTIVE',
      },
    });
    await giveSalary(secondEmployee.id, '55000');

    const later = new Date('2026-06-10T00:00:00.000Z');
    await runSalaryDraftGeneratorJob(prisma, later);

    const secondBatch = await prisma.salaryImport.findFirstOrThrow({
      where: { organizationId, legalEntityId: secondEntity.id, salaryMonth: previousMonthStart(later) },
      include: { lines: true },
    });
    expect(secondBatch.lines.map((l) => l.employeeId)).toEqual([secondEmployee.id]);
    // The first entity's employees have no legal entity set, so with two entities they are in no draft.
    const firstBatch = await prisma.salaryImport.count({ where: { organizationId, legalEntityId, salaryMonth: previousMonthStart(later) } });
    expect(firstBatch).toBe(0);
  });
});

