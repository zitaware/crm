import { Injectable } from '@nestjs/common';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  FinancialYearPort,
  FinancialYearSummary,
  AccountingPeriodSummary,
  AccountingPeriodStatus,
  AccountingPeriodAction,
  AccountingPeriodTransitionSummary,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isConstraintViolation } from './constraint-error.util';

interface FinancialYearRow {
  id: string;
  legalEntityId: string;
  label: string;
  startDate: Date;
  endDate: Date;
  isCurrent: boolean;
  version: number;
}

interface AccountingPeriodRow {
  id: string;
  financialYearId: string;
  periodNumber: number;
  startDate: Date;
  endDate: Date;
  status: string;
  lockedAt: Date | null;
  lockedBy: string | null;
  reopenedAt: Date | null;
  reopenedBy: string | null;
  version: number;
}

interface AccountingPeriodTransitionRow {
  id: string;
  accountingPeriodId: string;
  previousStatus: string;
  newStatus: string;
  action: string;
  actorId: string;
  reason: string;
  createdAt: Date;
}

function toDateOnly(date: Date): string {
  const iso = date.toISOString();
  return iso.slice(0, 10);
}

function toFinancialYearSummary(row: FinancialYearRow): FinancialYearSummary {
  return {
    id: row.id,
    legalEntityId: row.legalEntityId,
    label: row.label,
    startDate: toDateOnly(row.startDate),
    endDate: toDateOnly(row.endDate),
    isCurrent: row.isCurrent,
    version: row.version,
  };
}

function toAccountingPeriodSummary(row: AccountingPeriodRow): AccountingPeriodSummary {
  return {
    id: row.id,
    financialYearId: row.financialYearId,
    periodNumber: row.periodNumber,
    startDate: toDateOnly(row.startDate),
    endDate: toDateOnly(row.endDate),
    status: row.status as AccountingPeriodStatus,
    lockedAt: row.lockedAt ? row.lockedAt.toISOString() : null,
    lockedBy: row.lockedBy,
    reopenedAt: row.reopenedAt ? row.reopenedAt.toISOString() : null,
    reopenedBy: row.reopenedBy,
    version: row.version,
  };
}

function toTransitionSummary(row: AccountingPeriodTransitionRow): AccountingPeriodTransitionSummary {
  return {
    id: row.id,
    accountingPeriodId: row.accountingPeriodId,
    previousStatus: row.previousStatus,
    newStatus: row.newStatus,
    action: row.action,
    actorId: row.actorId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Up to 12 consecutive calendar-month periods starting at `start`. The
 * last period's end date is truncated/extended to exactly match `end`, so a
 * financial year that doesn't start on a month boundary still tiles
 * cleanly with no gap or overlap against its own declared end date. A
 * year shorter than 12 months (ADR-150) gets one period per month it
 * touches. */
function generateMonthlyPeriods(
  start: Date,
  end: Date,
): Array<{ periodNumber: number; startDate: Date; endDate: Date }> {
  const periods: Array<{ periodNumber: number; startDate: Date; endDate: Date }> = [];
  let periodStart = start;
  for (let periodNumber = 1; periodNumber <= 12 && periodStart <= end; periodNumber++) {
    const periodEnd = new Date(
      Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0),
    );
    periods.push({ periodNumber, startDate: periodStart, endDate: periodEnd });
    periodStart = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1));
  }
  const lastPeriod = periods[periods.length - 1];
  if (lastPeriod) {
    lastPeriod.endDate = end;
  }
  return periods;
}

function addDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

const ALLOWED_TRANSITIONS: Record<
  AccountingPeriodAction,
  { from: AccountingPeriodStatus[]; to: AccountingPeriodStatus }
> = {
  SOFT_CLOSE: { from: ['OPEN'], to: 'SOFT_CLOSED' },
  LOCK: { from: ['SOFT_CLOSED'], to: 'LOCKED' },
  REOPEN: { from: ['SOFT_CLOSED', 'LOCKED'], to: 'OPEN' },
};

@Injectable()
export class FinancialYearService implements FinancialYearPort {
  constructor(private readonly prisma: PrismaService) {}

  async list(input: { organizationId: string; legalEntityId: string }): Promise<FinancialYearSummary[]> {
    const rows = await this.prisma.client.financialYear.findMany({
      where: { organizationId: input.organizationId, legalEntityId: input.legalEntityId },
      orderBy: { startDate: 'desc' },
    });
    return rows.map(toFinancialYearSummary);
  }

