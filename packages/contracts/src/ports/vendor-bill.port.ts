export type VendorBillStatus = 'DRAFT' | 'SUBMITTED' | 'FINALIZED' | 'REJECTED' | 'CANCELLED' | 'VOID';
export type VendorBillPriority = 'NORMAL' | 'URGENT' | 'LOW';
export type VendorBillDecisionType = 'APPROVED' | 'REJECTED';

export interface VendorBillLineInput {
  description: string;
  /** A line is EITHER an expense line (expenseCategoryId) or a stock line
   * (inventoryItemId) — never both, never neither (Phase 7.2, ADR-092,
   * DB-enforced by chk_vendor_bill_lines_expense_or_inventory). An expense
   * line debits its category's ledger account; a stock line debits
   * INVENTORY and creates an InventoryMovement when the bill is approved,
   * per docs/06's two separate "Finalize vendor bill" tables. */
  expenseCategoryId: string | undefined;
  /** Must reference an item with isStockTracked = true — docs/01:
   * "Stock-tracked items use Inventory; non-stock goods/services use
   * Expense." */
  inventoryItemId: string | undefined;
  /** Required on every new create/update call (enforced in the zod schema)
   * even though the underlying column is nullable — one real, already-VOID
   * row predates this field with no data to backfill it from. */
  unitOfMeasureId: string;
  hsnSac: string | undefined;
  quantity: string;
  unitPrice: string;
  gstRatePercent: string;
  /** docs/06: "Ineligible GST is included in cost rather than Input GST
   * Receivable" — a per-line decision, since one bill can mix eligible and
   * blocked items. */
  itcEligible: boolean;
}

export interface VendorBillLineSummary {
  id: string;
  sequence: number;
  description: string;
  /** Null on a stock line — see VendorBillLineInput. */
  expenseCategoryId: string | null;
  expenseCategoryName: string | null;
  /** Null on an expense line. */
  inventoryItemId: string | null;
  inventoryItemName: string | null;
  inventoryItemCode: string | null;
  /** Null only for the one legacy row that predates this field. */
  unitOfMeasureId: string | null;
  unitOfMeasureName: string | null;
  hsnSac: string | null;
  quantity: string;
  unitPrice: string;
  taxableAmount: string;
  gstRatePercent: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  itcEligible: boolean;
  lineTotal: string;
}

/** One row of a `calculatePreview` response — the same computed shape as
 * `VendorBillLineSummary` minus the fields that only exist once a line is
 * actually persisted (`id`). */
export interface VendorBillLinePreviewRow {
  sequence: number;
  description: string;
  expenseCategoryId: string | null;
  expenseCategoryName: string | null;
  inventoryItemId: string | null;
  inventoryItemName: string | null;
  unitOfMeasureId: string;
  unitOfMeasureName: string;
  hsnSac: string | null;
  quantity: string;
  unitPrice: string;
  taxableAmount: string;
  gstRatePercent: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  itcEligible: boolean;
  lineTotal: string;
}

export interface VendorBillLinesPreview {
  lines: VendorBillLinePreviewRow[];
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  totalAmount: string;
}

export interface VendorBillDecisionSummary {
  id: string;
  decision: VendorBillDecisionType;
  actorId: string;
  decidedAt: string;
  note: string | null;
  isSelfApproval: boolean;
}

export interface VendorBillSummary {
  id: string;
  /** Null for a company-overhead bill (ADR-177). */
  projectId: string | null;
  projectName: string | null;
  /** Links to the vendor's invoice and the payment receipt, when given (ADR-178). */
  billUrl: string | null;
  paymentReceiptUrl: string | null;
  vendorId: string;
  vendorName: string;
  priority: VendorBillPriority;
  legalEntityId: string;
  legalEntityName: string;
  gstRegistrationId: string;
  gstRegistrationGstin: string;
  /** The vendor's own invoice/bill number — never system-generated. */
  vendorBillNumber: string;
  vendorBillDate: string;
  status: VendorBillStatus;
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
  createdBy: string | null;
  submittedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelledReason: string | null;
  createdAt: string;
  version: number;
}

