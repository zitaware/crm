import { Prisma } from '@prisma/client';
import type { AllocationDeductionType, InvoiceCollection } from '@zitaware/contracts';
import { apportion } from '../common/apportion.util';

const ZERO = new Prisma.Decimal(0);

const AMOUNT_KEYS = [
  'invoiceTotal',
  'creditDebitNet',
  'received',
  'tds',
  'gstTds',
  'hold',
  'retention',
  'penalty',
  'otherDeductions',
  'released',
] as const;
type AmountKey = (typeof AMOUNT_KEYS)[number];

/** The stored figures an InvoiceCollection is built from, before the derived pending/outstanding. */
export type CollectionAmounts = Record<AmountKey, Prisma.Decimal>;

const DEDUCTION_KEY: Record<AllocationDeductionType, AmountKey> = {
  TDS: 'tds',
  CGST_TDS: 'gstTds',
  SGST_TDS: 'gstTds',
  IGST_TDS: 'gstTds',
  HOLD: 'hold',
  RETENTION: 'retention',
  ACCEPTED_PENALTY: 'penalty',
  DISPUTED_PENALTY: 'penalty',
  OTHER: 'otherDeductions',
};

/** A receipt allocation on a POSTED receipt. Reversed receipts are left out by the caller. */
export interface CollectionAllocation {
  sourceEventId: string | null;
  cashAllocated: Prisma.Decimal;
  deductions: Array<{ type: AllocationDeductionType; amount: Prisma.Decimal; releases: Array<{ releasedAmount: Prisma.Decimal }> }>;
}

/** The parts of a FINALIZED invoice that say what it billed. */
export interface CollectionInvoice {
  sourceEventId: string | null;
  sourceInstallmentId: string | null;
  taxableAmount: Prisma.Decimal | null;
  totalAmount: Prisma.Decimal | null;
  capexSources: Array<{ sourceEventId: string; releasedAt: Date | null }>;
  lines: Array<{ sourceEventId: string | null; taxableAmount: Prisma.Decimal; lineTotal: Prisma.Decimal }>;
}

export interface SourceShare {
  sourceId: string;
  /** Taxable amount billed against this source — what the milestone cap counts. */
  billedTaxable: Prisma.Decimal;
  /** Gross amount of the source's lines; whole-invoice money is split by it. */
  weight: Prisma.Decimal;
}

export function emptyAmounts(): CollectionAmounts {
  return Object.fromEntries(AMOUNT_KEYS.map((key) => [key, ZERO])) as CollectionAmounts;
}

export function addAmounts(a: CollectionAmounts, b: CollectionAmounts): CollectionAmounts {
  return Object.fromEntries(AMOUNT_KEYS.map((key) => [key, a[key].plus(b[key])])) as CollectionAmounts;
}

/** Splits every figure by the same weights; each figure's parts add back to it exactly. */
export function apportionAmounts(amounts: CollectionAmounts, weights: Prisma.Decimal[]): CollectionAmounts[] {
  const parts = weights.map(() => emptyAmounts());
  for (const key of AMOUNT_KEYS) {
    apportion(amounts[key], weights).forEach((part, i) => {
      parts[i]![key] = part;
    });
  }
  return parts;
}

export function allocationAmounts(allocation: CollectionAllocation): CollectionAmounts {
  const amounts = emptyAmounts();
  amounts.received = allocation.cashAllocated;
  for (const deduction of allocation.deductions) {
    const key = DEDUCTION_KEY[deduction.type];
    amounts[key] = amounts[key].plus(deduction.amount);
    if (deduction.type === 'HOLD' || deduction.type === 'RETENTION') {
      amounts.released = deduction.releases.reduce((sum, r) => sum.plus(r.releasedAmount), amounts.released);
    }
  }
  return amounts;
}

export function toCollection(amounts: CollectionAmounts): InvoiceCollection {
  const deducted = amounts.tds.plus(amounts.gstTds).plus(amounts.hold).plus(amounts.retention).plus(amounts.penalty).plus(amounts.otherDeductions);
  return {
    invoiceTotal: amounts.invoiceTotal.toFixed(2),
    creditDebitNet: amounts.creditDebitNet.toFixed(2),
    received: amounts.received.toFixed(2),
    tds: amounts.tds.toFixed(2),
    gstTds: amounts.gstTds.toFixed(2),
    hold: amounts.hold.toFixed(2),
    retention: amounts.retention.toFixed(2),
    penalty: amounts.penalty.toFixed(2),
    otherDeductions: amounts.otherDeductions.toFixed(2),
    released: amounts.released.toFixed(2),
    holdRetentionPending: amounts.hold.plus(amounts.retention).minus(amounts.released).toFixed(2),
    outstanding: amounts.invoiceTotal.plus(amounts.creditDebitNet).minus(amounts.received).minus(deducted).toFixed(2),
  };
}

