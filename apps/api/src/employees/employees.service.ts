import { Injectable } from '@nestjs/common';
import { Money } from '@zitaware/accounting';
import { Prisma, generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type { EmployeeDetail, EmployeeImportPreview, EmployeePort, EmployeeSummary, LinkableEmployee } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isConstraintViolation } from '../organization/constraint-error.util';
import {
  buildEmployeeImportSample,
  decodeImportWorkbook,
  masterKey,
  NEW_MASTER_PREFIX,
  parseEmployeeWorkbook,
  resolveEmployeeImportRows,
  type ExistingEmployeeRef,
  type MasterRef,
  type ResolvedEmployeeImportRow,
} from './employee-import';
import { applySalaryRevision } from './employee-salary-revisions.service';

interface EmployeeRow {
  id: string;
  userId: string | null;
  legalEntityId: string | null;
  internalDepartmentId: string | null;
  designationId: string | null;
  employmentTypeId: string | null;
  employeeCode: string;
  fullName: string;
  isReimbursable: boolean;
  displayedSalaryAmount: { toString(): string } | null;
  joiningDate: Date | null;
  status: string;
  version: number;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toEmployeeSummary(row: EmployeeRow): EmployeeSummary {
  return {
    id: row.id,
    userId: row.userId,
    legalEntityId: row.legalEntityId,
    internalDepartmentId: row.internalDepartmentId,
    designationId: row.designationId,
    employmentTypeId: row.employmentTypeId,
    employeeCode: row.employeeCode,
    fullName: row.fullName,
    isReimbursable: row.isReimbursable,
    displayedSalaryAmount: row.displayedSalaryAmount
      ? Money.fromString(row.displayedSalaryAmount.toString()).toFixed()
      : null,
    joiningDate: row.joiningDate ? toDateOnly(row.joiningDate) : null,
    status: row.status as 'ACTIVE' | 'INACTIVE',
    version: row.version,
  };
}

@Injectable()
export class EmployeesService implements EmployeePort {
  constructor(private readonly prisma: PrismaService) {}

  /** ADR-154: an employee is assigned only to an active legal entity of the organization. */
  private async assertLegalEntity(organizationId: string, legalEntityId: string | undefined): Promise<void> {
    if (!legalEntityId) return;
    const legalEntity = await this.prisma.client.legalEntity.findFirst({
      where: { id: legalEntityId, organizationId, deletedAt: null, isActive: true },
    });
    if (!legalEntity) throwAppError('VALIDATION_FAILED', 'The selected legal entity does not exist or is inactive.');
  }

  async list(input: {
    organizationId: string;
    includeInactive: boolean | undefined;
  }): Promise<EmployeeSummary[]> {
    const rows = await this.prisma.client.employee.findMany({
      where: {
        organizationId: input.organizationId,
        deletedAt: null,
        ...(input.includeInactive ? {} : { status: 'ACTIVE' }),
      },
      orderBy: { fullName: 'asc' },
    });
    return rows.map(toEmployeeSummary);
  }

  async listLinkable(input: { organizationId: string }): Promise<LinkableEmployee[]> {
    const rows = await this.prisma.client.employee.findMany({
      where: { organizationId: input.organizationId, deletedAt: null, status: 'ACTIVE', userId: null },
      orderBy: { fullName: 'asc' },
      select: { id: true, employeeCode: true, fullName: true },
    });
    return rows;
  }

  async getDetail(input: { organizationId: string; id: string }): Promise<EmployeeDetail | null> {
    const row = await this.prisma.client.employee.findFirst({
      where: { id: input.id, organizationId: input.organizationId, deletedAt: null },
      include: {
        user: { include: { userRoles: { include: { role: true } } } },
      },
    });
    if (!row) {
      return null;
    }
    return {
      ...toEmployeeSummary(row),
      user: row.user
        ? {
            id: row.user.id,
            email: row.user.email,
            status: row.user.status,
            roleNames: row.user.userRoles.map((userRole) => userRole.role.name),
          }
        : null,
    };
  }

