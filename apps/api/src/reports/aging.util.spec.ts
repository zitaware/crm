import { describe, expect, it } from 'vitest';
import { agingBucket, daysBetween } from './aging.util';

describe('daysBetween', () => {
  it('counts calendar days, negative when the end is earlier', () => {
    expect(daysBetween('2026-07-28', '2026-08-31')).toBe(34);
    expect(daysBetween('2026-09-30', '2026-08-31')).toBe(-30);
    expect(daysBetween('2026-08-31', '2026-08-31')).toBe(0);
  });

  it('crosses month and leap-year boundaries', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });
});

describe('agingBucket', () => {
  it('puts anything before the due date in NOT_DUE and the due date itself in 0–30', () => {
    expect(agingBucket(-1)).toBe('NOT_DUE');
    expect(agingBucket(0)).toBe('DAYS_0_30');
  });

  it('switches bucket exactly after 30, 60 and 90 days', () => {
    expect(agingBucket(30)).toBe('DAYS_0_30');
    expect(agingBucket(31)).toBe('DAYS_31_60');
    expect(agingBucket(60)).toBe('DAYS_31_60');
    expect(agingBucket(61)).toBe('DAYS_61_90');
    expect(agingBucket(90)).toBe('DAYS_61_90');
    expect(agingBucket(91)).toBe('DAYS_90_PLUS');
  });
});
