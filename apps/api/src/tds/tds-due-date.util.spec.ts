import { describe, expect, it } from 'vitest';
import { tdsDepositDueDate } from './tds-due-date.util';

describe('tdsDepositDueDate (ADR-113)', () => {
  it('is the 7th of the next month for TDS, 30 April for March', () => {
    expect(tdsDepositDueDate('TDS', '2026-08-25')).toBe('2026-09-07');
    expect(tdsDepositDueDate('TDS', '2027-03-31')).toBe('2027-04-30');
    expect(tdsDepositDueDate('TDS', '2026-12-10')).toBe('2027-01-07');
  });

  it('is the 10th of the next month for GST-TDS, March included', () => {
    expect(tdsDepositDueDate('IGST_TDS', '2027-03-15')).toBe('2027-04-10');
    expect(tdsDepositDueDate('CGST_TDS', '2026-12-01')).toBe('2027-01-10');
  });
});
