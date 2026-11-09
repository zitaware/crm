export type DirectExpenseStatus = 'DRAFT' | 'POSTED' | 'CANCELLED' | 'REVERSED';
export type DirectExpenseSupplyType = 'INTRASTATE' | 'INTERSTATE';
/** ADR-169: a server or subscription bill; null for every other expense. */
export type DirectExpenseSpendType = 'SERVER' | 'SUBSCRIPTION';

export interface DirectExpenseSummary {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  expenseCategoryId: string;
  expenseCategoryName: string;
  vendorId: string | null;
  vendorName: string | null;
  title: string;
  projectId: string | null;
  projectName: string | null;
  taxableAmount: string;
  amount: string;
  expenseDate: string;
  gstInvoiceAvailable: boolean;
  gstRatePercent: string | null;
  supplyType: DirectExpenseSupplyType | null;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  /** CGST + SGST + IGST. */
  gstAmount: string;
  itcEligible: boolean;
  tdsAmount: string;
  tdsRatePercent: string | null;
  paymentModeId: string;
  paymentModeLabel: string;
  bankAccountId: string | null;
  bankAccountName: string | null;
  cardAccountId: string | null;
  cardAccountLabel: string | null;
  transactionReference: string | null;
  purchasedByEmployeeId: string | null;
  purchasedByEmployeeName: string | null;
  note: string | null;
  spendType: DirectExpenseSpendType | null;
  billUrl: string | null;
  status: DirectExpenseStatus;
  postedAt: string | null;
  postedBy: string | null;
  journalEntryId: string | null;
  reversalJournalEntryId: string | null;
  reversalReason: string | null;
  reversedBy: string | null;
  reversedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelledReason: string | null;
  createdAt: string;
  createdBy: string | null;
  version: number;
}

export interface DirectExpenseFilters {
  expenseCategoryId?: string | undefined;
  projectId?: string | undefined;
  status?: DirectExpenseStatus | undefined;
  expenseDateFrom?: string | undefined;
  expenseDateTo?: string | undefined;
  /** ANY lists every server and subscription bill. */
  spendType?: DirectExpenseSpendType | 'ANY' | undefined;
}

export interface DirectExpenseWriteInput {
  organizationId: string;
  expenseCategoryId: string;
  vendorId?: string | undefined;
  title: string;
  projectId?: string | undefined;
  legalEntityId?: string | undefined;
  taxableAmount: string;
  expenseDate: string;
  gstInvoiceAvailable: boolean;
  gstRatePercent?: string | undefined;
  supplyType?: DirectExpenseSupplyType | undefined;
  itcEligible?: boolean | undefined;
  tdsAmount?: string | undefined;
  tdsRatePercent?: string | undefined;
  paymentModeId: string;
  bankAccountId?: string | undefined;
  cardAccountId?: string | undefined;
  transactionReference?: string | undefined;
  purchasedByEmployeeId?: string | undefined;
  note?: string | undefined;
  spendType?: DirectExpenseSpendType | null | undefined;
  /** A web address of the bill; null clears it on a draft. */
  billUrl?: string | null | undefined;
}

/** One row of a Server & Subscription Excel import, as read and checked against the masters (ADR-169). */
export interface ServerSubscriptionImportRow {
  rowNumber: number;
  employeeName: string;
  /** Set when the name (or code) matches exactly one active employee, or once the user has chosen. */
  employeeId: string | null;
  /** More than one when several active employees share the name: the user picks one by code. */
  employeeChoices: Array<{ id: string; employeeCode: string; fullName: string }>;
  title: string;
  spendType: DirectExpenseSpendType | null;
  expenseDate: string | null;
  legalEntityName: string | null;
  projectName: string | null;
  expenseCategoryName: string | null;
  paymentModeLabel: string | null;
  /** The card or bank account the row matched, e.g. "Corporate Card •••• 7823". */
  paymentSourceLabel: string | null;
  /** Rupees. */
  taxableAmount: string | null;
  gstAmount: string | null;
  amount: string | null;
  /** INTERSTATE (IGST) unless the sheet or the user says CGST+SGST. Null when there is no GST. */
  supplyType: DirectExpenseSupplyType | null;
  transactionReference: string | null;
  billUrl: string | null;
  errors: string[];
}

export interface ServerSubscriptionImportPreview {
  rows: ServerSubscriptionImportRow[];
  validCount: number;
  errorCount: number;
  /** Rows with no error that still wait for the user to pick an employee. */
  needsChoiceCount: number;
  /** Rupee total of the rows without errors. */
  totalAmount: string;
}

/** What the user decided in the preview, per sheet row. */
export interface ServerSubscriptionImportChoice {
  rowNumber: number;
  employeeId?: string | undefined;
  supplyType?: DirectExpenseSupplyType | undefined;
}

/**
 * One server or subscription bill entered on the form: the sheet's columns,
 * with masters picked by id. Basic and GST are in rupees.
 */
export interface ServerSubscriptionEntryInput {
  spendType: DirectExpenseSpendType;
  title: string;
  employeeId: string;
  legalEntityId: string;
  projectId?: string | undefined;
  expenseCategoryId?: string | undefined;
  expenseDate: string;
  basicAmount: string;
  gstAmount?: string | undefined;
  /** Required when there is GST. */
  supplyType?: DirectExpenseSupplyType | undefined;
  paymentModeId: string;
  cardAccountId?: string | undefined;
  bankAccountId?: string | undefined;
  transactionReference?: string | undefined;
  note?: string | undefined;
  /** A web address of the bill. */
  billUrl?: string | undefined;
}

