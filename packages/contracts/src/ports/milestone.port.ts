export type MilestoneType = 'CAPEX' | 'OPEX';
export type MilestoneAchievementStatus = 'PLANNED' | 'IN_PROGRESS' | 'ACHIEVED' | 'CANCELLED';
export type MilestoneBillingStatus = 'NOT_INVOICED' | 'PARTIALLY_INVOICED' | 'FULLY_INVOICED';
export type InstallmentFrequency = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export type InstallmentStatus = 'PLANNED' | 'SKIPPED' | 'CANCELLED' | 'INVOICE_DRAFT' | 'INVOICED';
export type AlertRecipient = 'ACCOUNT_TEAM' | 'PROJECT_MANAGER' | 'BOTH';

export interface MilestoneEventSummary {
  id: string;
  milestoneId: string;
  milestoneCode: string;
  milestoneName: string;
  code: string;
  name: string;
  percentOfPool: string;
  amount: string;
  dueDate: string;
  achievementStatus: MilestoneAchievementStatus;
  achievedOn: string | null;
  cancelReason: string | null;
  sequence: number;
  version: number;
  /** Derived, never stored (ADR-104), by amount (ADR-156): what FINALIZED invoices billed against `amount`. */
  billingStatus: MilestoneBillingStatus;
  /** Every FINALIZED invoice billing this event, comma-separated; null when none. */
  invoiceNumber: string | null;
  /** The event's payment alert, once one was opened; invoices are raised from it. */
  paymentAlertId: string | null;
  /** Taxable amount FINALIZED invoices billed against this event (ADR-155). */
  invoicedAmount: string;
  /** amount - invoicedAmount; negative when billed above the event amount. */
  remainingAmount: string;
}

export interface MilestoneInstallmentSummary {
  id: string;
  sequenceNumber: number;
  servicePeriodStart: string;
  servicePeriodEnd: string;
  plannedInvoiceDate: string;
  scheduledAmount: string;
  status: InstallmentStatus;
  skipReason: string | null;
  cancelReason: string | null;
  version: number;
  /** By amount (ADR-156): what FINALIZED invoices billed against `scheduledAmount`. */
  billingStatus: MilestoneBillingStatus;
  /** Every FINALIZED invoice billing this installment, comma-separated (ADR-104/156). */
  invoiceNumber: string | null;
  /** The installment's payment alert, once one was opened. */
  paymentAlertId: string | null;
  /** Taxable amount FINALIZED invoices billed against this installment (ADR-155). */
  invoicedAmount: string;
  /** scheduledAmount - invoicedAmount. */
  remainingAmount: string;
}

export interface MilestoneSummary {
  id: string;
  projectId: string;
  type: MilestoneType;
  code: string;
  name: string;
  approvedAmount: string;
  referenceNumber: string | null;
  approvalDate: string | null;
  description: string | null;
  achievementStatus: MilestoneAchievementStatus | null;
  /** Derived from the milestone's events (CAPEX) or installments (OPEX), never stored (ADR-104). */
  billingStatus: MilestoneBillingStatus;
  /** Units fully invoiced, out of the units still expecting an invoice — the "progress" docs/04 asks for. */
  invoicedCount: number;
  billableCount: number;
  /** Taxable amount FINALIZED invoices billed against this milestone's events or installments (ADR-155). */
  invoicedAmount: string;
  /** approvedAmount - invoicedAmount. */
  remainingAmount: string;
  frequency: InstallmentFrequency | null;
  installmentCount: number | null;
  scheduleStartDate: string | null;
  firstInvoiceDate: string | null;
  alertRecipient: AlertRecipient;
  reminderOffsetDays: number;
  achievedOn: string | null;
  cancelReason: string | null;
  version: number;
  createdAt: string;
  installments: MilestoneInstallmentSummary[] | undefined;
}

export interface ProjectMilestoneOverview {
  capexEvents: MilestoneEventSummary[];
  opexMilestones: MilestoneSummary[];
  capexTotalAmount: string;
  opexTotalAmount: string;
  capexInvoicedAmount: string;
  opexInvoicedAmount: string;
}

