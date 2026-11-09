/**
 * Bank statement import and reconciliation matching (Phase 8.6a, ADR-114).
 * A statement line (the bank's record) is matched to bank journal lines (the
 * books' record) for equal amounts; what cannot be matched is explained by
 * an exception that someone other than its author approves.
 */

export type BankStatementAmountMode = 'DEBIT_CREDIT_COLUMNS' | 'SIGNED_AMOUNT' | 'AMOUNT_WITH_INDICATOR';
export type BankStatementDateFormat = 'YYYY_MM_DD' | 'DD_MM_YYYY_SLASH' | 'DD_MM_YYYY_DASH' | 'DD_MMM_YYYY' | 'MM_DD_YYYY_SLASH';
export const BANK_STATEMENT_DATE_FORMAT_LABELS: Record<BankStatementDateFormat, string> = {
  YYYY_MM_DD: '2026-07-31',
  DD_MM_YYYY_SLASH: '31/07/2026',
  DD_MM_YYYY_DASH: '31-07-2026',
  DD_MMM_YYYY: '31-Jul-2026 or 31 Jul 2026',
  MM_DD_YYYY_SLASH: '07/31/2026',
};

export interface BankStatementProfileInput {
  dateColumn: string;
  dateFormat: BankStatementDateFormat;
  descriptionColumn: string;
  referenceColumn: string | undefined;
  amountMode: BankStatementAmountMode;
  debitColumn: string | undefined;
  creditColumn: string | undefined;
  amountColumn: string | undefined;
  indicatorColumn: string | undefined;
  creditIndicator: string | undefined;
  balanceColumn: string | undefined;
}

export interface BankStatementProfile extends Omit<BankStatementProfileInput, 'referenceColumn' | 'debitColumn' | 'creditColumn' | 'amountColumn' | 'indicatorColumn' | 'creditIndicator' | 'balanceColumn'> {
  id: string;
  bankAccountId: string;
  referenceColumn: string | null;
  debitColumn: string | null;
  creditColumn: string | null;
  amountColumn: string | null;
  indicatorColumn: string | null;
  creditIndicator: string | null;
  balanceColumn: string | null;
  version: number;
}

/** A CSV as the browser read it: the header cells and every following row's cells. */
export interface BankStatementCsv {
  fileName: string;
  headers: string[];
  rows: string[][];
}

export interface BankStatementPreviewRow {
  rowNumber: number;
  transactionDate: string | null;
  description: string;
  reference: string | null;
  /** Signed: positive is money in. */
  amount: string | null;
  balance: string | null;
  /** READY to import; DUPLICATE already imported (or repeated identically); SKIPPED a summary or blank row; ERROR must be fixed. */
  outcome: 'READY' | 'DUPLICATE' | 'SKIPPED' | 'ERROR';
  errors: string[];
}

export interface BankStatementImportPreview {
  rows: BankStatementPreviewRow[];
  readyCount: number;
  duplicateCount: number;
  skippedCount: number;
  errorCount: number;
  firstDate: string | null;
  lastDate: string | null;
  totalIn: string;
  totalOut: string;
}

export type BankLineStatus = 'UNMATCHED' | 'PARTIALLY_MATCHED' | 'MATCHED';
export type BankExceptionStatus = 'NONE' | 'PENDING_APPROVAL' | 'APPROVED';

export interface BankStatementLineRow {
  id: string;
  transactionDate: string;
  description: string;
  reference: string | null;
  amount: string;
  balance: string | null;
  matchedAmount: string;
  remaining: string;
  status: BankLineStatus;
  exception: BankExceptionStatus;
  exceptionReason: string | null;
}

export interface BankBookLineRow {
  journalLineId: string;
  journalEntryId: string;
  accountingDate: string;
  sourceType: string;
  description: string;
  amount: string;
  matchedAmount: string;
  remaining: string;
  status: BankLineStatus;
}

export interface BankMatchRow {
  id: string;
  statementLineId: string;
  journalLineId: string;
  amount: string;
  createdAt: string;
}

export interface BankReconciliationWorkspace {
  bankAccountId: string;
  bankAccountName: string;
  legalEntityName: string;
  from: string;
  to: string;
  profile: BankStatementProfile | null;
  /** Lines dated in the range, plus any older line still not fully matched or explained. */
  statementLines: BankStatementLineRow[];
  bookLines: BankBookLineRow[];
  matches: BankMatchRow[];
  summary: {
    statementIn: string;
    statementOut: string;
    bookIn: string;
    bookOut: string;
    unmatchedStatementCount: number;
    unmatchedStatementAmount: string;
    unmatchedBookCount: number;
    unmatchedBookAmount: string;
    pendingExceptionCount: number;
  };
}

