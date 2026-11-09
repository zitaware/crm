import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeSalaryRevisionsService } from './employee-salary-revisions.service';

const prisma = new PrismaService();
const revisions = new EmployeeSalaryRevisionsService(prisma);

let organizationId: string;
let employeeId: string;
const actorId = generateId();

beforeAll(async () => {
  const org = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Salary Revision Test Org', code: `SALREV-${generateId()}` },
  });
  organizationId = org.id;
  const employee = await prisma.client.employee.create({
    data: {
      id: generateId(), organizationId, employeeCode: 'REV-001', fullName: 'Asha Patel',
      joiningDate: new Date('2025-01-01T00:00:00.000Z'),
    },
  });
  employeeId = employee.id;
});

afterAll(async () => {
  await prisma.client.auditEvent.deleteMany({ where: { organizationId } });
  await prisma.client.employeeSalaryRevision.deleteMany({ where: { organizationId } });
  await prisma.client.employee.deleteMany({ where: { organizationId } });
  await prisma.client.organization.deleteMany({ where: { id: organizationId } });
  await prisma.client.$disconnect();
});

function revise(grossAmount: string, effectiveFrom: string, reason?: string) {
  return revisions.revise({
    organizationId, employeeId, grossAmount, effectiveFrom,
    reason, actorId, correlationId: generateId(),
  });
}

describe('EmployeeSalaryRevisionsService', () => {
  it('records the first salary as the open revision, and caches it on the employee', async () => {
    const first = await revise('50000', '2025-01-01', 'Joining salary');
    expect(first.grossAmount).toBe('50000.00');
    expect(first.effectiveTo).toBeNull();
    expect(first.isCurrent).toBe(true);

    // displayedSalaryAmount survives as a read-cache with exactly one writer.
    const employee = await prisma.client.employee.findFirstOrThrow({ where: { id: employeeId } });
    expect(employee.displayedSalaryAmount?.toFixed(2)).toBe('50000.00');
  });

  it('closes the previous revision the day before the new one starts, never overlapping', async () => {
    const second = await revise('62000', '2025-07-01', 'Annual revision');
    expect(second.grossAmount).toBe('62000.00');
    expect(second.isCurrent).toBe(true);

    const all = await revisions.list({ organizationId, employeeId });
    expect(all).toHaveLength(2);
    const previous = all.find((r) => r.grossAmount === '50000.00')!;
    // Abuts without overlapping — the two periods must not both claim 1 July.
    expect(previous.effectiveTo).toBe('2025-06-30');
    expect(previous.isCurrent).toBe(false);
    // The past is never rewritten: the old figure is still 50,000.
    expect(previous.grossAmount).toBe('50000.00');
  });

  it('refuses a revision that starts on or before the current one, or before joining', async () => {
    await expect(revise('70000', '2025-07-01')).rejects.toThrow(/must start after/i);
    await expect(revise('70000', '2025-06-30')).rejects.toThrow(/must start after/i);
    await expect(revise('70000', '2024-12-31')).rejects.toThrow(/before the employee joined/i);
    await expect(revise('-1', '2026-01-01')).rejects.toThrow(/cannot be negative/i);
  });

  it('resolves the salary effective for a given month, including month boundaries', async () => {
    // 50,000 until 30 June 2025, then 62,000.
    const june = await revisions.grossByEmployeeForMonth(organizationId, new Date('2025-06-01T00:00:00.000Z'));
    expect(june.get(employeeId)?.toFixed(2)).toBe('50000.00');

    const july = await revisions.grossByEmployeeForMonth(organizationId, new Date('2025-07-01T00:00:00.000Z'));
    expect(july.get(employeeId)?.toFixed(2)).toBe('62000.00');

    // Long after: the open revision still applies, with no end date.
    const later = await revisions.grossByEmployeeForMonth(organizationId, new Date('2030-01-01T00:00:00.000Z'));
    expect(later.get(employeeId)?.toFixed(2)).toBe('62000.00');

    // Before anyone had a salary on record: nothing at all, rather than zero.
    const before = await revisions.grossByEmployeeForMonth(organizationId, new Date('2024-01-01T00:00:00.000Z'));
    expect(before.has(employeeId)).toBe(false);
  });

  it('never returns another organization’s employee', async () => {
    const otherOrg = await prisma.client.organization.create({
      data: { id: generateId(), name: 'Salary Revision Other Org', code: `SALREVO-${generateId()}` },
    });
    await expect(
      revisions.list({ organizationId: otherOrg.id, employeeId }),
    ).rejects.toThrow(/not found/i);
    await prisma.client.organization.deleteMany({ where: { id: otherOrg.id } });
  });
});
