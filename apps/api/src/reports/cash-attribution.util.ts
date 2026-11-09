import { Prisma } from '@zitaware/database';
import { CASH_INFLOW_CATEGORIES } from '@zitaware/contracts';
import type { CashCategory } from '@zitaware/contracts';

export { apportion } from '../common/apportion.util';

/** Money in counts positive for an inflow category; for every other category money out counts positive. */
export function naturalCashAmount(category: CashCategory, debitMinusCredit: Prisma.Decimal): Prisma.Decimal {
  return CASH_INFLOW_CATEGORIES.includes(category) ? debitMinusCredit : debitMinusCredit.negated();
}

/** value ÷ base × 100 to 2 dp, or null when the base is not positive. */
export function percentOf(value: Prisma.Decimal, base: Prisma.Decimal | null): string | null {
  if (!base || !base.greaterThan(0)) return null;
  return value.dividedBy(base).times(100).toFixed(2);
}
