import { describe, expect, it } from 'vitest';
import { formatDisplayDate } from './display-date.util';

describe('formatDisplayDate', () => {
  it('shows a business date as DD/MM/YYYY', () => {
    expect(formatDisplayDate('2026-04-05')).toBe('05/04/2026');
  });

  it('uses the date part of an ISO timestamp', () => {
    expect(formatDisplayDate('2026-10-26T00:00:00.000Z')).toBe('26/10/2026');
  });

  it('returns other text unchanged', () => {
    expect(formatDisplayDate('current')).toBe('current');
  });
});