export interface OpexScheduleRowSummary {
  sequenceNumber: number;
  servicePeriodStart: string;
  servicePeriodEnd: string;
  plannedInvoiceDate: string;
  scheduledAmount: string;
}

export interface MilestonePort {
  listForProject(input: { organizationId: string; projectId: string; actorId: string; canSeeAll: boolean }): Promise<ProjectMilestoneOverview>;

  /** Pure preview — persists nothing. Returns exactly what `createOpex`
   * would generate for the same input, so the frontend never computes
   * this itself. */
  previewOpexSchedule(input: {
    approvedAmount: string;
    frequency: InstallmentFrequency;
    installmentCount: number;
    scheduleStartDate: string;
    firstInvoiceDate: string;
  }): Promise<OpexScheduleRowSummary[]>;

  /** Event amounts must sum to `approvedAmount` exactly. `percentOfPool` is
   * derived server-side, never accepted as input. Codes are generated
   * server-side. */
  createCapex(input: {
    organizationId: string;
    projectId: string;
    name: string;
    approvedAmount: string;
    referenceNumber: string | undefined;
    approvalDate: string | undefined;
    description: string | undefined;
    alertRecipient: AlertRecipient | undefined;
    reminderOffsetDays: number | undefined;
    events: Array<{ name: string; amount: string; dueDate: string }>;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<MilestoneSummary>;

  /** Generates the installment schedule server-side via the shared
   * schedule generator — never trusts a client-supplied schedule. */
  createOpex(input: {
    organizationId: string;
    projectId: string;
    name: string;
    approvedAmount: string;
    frequency: InstallmentFrequency;
    installmentCount: number;
    scheduleStartDate: string;
    firstInvoiceDate: string;
    referenceNumber: string | undefined;
    approvalDate: string | undefined;
    description: string | undefined;
    alertRecipient: AlertRecipient | undefined;
    reminderOffsetDays: number | undefined;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<MilestoneSummary>;

  /** Editable pool/milestone-level fields only — approvedAmount,
   * frequency, installmentCount, and the two schedule dates are immutable
   * after creation (decision 8). */
  updateMilestone(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    referenceNumber: string | undefined;
    approvalDate: string | undefined;
    description: string | undefined;
    alertRecipient: AlertRecipient | undefined;
    reminderOffsetDays: number | undefined;
    expectedVersion: number;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<MilestoneSummary>;

  /** Rejected once the event is ACHIEVED/CANCELLED. Re-validates the
   * pool-wide exact-sum invariant against the proposed total. */
  updateEvent(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    amount: string | undefined;
    dueDate: string | undefined;
    expectedVersion: number;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<MilestoneEventSummary>;

  startEvent(input: { organizationId: string; id: string; expectedVersion: number; actorId: string; canSeeAll: boolean; correlationId: string }): Promise<MilestoneEventSummary>;
  markEventAchieved(input: { organizationId: string; id: string; achievedOn: string; expectedVersion: number; actorId: string; canSeeAll: boolean; correlationId: string }): Promise<MilestoneEventSummary>;
  cancelEvent(input: { organizationId: string; id: string; reason: string; expectedVersion: number; actorId: string; canSeeAll: boolean; correlationId: string }): Promise<MilestoneEventSummary>;

  startMilestone(input: { organizationId: string; id: string; expectedVersion: number; actorId: string; canSeeAll: boolean; correlationId: string }): Promise<MilestoneSummary>;
  markMilestoneAchieved(input: { organizationId: string; id: string; achievedOn: string; expectedVersion: number; actorId: string; canSeeAll: boolean; correlationId: string }): Promise<MilestoneSummary>;

  /** Cancelling an OPEX milestone transactionally cancels every remaining
   * PLANNED installment with the same reason (decision 14). */
  cancelMilestone(input: { organizationId: string; id: string; reason: string; expectedVersion: number; actorId: string; canSeeAll: boolean; correlationId: string }): Promise<MilestoneSummary>;

  skipInstallment(input: { organizationId: string; id: string; reason: string; expectedVersion: number; actorId: string; canSeeAll: boolean; correlationId: string }): Promise<MilestoneInstallmentSummary>;
}
