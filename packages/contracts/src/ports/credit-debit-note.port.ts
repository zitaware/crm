export type CreditDebitNoteType = 'CREDIT' | 'DEBIT';
export type CreditDebitNoteStatus = 'DRAFT' | 'FINALIZED' | 'VOID';

export interface CreditDebitNoteLineInput {
  description: string;
  hsnSac: string | undefined;
  quantity: string;
  unitPrice: string;
  gstRatePercent: string;
}

export interface CreditDebitNoteLineSummary {
  id: string;
  sequence: number;
  description: string;
  hsnSac: string | null;
  quantity: string;
  unitPrice: string;
  taxableAmount: string;
  gstRatePercent: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  lineTotal: string;
}

export interface CreditDebitNoteSummary {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  projectId: string;
  projectName: string;
  legalEntityId: string;
  legalEntityName: string;
  gstRegistrationId: string;
  gstRegistrationGstin: string;
  type: CreditDebitNoteType;
  status: CreditDebitNoteStatus;
  reason: string;
  noteNumber: string | null;
  noteDate: string | null;
  taxableAmount: string | null;
  cgstAmount: string | null;
  sgstAmount: string | null;
  igstAmount: string | null;
  totalAmount: string | null;
  journalEntryId: string | null;
  voidJournalEntryId: string | null;
  voidReason: string | null;
  voidedBy: string | null;
  voidedAt: string | null;
  version: number;
}

export interface CreditDebitNoteDetail extends CreditDebitNoteSummary {
  lines: CreditDebitNoteLineSummary[];
}

export interface CreditDebitNoteFilters {
  invoiceId?: string | undefined;
  projectId?: string | undefined;
  type?: CreditDebitNoteType | undefined;
  status?: CreditDebitNoteStatus | undefined;
}

export interface CreditDebitNotePort {
  /** The only creation path — mirrors Invoice's own "no free-standing
   * creation" rule (docs/04 §18): a note always originates from one
   * specific FINALIZED invoice. Rejects if the invoice is DRAFT/VOID. */
  createDraft(input: {
    organizationId: string;
    invoiceId: string;
    type: CreditDebitNoteType;
    reason: string;
    lines: CreditDebitNoteLineInput[];
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<CreditDebitNoteSummary>;

  /** Only reachable while status is DRAFT. */
  updateDraft(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string | undefined;
    lines: CreditDebitNoteLineInput[] | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<CreditDebitNoteSummary>;

  /** Computes CGST+SGST/IGST from the invoice's own buyer/seller state
   * pairing, generates the note number (scoped to GST registration +
   * financial year + type, so Credit and Debit Notes get independent
   * series), posts the mirrored docs/06 journal (Credit Note: Dr Project
   * Revenue + Dr Output GST / Cr Accounts Receivable; Debit Note: the
   * opposite direction), and always posts into today's currently open
   * accounting period — never the original invoice's, matching the
   * Reversal Mechanism precedent (ADR-067). A CREDIT note is rejected if
   * it (plus every other FINALIZED credit note against the same invoice)
   * would exceed the invoice's own taxable amount. Never touches the
   * source Invoice's own status or its PaymentAlert. Immutable
   * afterward. */
  finalize(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<CreditDebitNoteSummary>;

  /** A DRAFT voids with a simple status flip. A FINALIZED note voids by
   * calling PostingService.reverseJournal against the finalize posting
   * (same mechanism Invoice.void already reuses). */
  void(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string | undefined;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<CreditDebitNoteSummary>;

  list(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: CreditDebitNoteFilters;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<{ rows: CreditDebitNoteSummary[]; total: number }>;

  getDetail(input: { organizationId: string; id: string; actorId: string; canSeeAll: boolean }): Promise<CreditDebitNoteDetail>;
}
