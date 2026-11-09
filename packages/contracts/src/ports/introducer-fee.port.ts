/**
 * Introducer commission — agreement, accrual, payment and allocation
 * (Phase 7.6, ADR-096).
 *
 * docs/06 gives two rules and no more: accrual is Dr Introducer Commission
 * Expense / Cr Introducer Payable, and payment "follows vendor-style payable
 * settlement with TDS where applicable. Excess payment posts to Introducer
 * Advance Receivable."
 *
 * The agreement itself posts nothing — it is an entitlement, not an event.
 */
export type IntroducerCommissionBasis = 'PERCENT_OF_PROJECT_VALUE' | 'FIXED_AMOUNT';
export type IntroducerDocumentStatus = 'POSTED' | 'REVERSED';

export interface IntroducerAgreementSummary {
  id: string;
  introducerId: string;
  introducerName: string;
  projectId: string;
  projectName: string;
  legalEntityId: string;
  legalEntityName: string;
  basisType: IntroducerCommissionBasis;
  ratePercent: string | null;
  fixedAmount: string | null;
  agreementDate: string;
  remarks: string | null;
  isActive: boolean;
  /** What the agreement entitles the introducer to in total, derived from
   * the basis. Null for a percentage agreement whose project carries no
   * value yet — the entitlement is genuinely unknown, and inventing zero
   * would silently cap every accrual at nothing. */
  entitledAmount: string | null;
  accruedAmount: string;
  /** entitledAmount − accruedAmount, or null when the entitlement is
   * unknown. */
  remainingToAccrue: string | null;
  createdAt: string;
  version: number;
}

export interface IntroducerAccrualSummary {
  id: string;
  introducerAgreementId: string;
  accrualNumber: string;
  introducerId: string;
  introducerName: string;
  projectId: string;
  projectName: string;
  accrualDate: string;
  amount: string;
  narrative: string | null;
  status: IntroducerDocumentStatus;
  journalEntryId: string;
  reversalJournalEntryId: string | null;
  reversalReason: string | null;
  /** Settled so far by posted payments. */
  allocatedAmount: string;
  outstandingAmount: string;
  createdAt: string;
  version: number;
}

export interface IntroducerPaymentAllocationInput {
  introducerAccrualId: string;
  allocatedAmount: string;
}

export interface IntroducerPaymentAllocationRow extends IntroducerPaymentAllocationInput {
  id: string;
  accrualNumber: string;
  projectName: string;
}

export interface IntroducerPaymentSummary {
  id: string;
  paymentNumber: string;
  introducerId: string;
  introducerName: string;
  legalEntityId: string;
  legalEntityName: string;
  bankAccountId: string;
  bankAccountName: string;
  paymentDate: string;
  paymentModeId: string | null;
  paymentModeName: string | null;
  referenceNumber: string | null;
  grossAmount: string;
  tdsAmount: string;
  netAmount: string;
  /** The part of gross that matched no accrual. A receivable, never a
   * negative payable (docs/04 §15). */
  advanceAmount: string;
  narrative: string | null;
  status: IntroducerDocumentStatus;
  journalEntryId: string;
  reversalJournalEntryId: string | null;
  reversalReason: string | null;
  createdAt: string;
  version: number;
}

export interface IntroducerPaymentDetail extends IntroducerPaymentSummary {
  allocations: IntroducerPaymentAllocationRow[];
}

/**
 * One introducer's position — docs/04 §15's `introducer-all.html`:
 * "separately show accrued, paid, TDS, advance/unallocated and payable
 * balances". Deliberately five separate figures and never one blended
 * "balance", because they answer five different questions.
 */
export interface IntroducerBalanceRow {
  introducerId: string;
  introducerName: string;
  agreementCount: number;
  /** The plain view: commission agreed across the agreements, what has been
   * paid (gross, TDS included) and what is left to pay. Accrual, settlement,
   * TDS and advance below are the accounting behind it. */
  agreedAmount: string;
  /** False when a percentage agreement's project has no value yet, so part
   * of the commission is not known and agreedAmount is short. */
  agreedComplete: boolean;
  paidAmount: string;
  /** agreedAmount − paidAmount, never below zero. */
  remainingAmount: string;
  lastPaidOn: string | null;
  accruedAmount: string;
  /** Gross settled against accruals — excludes any advance. */
  allocatedAmount: string;
  tdsAmount: string;
  /** Cash that actually left the bank. */
  netPaidAmount: string;
  advanceAmount: string;
  payableAmount: string;
}

export type IntroducerBalanceTotals = Omit<IntroducerBalanceRow, 'introducerId' | 'introducerName' | 'agreementCount' | 'agreedComplete' | 'lastPaidOn'>;

export interface IntroducerFeePort {
  listAgreements(input: {
    organizationId: string;
    filters: { introducerId: string | undefined; projectId: string | undefined; includeInactive: boolean };
  }): Promise<{ rows: IntroducerAgreementSummary[] }>;

  createAgreement(input: {
    organizationId: string;
    introducerId: string;
    projectId: string;
    basisType: IntroducerCommissionBasis;
    ratePercent: string | undefined;
    fixedAmount: string | undefined;
    agreementDate: string;
    remarks: string | undefined;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<IntroducerAgreementSummary>;

  listAccruals(input: {
    organizationId: string;
    filters: { introducerId: string | undefined; projectId: string | undefined; status: IntroducerDocumentStatus | undefined };
  }): Promise<{ rows: IntroducerAccrualSummary[] }>;

  postAccrual(input: {
    organizationId: string;
    introducerAgreementId: string;
    accrualDate: string;
    amount: string;
    narrative: string | undefined;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<IntroducerAccrualSummary>;

  reverseAccrual(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<IntroducerAccrualSummary>;

  listPayments(input: {
    organizationId: string;
    filters: { introducerId: string | undefined; status: IntroducerDocumentStatus | undefined };
  }): Promise<{ rows: IntroducerPaymentSummary[] }>;

  getPaymentDetail(input: { organizationId: string; id: string }): Promise<IntroducerPaymentDetail>;

  postPayment(input: {
    organizationId: string;
    introducerId: string;
    legalEntityId: string;
    bankAccountId: string;
    paymentDate: string;
    paymentModeId: string | undefined;
    referenceNumber: string | undefined;
    grossAmount: string;
    tdsAmount: string;
    narrative: string | undefined;
    allocations: IntroducerPaymentAllocationInput[];
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<IntroducerPaymentSummary>;

  reversePayment(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<IntroducerPaymentSummary>;

  listBalances(input: { organizationId: string }): Promise<{ rows: IntroducerBalanceRow[]; totals: IntroducerBalanceTotals }>;
}
