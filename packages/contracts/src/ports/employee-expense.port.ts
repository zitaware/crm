export type EmployeeAdvanceStatus = 'POSTED' | 'REVERSED';
export type EmployeeExpenseClaimStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'REIMBURSED';
export type EmployeeExpenseClaimDecisionType = 'APPROVED' | 'REJECTED';

export interface EmployeeAdvanceSummary {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  employeeId: string;
  employeeName: string;
  projectId: string | null;
  projectName: string | null;
  amount: string;
  advanceDate: string;
  paymentModeId: string;
  paymentModeLabel: string;
  bankAccountId: string;
  bankAccountName: string;
  utrReference: string | null;
  purpose: string | null;
  note: string | null;
  status: EmployeeAdvanceStatus;
  journalEntryId: string | null;
  reversalJournalEntryId: string | null;
  reversalReason: string | null;
  reversedBy: string | null;
  reversedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  version: number;
}

export interface EmployeeExpenseClaimDecisionSummary {
  id: string;
  decision: EmployeeExpenseClaimDecisionType;
  actorId: string;
  decidedAt: string;
  note: string | null;
  isSelfApproval: boolean;
  /** Who decided, by name (ADR-171). */
  actorName: string | null;
}

/** A user who approves expense claims (ADR-171). */
export interface ClaimApproverUser {
  userId: string;
  name: string;
  email: string;
}

/**
 * Who approves a legal entity's claims, worked out from the users holding
 * employee_claim.approve (ADR-171): those whose employee record is in this
 * legal entity, or who see every legal entity (ADR-182). Never anyone from
 * another legal entity; the list can be empty.
 */
export interface LegalEntityClaimApprovers {
  legalEntityId: string;
  legalEntityName: string;
  rule: 'LISTED';
  approvers: ClaimApproverUser[];
}

export interface EmployeeExpenseClaimSummary {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  employeeId: string;
  employeeName: string;
  expenseCategoryId: string;
  expenseCategoryName: string;
  title: string;
  projectId: string | null;
  projectName: string | null;
  amount: string;
  expenseDate: string;
  gstInvoiceAvailable: boolean;
  gstCreditAmount: string;
  note: string | null;
  status: EmployeeExpenseClaimStatus;
  submittedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelledReason: string | null;
  journalEntryId: string | null;
  reimbursementJournalEntryId: string | null;
  reimbursementReversalJournalEntryId: string | null;
  reimbursementReversalReason: string | null;
  reimbursedAt: string | null;
  reimbursedBy: string | null;
  createdBy: string | null;
  createdAt: string;
  version: number;
  /** Who approves this claim (ADR-171, ADR-182): its legal entity's approvers, possibly none. Null on a command's reply. */
  approval: { rule: 'LISTED'; approverNames: string[]; approverUserIds: string[] } | null;
  /** The latest approve or reject: by whom and when. */
  lastDecision: { decision: EmployeeExpenseClaimDecisionType; byName: string | null; at: string } | null;
  reimbursedByName: string | null;
}

export interface EmployeeExpenseClaimDetail extends EmployeeExpenseClaimSummary {
  decisions: EmployeeExpenseClaimDecisionSummary[];
}

export interface EmployeeAdvanceFilters {
  employeeId?: string | undefined;
  legalEntityId?: string | undefined;
  status?: EmployeeAdvanceStatus | undefined;
}

export interface EmployeeExpenseClaimFilters {
  employeeId?: string | undefined;
  expenseCategoryId?: string | undefined;
  projectId?: string | undefined;
  status?: EmployeeExpenseClaimStatus | undefined;
  expenseDateFrom?: string | undefined;
  expenseDateTo?: string | undefined;
  /** Matches against EmployeeExpenseClaimDecision.decidedAt where
   * decision = APPROVED, not a column on the claim itself — a claim has
   * no separate "approvedAt" field, only its decision history. */
  approvedDateFrom?: string | undefined;
  approvedDateTo?: string | undefined;
}

/** Same filter dimensions as EmployeeExpenseClaimFilters minus `status` —
 * getClaimStats computes one figure per fixed status (or, for Advance
 * Outstanding, no status at all), so a status filter would be
 * self-contradictory. */
export type EmployeeExpenseClaimStatsFilters = Omit<EmployeeExpenseClaimFilters, 'status'>;

