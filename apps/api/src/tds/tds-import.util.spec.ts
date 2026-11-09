import { describe, expect, it } from 'vitest';
import { parseAmount, parseDate, parseDeductionType, parseSource } from './tds-import.util';

describe('TDS certificate CSV template parsing (ADR-112)', () => {
  it('accepts the documented spellings of source and type, and nothing else', () => {
    expect(['certificate', 'Form 16A', '16A', 'GSTR-7A', 'statement', '26AS', 'Form26AS'].map(parseSource)).toEqual([
      'CERTIFICATE', 'CERTIFICATE', 'CERTIFICATE', 'CERTIFICATE', 'STATEMENT', 'STATEMENT', 'STATEMENT',
    ]);
    expect(parseSource('bank')).toBeNull();
    expect(['TDS', 'cgst-tds', 'SGST TDS', 'igst_tds'].map(parseDeductionType)).toEqual(['TDS', 'CGST_TDS', 'SGST_TDS', 'IGST_TDS']);
    expect(parseDeductionType('GST')).toBeNull();
  });

  it('reads ISO and Indian day-first dates, refusing impossible ones', () => {
    expect(parseDate('2026-07-10')).toBe('2026-07-10');
    expect(parseDate('10/07/2026')).toBe('2026-07-10');
    expect(parseDate('10-07-2026')).toBe('2026-07-10');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('07/10/26')).toBeNull();
  });

  it('reads amounts with separators and a rupee sign, refusing zero, negatives and extra decimals', () => {
    expect(parseAmount('₹1,20,000.50')).toBe('120000.50');
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('10.555')).toBeNull();
  });
});
