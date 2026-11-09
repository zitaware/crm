import { Prisma } from '@prisma/client';

export type OpexFrequency = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface OpexScheduleInput {
  approvedAmount: Prisma.Decimal;
  frequency: OpexFrequency;
  installmentCount: number;
  scheduleStartDate: Date;
  firstInvoiceDate: Date;
}

export interface OpexScheduleRow {
  sequenceNumber: number;
  servicePeriodStart: Date;
  servicePeriodEnd: Date;
  plannedInvoiceDate: Date;
  scheduledAmount: Prisma.Decimal;
}

const STEP_MONTHS: Record<OpexFrequency, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  YEARLY: 12,
};

/** Adds `months` to `date`, clamping the day-of-month to the target month's
 * last day when it would otherwise overflow (31 Jan + 1 month -> 28/29 Feb,
 * never 3 Mar). All arithmetic is UTC, matching this codebase's existing
 * `generateMonthlyPeriods` (financial-year.service.ts) idiom — no date
 * library. */
export function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const targetMonthIndex = month + months;
  const daysInTargetMonth = new Date(Date.UTC(year, targetMonthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, targetMonthIndex, Math.min(day, daysInTargetMonth)));
}

/** A calendar date some days on, in UTC. */
export function addDaysUTC(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

/**
 * The single source of truth for OPEX schedule math — called by the
 * non-mutating preview query, the real create mutation, and the
 * integration tests directly (never re-implemented). Service periods and
 * invoice dates are generated as two independent sequences from their own
 * respective start dates (a service-start date does not imply advance
 * billing). Periods are consecutive and non-overlapping with inclusive end
 * dates. All money arithmetic uses `Prisma.Decimal` — never native JS
 * floats. The rounding remainder from an inexact division lands entirely
 * on the final installment, so the sum of every `scheduledAmount` always
 * equals `approvedAmount` exactly.
 */
export function generateOpexSchedule(input: OpexScheduleInput): OpexScheduleRow[] {
  const stepMonths = STEP_MONTHS[input.frequency];
  const base = input.approvedAmount.dividedBy(input.installmentCount).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);

  const rows: OpexScheduleRow[] = [];
  let allocated = new Prisma.Decimal(0);
  for (let i = 0; i < input.installmentCount; i++) {
    const sequenceNumber = i + 1;
    const servicePeriodStart = addMonthsClamped(input.scheduleStartDate, i * stepMonths);
    const nextPeriodStart = addMonthsClamped(input.scheduleStartDate, (i + 1) * stepMonths);
    const servicePeriodEnd = addDaysUTC(nextPeriodStart, -1);
    const plannedInvoiceDate = addMonthsClamped(input.firstInvoiceDate, i * stepMonths);
    const isLast = sequenceNumber === input.installmentCount;
    const scheduledAmount = isLast ? input.approvedAmount.minus(allocated) : base;
    allocated = allocated.plus(scheduledAmount);

    rows.push({ sequenceNumber, servicePeriodStart, servicePeriodEnd, plannedInvoiceDate, scheduledAmount });
  }
  return rows;
}
