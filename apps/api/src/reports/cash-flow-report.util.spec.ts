import { describe, expect, it } from 'vitest';
import { monthsBetween } from './cash-flow-report.service';

describe('monthsBetween', () => {
  it('lists every calendar month from the start to the end, across a year end', () => {
    expect(monthsBetween('2026-11-15', '2027-02-01')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthsBetween('2026-06-01', '2026-06-30')).toEqual(['2026-06']);
  });
});