  async create(input: {
    organizationId: string;
    userId: string | undefined;
    legalEntityId?: string | undefined;
    internalDepartmentId: string | undefined;
    designationId: string | undefined;
    employmentTypeId: string | undefined;
    employeeCode: string;
    fullName: string;
    isReimbursable: boolean | undefined;
    displayedSalaryAmount: string | undefined;
    joiningDate: string;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeSummary> {
    await this.assertLegalEntity(input.organizationId, input.legalEntityId);
    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.employee.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            userId: input.userId ?? null,
            legalEntityId: input.legalEntityId ?? null,
            internalDepartmentId: input.internalDepartmentId ?? null,
            designationId: input.designationId ?? null,
            employmentTypeId: input.employmentTypeId ?? null,
            employeeCode: input.employeeCode,
            fullName: input.fullName,
            isReimbursable: input.isReimbursable ?? false,
            displayedSalaryAmount: input.displayedSalaryAmount
              ? Money.fromString(input.displayedSalaryAmount).toFixed()
              : null,
            joiningDate: new Date(`${input.joiningDate}T00:00:00.000Z`),
            createdBy: input.actorId,
          },
        });
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'EMPLOYEE',
          entityId: row.id,
          action: 'EMPLOYEE_CREATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { employeeCode: input.employeeCode, fullName: input.fullName },
        });
        return row;
      });
      return toEmployeeSummary(created);
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError(
          'VALIDATION_FAILED',
          'An employee with this code already exists, or the linked user already has an employee record, or the linked user does not belong to this organization.',
        );
      }
      throw error;
    }
  }

  async update(input: {
    organizationId: string;
    id: string;
    userId: string | undefined;
    legalEntityId?: string | undefined;
    internalDepartmentId: string | undefined;
    designationId: string | undefined;
    employmentTypeId: string | undefined;
    fullName: string | undefined;
    isReimbursable: boolean | undefined;
    displayedSalaryAmount: string | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeSummary> {
    await this.assertLegalEntity(input.organizationId, input.legalEntityId);
    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.userId !== undefined) data.userId = input.userId;
    if (input.legalEntityId !== undefined) data.legalEntityId = input.legalEntityId;
    if (input.internalDepartmentId !== undefined) data.internalDepartmentId = input.internalDepartmentId;
    if (input.designationId !== undefined) data.designationId = input.designationId;
    if (input.employmentTypeId !== undefined) data.employmentTypeId = input.employmentTypeId;
    if (input.fullName !== undefined) data.fullName = input.fullName;
    if (input.isReimbursable !== undefined) data.isReimbursable = input.isReimbursable;
    if (input.displayedSalaryAmount !== undefined) {
      data.displayedSalaryAmount = Money.fromString(input.displayedSalaryAmount).toFixed();
    }

    try {
      const updated = await this.prisma.client.$transaction(async (tx) => {
        const before = await tx.employee.findFirstOrThrow({
          where: { id: input.id, organizationId: input.organizationId },
        });
        const { count } = await tx.employee.updateMany({
          where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
          data,
        });
        if (count === 0) {
          throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
        }
        const row = await tx.employee.findFirstOrThrow({
          where: { id: input.id, organizationId: input.organizationId },
        });

        // Full old/new diff for every field this call touched — a prior
        // version only logged the new fullName, silently dropping every
        // other changed field (including salary) from the audit trail.
        const formatSalary = (value: { toString(): string } | null) =>
          value ? Money.fromString(value.toString()).toFixed() : null;
        const oldValues: Record<string, unknown> = {};
        const newValues: Record<string, unknown> = {};
        const track = (key: string, beforeValue: unknown, afterValue: unknown, touched: boolean) => {
          if (touched && beforeValue !== afterValue) {
            oldValues[key] = beforeValue;
            newValues[key] = afterValue;
          }
        };
        track('legalEntityId', before.legalEntityId, row.legalEntityId, input.legalEntityId !== undefined);
        track('internalDepartmentId', before.internalDepartmentId, row.internalDepartmentId, input.internalDepartmentId !== undefined);
        track('designationId', before.designationId, row.designationId, input.designationId !== undefined);
        track('employmentTypeId', before.employmentTypeId, row.employmentTypeId, input.employmentTypeId !== undefined);
        track('fullName', before.fullName, row.fullName, input.fullName !== undefined);
        track('isReimbursable', before.isReimbursable, row.isReimbursable, input.isReimbursable !== undefined);
        track(
          'displayedSalaryAmount',
          formatSalary(before.displayedSalaryAmount),
          formatSalary(row.displayedSalaryAmount),
          input.displayedSalaryAmount !== undefined,
        );
        track('userId', before.userId, row.userId, input.userId !== undefined);

        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'EMPLOYEE',
          entityId: row.id,
          action: 'EMPLOYEE_UPDATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          oldValues,
          newValues,
        });
        return row;
      });
      return toEmployeeSummary(updated);
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError(
          'VALIDATION_FAILED',
          'The linked user already has an employee record, or does not belong to this organization.',
        );
      }
      throw error;
    }
  }

  async setStatus(input: {
    organizationId: string;
    id: string;
    status: 'ACTIVE' | 'INACTIVE';
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.employee.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: {
          status: input.status,
          updatedBy: input.actorId,
          version: { increment: 1 },
        },
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'EMPLOYEE',
        entityId: input.id,
        action: input.status === 'ACTIVE' ? 'EMPLOYEE_ACTIVATED' : 'EMPLOYEE_DEACTIVATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }

  async legalEntityOfUser(input: { organizationId: string; userId: string }): Promise<string | null> {
    const employee = await this.prisma.client.employee.findFirst({
      where: { organizationId: input.organizationId, userId: input.userId, deletedAt: null },
      select: { legalEntityId: true },
    });
    return employee?.legalEntityId ?? null;
  }

  async downloadImportSample(): Promise<{ filename: string; contentBase64: string }> {
    const buffer = await buildEmployeeImportSample();
    return { filename: 'employee-import-sample.xlsx', contentBase64: buffer.toString('base64') };
  }

  async previewImport(input: { organizationId: string; contentBase64: string }): Promise<EmployeeImportPreview> {
    const loaded = await this.loadImport(input.organizationId, input.contentBase64);
    return loaded.preview;
  }

  /**
   * New codes become employees; a code already here updates that employee
   * with the filled cells, and a different salary becomes a revision from
   * its effective date (ADR-170). One transaction: all rows or none.
   */
  async importRows(input: {
    organizationId: string;
    contentBase64: string;
    actorId: string;
    correlationId: string;
  }): Promise<{ created: number; updated: number; unchanged: number }> {
    const loaded = await this.loadImport(input.organizationId, input.contentBase64);
    if (loaded.preview.rows.length === 0) {
      throwAppError('VALIDATION_FAILED', 'The sheet has no employee rows.');
    }
    if (loaded.preview.errorCount > 0) {
      throwAppError('VALIDATION_FAILED', 'Fix the rows marked in the preview before importing.');
    }
    const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

    try {
      await this.prisma.client.$transaction(async (tx) => {
        // Departments and designations the sheet names that are not in Masters yet, added first (ADR-189).
        const addedIds = new Map<string, string>();
        const addMasters = async (kind: 'internal_departments' | 'designations', names: string[]) => {
          if (names.length === 0) return;
          const delegate = kind === 'internal_departments' ? tx.internalDepartment : tx.designation;
          const taken = new Set(
            (await (delegate as typeof tx.designation).findMany({ where: { organizationId: input.organizationId }, select: { code: true } })).map((m) => m.code),
          );
          for (const name of names) {
            const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'master';
            let code = base;
            for (let n = 2; taken.has(code); n += 1) code = `${base}_${n}`;
            taken.add(code);
            const id = generateId();
            await (delegate as typeof tx.designation).create({ data: { id, organizationId: input.organizationId, code, name, description: 'Added by the employee import.', sortOrder: 0, createdBy: input.actorId } });
            await recordAuditEvent(tx, {
              organizationId: input.organizationId,
              entityType: kind.toUpperCase(),
              entityId: id,
              action: 'MASTER_CREATED',
              actorId: input.actorId,
              correlationId: input.correlationId,
              newValues: { code, name, source: 'EMPLOYEE_IMPORT' },
            });
            addedIds.set(`${kind}|${masterKey(name)}`, id);
          }
        };
        await addMasters('internal_departments', loaded.preview.newDepartmentNames);
        await addMasters('designations', loaded.preview.newDesignationNames);
        const realId = (kind: 'internal_departments' | 'designations', id: string | null | undefined) =>
          id && id.startsWith(NEW_MASTER_PREFIX) ? (addedIds.get(`${kind}|${masterKey(id.slice(NEW_MASTER_PREFIX.length))}`) ?? null) : id;
        for (const row of loaded.ready) {
          if (row.kind === 'CREATE') {
            row.internalDepartmentId = realId('internal_departments', row.internalDepartmentId) ?? null;
            row.designationId = realId('designations', row.designationId) ?? null;
          } else {
            if (row.update.internalDepartmentId) row.update.internalDepartmentId = realId('internal_departments', row.update.internalDepartmentId)!;
            if (row.update.designationId) row.update.designationId = realId('designations', row.update.designationId)!;
          }
        }

        for (const row of loaded.ready) {
          if (row.kind === 'CREATE') {
            const id = generateId();
            await tx.employee.create({
              data: {
                id,
                organizationId: input.organizationId,
                legalEntityId: row.legalEntityId,
                internalDepartmentId: row.internalDepartmentId,
                designationId: row.designationId,
                employmentTypeId: row.employmentTypeId,
                employeeCode: row.employeeCode,
                fullName: row.fullName,
                isReimbursable: row.isReimbursable,
                joiningDate: row.joiningDate ? day(row.joiningDate) : null,
                status: row.status,
                createdBy: input.actorId,
              },
            });
            await recordAuditEvent(tx, {
              organizationId: input.organizationId,
              entityType: 'EMPLOYEE',
              entityId: id,
              action: 'EMPLOYEE_CREATED',
              actorId: input.actorId,
              correlationId: input.correlationId,
              newValues: { employeeCode: row.employeeCode, fullName: row.fullName, source: 'EXCEL_IMPORT' },
            });
            if (row.salary) {
              await applySalaryRevision(tx, {
                organizationId: input.organizationId,
                employeeId: id,
                grossAmount: new Prisma.Decimal(row.salary.amount),
                effectiveFrom: day(row.salary.effectiveFrom),
                reason: 'Imported from Excel',
                actorId: input.actorId,
                correlationId: input.correlationId,
              });
            }
            continue;
          }

          const fields = Object.keys(row.update);
          if (fields.length > 0) {
            const before = await tx.employee.findFirstOrThrow({ where: { id: row.employeeId, organizationId: input.organizationId } });
            const { joiningDate, ...rest } = row.update;
            const { count } = await tx.employee.updateMany({
              where: { id: row.employeeId, organizationId: input.organizationId, version: row.version },
              data: { ...rest, ...(joiningDate ? { joiningDate: day(joiningDate) } : {}), updatedBy: input.actorId, version: { increment: 1 } },
            });
            if (count === 0) throwAppError('VERSION_CONFLICT', `Employee ${row.employeeCode} was changed by someone else while importing. Preview the file again.`);
            const old = before as unknown as Record<string, unknown>;
            await recordAuditEvent(tx, {
              organizationId: input.organizationId,
              entityType: 'EMPLOYEE',
              entityId: row.employeeId,
              action: 'EMPLOYEE_UPDATED',
              actorId: input.actorId,
              correlationId: input.correlationId,
              oldValues: Object.fromEntries(fields.map((f) => [f, f === 'joiningDate' ? (before.joiningDate ? toDateOnly(before.joiningDate) : null) : old[f]])),
              newValues: { ...row.update, source: 'EXCEL_IMPORT' },
            });
          }
          if (row.salary) {
            await applySalaryRevision(tx, {
              organizationId: input.organizationId,
              employeeId: row.employeeId,
              grossAmount: new Prisma.Decimal(row.salary.amount),
              effectiveFrom: day(row.salary.effectiveFrom),
              reason: 'Imported from Excel',
              actorId: input.actorId,
              correlationId: input.correlationId,
            });
          }
        }
      });
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'An employee code in this file was added meanwhile. Preview the file again.');
      }
      throw error;
    }
    const { createCount, updateCount, unchangedCount } = loaded.preview;
    return { created: createCount, updated: updateCount, unchanged: unchangedCount };
  }

  private async loadImport(organizationId: string, contentBase64: string): Promise<{
    preview: EmployeeImportPreview;
    ready: ResolvedEmployeeImportRow[];
  }> {
    let buffer: Buffer;
    try {
      buffer = decodeImportWorkbook(contentBase64);
    } catch (error) {
      throwAppError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Choose an Excel file.');
    }
    const parsed = await parseEmployeeWorkbook(buffer);
    if (!parsed.ok) throwAppError('VALIDATION_FAILED', parsed.message);

    const where = { organizationId, deletedAt: null };
    const [departments, designations, employmentTypes, employees, legalEntities] = await Promise.all([
      this.prisma.client.internalDepartment.findMany({ where, select: { id: true, code: true, name: true, isActive: true } }),
      this.prisma.client.designation.findMany({ where, select: { id: true, code: true, name: true, isActive: true } }),
      this.prisma.client.employmentType.findMany({ where, select: { id: true, code: true, name: true, isActive: true } }),
      this.prisma.client.employee.findMany({
        where: { organizationId },
        select: {
          id: true, version: true, deletedAt: true, employeeCode: true, fullName: true, legalEntityId: true, internalDepartmentId: true, designationId: true,
          employmentTypeId: true, isReimbursable: true, status: true, joiningDate: true, displayedSalaryAmount: true,
          salaryRevisions: { where: { effectiveTo: null }, select: { grossAmount: true, effectiveFrom: true } },
        },
      }),
      this.prisma.client.legalEntity.findMany({ where, select: { id: true, panNumber: true, legalName: true, isActive: true } }),
    ]);
    return resolveEmployeeImportRows(
      parsed.rows,
      {
        departments: departments satisfies MasterRef[],
        designations: designations satisfies MasterRef[],
        employmentTypes: employmentTypes satisfies MasterRef[],
        // Matched by legal name or PAN.
        legalEntities: legalEntities.map((e) => ({ id: e.id, code: e.panNumber, name: e.legalName, isActive: e.isActive })),
      },
      new Map(
        employees.map((e): [string, ExistingEmployeeRef] => {
          const open = e.salaryRevisions[0];
          return [
            e.employeeCode,
            {
              id: e.id,
              version: e.version,
              deleted: e.deletedAt !== null,
              fullName: e.fullName,
              legalEntityId: e.legalEntityId,
              internalDepartmentId: e.internalDepartmentId,
              designationId: e.designationId,
              employmentTypeId: e.employmentTypeId,
              isReimbursable: e.isReimbursable,
              status: e.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
              joiningDate: e.joiningDate ? toDateOnly(e.joiningDate) : null,
              currentSalary: open
                ? { amount: open.grossAmount.toString(), effectiveFrom: toDateOnly(open.effectiveFrom) }
                : e.displayedSalaryAmount
                  ? { amount: e.displayedSalaryAmount.toString(), effectiveFrom: null }
                  : null,
            },
          ];
        }),
      ),
    );
  }
}
