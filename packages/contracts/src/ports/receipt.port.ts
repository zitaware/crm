export type ClientReceiptStatus = 'POSTED' | 'REVERSED';

export type AllocationDeductionType =
  | 'TDS'
  | 'CGST_TDS'
  | 'SGST_TDS'
  | 'IGST_TDS'
  | 'HOLD'
  | 'RETENTION'
  | 'ACCEPTED_PENALTY'
  | 'DISPUTED_PENALTY'
  | 'OTHER';

export interface DeductionInput {
  type: AllocationDeductionType;
  amount: string;
  ratePercent: string | undefined;
  penaltyCategoryId: string | undefined;
  otherLedgerAccountId: string | undefined;
  narrative: string | undefined;
}

export interface AllocationInput {
  invoiceId: string;
  /** On an invoice billing several CAPEX events, the one event this
   * allocation pays (ADR-151). Omitted means the whole invoice. */
  sourceEventId?: string | undefined;
  cashAllocated: string;
  deductions: DeductionInput[];
}

export interface DeductionSummary {
  id: string;
  type: AllocationDeductionType;
  amount: string;
  ratePercent: string | null;
  penaltyCategoryId: string | null;
  penaltyCategoryName: string | null;
  otherLedgerAccountId: string | null;
  otherLedgerAccountName: string | null;
  narrative: string | null;
  releasedAmount: string;
  outstandingAmount: string;
}

export interface AllocationSummary {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  /** The invoice's project, for linking to it (an allocation may be on another project of the same client). */
  invoiceProjectId: string;
  sourceEventId: string | null;
  sourceEventName: string | null;
  invoiceTaxableAmountSnapshot: string;
  invoiceCgstSnapshot: string;
  invoiceSgstSnapshot: string;
  invoiceIgstSnapshot: string;
  invoiceTotalSnapshot: string;
  cashAllocated: string;
  settledAmount: string;
  deductions: DeductionSummary[];
}

export interface ClientReceiptSummary {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  bankAccountId: string;
  bankAccountName: string;
  paymentModeId: string;
  paymentModeLabel: string;
  receiptDate: string;
  utrReference: string | null;
  actualAmount: string;
  status: ClientReceiptStatus;
  journalEntryId: string | null;
  reversalJournalEntryId: string | null;
  reversalReason: string | null;
  reversedBy: string | null;
  reversedAt: string | null;
  clientName: string;
  projectIds: string[];
  projectNames: string[];
  invoiceNumbers: string[];
  version: number;
}

export interface ClientReceiptDetail extends ClientReceiptSummary {
  allocations: AllocationSummary[];
}

export interface ReceiptFilters {
  projectId?: string | undefined;
  legalEntityId?: string | undefined;
  status?: ClientReceiptStatus | undefined;
}

export interface AllocationCandidateInvoice {
  id: string;
  invoiceNumber: string;
  projectId: string;
  projectName: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  totalAmount: string;
  outstandingAmount: string;
  /** One entry per CAPEX event when the invoice bills two or more; empty
   * otherwise. `outstandingAmount` counts only allocations naming that
   * event — whole-invoice payments reduce the invoice, not an event. */
  capexEvents: AllocationCandidateEvent[];
}

export interface AllocationCandidateEvent {
  sourceEventId: string;
  name: string;
  taxableAmount: string;
  totalAmount: string;
  outstandingAmount: string;
}

export interface AllocationCandidates {
  legalEntityId: string;
  legalEntityName: string;
  clientId: string;
  clientName: string;
  bankAccountOptions: Array<{ id: string; accountName: string; bankName: string | null }>;
  invoices: AllocationCandidateInvoice[];
}

export interface ReceiptPreviewAllocation {
  invoiceId: string;
  sourceEventId: string | null;
  cashAllocated: string;
  deductionsTotal: string;
  settledAmount: string;
  outstandingBefore: string;
  outstandingAfter: string;
}

export interface ReceiptPreview {
  allocations: ReceiptPreviewAllocation[];
  debitLines: Array<{ ledgerAccountCode: string; ledgerAccountName: string; amount: string }>;
  creditTotal: string;
  balanced: boolean;
}

export interface OutstandingDeduction {
  id: string;
  type: AllocationDeductionType;
  amount: string;
  outstandingAmount: string;
  invoiceId: string;
  invoiceNumber: string | null;
  receiptId: string;
}

export interface ReceiptPort {
  /** Seeded from a specific FINALIZED invoice ("Record Payment") — resolves
   * that invoice's client + legal entity, then returns every other
   * FINALIZED invoice for the same client/legal entity with outstanding
   * amount > 0, since one receipt is one client's remittance and all
   * allocated invoices must share the receiving bank account's legal
   * entity (docs/04 point 8). */
  getAllocationCandidates(input: {
    organizationId: string;
    seedInvoiceId: string;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<AllocationCandidates>;

  /** Pure computation, persists nothing — CLAUDE.md: never calculate
   * accounting totals independently in React components, so the add-form
   * calls this before enabling Post rather than computing the settlement
   * client-side. Reuses postReceipt's own validation, so a preview that
   * succeeds is guaranteed to post identically. */
  calculatePreview(input: {
    organizationId: string;
    bankAccountId: string;
    allocations: AllocationInput[];
  }): Promise<ReceiptPreview>;

  /** The only creation path — one atomic post, no draft/finalize split
   * (docs/04 names only receipt.post). Rejects if any allocated invoice
   * is not FINALIZED, if the bank account and every allocated invoice
   * don't share one legal entity, if allocated invoices don't share one
   * client, if sum(cashAllocated) != actualAmount, or if any allocation
   * would exceed its invoice's live-computed outstanding amount. */
  postReceipt(input: {
    organizationId: string;
    bankAccountId: string;
    paymentModeId: string;
    receiptDate: string;
    utrReference: string | undefined;
    actualAmount: string;
    allocations: AllocationInput[];
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<ClientReceiptDetail>;

  /** Calls the existing PostingService.reverseJournal (Slice 4.6) against
   * the receipt's own journal entry. Does not revert allocation/deduction
   * rows — reversal undoes the accounting effect, not the historical
   * record (same principle ADR-067/068 established for journal/invoice
   * reversal). A reversed receipt's allocations are excluded from future
   * outstanding computations via a status filter, not a data mutation. */
  reverseReceipt(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<ClientReceiptDetail>;

  /** Releases part or all of a HOLD/RETENTION deduction — docs/06
   * "Hold/retention release": Dr Bank; Cr Hold/Retention Receivable.
   * Rejects if the target deduction isn't HOLD/RETENTION or if
   * releasedAmount exceeds the live-computed outstanding amount. */
  releaseDeduction(input: {
    organizationId: string;
    deductionId: string;
    releasedAmount: string;
    releasedOn: string;
    bankAccountId: string;
    utrReference: string | undefined;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<OutstandingDeduction>;

  /** Every HOLD/RETENTION deduction (across all of this org's receipts)
   * with outstanding > 0 — powers the release action's own picker and the
   * receipt detail page's "Release..." list. */
  getOutstandingDeductions(input: {
    organizationId: string;
    projectId: string | undefined;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<OutstandingDeduction[]>;

  list(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: ReceiptFilters;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<{ rows: ClientReceiptSummary[]; total: number }>;

  getDetail(input: { organizationId: string; id: string; actorId: string; canSeeAll: boolean }): Promise<ClientReceiptDetail>;
}
