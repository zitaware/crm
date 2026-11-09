import { describe, expect, it } from 'vitest';
import { firstMonthStartingOnOrAfter } from './profitability-report.service';

describe('firstMonthStartingOnOrAfter', () => {
  it('keeps a date that is already the 1st', () => {
    expect(firstMonthStartingOnOrAfter('2026-07-01')).toBe('2026-07-01');
  });

  it('moves any other day to the next month, across a year end', () => {
    expect(firstMonthStartingOnOrAfter('2026-07-15')).toBe('2026-08-01');
    expect(firstMonthStartingOnOrAfter('2026-12-02')).toBe('2027-01-01');
  });
});
