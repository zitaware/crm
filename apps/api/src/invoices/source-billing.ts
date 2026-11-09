import { Prisma } from '@prisma/client';
import { invoiceSourceShares } from './invoice-collection.util';

const ZERO = new Prisma.Decimal(0);

/** What FINALIZED invoices billed against one CAPEX event or OPEX installment. */
export interface SourceBilling {
  /** Taxable amount billed — the figure the source's amount caps (ADR-156). */
  invoiced: Prisma.Decimal;
  /** A finalized invoice on it was marked as the full bill (ADR-167): nothing more is expected. */
  completed: boolean;
  /** Oldest first. */
  invoices: Array<{ id: string; invoiceNumber: string | null; version: number }>;
}

/**
 * Taxable amount every FINALIZED invoice billed against each of these events
 * or installments (ADR-155/156). A DRAFT has billed nothing yet and a VOID
 * was undone, so neither counts. An event on another event's multi-event
 * invoice (ADR-126) counts through invoice_capex_sources. A source with no
 * finalized invoice is absent from the map.
 */
export async function loadSourceBilling(
  db: Prisma.TransactionClient,
  organizationId: string,
  sourceIds: string[],
  options: { excludeInvoiceId?: string } = {},
): Promise<Map<string, SourceBilling>> {
  const bySource = new Map<string, SourceBilling>();
  if (sourceIds.length === 0) return bySource;
  const invoices = await db.invoice.findMany({
    where: {
      organizationId,
      status: 'FINALIZED',
      ...(options.excludeInvoiceId ? { id: { not: options.excludeInvoiceId } } : {}),
      OR: [
        { sourceEventId: { in: sourceIds } },
        { sourceInstallmentId: { in: sourceIds } },
        { capexSources: { some: { sourceEventId: { in: sourceIds }, releasedAt: null } } },
      ],
    },
    include: {
      capexSources: { select: { sourceEventId: true, releasedAt: true } },
      lines: { select: { sourceEventId: true, taxableAmount: true, lineTotal: true } },
    },
    orderBy: [{ invoiceDate: 'asc' }, { createdAt: 'asc' }],
  });
  const wanted = new Set(sourceIds);
  for (const invoice of invoices) {
    for (const share of invoiceSourceShares(invoice)) {
      if (!wanted.has(share.sourceId)) continue;
      const entry = bySource.get(share.sourceId) ?? { invoiced: ZERO, completed: false, invoices: [] };
      entry.invoiced = entry.invoiced.plus(share.billedTaxable);
      entry.completed = entry.completed || invoice.completesSource;
      entry.invoices.push({ id: invoice.id, invoiceNumber: invoice.invoiceNumber, version: invoice.version });
      bySource.set(share.sourceId, entry);
    }
  }
  return bySource;
}

/** What each source is worth: an event's amount, an installment's scheduled amount. */
export async function loadSourceAmounts(
  db: Prisma.TransactionClient,
  sourceIds: string[],
): Promise<Map<string, { amount: Prisma.Decimal; label: string }>> {
  if (sourceIds.length === 0) return new Map();
  const [events, installments] = await Promise.all([
    db.milestoneEvent.findMany({ where: { id: { in: sourceIds } }, select: { id: true, amount: true, code: true, name: true } }),
    db.milestoneInstallment.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true, scheduledAmount: true, sequenceNumber: true, milestone: { select: { name: true } } },
    }),
  ]);
  return new Map([
    ...events.map((e) => [e.id, { amount: e.amount, label: `${e.code} — ${e.name}` }] as const),
    ...installments.map((i) => [i.id, { amount: i.scheduledAmount, label: `${i.milestone.name} — Installment ${i.sequenceNumber}` }] as const),
  ]);
}

/** amount - invoiced, never below zero; zero once an invoice was marked as the full bill (ADR-167). */
export function remainingOf(amount: Prisma.Decimal, billing: SourceBilling | undefined): Prisma.Decimal {
  if (billing?.completed) return ZERO;
  const left = amount.minus(billing?.invoiced ?? ZERO);
  return left.isNegative() ? ZERO : left;
}