export interface EmployeeExpenseClaimStats {
  pendingApproval: { amount: string; count: number };
  approvedToPay: { amount: string; count: number };
  /** isCurrentFinancialYear is true only when neither expenseDate* nor
   * approvedDate* filters were supplied, in which case this figure
   * defaults to the org's current financial year (matching the "(FY)"
   * label on the UI tile) — supplying either date filter narrows this
   * the same way it narrows listClaims instead, and the flag flips false
   * so the UI can drop the "(FY)" qualifier from its own label. */
  reimbursed: { amount: string; count: number; isCurrentFinancialYear: boolean };
  /** A current point-in-time EMPLOYEE_ADVANCE_RECEIVABLE control-account
   * balance, not a historical range — only employeeId/projectId narrow
   * it; expenseCategoryId and the date filters do not apply to a running
   * balance and are ignored here. employeeCount counts only employees
   * with a POSITIVE (debit) balance — i.e. still holding unspent advance,
   * not employees the company currently owes money to. */
  advanceOutstanding: { amount: string; employeeCount: number };
}

export type EmployeeWalletEntryType = 'ADVANCE' | 'CLAIM' | 'REIMBURSEMENT' | 'ADVANCE_REVERSAL' | 'REIMBURSEMENT_REVERSAL';

/** One row per posted event affecting one employee's own
 * EMPLOYEE_ADVANCE_RECEIVABLE control-account balance — `debit` increases
 * the balance (advance given, reimbursement paid, or a reversal undoing a
 * claim's own Cr), `credit` decreases it (claim approved, or a reversal
 * undoing an advance/reimbursement's own Dr). `runningBalance` is the
 * signed ledger-account balance after this entry (positive = employee
 * holds unspent advance; negative = company owes the employee). */
export interface EmployeeWalletStatementEntry {
  date: string;
  type: EmployeeWalletEntryType;
  particulars: string;
  sourceId: string;
  debit: string;
  credit: string;
  runningBalance: string;
}

export interface EmployeeWalletStatement {
  employeeId: string;
  employeeName: string;
  month: string;
  openingBalance: string;
  entries: EmployeeWalletStatementEntry[];
  closingBalance: string;
  totalAdvances: string;
  totalClaims: string;
  totalReimbursed: string;
}

export interface EmployeeExpensePort {
  /** Resolves whether the acting user has a linked, reimbursable Employee
   * record — powers the "Add Expense"/"My Statement" pages' own upfront
   * eligibility check, no special permission required beyond being
   * authenticated. */
  getMyEmployeeStatus(input: { organizationId: string; actorId: string }): Promise<{ hasEmployee: boolean; isReimbursable: boolean; employeeName: string | null }>;

  /** Self-service — resolves the acting employee from the session
   * (actorId), never from a client-supplied employeeId. */
  getMyWalletStatement(input: { organizationId: string; actorId: string; month: string }): Promise<EmployeeWalletStatement>;

  /** Self-service — every claim the acting employee has ever submitted
   * (all statuses), newest first. */
  getMyClaims(input: { organizationId: string; actorId: string }): Promise<EmployeeExpenseClaimSummary[]>;

  /** Pure computation, persists nothing — CLAUDE.md: never calculate
   * accounting totals independently in React components. Powers the Give
   * Advance page's own wallet-impact preview panel. */
  calculateAdvanceWalletImpact(input: { organizationId: string; employeeId: string; amount: string }): Promise<{ currentBalance: string; newBalance: string }>;

  /** The only creation path for an advance — one atomic post, no
   * maker-checker (mirrors ClientReceipt's own shape). Rejects if the
   * employee is not reimbursable/active or the bank account is inactive. */
  issueAdvance(input: {
    organizationId: string;
    employeeId: string;
    projectId: string | undefined;
    legalEntityId: string | undefined;
    amount: string;
    advanceDate: string;
    paymentModeId: string;
    bankAccountId: string;
    utrReference: string | undefined;
    purpose: string | undefined;
    note: string | undefined;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeAdvanceSummary>;

  /** Mirrors ReceiptsService.reverseReceipt exactly. */
  reverseAdvance(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeAdvanceSummary>;

  listAdvances(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: EmployeeAdvanceFilters;
  }): Promise<{ rows: EmployeeAdvanceSummary[]; total: number }>;

  getAdvanceDetail(input: { organizationId: string; id: string }): Promise<EmployeeAdvanceSummary>;

  /** Requires at least a title/category/amount/date; legalEntityId is
   * required only when projectId is not supplied ("company overhead").
   * The claiming employee is normally resolved from `actorId` server-side
   * (self-service). An actor holding `employee_claim.approve` may instead
   * pass an explicit `employeeId` to raise a claim on behalf of an
   * employee with no CRM login of their own (rejected as FORBIDDEN for
   * anyone else). Rejects if the resolved employee has no linked Employee
   * record, or it is not reimbursable/active. */
  createClaimDraft(input: {
    organizationId: string;
    employeeId: string | undefined;
    expenseCategoryId: string;
    title: string;
    projectId: string | undefined;
    legalEntityId: string | undefined;
    amount: string;
    expenseDate: string;
    gstInvoiceAvailable: boolean;
    gstCreditAmount: string | undefined;
    note: string | undefined;
    idempotencyKey: string;
    actorId: string;
    hasApprovePermission: boolean;
    correlationId: string;
  }): Promise<EmployeeExpenseClaimSummary>;

  /** Only reachable while status is DRAFT, and only by the claim's own
   * employee (ownership check against the actor's own resolved employee,
   * not a permission — `employee_claim.create` is broadly granted) — OR
   * by an actor holding `employee_claim.approve`, who may manage any
   * employee's claim, including one raised on their behalf. */
  updateClaimDraft(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    expenseCategoryId: string | undefined;
    title: string | undefined;
    projectId: string | undefined;
    legalEntityId: string | undefined;
    amount: string | undefined;
    expenseDate: string | undefined;
    gstInvoiceAvailable: boolean | undefined;
    gstCreditAmount: string | undefined;
    note: string | undefined;
    actorId: string;
    hasApprovePermission: boolean;
    correlationId: string;
  }): Promise<EmployeeExpenseClaimSummary>;

  /** DRAFT -> SUBMITTED. Ownership-checked, same as updateClaimDraft. */
  submitClaim(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    idempotencyKey: string;
    actorId: string;
    hasApprovePermission: boolean;
    correlationId: string;
  }): Promise<EmployeeExpenseClaimSummary>;

