import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatMoney } from './format';

describe('formatMoney', () => {
  it('groups digits using Indian lakh/crore placement', () => {
    expect(formatMoney('1200')).toBe('₹1,200.00');
    expect(formatMoney('23000')).toBe('₹23,000.00');
    expect(formatMoney('123000')).toBe('₹1,23,000.00');
    expect(formatMoney('3254833')).toBe('₹32,54,833.00');
  });

  it('always shows exactly two decimal places', () => {
    expect(formatMoney('1200.5')).toBe('₹1,200.50');
    expect(formatMoney('1200.567')).toBe('₹1,200.57');
  });

  it('renders an em dash for null or empty input', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney('')).toBe('—');
  });
});

describe('formatDate', () => {
  it('shows a business date as DD/MM/YYYY without shifting the day', () => {
    expect(formatDate('2026-04-05')).toBe('05/04/2026');
    expect(formatDate('2026-12-31')).toBe('31/12/2026');
  });

  it('shows a timestamp as DD/MM/YYYY in local time', () => {
    const local = new Date(2026, 9, 26, 14, 5);
    expect(formatDate(local.toISOString())).toBe('26/10/2026');
  });

  it('returns unreadable text unchanged', () => {
    expect(formatDate('not a date')).toBe('not a date');
  });
});

describe('formatDateTime', () => {
  it('shows DD/MM/YYYY HH:mm in local time', () => {
    expect(formatDateTime(new Date(2026, 9, 26, 9, 7).toISOString())).toBe('26/10/2026 09:07');
  });
});