export interface VendorBillDetail extends VendorBillSummary {
  lines: VendorBillLineSummary[];
  /** Newest first. At most one row this slice — REJECTED/CANCELLED are
   * terminal, and a FINALIZED bill is never decided again. */
  decisions: VendorBillDecisionSummary[];
}

export interface VendorBillFilters {
  projectId?: string | undefined;
  vendorId?: string | undefined;
  status?: VendorBillStatus | undefined;
}

export interface VendorBillPort {
  /** Pure, non-mutating — reuses the same `computeLines` createDraft/
   * updateDraft persist with, just without writing anything. Powers the
   * live "as you type" summary panel and the per-line GST-rate/amount
   * two-way conversion on the frontend (same shape as
   * `receipts.calculatePreview`). */
  calculatePreview(input: {
    organizationId: string;
    vendorId: string;
    gstRegistrationId: string;
    lines: VendorBillLineInput[];
    actorId: string;
    canSeeAll: boolean;
  }): Promise<VendorBillLinesPreview>;

  /** Requires at least one line. `vendorId`/`projectId`/`priority` are
   * entered directly (Purchase Request no longer exists as a separate
   * pre-bill document, merged Phase 6.4 — docs/12 ADR-079); `legalEntityId`
   * is the project's; only a bill without a project (company overhead,
   * ADR-177) names it. */
  createDraft(input: {
    organizationId: string;
    projectId: string | undefined;
    legalEntityId?: string | undefined;
    vendorId: string;
    priority: VendorBillPriority | undefined;
    gstRegistrationId: string;
    vendorBillNumber: string;
    vendorBillDate: string;
    lines: VendorBillLineInput[];
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<VendorBillSummary>;

  /** Only reachable while status is DRAFT. */
  updateDraft(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    /** Null clears it (company overhead, ADR-177). */
    projectId: string | null | undefined;
    legalEntityId?: string | undefined;
    vendorId: string | undefined;
    priority: VendorBillPriority | undefined;
    gstRegistrationId: string | undefined;
    vendorBillNumber: string | undefined;
    vendorBillDate: string | undefined;
    lines: VendorBillLineInput[] | undefined;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<VendorBillSummary>;

  /** Flips DRAFT -> SUBMITTED. Every field becomes immutable afterward
   * except status/cancellation/decision fields — mirrors the deleted
   * PurchaseRequest.submit() exactly. */
  submit(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<VendorBillSummary>;

  /** Only reachable from SUBMITTED. Rejects if the actor is the bill's own
   * creator UNLESS they hold `vendor_bill.self_approve` AND supply a
   * non-empty `note` — the self-approval exception, recorded permanently on
   * the resulting VendorBillDecision row (`isSelfApproval`). On success,
   * computes real GST (CGST+SGST vs IGST from vendor-state vs
   * GST-registration-state comparison, reusing `computeLines`), splits
   * ITC-eligible vs ineligible per line, and posts Dr Expense (grouped by
   * resolved ledger account) + Dr Input CGST/SGST/IGST Receivable (eligible
   * only) / Cr Accounts Payable — Vendor, all in the same transaction as
   * the decision row and the SUBMITTED -> FINALIZED status flip. Approve
   * and the ledger posting are one combined action (docs/12 ADR-079) —
   * there is no separate "finalize" step anymore. */
  approve(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    note: string | undefined;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    hasSelfApprovePermission: boolean;
    correlationId: string;
  }): Promise<VendorBillSummary>;

  /** Only reachable from SUBMITTED. `reason` is mandatory. Terminal — no
   * resubmission path. */
  reject(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<VendorBillSummary>;

  /** Creator-only withdrawal, reachable from DRAFT or SUBMITTED. `reason`
   * is mandatory. Replaces voiding a draft — Void is reserved for reversing
   * an already-posted (FINALIZED) bill's journal entry. */
  cancel(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<VendorBillSummary>;

  /** Only reachable from FINALIZED — reverses the posted journal entry via
   * the existing reverseJournal, matching Invoice.void exactly. */
  void(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<VendorBillSummary>;

  list(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: VendorBillFilters;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<{ rows: VendorBillSummary[]; total: number }>;

  getDetail(input: { organizationId: string; id: string; actorId: string; canSeeAll: boolean }): Promise<VendorBillDetail>;
}
