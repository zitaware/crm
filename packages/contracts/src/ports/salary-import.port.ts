/**
 * Monthly gross salary import (Phase 7.4, ADR-094).
 *
 * docs/16 §7.6: "Imported monthly gross salary is the historical costing
 * source." This — not `Employee.displayedSalaryAmount`, which is a
 * current-state display figure that may be edited at any time — is what
 * Slice 7.6's project manpower cost multiplies by an allocation
 * percentage.
 *
 * Only gross salary is imported. Deductions, net pay, statutory
 * contributions and payslips are out of scope: docs/00 excludes payroll
 * processing outright and docs/06 gives none of them a posting rule.
 */
/** DRAFT is generated and reviewable but has posted nothing (ADR-098). */
export type SalaryImportStatus = 'DRAFT' | 'POSTED' | 'REVERSED';

/** One row as it came out of the uploaded sheet, before matching. */
export interface SalaryImportRowInput {
  employeeCode: string;
  employeeName: string | undefined;
  grossSalaryAmount: string;
}

/** Why a row cannot be committed. `MATCHED` rows are the only committable
 * ones; every other value is a blocking problem the screen must show. */
export type SalaryImportRowStatus = 'MATCHED' | 'UNMATCHED' | 'DUPLICATE' | 'INACTIVE' | 'INVALID_AMOUNT' | 'AMBIGUOUS';

export interface SalaryImportPreviewRow {
  rowNumber: number;
  employeeCode: string;
  employeeName: string | null;
  grossSalaryAmount: string;
  status: SalaryImportRowStatus;
  /** Resolved only when status is MATCHED. */
  employeeId: string | null;
  /** The employee's name as this system holds it, so a mismatch against the
   * sheet's own name is visible before committing. */
  matchedEmployeeName: string | null;
  message: string | null;
  /** AMBIGUOUS: a row with a name and no code matches several active
   * employees; the screen asks which one by code (ADR-170). */
  candidates: Array<{ employeeCode: string; fullName: string; currentSalary: string | null }>;
  /** The candidate whose salary on record equals the row's amount, when exactly one does. */
  suggestedEmployeeCode: string | null;
}

export interface SalaryImportPreview {
  salaryMonth: string;
  rows: SalaryImportPreviewRow[];
  matchedCount: number;
  problemCount: number;
  totalGrossAmount: string;
  /** Set when a POSTED batch already covers this legal entity and month.
   * Reversing that batch frees the month. */
  existingImportId: string | null;
  existingImportMessage: string | null;
  /** Employees active in this legal entity's organization who appear in no
   * row at all — not an error (a joiner mid-month may legitimately be
   * absent), but the accountant should see it before committing. */
  missingEmployeeNames: string[];
  isCommittable: boolean;
}

export interface SalaryImportLineRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  employeeCodeRaw: string;
  employeeNameRaw: string | null;
  grossSalaryAmount: string;
  /** Settled for THIS employee so far, across POSTED payments (ADR-101). */
  paidAmount: string;
  /** grossSalaryAmount - paidAmount for a POSTED batch; '0.00' otherwise. */
  outstandingAmount: string;
}

export interface SalaryImportSummary {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  salaryMonth: string;
  accountingDate: string;
  sourceFileName: string | null;
  sourceChecksum: string | null;
  employeeCount: number;
  totalGrossAmount: string;
  status: SalaryImportStatus;
  /** Null only while the batch is a DRAFT. */
  journalEntryId: string | null;
  reversalJournalEntryId: string | null;
  reversalReason: string | null;
  /** Settled so far (ADR-100) — POSTED payments only, so a reversed payment
   * correctly restores the outstanding balance. Always '0.00' for a batch
   * that has posted nothing. */
  paidAmount: string;
  /** totalGrossAmount - paidAmount for a POSTED batch; '0.00' otherwise,
   * because a DRAFT owes nothing yet and a REVERSED one owes nothing any
   * more. */
  outstandingAmount: string;
  createdAt: string;
  version: number;
}

export interface SalaryImportDetail extends SalaryImportSummary {
  lines: SalaryImportLineRow[];
  payments: SalaryPaymentSummary[];
}

/**
 * Settlement of a posted salary month (ADR-100).
 *
 * The import recognises the cost and the liability; this discharges it.
 * Without it `SALARY_PAYABLE` is credit-only and "what we still owe staff"
 * grows forever. Settling a liability already recorded is a bank
 * disbursement, not the payroll processing docs/00 excludes — attendance,
 * leave and computing pay remain out of scope.
 */
export type SalaryPaymentStatus = 'POSTED' | 'REVERSED';