  /** SUBMITTED -> APPROVED. Posts the expense-recognition journal (Dr
   * expense category's own ledger account + Dr Input GST Receivable —
   * Expense Claims [flat gstCreditAmount] / Cr Employee Advance
   * Receivable). Rejects if the actor is the claim's own creator UNLESS
   * they hold `employee_claim.self_approve` AND supply a non-empty
   * `note`. */
  approveClaim(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    note: string | undefined;
    idempotencyKey: string;
    actorId: string;
    hasSelfApprovePermission: boolean;
    correlationId: string;
  }): Promise<EmployeeExpenseClaimSummary>;

  /** SUBMITTED -> REJECTED. `reason` is mandatory. Terminal. */
  rejectClaim(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeExpenseClaimSummary>;

  /** Creator-only withdrawal (ownership-checked, same as
   * updateClaimDraft), reachable from DRAFT or SUBMITTED. `reason` is
   * mandatory. */
  cancelClaim(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    hasApprovePermission: boolean;
    correlationId: string;
  }): Promise<EmployeeExpenseClaimSummary>;

  /** APPROVED -> REIMBURSED. One claim, one payment — no partial or
   * batched reimbursement. Posts Dr Employee Advance Receivable / Cr the
   * paying bank account, for this claim's own full amount. No
   * paymentModeId/utrReference column exists on this model — the journal
   * entry itself (traceable via reimbursementJournalEntryId) is the
   * source of truth for which bank account settled it, same as every
   * other reversal/settlement action in this codebase that doesn't
   * persist a redundant payment-mode column. */
  reimburseClaim(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    bankAccountId: string;
    reimbursementDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeExpenseClaimSummary>;

  /** Only reachable once REIMBURSED. Mirrors
   * VendorPaymentsService.reverseVendorPayment exactly. Reversing an
   * APPROVED-but-not-yet-reimbursed claim's own approve-journal is not
   * supported this slice. */
  reverseReimbursement(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeExpenseClaimSummary>;

  listClaims(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: EmployeeExpenseClaimFilters;
  }): Promise<{ rows: EmployeeExpenseClaimSummary[]; total: number }>;

  /** Powers the 4 summary tiles on the Employee Reimbursements list page
   * (Pending Approval / Approved — To Pay / Reimbursed / Advance
   * Outstanding), matching expense-employee.html's own tile row exactly.
   * See EmployeeExpenseClaimStats for the per-tile filter semantics. */
  getClaimStats(input: { organizationId: string; filters: EmployeeExpenseClaimStatsFilters }): Promise<EmployeeExpenseClaimStats>;

  /** Blends admin and self-service access in one procedure (mirrors this
   * codebase's own `canSeeAll` pattern): when `hasReadPermission` is
   * false, only returns the claim if it belongs to the actor's own
   * resolved employee (NOT_FOUND otherwise) — lets a plain Employee
   * (who holds `employee_claim.create` only, never `.read`) still view
   * their own claim's detail page after submitting it. */
  getClaimDetail(input: { organizationId: string; id: string; actorId: string; hasReadPermission: boolean }): Promise<EmployeeExpenseClaimDetail>;

  /** Who approves claims, per legal entity, worked out from each approver's own legal entity (ADR-171). */
  listClaimApprovers(input: { organizationId: string }): Promise<{ entities: LegalEntityClaimApprovers[] }>;
}
