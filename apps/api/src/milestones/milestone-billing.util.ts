import { Prisma } from '@prisma/client';
import type { MilestoneBillingStatus } from '@zitaware/contracts';

export interface BillingUnit {
  /** A cancelled event, or a skipped or cancelled installment — no invoice is expected any more. */
  closed: boolean;
  /** The unit's own status, from what FINALIZED invoices billed against its amount. */
  status: MilestoneBillingStatus;
}

export interface DerivedBilling {
  billingStatus: MilestoneBillingStatus;
  invoicedCount: number;
  billableCount: number;
}

/**
 * One event's or installment's billing status by amount (ADR-156): nothing
 * finalized is NOT_INVOICED, its whole amount is FULLY_INVOICED, anything
 * between is PARTIALLY_INVOICED. A DRAFT has billed nothing yet. An invoice
 * marked as the full bill (ADR-167) makes it FULLY_INVOICED whatever it billed.
 */
export function unitBillingStatus(invoiced: Prisma.Decimal, amount: Prisma.Decimal, completed = false): MilestoneBillingStatus {
  if (!invoiced.greaterThan(0)) return 'NOT_INVOICED';
  return completed || invoiced.greaterThanOrEqualTo(amount) ? 'FULLY_INVOICED' : 'PARTIALLY_INVOICED';
}

/**
 * A milestone's billing status, derived on read and never stored — docs/05
 * "Do not store billing state as independently editable data" (ADR-104).
 *
 * A milestone bills in units: a CAPEX pool's events, an OPEX schedule's
 * installments. A unit is done when fully invoiced. A closed unit no longer
 * expects an invoice: uninvoiced, it cannot hold a milestone back; invoiced
 * in part or in full before it closed, it is done, because no more will
 * be billed on it.
 */
export function deriveBillingStatus(units: BillingUnit[]): DerivedBilling {
  const billable = units.filter((u) => !u.closed || u.status !== 'NOT_INVOICED');
  const done = billable.filter((u) => u.status === 'FULLY_INVOICED' || u.closed);
  const started = billable.some((u) => u.status !== 'NOT_INVOICED');
  const billingStatus: MilestoneBillingStatus =
    billable.length > 0 && done.length === billable.length ? 'FULLY_INVOICED' : started ? 'PARTIALLY_INVOICED' : 'NOT_INVOICED';
  return { billingStatus, invoicedCount: done.length, billableCount: billable.length };
}
