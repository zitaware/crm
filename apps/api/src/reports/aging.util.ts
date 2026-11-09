import type { AgingBucket } from '@zitaware/contracts';

const DAY_MS = 86_400_000;

/** Whole days from `from` to `to` (both YYYY-MM-DD, read as UTC dates) —
 * negative when `to` is earlier. Calendar days, never money. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS);
}

/**
 * docs/16's 0–30 / 31–60 / 61–90 / 90+ buckets by days past due. Before the
 * due date an amount is NOT_DUE; the due date itself is day 0 of the first
 * bucket. Hold and retention use the same buckets on days held, which is
 * never negative.
 */
export function agingBucket(daysPastDue: number): AgingBucket {
  if (daysPastDue < 0) return 'NOT_DUE';
  if (daysPastDue <= 30) return 'DAYS_0_30';
  if (daysPastDue <= 60) return 'DAYS_31_60';
  if (daysPastDue <= 90) return 'DAYS_61_90';
  return 'DAYS_90_PLUS';
}