/** One employee's share of a payment — the amount, what was withheld from
 * it, and the bank reference for that specific credit. */
export interface SalaryPaymentLineRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  paidAmount: string;
  tdsAmount: string;
  netAmount: string;
  referenceNumber: string | null;
}

export interface SalaryPaymentLineInput {
  employeeId: string;
  paidAmount: string;
  tdsAmount: string;
  referenceNumber: string | undefined;
}

export interface SalaryPaymentSummary {
  id: string;
  salaryImportId: string;
  salaryMonth: string;
  legalEntityId: string;
  legalEntityName: string;
  bankAccountId: string;
  bankAccountName: string;
  paymentNumber: string;
  paymentDate: string;
  paymentModeId: string | null;
  referenceNumber: string | null;
  /** The payable discharged; always tdsAmount + netAmount. */
  grossAmount: string;
  /** Withheld, not paid — it moves to TDS Payable rather than leaving. */
  tdsAmount: string;
  netAmount: string;
  narrative: string | null;
  status: SalaryPaymentStatus;
  journalEntryId: string;
  reversalJournalEntryId: string | null;
  reversalReason: string | null;
  createdAt: string;
  version: number;
  /** Who was paid, how much, and under which reference. Never empty — a
   * payment with no employees would settle nothing. */
  lines: SalaryPaymentLineRow[];
}

export interface SalaryImportPort {
  list(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: { legalEntityId: string | undefined; status: SalaryImportStatus | undefined };
  }): Promise<{ rows: SalaryImportSummary[]; total: number }>;

  getDetail(input: { organizationId: string; id: string }): Promise<SalaryImportDetail>;

  /** Read-only dry run — resolves every row against the employee master and
   * reports every problem at once, without writing anything. */
  preview(input: {
    organizationId: string;
    legalEntityId: string;
    salaryMonth: string;
    rows: SalaryImportRowInput[];
  }): Promise<SalaryImportPreview>;

  /** Generates this month's DRAFT from each employee's effective salary
   * revision. Idempotent: an existing draft for the month is returned rather
   * than regenerated, so a worker tick and a human click cannot make two. */
  generateDraft(input: {
    organizationId: string;
    legalEntityId: string;
    salaryMonth: string;
    actorId: string;
    correlationId: string;
  }): Promise<SalaryImportSummary>;

  /** Replaces a draft's rows — the CSV path, and how exceptions (joiners,
   * unpaid leave, bonuses) are applied before committing. */
  replaceDraftRows(input: {
    organizationId: string;
    id: string;
    sourceFileName: string | undefined;
    rows: SalaryImportRowInput[];
    actorId: string;
    correlationId: string;
  }): Promise<SalaryImportSummary>;

  discardDraft(input: { organizationId: string; id: string; actorId: string; correlationId: string }): Promise<void>;

  /** Promotes a DRAFT to POSTED, posting Dr Salaries & Wages Expense /
   * Cr Salary Payable. The reviewed rows and the posted rows are the same
   * rows by construction — it posts what the draft holds. */
  commit(input: {
    organizationId: string;
    id: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<SalaryImportSummary>;

  reverse(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<SalaryImportSummary>;

  /**
   * Settles part or all of a POSTED month, employee by employee (ADR-101).
   *
   * Each line posts Dr Salary Payable / Cr TDS Payable / Cr Bank stamped with
   * that employee's id, mirroring the per-employee credit the import made, so
   * "what is still owed to this person" is answerable from the ledger itself.
   * A zero leg is omitted — the posting engine rejects a line that is neither
   * a debit nor a credit.
   *
   * Each employee's own outstanding is enforced, not merely the month's
   * total: paying one person more than they are owed while the month still
   * has headroom elsewhere would leave a negative payable for that person.
   */
  pay(input: {
    organizationId: string;
    salaryImportId: string;
    bankAccountId: string;
    paymentDate: string;
    paymentModeId: string | undefined;
    /** Optional batch reference, for a single bulk file uploaded to the bank.
     * The per-credit UTR belongs on the line. */
    referenceNumber: string | undefined;
    /** One entry per employee being paid. Header totals are DERIVED from
     * these, never sent — a client-supplied total that disagreed with its
     * own lines would be a second, contradictory truth. */
    lines: SalaryPaymentLineInput[];
    narrative: string | undefined;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<SalaryPaymentSummary>;

  reversePayment(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<SalaryPaymentSummary>;

  listPayments(input: { organizationId: string; salaryImportId: string | undefined }): Promise<SalaryPaymentSummary[]>;
}