/** Whole-invoice figures: the invoice total, its credit/debit notes and every allocation on it. */
export function invoiceAmounts(
  totalAmount: Prisma.Decimal | null,
  creditDebitNet: Prisma.Decimal,
  allocations: CollectionAllocation[],
): CollectionAmounts {
  const base = emptyAmounts();
  base.invoiceTotal = totalAmount ?? ZERO;
  base.creditDebitNet = creditDebitNet;
  return allocations.reduce((sum, allocation) => addAmounts(sum, allocationAmounts(allocation)), base);
}

/**
 * The CAPEX events or the OPEX installment an invoice bills. A multi-event
 * invoice (ADR-126) names each event on its own line; a single-event invoice
 * leaves its lines untagged, so the whole invoice bills its header event.
 * Untagged extra lines on a multi-event invoice count toward no event's
 * taxable, the same reading the milestone cap uses at finalize.
 */
export function invoiceSourceShares(invoice: CollectionInvoice): SourceShare[] {
  const taxable = invoice.taxableAmount ?? ZERO;
  const total = invoice.totalAmount ?? ZERO;
  if (invoice.sourceInstallmentId) {
    return [{ sourceId: invoice.sourceInstallmentId, billedTaxable: taxable, weight: total }];
  }

  const active = invoice.capexSources.filter((source) => source.releasedAt === null).map((source) => source.sourceEventId);
  const eventIds = active.length > 0 ? [...new Set(active)] : invoice.sourceEventId ? [invoice.sourceEventId] : [];
  if (eventIds.length === 0) return [];

  const tagged = invoice.lines.filter((line) => line.sourceEventId !== null && eventIds.includes(line.sourceEventId));
  if (tagged.length === 0) {
    const owner = invoice.sourceEventId && eventIds.includes(invoice.sourceEventId) ? invoice.sourceEventId : eventIds[0]!;
    return eventIds.map((sourceId) =>
      sourceId === owner ? { sourceId, billedTaxable: taxable, weight: total } : { sourceId, billedTaxable: ZERO, weight: ZERO },
    );
  }
  return eventIds.map((sourceId) => {
    const lines = tagged.filter((line) => line.sourceEventId === sourceId);
    return {
      sourceId,
      billedTaxable: lines.reduce((sum, line) => sum.plus(line.taxableAmount), ZERO),
      weight: lines.reduce((sum, line) => sum.plus(line.lineTotal), ZERO),
    };
  });
}

function settledOf(amounts: CollectionAmounts): Prisma.Decimal {
  return amounts.received.plus(amounts.tds).plus(amounts.gstTds).plus(amounts.hold).plus(amounts.retention).plus(amounts.penalty).plus(amounts.otherDeductions);
}

/**
 * Each source's share of one invoice's money (ADR-155). The invoice total and
 * credit/debit notes are split by the sources' line totals. An allocation
 * that names an event (ADR-151) belongs to that event alone. A whole-invoice
 * allocation is split by what each source still owes after its named
 * allocations, so paying the rest of an invoice never pushes an event that
 * was already paid into credit; when nothing is owed, by line totals. The
 * shares always add back to the invoice.
 */
export function collectionBySource(
  invoice: CollectionInvoice,
  creditDebitNet: Prisma.Decimal,
  allocations: CollectionAllocation[],
): Array<{ sourceId: string; billedTaxable: Prisma.Decimal; amounts: CollectionAmounts }> {
  const shares = invoiceSourceShares(invoice);
  if (shares.length === 0) return [];
  const sourceIds = new Set(shares.map((share) => share.sourceId));
  const lineWeights = shares.map((share) => share.weight);

  const named = new Map<string, CollectionAmounts>();
  let whole = emptyAmounts();
  for (const allocation of allocations) {
    if (allocation.sourceEventId && sourceIds.has(allocation.sourceEventId)) {
      named.set(allocation.sourceEventId, addAmounts(named.get(allocation.sourceEventId) ?? emptyAmounts(), allocationAmounts(allocation)));
    } else {
      whole = addAmounts(whole, allocationAmounts(allocation));
    }
  }

  const billed = apportionAmounts(invoiceAmounts(invoice.totalAmount, creditDebitNet, []), lineWeights);
  const owed = shares.map((share, i) => {
    const left = billed[i]!.invoiceTotal.plus(billed[i]!.creditDebitNet).minus(settledOf(named.get(share.sourceId) ?? emptyAmounts()));
    return left.isNegative() ? ZERO : left;
  });
  const wholeSplit = apportionAmounts(whole, owed.some((left) => left.greaterThan(0)) ? owed : lineWeights);

  return shares.map((share, i) => ({
    sourceId: share.sourceId,
    billedTaxable: share.billedTaxable,
    amounts: addAmounts(addAmounts(billed[i]!, wholeSplit[i]!), named.get(share.sourceId) ?? emptyAmounts()),
  }));
}
