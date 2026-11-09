import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { EMPLOYEE_IMPORT_HEADERS } from './employee-import';
import { EmployeesService } from './employees.service';

const prisma = new PrismaService();
const employees = new EmployeesService(prisma);

let organizationId: string;
const actorId = generateId();

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Employees Test Org', code: `EMPTEST-${generateId()}` },
  });
  organizationId = organization.id;
});

afterAll(async () => {
  await prisma.client.auditEvent.deleteMany({ where: { organizationId } });
  await prisma.client.userRole.deleteMany({ where: { organizationId } });
  await prisma.client.role.deleteMany({ where: { organizationId } });
  await prisma.client.employeeSalaryRevision.deleteMany({ where: { organizationId } });
  await prisma.client.employee.deleteMany({ where: { organizationId } });
  await prisma.client.legalEntity.deleteMany({ where: { organizationId } });
  await prisma.client.internalDepartment.deleteMany({ where: { organizationId } });
  await prisma.client.designation.deleteMany({ where: { organizationId } });
  await prisma.client.employmentType.deleteMany({ where: { organizationId } });
  await prisma.client.user.deleteMany({ where: { organizationId } });
  await prisma.client.organization.delete({ where: { id: organizationId } });
  await prisma.client.$disconnect();
});

describe('EmployeesService', () => {
  it('creates an employee with a decimal-string displayed salary and lists only active by default', async () => {
    const created = await employees.create({
      organizationId,
      userId: undefined,
      internalDepartmentId: undefined,
      designationId: undefined,
      employmentTypeId: undefined,
      employeeCode: 'EMP001',
      fullName: 'Asha Verma',
      isReimbursable: true,
      displayedSalaryAmount: '75000.5',
      joiningDate: '2026-01-15',
      actorId,
      correlationId: generateId(),
    });

    expect(created.employeeCode).toBe('EMP001');
    expect(created.displayedSalaryAmount).toBe('75000.5000');
    expect(created.status).toBe('ACTIVE');

    const list = await employees.list({ organizationId, includeInactive: false });
    expect(list.some((row) => row.id === created.id)).toBe(true);
  });

  it('rejects a duplicate employee code within the same organization', async () => {
    await employees.create({
      organizationId,
      userId: undefined,
      internalDepartmentId: undefined,
      designationId: undefined,
      employmentTypeId: undefined,
      employeeCode: 'EMP002',
      fullName: 'First Employee',
      isReimbursable: undefined,
      displayedSalaryAmount: undefined,
      joiningDate: '2026-01-01',
      actorId,
      correlationId: generateId(),
    });

    await expect(
      employees.create({
        organizationId,
        userId: undefined,
        internalDepartmentId: undefined,
        designationId: undefined,
        employmentTypeId: undefined,
        employeeCode: 'EMP002',
        fullName: 'Second Employee',
        isReimbursable: undefined,
        displayedSalaryAmount: undefined,
        joiningDate: '2026-01-01',
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('already exists');
  });

  it('sets an employee to INACTIVE and excludes them from the default list', async () => {
    const created = await employees.create({
      organizationId,
      userId: undefined,
      internalDepartmentId: undefined,
      designationId: undefined,
      employmentTypeId: undefined,
      employeeCode: 'EMP003',
      fullName: 'Temp Employee',
      isReimbursable: undefined,
      displayedSalaryAmount: undefined,
      joiningDate: '2026-01-01',
      actorId,
      correlationId: generateId(),
    });

    await employees.setStatus({
      organizationId,
      id: created.id,
      status: 'INACTIVE',
      expectedVersion: created.version,
      actorId,
      correlationId: generateId(),
    });

    const activeList = await employees.list({ organizationId, includeInactive: false });
    expect(activeList.some((row) => row.id === created.id)).toBe(false);

    const fullList = await employees.list({ organizationId, includeInactive: true });
    const found = fullList.find((row) => row.id === created.id);
    expect(found?.status).toBe('INACTIVE');
  });

  it('enforces at most one employee per user, with organization consistency', async () => {
    const user = await prisma.client.user.create({
      data: {
        id: generateId(),
        organizationId,
        email: `employee-link-${generateId()}@zitaware.test`,
        passwordHash: 'test-hash',
        displayName: 'Linked User',
        status: 'ACTIVE',
      },
    });

    const first = await employees.create({
      organizationId,
      userId: user.id,
      internalDepartmentId: undefined,
      designationId: undefined,
      employmentTypeId: undefined,
      employeeCode: 'EMP-LINKED-1',
      fullName: 'Linked Employee One',
      isReimbursable: undefined,
      displayedSalaryAmount: undefined,
      joiningDate: '2026-01-01',
      actorId,
      correlationId: generateId(),
    });
    expect(first.userId).toBe(user.id);

    await expect(
      employees.create({
        organizationId,
        userId: user.id,
        internalDepartmentId: undefined,
        designationId: undefined,
        employmentTypeId: undefined,
        employeeCode: 'EMP-LINKED-2',
        fullName: 'Linked Employee Two',
        isReimbursable: undefined,
        displayedSalaryAmount: undefined,
        joiningDate: '2026-01-01',
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow();

    const otherOrg = await prisma.client.organization.create({
      data: { id: generateId(), name: 'Other Org', code: `OTHERORG-${generateId()}` },
    });
    const otherOrgUser = await prisma.client.user.create({
      data: {
        id: generateId(),
        organizationId: otherOrg.id,
        email: `other-org-${generateId()}@zitaware.test`,
        passwordHash: 'test-hash',
        displayName: 'Other Org User',
        status: 'ACTIVE',
      },
    });

    await expect(
      employees.create({
        organizationId,
        userId: otherOrgUser.id,
        internalDepartmentId: undefined,
        designationId: undefined,
        employmentTypeId: undefined,
        employeeCode: 'EMP-CROSSORG',
        fullName: 'Cross Org Employee',
        isReimbursable: undefined,
        displayedSalaryAmount: undefined,
        joiningDate: '2026-01-01',
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow();

    await prisma.client.user.deleteMany({ where: { organizationId: otherOrg.id } });
    await prisma.client.organization.delete({ where: { id: otherOrg.id } });
  });

  it('update() records a full old/new diff in the audit event, not just fullName', async () => {
    const created = await employees.create({
      organizationId,
      userId: undefined,
      internalDepartmentId: undefined,
      designationId: undefined,
      employmentTypeId: undefined,
      employeeCode: 'EMP-AUDIT-1',
      fullName: 'Audit Test Employee',
      isReimbursable: false,
      displayedSalaryAmount: '50000',
      joiningDate: '2026-01-01',
      actorId,
      correlationId: generateId(),
    });

    await employees.update({
      organizationId,
      id: created.id,
      userId: undefined,
      internalDepartmentId: undefined,
      designationId: undefined,
      employmentTypeId: undefined,
      fullName: undefined,
      isReimbursable: undefined,
      displayedSalaryAmount: '55000',
      expectedVersion: created.version,
      actorId,
      correlationId: generateId(),
    });

    const events = await prisma.client.auditEvent.findMany({
      where: { organizationId, entityType: 'EMPLOYEE', entityId: created.id, action: 'EMPLOYEE_UPDATED' },
    });
    expect(events).toHaveLength(1);
    const oldValues = events[0]!.oldValues as Record<string, unknown>;
    const newValues = events[0]!.newValues as Record<string, unknown>;
    expect(oldValues.displayedSalaryAmount).toBe('50000.0000');
    expect(newValues.displayedSalaryAmount).toBe('55000.0000');
    // fullName was not part of this update — must not appear in the diff.
    expect(oldValues.fullName).toBeUndefined();
    expect(newValues.fullName).toBeUndefined();
  });

  it('getDetail composes the linked user (email, status, roles) or returns null when unlinked', async () => {
    const unlinked = await employees.create({
      organizationId,
      userId: undefined,
      internalDepartmentId: undefined,
      designationId: undefined,
      employmentTypeId: undefined,
      employeeCode: 'EMP-DETAIL-1',
      fullName: 'Unlinked Detail Employee',
      isReimbursable: undefined,
      displayedSalaryAmount: undefined,
      joiningDate: '2026-01-01',
      actorId,
      correlationId: generateId(),
    });
    const unlinkedDetail = await employees.getDetail({ organizationId, id: unlinked.id });
    expect(unlinkedDetail?.user).toBeNull();

    const role = await prisma.client.role.create({
      data: { id: generateId(), organizationId, name: `Detail Test Role ${generateId()}`, isSystem: false },
    });
    const user = await prisma.client.user.create({
      data: {
        id: generateId(),
        organizationId,
        email: `employee-detail-${generateId()}@zitaware.test`,
        passwordHash: 'test-hash',
        displayName: 'Detail Linked User',
        status: 'ACTIVE',
      },
    });
    await prisma.client.userRole.create({
      data: { id: generateId(), organizationId, userId: user.id, roleId: role.id },
    });
    const linked = await employees.create({
      organizationId,
      userId: user.id,
      internalDepartmentId: undefined,
      designationId: undefined,
      employmentTypeId: undefined,
      employeeCode: 'EMP-DETAIL-2',
      fullName: 'Linked Detail Employee',
      isReimbursable: undefined,
      displayedSalaryAmount: undefined,
      joiningDate: '2026-01-01',
      actorId,
      correlationId: generateId(),
    });

    const linkedDetail = await employees.getDetail({ organizationId, id: linked.id });
    expect(linkedDetail?.user?.email).toBe(user.email);
    expect(linkedDetail?.user?.status).toBe('ACTIVE');
    expect(linkedDetail?.user?.roleNames).toEqual([role.name]);

    expect(await employees.getDetail({ organizationId, id: generateId() })).toBeNull();
  });

  it('imports every employee field from Excel and saves nothing when any row is invalid', async () => {
    const department = await prisma.client.internalDepartment.create({
      data: { id: generateId(), organizationId, code: 'ACC', name: 'Accounts' },
    });
    const designation = await prisma.client.designation.create({
      data: { id: generateId(), organizationId, code: 'ACCT', name: 'Accountant' },
    });
    const employmentType = await prisma.client.employmentType.create({
      data: { id: generateId(), organizationId, code: 'FT', name: 'Full-time' },
    });
    const workbookBase64 = async (rows: unknown[][]) => {
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet('Employees');
      sheet.addRow([...EMPLOYEE_IMPORT_HEADERS]);
      for (const row of rows) sheet.addRow(row);
      return Buffer.from(await book.xlsx.writeBuffer()).toString('base64');
    };

    const invalid = await workbookBase64([
      ['EMP-XLS-1', 'Imported One', 'Accounts', 'Accountant', 'Full-time', 'Yes', '50000.50', '2026-04-01', 'ACTIVE'],
      ['EMP-XLS-2', 'Imported Two', '', '', 'Missing Type', 'No', '', '01/05/2026', 'INACTIVE'],
    ]);
    const blocked = await employees.previewImport({ organizationId, contentBase64: invalid });
    expect(blocked.validCount).toBe(1);
    expect(blocked.errorCount).toBe(1);
    expect(blocked.rows[1]?.errors.join(' ')).toContain('was not found');
    await expect(
      employees.importRows({ organizationId, contentBase64: invalid, actorId, correlationId: generateId() }),
    ).rejects.toThrow(/preview/);
    expect(await prisma.client.employee.findFirst({ where: { organizationId, employeeCode: 'EMP-XLS-1' } })).toBeNull();

    const valid = await workbookBase64([
      ['EMP-XLS-1', 'Imported One', 'ACC', 'Accountant', 'Full-time', 'Yes', '50000.50', '2026-04-01', 'ACTIVE'],
      ['EMP-XLS-2', 'Imported Two', '', '', '', 'No', '', '01/05/2026', 'INACTIVE'],
    ]);
    const ready = await employees.previewImport({ organizationId, contentBase64: valid });
    expect(ready.errorCount).toBe(0);
    expect(ready.validCount).toBe(2);
    expect(await employees.importRows({ organizationId, contentBase64: valid, actorId, correlationId: generateId() })).toEqual({
      created: 2,
      updated: 0,
      unchanged: 0,
    });

    const first = await prisma.client.employee.findFirstOrThrow({ where: { organizationId, employeeCode: 'EMP-XLS-1' } });
    expect(first.fullName).toBe('Imported One');
    expect(first.internalDepartmentId).toBe(department.id);
    expect(first.designationId).toBe(designation.id);
    expect(first.employmentTypeId).toBe(employmentType.id);
    expect(first.isReimbursable).toBe(true);
    expect(first.displayedSalaryAmount?.toFixed(4)).toBe('50000.5000');
    expect(first.joiningDate?.toISOString().slice(0, 10)).toBe('2026-04-01');
    expect(first.status).toBe('ACTIVE');
    const revision = await prisma.client.employeeSalaryRevision.findFirstOrThrow({ where: { employeeId: first.id } });
    expect(revision.grossAmount.toFixed(4)).toBe('50000.5000');
    expect(revision.effectiveFrom.toISOString().slice(0, 10)).toBe('2026-04-01');
    expect(revision.reason).toBe('Imported from Excel');

    const second = await prisma.client.employee.findFirstOrThrow({ where: { organizationId, employeeCode: 'EMP-XLS-2' } });
    expect(second.status).toBe('INACTIVE');
    expect(second.internalDepartmentId).toBeNull();
    expect(second.displayedSalaryAmount).toBeNull();
    expect(second.isReimbursable).toBe(false);
    expect(await prisma.client.employeeSalaryRevision.count({ where: { employeeId: second.id } })).toBe(0);

    // The same file again changes nothing (ADR-170).
    const again = await employees.previewImport({ organizationId, contentBase64: valid });
    expect([again.errorCount, again.unchangedCount]).toEqual([0, 2]);

    // A new salary with its date becomes a revision; the old one closes the day before.
    const raise = await workbookBase64([['EMP-XLS-1', 'Imported One', '', '', '', '', '60000', '', '', '', '01/08/2026']]);
    expect(await employees.importRows({ organizationId, contentBase64: raise, actorId, correlationId: generateId() })).toEqual({ created: 0, updated: 1, unchanged: 0 });
    const revisions = await prisma.client.employeeSalaryRevision.findMany({ where: { employeeId: first.id }, orderBy: { effectiveFrom: 'asc' } });
    expect(revisions.map((r) => [r.grossAmount.toFixed(2), r.effectiveFrom.toISOString().slice(0, 10), r.effectiveTo?.toISOString().slice(0, 10) ?? null])).toEqual([
      ['50000.50', '2026-04-01', '2026-07-31'],
      ['60000.00', '2026-08-01', null],
    ]);
    const raised = await prisma.client.employee.findFirstOrThrow({ where: { id: first.id } });
    expect([raised.displayedSalaryAmount?.toFixed(2), raised.isReimbursable, raised.internalDepartmentId]).toEqual(['60000.00', true, department.id]);
  });

  it('assigns an employee to an active legal entity and audits a change', async () => {
    const entity = await prisma.client.legalEntity.create({
      data: { id: generateId(), organizationId, legalName: 'Employees Entity Pvt Ltd', panNumber: 'ABCPE1234E', registeredAddress: 'Ahmedabad' },
    });
    const base = {
      organizationId, userId: undefined, internalDepartmentId: undefined, designationId: undefined, employmentTypeId: undefined,
      isReimbursable: undefined, displayedSalaryAmount: undefined, joiningDate: '2026-01-15', actorId,
    };
    const created = await employees.create({ ...base, legalEntityId: entity.id, employeeCode: 'EMP-LE-1', fullName: 'Entity Person', correlationId: generateId() });
    expect(created.legalEntityId).toBe(entity.id);

    await expect(
      employees.create({ ...base, legalEntityId: generateId(), employeeCode: 'EMP-LE-2', fullName: 'Nowhere Person', correlationId: generateId() }),
    ).rejects.toThrow('legal entity does not exist or is inactive');

    const unassigned = await employees.create({ ...base, employeeCode: 'EMP-LE-3', fullName: 'Later Person', correlationId: generateId() });
    expect(unassigned.legalEntityId).toBeNull();
    const assigned = await employees.update({
      organizationId, id: unassigned.id, userId: undefined, legalEntityId: entity.id, internalDepartmentId: undefined,
      designationId: undefined, employmentTypeId: undefined, fullName: undefined, isReimbursable: undefined,
      displayedSalaryAmount: undefined, expectedVersion: unassigned.version, actorId, correlationId: generateId(),
    });
    expect(assigned.legalEntityId).toBe(entity.id);
    const event = await prisma.client.auditEvent.findFirst({ where: { organizationId, entityId: unassigned.id, action: 'EMPLOYEE_UPDATED' } });
    expect(event?.newValues).toMatchObject({ legalEntityId: entity.id });
  });
  it('adds a missing department and designation once while importing, matched without case or extra spaces', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Employees');
    sheet.addRow([...EMPLOYEE_IMPORT_HEADERS]);
    sheet.addRow(['EMP-NEW-1', 'Mehul New', 'Dot net', 'Manager (BA)', '', 'Yes', '', '6/11/2024', '']);
    sheet.addRow(['EMP-NEW-2', 'Tej New', 'dot  NET', 'manager (ba)', '', 'Yes', '', '7/10/26', '']);
    const contentBase64 = Buffer.from(await book.xlsx.writeBuffer()).toString('base64');

    const preview = await employees.previewImport({ organizationId, contentBase64 });
    expect([preview.errorCount, preview.newDepartmentNames, preview.newDesignationNames]).toEqual([0, ['Dot net'], ['Manager (BA)']]);
    expect(await prisma.client.internalDepartment.count({ where: { organizationId, name: 'Dot net' } })).toBe(0);

    expect(await employees.importRows({ organizationId, contentBase64, actorId, correlationId: generateId() })).toMatchObject({ created: 2 });
    const departments = await prisma.client.internalDepartment.findMany({ where: { organizationId, name: { equals: 'dot net', mode: 'insensitive' } } });
    const designations = await prisma.client.designation.findMany({ where: { organizationId, name: { equals: 'manager (ba)', mode: 'insensitive' } } });
    expect([departments.map((d) => [d.name, d.code]), designations.map((d) => d.name)]).toEqual([[['Dot net', 'dot_net']], ['Manager (BA)']]);
    const imported = await prisma.client.employee.findMany({ where: { organizationId, employeeCode: { in: ['EMP-NEW-1', 'EMP-NEW-2'] } }, orderBy: { employeeCode: 'asc' } });
    expect(imported.map((e) => [e.internalDepartmentId, e.designationId, e.joiningDate?.toISOString().slice(0, 10)])).toEqual([
      [departments[0]!.id, designations[0]!.id, '2024-11-06'],
      [departments[0]!.id, designations[0]!.id, '2026-10-07'],
    ]);
    expect(await prisma.client.auditEvent.count({ where: { organizationId, action: 'MASTER_CREATED', entityId: { in: [departments[0]!.id, designations[0]!.id] } } })).toBe(2);

    // The same sheet again finds them in Masters: nothing new, nothing added twice.
    const again = await employees.previewImport({ organizationId, contentBase64 });
    expect([again.newDepartmentNames, again.newDesignationNames]).toEqual([[], []]);
  });
});

