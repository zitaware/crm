export type VendorPaymentStatus = 'POSTED' | 'REVERSED';

/** TDS/GST-TDS subset of AllocationDeductionType only (docs/12 ADR-080) —
 * Hold/Retention/Penalty-on-payment were confirmed out of scope. */
export type VendorPaymentDeductionType = 'TDS' | 'CGST_TDS' | 'SGST_TDS' | 'IGST_TDS';

export interface DeductionInput {
  type: VendorPaymentDeductionType;
  amount: string;
  ratePercent: string | undefined;
  narrative: string | undefined;
}

export interface AllocationInput {
  paymentRequestLineId: string;
  cashPaid: string;
  deductions: DeductionInput[];
}

export interface VendorPaymentDeductionSummary {
  id: string;
  type: VendorPaymentDeductionType;
  amount: string;
  ratePercent: string | null;
  narrative: string | null;
}

export interface VendorPaymentAllocationSummary {
  id: string;
  paymentRequestLineId: string;
  paymentRequestId: string;
  requestNumber: string | null;
  vendorBillId: string;
  vendorBillNumber: string;
  vendorBillTaxableAmountSnapshot: string;
  requestedAmountSnapshot: string;
  cashPaid: string;
  settledAmount: string;
  deductions: VendorPaymentDeductionSummary[];
}

export interface VendorPaymentSummary {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  /** Exactly one of bank account / credit card is set (ADR-179). */
  bankAccountId: string | null;
  bankAccountName: string | null;
  cardAccountId: string | null;
  cardAccountLabel: string | null;
  paymentModeId: string;
  paymentModeLabel: string;
  paymentDate: string;
  utrReference: string | null;
  actualAmount: string;
  status: VendorPaymentStatus;
  journalEntryId: string | null;
  reversalJournalEntryId: string | null;
  reversalReason: string | null;
  reversedBy: string | null;
  reversedAt: string | null;
  vendorName: string;
  projectIds: string[];
  projectNames: string[];
  vendorBillNumbers: string[];
  version: number;
}

export interface VendorPaymentDetail extends VendorPaymentSummary {
  allocations: VendorPaymentAllocationSummary[];
}

export interface VendorPaymentFilters {
  projectId?: string | undefined;
  legalEntityId?: string | undefined;
  status?: VendorPaymentStatus | undefined;
  /** Powers the Payment Request detail page's own "Vendor Payments" card. */
  paymentRequestId?: string | undefined;
}

export interface EligiblePaymentRequestLine {
  id: string;
  paymentRequestId: string;
  requestNumber: string | null;
  vendorBillId: string;
  vendorBillNumber: string;
  /** Null for a company-overhead bill (ADR-177). */
  projectId: string | null;
  projectName: string | null;
  vendorBillTaxableAmount: string;
  requestedAmount: string;
  availableToPay: string;
}

export interface EligiblePaymentRequestLines {
  vendorId: string;
  vendorName: string;
  legalEntityId: string;
  legalEntityName: string;
  bankAccountOptions: Array<{ id: string; accountName: string; bankName: string | null }>;
  lines: EligiblePaymentRequestLine[];
}

export interface VendorPaymentPreviewAllocation {
  paymentRequestLineId: string;
  cashPaid: string;
  deductionsTotal: string;
  settledAmount: string;
  availableBefore: string;
  availableAfter: string;
}

export interface VendorPaymentPreview {
  allocations: VendorPaymentPreviewAllocation[];
  creditLines: Array<{ ledgerAccountCode: string; ledgerAccountName: string; amount: string }>;
  debitTotal: string;
  balanced: boolean;
}

export interface VendorPaymentPort {
  /** Seeded from a specific APPROVED PaymentRequest ("Record Payment") —
   * resolves that request's vendor + legal entity, then returns every
   * APPROVED PaymentRequestLine for the same vendor/legal entity (across
   * every APPROVED request, not just the seed one — one vendor payment may
   * batch several requests' lines) with a live "available to pay" balance
   * > 0. Project-scoped when !canSeeAll, mirroring
   * PaymentRequestsService.getEligibleBills. */
  getEligiblePaymentRequestLines(input: {
    organizationId: string;
    vendorId: string | undefined;
    legalEntityId: string | undefined;
    seedPaymentRequestId: string | undefined;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<EligiblePaymentRequestLines>;

  /** Sums live "available to pay" across every line of one APPROVED
   * PaymentRequest — powers the Payment Request detail page's own
   * "Record Payment…" visibility (shown only when a balance remains). */
  getPaymentRequestAvailability(input: { organizationId: string; paymentRequestId: string }): Promise<{ available: string }>;

  /** Pure computation, persists nothing — CLAUDE.md: never calculate
   * accounting totals independently in React components. Reuses
   * postVendorPayment's own validation, so a preview that succeeds is
   * guaranteed to post identically. */
  calculatePreview(input: {
    organizationId: string;
    bankAccountId: string;
    allocations: AllocationInput[];
  }): Promise<VendorPaymentPreview>;

  /** The only creation path — one atomic post, no draft/finalize split and
   * no maker-checker (the authorization gate already happened at
   * PaymentRequest's own approve()). Rejects if any allocated line's
   * parent request is not APPROVED, if the bank account and every
   * allocated line don't share one legal entity, if allocated lines don't
   * share one vendor, if sum(cashPaid) != actualAmount, or if any
   * allocation would exceed its line's live-computed available balance. */
  postVendorPayment(input: {
    organizationId: string;
    bankAccountId: string | undefined;
    cardAccountId?: string | undefined;
    paymentModeId: string;
    paymentDate: string;
    utrReference: string | undefined;
    actualAmount: string;
    allocations: AllocationInput[];
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<VendorPaymentDetail>;

  /** Calls the existing PostingService.reverseJournal against the
   * payment's own journal entry. Does not revert allocation/deduction
   * rows — reversal undoes the accounting effect, not the historical
   * record. A reversed payment's allocations are excluded from future
   * "available to pay" computations via a status filter, not a data
   * mutation. */
  reverseVendorPayment(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<VendorPaymentDetail>;

  list(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: VendorPaymentFilters;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<{ rows: VendorPaymentSummary[]; total: number }>;

  getDetail(input: { organizationId: string; id: string; actorId: string; canSeeAll: boolean }): Promise<VendorPaymentDetail>;
}