export interface ServerSubscriptionImportPort {
  downloadSample(): Promise<{ filename: string; contentBase64: string }>;
  preview(input: { organizationId: string; contentBase64: string; choices: ServerSubscriptionImportChoice[] }): Promise<ServerSubscriptionImportPreview>;
  /** All or nothing on validation: any row with an error, or still waiting for an employee, imports nothing. Each row posts as a direct expense. */
  importRows(input: {
    organizationId: string;
    contentBase64: string;
    choices: ServerSubscriptionImportChoice[];
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<{ created: number; totalAmount: string }>;

  /** Add one bill by hand: checked like an imported row, then posted. */
  createEntry(input: { organizationId: string; entry: ServerSubscriptionEntryInput; idempotencyKey: string; actorId: string; correlationId: string }): Promise<DirectExpenseSummary>;

  /**
   * A posted bill is never edited (ADR-169): correcting it reverses it on
   * reversalDate and posts the corrected bill, both kept in the history.
   */
  correctEntry(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    reversalDate: string;
    entry: ServerSubscriptionEntryInput;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<DirectExpenseSummary>;
}

/// The other branch of the shared expense-add.html prototype (docs/04,
/// docs/06 "Direct expense paid immediately") -- a company-paid bill with no
/// employee/wallet involvement, deliberately deferred out of Phase 6.6
/// (Employee Advance & Expense Claim, docs/12 ADR-081) and built as its own
/// follow-up (ADR-087). No maker-checker (confirmed via AskUserQuestion,
/// docs/04's own wording contrasting it with a Claim, which "waits for
/// approval/settlement"): `post` is the sole authoritative action, not a
/// second-person approval step. No Lead as a link target (same
/// simplification as Employee Expense Claim) and no project-scoping
/// anywhere in this module -- purely Accountant/Admin-facing.
///
/// Phase 6.8 (docs/12 ADR-088) replaced the flat gstCreditAmount this port
/// shipped with (ADR-087) with a full CGST/SGST/IGST split
/// (taxableAmount/gstRatePercent/supplyType/itcEligible), added optional
/// flat TDS (tdsAmount/tdsRatePercent), an optional vendor link, and
/// Debit/Credit Card posting (cardAccountId, alongside the now-optional
/// bankAccountId) -- see DirectExpensesService for the exact computation
/// and posting shape.
export interface DirectExpensePort {
  /** DRAFT only. legalEntityId derives from projectId when given (mirrors
   * Vendor Bill/Employee Expense Claim); when projectId is absent ("company
   * overhead"), legalEntityId must be supplied directly. amount/GST split/
   * TDS are all server-computed from taxableAmount + gstRatePercent +
   * supplyType -- never accepted directly from the caller. */
  createDraft(input: DirectExpenseWriteInput & { idempotencyKey: string; actorId: string; correlationId: string }): Promise<DirectExpenseSummary>;

  /** DRAFT only, creator-only (ownership check against `createdBy`, mirrors
   * VendorBillsService's own DRAFT-stage mutation scoping). */
  updateDraft(
    input: {
      organizationId: string;
      id: string;
      expectedVersion: number;
    } & { [K in keyof Omit<DirectExpenseWriteInput, 'organizationId'>]?: DirectExpenseWriteInput[K] | undefined } & {
      actorId: string;
      correlationId: string;
    },
  ): Promise<DirectExpenseSummary>;

  /** DRAFT only, creator-only, reason required. */
  cancelDraft(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<DirectExpenseSummary>;

  /** DRAFT -> POSTED. Not ownership-restricted -- any direct_expense.post
   * holder may post any DRAFT, since there is deliberately no
   * maker-checker to enforce a same-actor or different-actor rule. Posts
   * one journal: Dr [expense category ledger account] (taxable + any
   * ITC-ineligible GST) + Dr Input CGST/SGST/IGST Receivable (ITC-eligible
   * split, only lines > 0) / Cr [bank or card-derived ledger account]
   * (amount minus tdsAmount) + Cr TDS Payable (tdsAmount, only if > 0). */
  post(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<DirectExpenseSummary>;

  /** One-hop create+post (draft-create validation + the post() journal, no
   * intermediate review step) for callers that need an already-POSTED
   * result in one call -- the Server & Subscription import (ADR-169). */
  createAndPostDraft(input: DirectExpenseWriteInput & { idempotencyKey: string; actorId: string; correlationId: string }): Promise<DirectExpenseSummary>;

  /** POSTED -> REVERSED. Mirrors EmployeeAdvance/VendorPayment's own
   * reversal exactly (expectedVersion-guarded, mandatory reason +
   * accountingDate, calls the shared PostingService.reverseJournal). */
  reverse(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<DirectExpenseSummary>;

  list(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: DirectExpenseFilters;
  }): Promise<{ rows: DirectExpenseSummary[]; total: number }>;

  getDetail(input: { organizationId: string; id: string }): Promise<DirectExpenseSummary>;
}
