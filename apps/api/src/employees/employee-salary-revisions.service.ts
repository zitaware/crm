import { Injectable } from '@nestjs/common';
import { Prisma, generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type { EmployeeSalaryRevisionRow } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isConstraintViolation } from '../organization/constraint-error.util';

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function toRow(row: {
  id: string;
  employeeId: string;
  grossAmount: Prisma.Decimal;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  reason: string | null;
  createdAt: Date;
  version: number;
}): EmployeeSalaryRevisionRow {
  return {
    id: row.id,
    employeeId: row.employeeId,
    grossAmount: row.grossAmount.toFixed(2),
    effectiveFrom: toDateStr(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? toDateStr(row.effectiveTo) : null,
    isCurrent: row.effectiveTo === null,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

/**
 * Closes the open revision the day before `effectiveFrom`, opens the new one
 * and moves the display cache, inside the caller's transaction. The caller
 * has checked the dates; `revise` and the employee import (ADR-170) both
 * come through here, so there is still one writer.
 */
export async function applySalaryRevision(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; employeeId: string; grossAmount: Prisma.Decimal; effectiveFrom: Date; reason: string | null; actorId: string; correlationId: string },
): Promise<string> {
  const open = await tx.employeeSalaryRevision.findFirst({
    where: { organizationId: input.organizationId, employeeId: input.employeeId, effectiveTo: null },
  });
  if (open && input.effectiveFrom <= open.effectiveFrom) {
    throwAppError('VALIDATION_FAILED', `The current salary took effect on ${toDateStr(open.effectiveFrom)}. A revision must start after that.`);
  }
  if (open) {
    // The previous revision ends the day before the new one begins, so
    // the two periods abut without overlapping.
    const previousEnd = new Date(input.effectiveFrom);
    previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
    await tx.employeeSalaryRevision.update({
      where: { id: open.id },
      data: { effectiveTo: previousEnd, updatedBy: input.actorId, version: { increment: 1 } },
    });
  }

  const id = generateId();
  await tx.employeeSalaryRevision.create({
    data: {
      id,
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      grossAmount: input.grossAmount,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: null,
      reason: input.reason,
      createdBy: input.actorId,
    },
  });

  // The display cache follows its single writer.
  await tx.employee.update({
    where: { id: input.employeeId },
    data: { displayedSalaryAmount: input.grossAmount, updatedBy: input.actorId, version: { increment: 1 } },
  });

  await recordAuditEvent(tx, {
    organizationId: input.organizationId,
    entityType: 'EMPLOYEE',
    entityId: input.employeeId,
    action: 'EMPLOYEE_SALARY_REVISED',
    actorId: input.actorId,
    correlationId: input.correlationId,
    oldValues: open ? { grossAmount: open.grossAmount.toFixed(2), effectiveFrom: toDateStr(open.effectiveFrom) } : undefined,
    newValues: { grossAmount: input.grossAmount.toFixed(2), effectiveFrom: toDateStr(input.effectiveFrom), reason: input.reason },
  });
  return id;
}

/**
 * An employee's compensation history (ADR-098) — the table ADR-047
 * explicitly deferred "to when Salary Import is built".
 *
 * A revision is never edited. Raising someone's salary closes the open row
 * (`effectiveTo`) and inserts a new open one, in a single transaction, so
 * what somebody earned in a past month can never be rewritten by a later
 * change. That is the whole reason this exists rather than a mutable field.
 *
 * `Employee.displayedSalaryAmount` survives as a read-cache of the current
 * revision, and this service is its ONLY writer — which is what stops it
 * being a second, divergent truth.
 */
@Injectable()
export class EmployeeSalaryRevisionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(input: { organizationId: string; employeeId: string }): Promise<EmployeeSalaryRevisionRow[]> {
    const employee = await this.prisma.client.employee.findFirst({
      where: { id: input.employeeId, organizationId: input.organizationId, deletedAt: null },
    });
    if (!employee) throwAppError('NOT_FOUND', 'Employee not found.');

    const rows = await this.prisma.client.employeeSalaryRevision.findMany({
      where: { organizationId: input.organizationId, employeeId: input.employeeId },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(toRow);
  }

  /**
   * Records a new salary effective from a date, superseding the current one.
   *
   * The new revision must start strictly after the open one began —
   * otherwise the two would describe the same day and "what did this person
   * earn in March" would have two answers. Correcting a revision's own start
   * date is deliberately not offered here; that is a different operation
   * from a raise and would need its own rules about already-posted months.
   */
  async revise(input: {
    organizationId: string;
    employeeId: string;
    grossAmount: string;
    effectiveFrom: string;
    reason: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeSalaryRevisionRow> {
    const employee = await this.prisma.client.employee.findFirst({
      where: { id: input.employeeId, organizationId: input.organizationId, deletedAt: null },
    });
    if (!employee) throwAppError('NOT_FOUND', 'Employee not found.');

    const grossAmount = new Prisma.Decimal(input.grossAmount);
    if (grossAmount.isNegative()) throwAppError('VALIDATION_FAILED', 'Gross salary cannot be negative.');

    const effectiveFrom = toDate(input.effectiveFrom);
    if (employee.joiningDate && effectiveFrom < employee.joiningDate) {
      throwAppError('VALIDATION_FAILED', 'A salary cannot take effect before the employee joined.');
    }

    const open = await this.prisma.client.employeeSalaryRevision.findFirst({
      where: { organizationId: input.organizationId, employeeId: input.employeeId, effectiveTo: null },
    });
    if (open && effectiveFrom <= open.effectiveFrom) {
      throwAppError(
        'VALIDATION_FAILED',
        `The current salary took effect on ${toDateStr(open.effectiveFrom)}. A revision must start after that.`,
      );
    }

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const id = await applySalaryRevision(tx, {
          organizationId: input.organizationId,
          employeeId: input.employeeId,
          grossAmount,
          effectiveFrom,
          reason: input.reason?.trim() || null,
          actorId: input.actorId,
          correlationId: input.correlationId,
        });
        const created = await tx.employeeSalaryRevision.findFirstOrThrow({ where: { id } });
        return toRow(created);
      });
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'This employee already has an open salary revision. Reload and try again.');
      }
      throw error;
    }
  }

  /**
   * Each employee's gross salary effective for a given month, for everyone
   * with an open-or-covering revision.
   *
   * A revision covers a month when it started on or before the month ends
   * and had not already ended before the month began. Used by the salary
   * draft generator, which is why it returns a map rather than rows.
   */
  async grossByEmployeeForMonth(organizationId: string, month: Date): Promise<Map<string, Prisma.Decimal>> {
    const monthEnd = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
    const revisions = await this.prisma.client.employeeSalaryRevision.findMany({
      where: {
        organizationId,
        effectiveFrom: { lte: monthEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: month } }],
      },
      orderBy: { effectiveFrom: 'asc' },
    });
    // Later revisions win when two somehow overlap the same month — the
    // period rules make that impossible, but the read shouldn't depend on it.
    const byEmployee = new Map<string, Prisma.Decimal>();
    for (const revision of revisions) byEmployee.set(revision.employeeId, revision.grossAmount);
    return byEmployee;
  }
}
