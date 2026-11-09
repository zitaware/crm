import { Prisma } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';

/**
 * Weighted-average inventory valuation (Phase 7.2, ADR-092 — the ADR that
 * promotes TDR-007 from a pending technical decision to an accepted one).
 *
 * docs/06 fixes only the method ("Recommended initial method: weighted
 * average") and docs/04:463 fixes only the authority ("Movement ledger is
 * authoritative. Filters do not independently recompute opening/closing
 * values"). This module is the whole of the arithmetic those two lines
 * imply, kept pure so the preview query, the real posting commands and the
 * tests all share one implementation — the same discipline the OPEX
 * schedule generator (ADR-063) and `computeLines` already follow.
 *
 * Every movement stores the balance it produced. Nothing recomputes a
 * historical rate by replaying the ledger, so a past consumption's cost
 * stays reproducible forever, and the sum of the latest movements'
 * `balanceValueAmount` across items is exactly the INVENTORY ledger
 * account's balance — which is Phase 7's own exit criterion.
 */

/** Money is stored at Decimal(19,4) but every posted amount is rounded to 2
 * — the same basis `computeLines` uses for `taxableAmount`, so an inventory
 * debit can never carry a sub-paisa fraction a journal line cannot. */
const MONEY_DP = 2;
/** The rate keeps its full stored precision: it is a divisor, not a posted
 * amount, and rounding it to 2 would compound error across many issues. */
const RATE_DP = 4;

export interface StockBalance {
  quantity: Prisma.Decimal;
  valueAmount: Prisma.Decimal;
  weightedAverageRate: Prisma.Decimal;
}

export interface MovementResult {
  /** The value this movement itself moved — the exact figure posted to the
   * journal, not a rounded display of something else. */
  movementValueAmount: Prisma.Decimal;
  /** Per-unit cost this movement was valued at. For a receipt it is the
   * caller's purchase cost; for a consumption it is the weighted average
   * ruling at that moment. */
  unitCostAmount: Prisma.Decimal;
  /** The running snapshot stamped onto the movement row. */
  balance: StockBalance;
}

export function zeroBalance(): StockBalance {
  return {
    quantity: new Prisma.Decimal(0),
    valueAmount: new Prisma.Decimal(0),
    weightedAverageRate: new Prisma.Decimal(0),
  };
}

function deriveRate(quantity: Prisma.Decimal, valueAmount: Prisma.Decimal): Prisma.Decimal {
  if (quantity.isZero()) return new Prisma.Decimal(0);
  return valueAmount.dividedBy(quantity).toDecimalPlaces(RATE_DP);
}

/**
 * Receive stock at a known purchase cost.
 *
 * `unitCost` is the caller's landed cost per unit — for a vendor-bill line
 * that is taxable value plus any *ineligible* tax, per docs/06's "Inventory:
 * taxable inventory value plus ineligible tax". Computing that split is the
 * caller's job (it already exists on VendorBillLine); this function only
 * folds the result into the running average.
 */
export function applyReceipt(current: StockBalance, quantityIn: Prisma.Decimal, unitCost: Prisma.Decimal): MovementResult {
  if (!quantityIn.greaterThan(0)) throwAppError('VALIDATION_FAILED', 'Received quantity must be greater than zero.');
  if (unitCost.isNegative()) throwAppError('VALIDATION_FAILED', 'Unit cost cannot be negative.');

  const movementValueAmount = quantityIn.times(unitCost).toDecimalPlaces(MONEY_DP);
  const quantity = current.quantity.plus(quantityIn);
  const valueAmount = current.valueAmount.plus(movementValueAmount);

  return {
    movementValueAmount,
    unitCostAmount: unitCost,
    balance: { quantity, valueAmount, weightedAverageRate: deriveRate(quantity, valueAmount) },
  };
}

/**
 * Issue stock at the weighted average ruling right now.
 *
 * Full depletion is special-cased deliberately: issuing the last unit
 * carries out the entire remaining value, not `quantity × rate`. Without
 * that, a rate that did not divide evenly would strand a few paise of value
 * against zero quantity forever — stock value would stop reconciling to the
 * INVENTORY ledger account, breaking Phase 7's own exit criterion. The
 * residue lands on the final issue, which is the deterministic choice
 * docs/06 already demands of salary allocation ("rounding remainder is
 * assigned deterministically").
 */
export function applyConsumption(current: StockBalance, quantityOut: Prisma.Decimal): MovementResult {
  if (!quantityOut.greaterThan(0)) throwAppError('VALIDATION_FAILED', 'Issued quantity must be greater than zero.');
  if (quantityOut.greaterThan(current.quantity)) {
    throwAppError(
      'VALIDATION_FAILED',
      `Only ${current.quantity.toFixed(4)} in stock — cannot issue ${quantityOut.toFixed(4)}.`,
    );
  }

  const quantity = current.quantity.minus(quantityOut);

  if (quantity.isZero()) {
    return {
      movementValueAmount: current.valueAmount,
      unitCostAmount: current.weightedAverageRate,
      balance: zeroBalance(),
    };
  }

  const movementValueAmount = quantityOut.times(current.weightedAverageRate).toDecimalPlaces(MONEY_DP);
  const valueAmount = current.valueAmount.minus(movementValueAmount);
  if (valueAmount.isNegative()) {
    // Unreachable for quantityOut < quantity given rate = value / quantity;
    // asserted rather than clamped so a future change to the rounding basis
    // fails loudly instead of silently writing a negative stock value.
    throwAppError('VALIDATION_FAILED', 'Issuing this quantity would drive stock value negative.');
  }

  return {
    movementValueAmount,
    unitCostAmount: current.weightedAverageRate,
    balance: { quantity, valueAmount, weightedAverageRate: deriveRate(quantity, valueAmount) },
  };
}
