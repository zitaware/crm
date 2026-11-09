import { Prisma } from '@zitaware/database';

/**
 * Splitting one employee-month's gross salary across their allocation
 * (Phase 7.5, ADR-095).
 *
 * docs/06 ("Salary project costing"):
 *
 *     allocated project amount = gross salary x allocation percentage
 *     Rounding remainder is assigned deterministically so allocations
 *     equal gross salary.
 *
 * That second sentence is the whole reason this module exists. A plain
 * `gross x pct` rounded per line does NOT sum back to gross: three equal
 * shares of 10,000.00 round to 3,333.33 each and lose a paisa. Left alone,
 * every project cost report would be quietly short, and the shortfall would
 * grow with head count and month count — the same class of silent drift the
 * inventory full-depletion rule exists to prevent (ADR-092).
 *
 * The remainder is therefore assigned to a single, deterministically chosen
 * line — the largest share, ties broken by the earliest sequence — rather
 * than spread. One line carrying one extra paisa is explainable; a
 * distribution rule that moves paise around as unrelated lines change is
 * not, and would make the same month reconcile differently on two runs.
 *
 * Pure and shared by every caller and the tests, the same discipline as the
 * OPEX generator (ADR-063) and the inventory valuation util (ADR-092).
 */
export interface AllocationShare {
  /** Stable identity of the line, echoed back on the result. */
  key: string;
  sequence: number;
  percentage: Prisma.Decimal;
}

export interface AllocatedAmount {
  key: string;
  sequence: number;
  percentage: Prisma.Decimal;
  amount: Prisma.Decimal;
  /** True on the one line the rounding remainder landed on. Surfaced so a
   * screen or report can explain an amount that is a paisa off the naive
   * product rather than looking like an error. */
  carriesRemainder: boolean;
}

export const HUNDRED = new Prisma.Decimal(100);

/** Sum of the shares, unrounded — the figure the exactly-100% rule tests. */
export function totalPercentage(shares: Array<{ percentage: Prisma.Decimal }>): Prisma.Decimal {
  return shares.reduce((sum, s) => sum.plus(s.percentage), new Prisma.Decimal(0));
}

export function isExactlyHundred(shares: Array<{ percentage: Prisma.Decimal }>): boolean {
  return totalPercentage(shares).equals(HUNDRED);
}

/**
 * Splits `grossSalaryAmount` across `shares`, guaranteeing the parts sum to
 * the whole exactly.
 *
 * Assumes the shares total 100% — the caller enforces that separately,
 * because a DRAFT allocation is legitimately allowed not to. If they total
 * something else, each line is still `gross x pct` and the remainder line
 * still absorbs the difference from `gross`, which is deliberate: a
 * half-filled draft should preview at what it currently says, not silently
 * scale up to the whole salary.
 */
export function allocateSalary(grossSalaryAmount: Prisma.Decimal, shares: AllocationShare[]): AllocatedAmount[] {
  if (shares.length === 0) return [];

  const rounded = shares.map((share) => ({
    ...share,
    amount: grossSalaryAmount.times(share.percentage).dividedBy(HUNDRED).toDecimalPlaces(2),
    carriesRemainder: false,
  }));

  const assigned = rounded.reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0));
  const remainder = grossSalaryAmount.minus(assigned);

  if (remainder.isZero()) return rounded;

  // Largest share first; ties broken by the earliest sequence so the choice
  // never depends on array order or on Decimal comparison being stable.
  let target = 0;
  for (let i = 1; i < rounded.length; i++) {
    const a = rounded[i]!;
    const b = rounded[target]!;
    if (a.percentage.greaterThan(b.percentage) || (a.percentage.equals(b.percentage) && a.sequence < b.sequence)) {
      target = i;
    }
  }

  rounded[target] = {
    ...rounded[target]!,
    amount: rounded[target]!.amount.plus(remainder),
    carriesRemainder: true,
  };
  return rounded;
}
