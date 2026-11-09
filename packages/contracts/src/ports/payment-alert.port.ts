export type PaymentAlertSourceType = 'CAPEX_EVENT' | 'OPEX_INSTALLMENT';
/** CLOSED added in Phase 5 Slice 5.1 — set when the source's invoice
 * finalizes ("only finalized invoice closes the alert," docs/04 §11.3),
 * reverted back to OPEN if that invoice is later voided. Never set by
 * PaymentAlertsService itself; only by InvoicesService. */
export type PaymentAlertStatus = 'OPEN' | 'SNOOZED' | 'CLOSED';
export type PaymentAlertDerivedLabel = 'OVERDUE' | 'DUE' | 'SNOOZED';

export interface PaymentAlertSummary {
  id: string;
  projectId: string;
  sourceType: PaymentAlertSourceType;
  title: string;
  milestoneCode: string;
  dueDate: string;
  /** The OPEX installment's service period; null for a CAPEX event. */
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
  /** The event's amount or the installment's scheduled amount. */
  amount: string;
  /** Taxable amount finalized invoices already billed on it (ADR-156). */
  invoicedAmount: string;
  /** amount - invoicedAmount: what this alert still asks to invoice. */
  remainingAmount: string;
  /** The latest finalized invoice on its source, for marking it as the full bill (ADR-167). */
  latestInvoice: { id: string; invoiceNumber: string | null; version: number } | null;
  status: PaymentAlertStatus;
  derivedLabel: PaymentAlertDerivedLabel;
  snoozedUntil: string | null;
  snoozeNote: string | null;
  openedAt: string;
  version: number;
}

export interface ProjectPaymentAlertOverview {
  openAlerts: PaymentAlertSummary[];
  snoozedAlerts: PaymentAlertSummary[];
  overdueCount: number;
  dueCount: number;
  snoozedCount: number;
  pendingAmount: string;
}

export interface PaymentAlertHeaderItem extends PaymentAlertSummary {
  projectName: string;
}

/** Org-wide (but PM-scoped like ProjectsService.list) summary for the app
 * header's notification bell — OPEN alerts only (SNOOZED means a human
 * already deferred it; CLOSED means it's done), sorted soonest/most
 * -overdue first, `items` capped for a dropdown rather than a full list
 * page. `overdueCount`/`dueCount` reflect the true total, not just
 * `items.length`. */
export interface PaymentAlertHeaderSummary {
  overdueCount: number;
  dueCount: number;
  items: PaymentAlertHeaderItem[];
}

export interface PaymentAlertPort {
  listForProject(input: { organizationId: string; projectId: string; actorId: string; canSeeAll: boolean }): Promise<ProjectPaymentAlertOverview>;

  getHeaderSummary(input: { organizationId: string; actorId: string; canSeeAll: boolean }): Promise<PaymentAlertHeaderSummary>;

  /** Defers the next reminder to `snoozedUntil` (a future business date) —
   * never touches the underlying event/installment due date. Reachable
   * from both OPEN and SNOOZED (re-snoozing simply moves the date again). */
  snooze(input: {
    organizationId: string;
    id: string;
    snoozedUntil: string;
    note: string | undefined;
    expectedVersion: number;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<PaymentAlertSummary>;
}
