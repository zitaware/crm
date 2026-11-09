export type PaymentRequestStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'REVOKED';
export type PaymentRequestDecisionType = 'APPROVED' | 'REJECTED' | 'REVOKED';
export type PaymentRequestPriority = 'NORMAL' | 'URGENT' | 'LOW';

export interface PaymentRequestLineInput {
  vendorBillId: string;
  requestedAmount: string;
}

/** One FINALIZED vendor bill offered as a candidate line, with its live
 * "available for request" balance already resolved server-side —
 * `availableForRequest = vendorBill.totalAmount - alreadyReserved`, where
 * alreadyReserved sums requestedAmount across every OTHER PaymentRequestLine
 * on this bill whose parent request is SUBMITTED or APPROVED. */
export interface EligibleVendorBillSummary {
  vendorBillId: string;
  vendorBillNumber: string;
  /** Null for a company-overhead bill (ADR-177). */
  projectId: string | null;
  projectName: string | null;
  vendorBillDate: string;
  /** Derived display-only from vendorBillDate + the vendor's own
   * VendorProfile.paymentTerms offset, when set. Never stored. */
  dueDate: string | null;
  totalAmount: string;
  alreadyReserved: string;
  availableForRequest: string;
}

export interface PaymentRequestLineSummary {
  id: string;
  vendorBillId: string;
  vendorBillNumber: string;
  /** Null for a company-overhead bill (ADR-177). */
  projectId: string | null;
  projectName: string | null;
  vendorBillDate: string;
  vendorBillTotalAmount: string;
  requestedAmount: string;
}

export interface PaymentRequestDecisionSummary {
  id: string;
  decision: PaymentRequestDecisionType;
  actorId: string;
  decidedAt: string;
  note: string | null;
  isSelfApproval: boolean;
}

export interface PaymentRequestSummary {
  id: string;
  requestNumber: string | null;
  vendorId: string;
  vendorName: string;
  legalEntityId: string;
  legalEntityName: string;
  requestedPaymentDate: string;
  priority: PaymentRequestPriority;
  remarks: string | null;
  totalRequestedAmount: string | null;
  status: PaymentRequestStatus;
  createdBy: string | null;
  submittedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelledReason: string | null;
  createdAt: string;
  version: number;
}

export interface PaymentRequestDetail extends PaymentRequestSummary {
  lines: PaymentRequestLineSummary[];
  /** Newest first. */
  decisions: PaymentRequestDecisionSummary[];
}

export interface PaymentRequestFilters {
  vendorId?: string | undefined;
  legalEntityId?: string | undefined;
  status?: PaymentRequestStatus | undefined;
  /** Powers the Vendor Bill detail page's own "Payment Requests" card. */
  vendorBillId?: string | undefined;
}

export interface PaymentRequestPreviewLine {
  vendorBillId: string;
  vendorBillNumber: string;
  available: string;
  requestedAmount: string;
  valid: boolean;
}

/** Mirrors what `submit` will actually persist/validate — reuses the same
 * live-availability calculation `createDraft`/`updateDraft`/`submit` use
 * internally, so the preview and the real command can never disagree. */
export interface PaymentRequestPreview {
  lines: PaymentRequestPreviewLine[];
  totalRequestedAmount: string;
  valid: boolean;
}

export interface PaymentRequestPort {
  list(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: PaymentRequestFilters;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<{ rows: PaymentRequestSummary[]; total: number }>;

  getDetail(input: { organizationId: string; id: string; actorId: string; canSeeAll: boolean }): Promise<PaymentRequestDetail>;

  /** Resolves vendor+legal-entity (either given directly, or entirely
   * server-side from `seedVendorBillId` when a Payment Request is raised
   * from a specific Vendor Bill's own detail page — a client-supplied
   * vendorId/legalEntityId is ignored whenever a seed is present) and
   * returns every FINALIZED bill for that vendor+legal-entity with a live
   * available balance > 0, project-scoped when `!canSeeAll`. */
  getEligibleBills(input: {
    organizationId: string;
    vendorId: string | undefined;
    legalEntityId: string | undefined;
    seedVendorBillId: string | undefined;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<{
    vendorId: string;
    vendorName: string;
    legalEntityId: string;
    legalEntityName: string;
    bills: EligibleVendorBillSummary[];
  }>;

  /** Lightweight single-bill availability check powering the Vendor Bill
   * detail page's own "Raise Payment Request…" visibility (shown only
   * when a balance remains, not merely "when finalized"). */
  getBillAvailability(input: { organizationId: string; vendorBillId: string }): Promise<{ available: string }>;

  /** Non-mutating. Reserves nothing — `submit`'s own locked revalidation
   * remains the sole authoritative gate. */
  calculatePreview(input: {
    organizationId: string;
    vendorId: string;
    legalEntityId: string;
    lines: PaymentRequestLineInput[];
    actorId: string;
    canSeeAll: boolean;
  }): Promise<PaymentRequestPreview>;

  /** Assigns `requestNumber` immediately (PMR-000001). vendorId/
   * legalEntityId are fixed for the life of the request — never editable
   * via updateDraft. Requires at least one line. */
  createDraft(input: {
    organizationId: string;
    vendorId: string;
    legalEntityId: string;
    requestedPaymentDate: string;
    priority: PaymentRequestPriority | undefined;
    remarks: string | undefined;
    lines: PaymentRequestLineInput[];
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<PaymentRequestSummary>;

  /** Only reachable while status is DRAFT. Lines are replaced wholesale
   * when supplied. */
  updateDraft(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    requestedPaymentDate: string | undefined;
    priority: PaymentRequestPriority | undefined;
    remarks: string | undefined;
    lines: PaymentRequestLineInput[] | undefined;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<PaymentRequestSummary>;

  /** The authoritative, concurrency-safe reservation gate — locks every
   * referenced Vendor Bill row (ascending id order, deadlock-safe) and
   * revalidates live availability inside one transaction before flipping
   * DRAFT -> SUBMITTED. */
  submit(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<PaymentRequestSummary>;

  /** Rejects if the actor is the request's own creator UNLESS they hold
   * `payment_request.self_approve` AND supply a non-empty `note`. */
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
  }): Promise<PaymentRequestSummary>;

  /** `reason` is mandatory. Terminal — no resubmission path. */
  reject(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<PaymentRequestSummary>;

  /** Creator-only withdrawal, reachable from DRAFT or SUBMITTED. `reason`
   * is mandatory. */
  cancel(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<PaymentRequestSummary>;

  /** Only reachable from APPROVED. Releases the reservation without ever
   * having posted anything. `reason` is mandatory. Recorded as a
   * PaymentRequestDecision row (REVOKED), same as approve/reject. */
  revoke(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<PaymentRequestSummary>;
}