/** docs/05: OPEN is a month with no reconciliation record yet. */
export type BankReconciliationPeriodStatus = 'OPEN' | 'IN_PROGRESS' | 'RECONCILED' | 'LOCKED';

/**
 * The bank reconciliation statement for one month (Phase 8.6b, ADR-115),
 * computed by the server from the account's first reconciled month onwards:
 *   adjusted book balance = book closing − book opening at the start
 *     + statement opening at the start − uncleared book entries + bank-only items
 *   unexplained difference = statement closing − adjusted book balance
 * A LOCKED or RECONCILED month shows the figures it was reconciled with.
 */
export interface BankReconciliationStatement {
  bankAccountId: string;
  month: string;
  periodStart: string;
  periodEnd: string;
  status: BankReconciliationPeriodStatus;
  /** The account's first reconciled month (or this one, when none is yet): its opening balance must be entered. */
  isFirstPeriod: boolean;
  reconciliationStart: string;
  statementOpeningBalance: string | null;
  statementLinesTotal: string;
  statementClosingBalance: string | null;
  bookOpeningAtStart: string;
  bookClosingBalance: string;
  unclearedBookAmount: string;
  unclearedBookCount: number;
  bankOnlyAmount: string;
  exceptionAmount: string;
  adjustedBookBalance: string | null;
  unexplainedDifference: string | null;
  /** Why the month cannot be marked reconciled yet; empty when it can. */
  blockers: string[];
  preparedAt: string | null;
  preparedBy: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  version: number | null;
}

export interface BankReconciliationPeriodRow {
  month: string;
  status: BankReconciliationPeriodStatus;
  statementClosingBalance: string | null;
  bookClosingBalance: string | null;
  preparedAt: string | null;
  lockedAt: string | null;
}

export interface BankReconciliationPort {
  getProfile(input: { organizationId: string; bankAccountId: string }): Promise<BankStatementProfile | null>;
  saveProfile(input: BankStatementProfileInput & { organizationId: string; bankAccountId: string; expectedVersion: number | undefined; actorId: string; correlationId: string }): Promise<BankStatementProfile>;
  previewImport(input: BankStatementCsv & { organizationId: string; bankAccountId: string }): Promise<BankStatementImportPreview>;
  importStatement(input: BankStatementCsv & { organizationId: string; bankAccountId: string; actorId: string; correlationId: string }): Promise<{ importId: string; created: number; duplicates: number; skipped: number }>;
  getWorkspace(input: { organizationId: string; bankAccountId: string; from: string; to: string }): Promise<BankReconciliationWorkspace>;
  matchSelected(input: { organizationId: string; bankAccountId: string; statementLineIds: string[]; journalLineIds: string[]; actorId: string; correlationId: string }): Promise<{ matchCount: number }>;
  autoMatch(input: { organizationId: string; bankAccountId: string; from: string; to: string; actorId: string; correlationId: string }): Promise<{ matchCount: number }>;
  unmatchStatementLine(input: { organizationId: string; statementLineId: string; reason: string; actorId: string; correlationId: string }): Promise<{ unmatchedCount: number }>;
  markException(input: { organizationId: string; statementLineId: string; reason: string; actorId: string; correlationId: string }): Promise<BankStatementLineRow>;
  approveException(input: { organizationId: string; statementLineId: string; actorId: string; correlationId: string }): Promise<BankStatementLineRow>;
  getStatement(input: { organizationId: string; bankAccountId: string; month: string; statementOpeningBalance: string | undefined; statementClosingBalance: string | undefined }): Promise<BankReconciliationStatement>;
  listPeriods(input: { organizationId: string; bankAccountId: string }): Promise<BankReconciliationPeriodRow[]>;
  markReconciled(input: { organizationId: string; bankAccountId: string; month: string; statementOpeningBalance: string | undefined; statementClosingBalance: string; actorId: string; correlationId: string }): Promise<BankReconciliationStatement>;
  lockPeriod(input: { organizationId: string; bankAccountId: string; month: string; expectedVersion: number; actorId: string; correlationId: string }): Promise<BankReconciliationStatement>;
  clearException(input: { organizationId: string; statementLineId: string; reason: string; actorId: string; correlationId: string; canApprove: boolean }): Promise<BankStatementLineRow>;
}
