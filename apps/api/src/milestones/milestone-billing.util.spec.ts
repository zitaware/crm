import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { deriveBillingStatus, unitBillingStatus } from './milestone-billing.util';

const open = (status: 'NOT_INVOICED' | 'PARTIALLY_INVOICED' | 'FULLY_INVOICED') => ({ closed: false, status });
const closed = (status: 'NOT_INVOICED' | 'PARTIALLY_INVOICED' | 'FULLY_INVOICED') => ({ closed: true, status });
const d = (v: string) => new Prisma.Decimal(v);

describe('unitBillingStatus (ADR-156)', () => {
  it('reads nothing, part and all of the amount', () => {
    expect(unitBillingStatus(d('0'), d('100'))).toBe('NOT_INVOICED');
    expect(unitBillingStatus(d('70'), d('100'))).toBe('PARTIALLY_INVOICED');
    expect(unitBillingStatus(d('100'), d('100'))).toBe('FULLY_INVOICED');
  });

  it('is FULLY_INVOICED when an invoice was marked as the full bill, even for less (ADR-167)', () => {
    expect(unitBillingStatus(d('98.80'), d('100'), true)).toBe('FULLY_INVOICED');
    // Marking needs a finalized invoice: with nothing billed it stays NOT_INVOICED.
    expect(unitBillingStatus(d('0'), d('100'), true)).toBe('NOT_INVOICED');
  });
});

describe('deriveBillingStatus', () => {
  it('is NOT_INVOICED when nothing has been invoiced', () => {
    expect(deriveBillingStatus([open('NOT_INVOICED'), open('NOT_INVOICED')])).toEqual({ billingStatus: 'NOT_INVOICED', invoicedCount: 0, billableCount: 2 });
  });

  it('is PARTIALLY_INVOICED when some but not all open units are invoiced', () => {
    expect(deriveBillingStatus([open('FULLY_INVOICED'), open('NOT_INVOICED'), open('NOT_INVOICED')])).toEqual({ billingStatus: 'PARTIALLY_INVOICED', invoicedCount: 1, billableCount: 3 });
  });

  it('is PARTIALLY_INVOICED while a unit is billed only in part (ADR-156)', () => {
    expect(deriveBillingStatus([open('PARTIALLY_INVOICED')])).toEqual({ billingStatus: 'PARTIALLY_INVOICED', invoicedCount: 0, billableCount: 1 });
  });

  it('is FULLY_INVOICED when every open unit is invoiced', () => {
    expect(deriveBillingStatus([open('FULLY_INVOICED'), open('FULLY_INVOICED')])).toEqual({ billingStatus: 'FULLY_INVOICED', invoicedCount: 2, billableCount: 2 });
  });

  it('ignores a closed unit that was never invoiced — it no longer expects an invoice', () => {
    expect(deriveBillingStatus([open('FULLY_INVOICED'), closed('NOT_INVOICED')])).toEqual({ billingStatus: 'FULLY_INVOICED', invoicedCount: 1, billableCount: 1 });
  });

  it('still counts a unit invoiced before it was closed, in full or in part', () => {
    expect(deriveBillingStatus([closed('FULLY_INVOICED'), open('NOT_INVOICED')])).toEqual({ billingStatus: 'PARTIALLY_INVOICED', invoicedCount: 1, billableCount: 2 });
    expect(deriveBillingStatus([closed('PARTIALLY_INVOICED'), open('FULLY_INVOICED')])).toEqual({ billingStatus: 'FULLY_INVOICED', invoicedCount: 2, billableCount: 2 });
  });

  it('is NOT_INVOICED for a milestone with no units, or only closed uninvoiced ones', () => {
    expect(deriveBillingStatus([]).billingStatus).toBe('NOT_INVOICED');
    expect(deriveBillingStatus([closed('NOT_INVOICED'), closed('NOT_INVOICED')])).toEqual({ billingStatus: 'NOT_INVOICED', invoicedCount: 0, billableCount: 0 });
  });
});