  async create(input: {
    organizationId: string;
    legalEntityId: string;
    label: string;
    startDate: string;
    endDate: string;
    setCurrent: boolean;
    actorId: string;
    correlationId: string;
  }): Promise<FinancialYearSummary> {
    const startDate = new Date(`${input.startDate}T00:00:00.000Z`);
    const endDate = new Date(`${input.endDate}T00:00:00.000Z`);
    const periods = generateMonthlyPeriods(startDate, endDate);

    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        if (input.setCurrent) {
          await tx.financialYear.updateMany({
            where: { legalEntityId: input.legalEntityId, isCurrent: true },
            data: { isCurrent: false, updatedBy: input.actorId },
          });
        }

        const financialYear = await tx.financialYear.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            legalEntityId: input.legalEntityId,
            label: input.label,
            startDate,
            endDate,
            isCurrent: input.setCurrent,
            createdBy: input.actorId,
          },
        });

        for (const period of periods) {
          await tx.accountingPeriod.create({
            data: {
              id: generateId(),
              organizationId: input.organizationId,
              financialYearId: financialYear.id,
              periodNumber: period.periodNumber,
              startDate: period.startDate,
              endDate: period.endDate,
              createdBy: input.actorId,
            },
          });
        }

        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'FINANCIAL_YEAR',
          entityId: financialYear.id,
          action: 'FINANCIAL_YEAR_CREATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { label: input.label, startDate: input.startDate, endDate: input.endDate },
        });

        return financialYear;
      });
      return toFinancialYearSummary(created);
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError(
          'VALIDATION_FAILED',
          'A financial year with this label already exists for this legal entity, or another financial year is already current.',
        );
      }
      throw error;
    }
  }

  /** The financial year covering `date`, created when none does (ADR-150):
   * the Indian 1 April – 31 March year, trimmed so it neither overlaps
   * the years either side nor leaves a gap, never made current. */
  async findOrCreateCovering(input: {
    organizationId: string;
    legalEntityId: string;
    date: string;
    actorId: string;
    correlationId: string;
  }): Promise<FinancialYearSummary> {
    const date = new Date(`${input.date}T00:00:00.000Z`);
    const scope = { organizationId: input.organizationId, legalEntityId: input.legalEntityId };
    const findCovering = () =>
      this.prisma.client.financialYear.findFirst({ where: { ...scope, startDate: { lte: date }, endDate: { gte: date } } });

    const existing = await findCovering();
    if (existing) return toFinancialYearSummary(existing);

    const startYear = date.getUTCMonth() >= 3 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
    let startDate = new Date(Date.UTC(startYear, 3, 1));
    let endDate = new Date(Date.UTC(startYear + 1, 2, 31));
    const previous = await this.prisma.client.financialYear.findFirst({
      where: { ...scope, endDate: { lt: date } },
      orderBy: { endDate: 'desc' },
    });
    const next = await this.prisma.client.financialYear.findFirst({
      where: { ...scope, startDate: { gt: date } },
      orderBy: { startDate: 'asc' },
    });
    if (previous && previous.endDate >= startDate) startDate = addDays(previous.endDate, 1);
    if (next && next.startDate <= endDate) endDate = addDays(next.startDate, -1);

    const standardLabel = `FY${startYear}-${String(startYear + 1).slice(2)}`;
    const isStandard =
      toDateOnly(startDate) === `${startYear}-04-01` && toDateOnly(endDate) === `${startYear + 1}-03-31`;
    try {
      return await this.create({
        ...scope,
        label: isStandard ? standardLabel : `${standardLabel} (${toDateOnly(startDate)} to ${toDateOnly(endDate)})`,
        startDate: toDateOnly(startDate),
        endDate: toDateOnly(endDate),
        setCurrent: false,
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    } catch (error) {
      // Another request created the same year first.
      const created = await findCovering();
      if (created) return toFinancialYearSummary(created);
      throw error;
    }
  }

  async setCurrentFinancialYear(input: {
    organizationId: string;
    legalEntityId: string;
    id: string;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<FinancialYearSummary> {
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await tx.financialYear.updateMany({
        where: { legalEntityId: input.legalEntityId, organizationId: input.organizationId, isCurrent: true },
        data: { isCurrent: false, updatedBy: input.actorId },
      });

      const { count } = await tx.financialYear.updateMany({
        where: {
          id: input.id,
          organizationId: input.organizationId,
          legalEntityId: input.legalEntityId,
          version: input.expectedVersion,
        },
        data: { isCurrent: true, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }

      const row = await tx.financialYear.findFirstOrThrow({
        where: { id: input.id, organizationId: input.organizationId },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'FINANCIAL_YEAR',
        entityId: input.id,
        action: 'FINANCIAL_YEAR_SET_CURRENT',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
      return row;
    });
    return toFinancialYearSummary(updated);
  }

  async listAccountingPeriods(input: {
    organizationId: string;
    financialYearId: string;
  }): Promise<AccountingPeriodSummary[]> {
    const rows = await this.prisma.client.accountingPeriod.findMany({
      where: { organizationId: input.organizationId, financialYearId: input.financialYearId },
      orderBy: { periodNumber: 'asc' },
    });
    return rows.map(toAccountingPeriodSummary);
  }

  async transitionAccountingPeriod(input: {
    organizationId: string;
    accountingPeriodId: string;
    action: AccountingPeriodAction;
    reason: string;
    actorId: string;
    correlationId: string;
  }): Promise<AccountingPeriodSummary> {
    try {
      const updated = await this.prisma.client.$transaction(async (tx) => {
        const period = await tx.accountingPeriod.findFirst({
          where: { id: input.accountingPeriodId, organizationId: input.organizationId },
        });
        if (!period) {
          throwAppError('NOT_FOUND', 'Accounting period not found.');
        }

        const transition = ALLOWED_TRANSITIONS[input.action];
        const currentStatus = period.status as AccountingPeriodStatus;
        if (!transition.from.includes(currentStatus)) {
          throwAppError(
            'INVALID_STATE_TRANSITION',
            `Cannot ${input.action} a period in status ${currentStatus}.`,
          );
        }

        if (input.action === 'REOPEN' && currentStatus === 'LOCKED' && period.lockedBy === input.actorId) {
          throwAppError('SELF_APPROVAL_NOT_ALLOWED', 'The actor who locked this period cannot reopen it.');
        }

        const data: Record<string, unknown> = {
          status: transition.to,
          updatedBy: input.actorId,
          version: { increment: 1 },
        };
        if (input.action === 'LOCK') {
          data.lockedAt = new Date();
          data.lockedBy = input.actorId;
          data.reopenedAt = null;
          data.reopenedBy = null;
        }
        if (input.action === 'REOPEN') {
          data.reopenedAt = new Date();
          data.reopenedBy = input.actorId;
        }

        const { count } = await tx.accountingPeriod.updateMany({
          where: { id: input.accountingPeriodId, organizationId: input.organizationId, status: currentStatus },
          data,
        });
        if (count === 0) {
          throwAppError('VERSION_CONFLICT', 'This period was changed by someone else. Reload and try again.');
        }

        const row = await tx.accountingPeriod.findFirstOrThrow({
          where: { id: input.accountingPeriodId, organizationId: input.organizationId },
        });

        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'ACCOUNTING_PERIOD',
          entityId: input.accountingPeriodId,
          action: `ACCOUNTING_PERIOD_${input.action}`,
          actorId: input.actorId,
          correlationId: input.correlationId,
          reason: input.reason,
          oldValues: { status: currentStatus },
          newValues: { status: transition.to },
        });

        await tx.accountingPeriodTransition.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            accountingPeriodId: input.accountingPeriodId,
            previousStatus: currentStatus,
            newStatus: transition.to,
            action: input.action,
            actorId: input.actorId,
            reason: input.reason,
            correlationId: input.correlationId,
          },
        });

        return row;
      });
      return toAccountingPeriodSummary(updated);
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'This transition is not allowed.');
      }
      throw error;
    }
  }

  async listAccountingPeriodTransitions(input: {
    organizationId: string;
    accountingPeriodId: string;
  }): Promise<AccountingPeriodTransitionSummary[]> {
    const rows = await this.prisma.client.accountingPeriodTransition.findMany({
      where: { organizationId: input.organizationId, accountingPeriodId: input.accountingPeriodId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toTransitionSummary);
  }
}
