import { Prisma } from '@zitaware/database';

const ZERO = new Prisma.Decimal(0);

/**
 * Splits `total` in proportion to `weights`, each part rounded to paise, with
 * the last part taking the rounding so the parts always add up to `total`
 * exactly. Used only where one figure covers several owners and the document
 * does not state each share itself: an introducer payment's net cash across
 * the accruals it settles (ADR-110), and a whole-invoice amount across the
 * CAPEX events the invoice bills (ADR-155).
 */
export function apportion(total: Prisma.Decimal, weights: Prisma.Decimal[]): Prisma.Decimal[] {
  if (weights.length === 0) return [];
  const weightTotal = weights.reduce((s, w) => s.plus(w), ZERO);
  if (weightTotal.isZero()) return weights.map((_w, i) => (i === weights.length - 1 ? total : ZERO));
  const parts = weights.slice(0, -1).map((w) => total.times(w).dividedBy(weightTotal).toDecimalPlaces(2));
  const assigned = parts.reduce((s, p) => s.plus(p), ZERO);
  return [...parts, total.minus(assigned)];
}
