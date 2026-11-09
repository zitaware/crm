import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { addMonthsClamped, generateOpexSchedule } from './milestone-schedule.util';

describe('addMonthsClamped', () => {
  it('steps a mid-month date forward normally', () => {
    const result = addMonthsClamped(new Date('2026-03-15T00:00:00.000Z'), 1);
    expect(result.toISOString().slice(0, 10)).toBe('2026-04-15');
  });

  it('clamps 31 Jan + 1 month to the last day of February (non-leap year)', () => {
    const result = addMonthsClamped(new Date('2026-01-31T00:00:00.000Z'), 1);
    expect(result.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('clamps 31 Jan + 1 month to 29 Feb in a leap year', () => {
    const result = addMonthsClamped(new Date('2028-01-31T00:00:00.000Z'), 1);
    expect(result.toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  it('steps quarterly correctly', () => {
    const result = addMonthsClamped(new Date('2026-01-31T00:00:00.000Z'), 3);
    expect(result.toISOString().slice(0, 10)).toBe('2026-04-30');
  });

  it('steps yearly correctly, including across a leap-year boundary', () => {
    const result = addMonthsClamped(new Date('2028-02-29T00:00:00.000Z'), 12);
    expect(result.toISOString().slice(0, 10)).toBe('2029-02-28');
  });
});

describe('generateOpexSchedule', () => {
  it('sums exactly to the approved amount when it divides evenly', () => {
    const rows = generateOpexSchedule({
      approvedAmount: new Prisma.Decimal('36000000'),
      frequency: 'MONTHLY',
      installmentCount: 36,
      scheduleStartDate: new Date('2026-04-01T00:00:00.000Z'),
      firstInvoiceDate: new Date('2026-04-01T00:00:00.000Z'),
    });
    expect(rows).toHaveLength(36);
    const total = rows.reduce((sum, r) => sum.plus(r.scheduledAmount), new Prisma.Decimal(0));
    expect(total.toFixed(2)).toBe('36000000.00');
    expect(rows.every((r) => r.scheduledAmount.toFixed(2) === '1000000.00')).toBe(true);
  });

  it('puts all rounding remainder on the final installment when it does not divide evenly', () => {
    const rows = generateOpexSchedule({
      approvedAmount: new Prisma.Decimal('20000000'),
      frequency: 'MONTHLY',
      installmentCount: 36,
      scheduleStartDate: new Date('2026-01-01T00:00:00.000Z'),
      firstInvoiceDate: new Date('2026-01-01T00:00:00.000Z'),
    });
    const total = rows.reduce((sum, r) => sum.plus(r.scheduledAmount), new Prisma.Decimal(0));
    expect(total.toFixed(2)).toBe('20000000.00');
    const base = new Prisma.Decimal('20000000').dividedBy(36).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    for (let i = 0; i < 35; i++) {
      expect(rows[i]!.scheduledAmount.toFixed(2)).toBe(base.toFixed(2));
    }
    expect(rows[35]!.scheduledAmount.toFixed(2)).not.toBe(base.toFixed(2));
  });

  it('generates consecutive, non-overlapping, inclusive service periods', () => {
    const rows = generateOpexSchedule({
      approvedAmount: new Prisma.Decimal('1200'),
      frequency: 'MONTHLY',
      installmentCount: 3,
      scheduleStartDate: new Date('2026-01-31T00:00:00.000Z'),
      firstInvoiceDate: new Date('2026-02-01T00:00:00.000Z'),
    });
    expect(rows[0]!.servicePeriodStart.toISOString().slice(0, 10)).toBe('2026-01-31');
    expect(rows[0]!.servicePeriodEnd.toISOString().slice(0, 10)).toBe('2026-02-27'); // day before 28 Feb clamp
    expect(rows[1]!.servicePeriodStart.toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(rows[1]!.servicePeriodEnd.toISOString().slice(0, 10)).toBe('2026-03-30'); // day before 31 Mar (no clamp needed)
    expect(rows[2]!.servicePeriodStart.toISOString().slice(0, 10)).toBe('2026-03-31');
  });

  it('generates service periods and invoice dates as two independent sequences', () => {
    const rows = generateOpexSchedule({
      approvedAmount: new Prisma.Decimal('300'),
      frequency: 'MONTHLY',
      installmentCount: 3,
      scheduleStartDate: new Date('2026-01-01T00:00:00.000Z'),
      firstInvoiceDate: new Date('2026-01-15T00:00:00.000Z'),
    });
    expect(rows[0]!.servicePeriodStart.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(rows[0]!.plannedInvoiceDate.toISOString().slice(0, 10)).toBe('2026-01-15');
    expect(rows[1]!.plannedInvoiceDate.toISOString().slice(0, 10)).toBe('2026-02-15');
  });

  it('supports quarterly and yearly frequencies', () => {
    const quarterly = generateOpexSchedule({
      approvedAmount: new Prisma.Decimal('400'),
      frequency: 'QUARTERLY',
      installmentCount: 4,
      scheduleStartDate: new Date('2026-01-01T00:00:00.000Z'),
      firstInvoiceDate: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(quarterly[1]!.servicePeriodStart.toISOString().slice(0, 10)).toBe('2026-04-01');

    const yearly = generateOpexSchedule({
      approvedAmount: new Prisma.Decimal('200'),
      frequency: 'YEARLY',
      installmentCount: 2,
      scheduleStartDate: new Date('2026-01-01T00:00:00.000Z'),
      firstInvoiceDate: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(yearly[1]!.servicePeriodStart.toISOString().slice(0, 10)).toBe('2027-01-01');
  });
});
