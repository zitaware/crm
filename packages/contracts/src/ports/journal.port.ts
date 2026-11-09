export type JournalEntryStatus = 'DRAFT' | 'POSTED' | 'REVERSED';

export interface JournalLineSummary {
  id: string;
  ledgerAccountId: string;
  ledgerAccountCode: string;
  ledgerAccountName: string;
  debitAmount: string;
  creditAmount: string;
  projectId: string | null;
  projectName: string | null;
  partyId: string | null;
  partyName: string | null;
  employeeId: string | null;
  employeeName: string | null;
  gstRegistrationId: string | null;
  taxCode: string | null;
  narrative: string | null;
}

export interface JournalEntrySummary {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  accountingDate: string;
  accountingPeriodId: string;
  sourceType: string;
  sourceId: string;
  postingEvent: string;
  description: string | null;
  status: JournalEntryStatus;
  /** Sum of the debit side (always equal to the credit side — a posted
   * journal is balanced by construction). */
  totalAmount: string;
  postedAt: string;
  /** Set only on a reversal entry — points at the original entry it
   * undoes. Null on every ordinary (non-reversal) entry. */
  reversalOfJournalEntryId: string | null;
  /** Set only on an original entry once it has been reversed — points at
   * the new reversal entry. Derived from the reciprocal side of the same
   * self-relation, never a second stored column. */
  reversedByJournalEntryId: string | null;
  /** The remaining four are set only on the original entry once reversed
   * (never on the reversal entry itself). */
  reversalReason: string | null;
  reversedBy: string | null;
  reversedAt: string | null;
}

export interface JournalEntryDetail extends JournalEntrySummary {
  lines: JournalLineSummary[];
}

export interface JournalEntryFilters {
  legalEntityId?: string | undefined;
  sourceType?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

export interface LedgerActivityRow {
  id: string;
  journalEntryId: string;
  accountingDate: string;
  postingEvent: string;
  sourceType: string;
  sourceId: string;
  debitAmount: string;
  creditAmount: string;
  /** Running balance after this row, signed per the account's own normal
   * balance (DEBIT-normal: debit increases it; CREDIT-normal: credit
   * increases it) — never computed client-side. */
  runningBalance: string;
  narrative: string | null;
}

export interface PostJournalLineInput {
  ledgerAccountId: string;
  debit: string;
  credit: string;
  projectId: string | undefined;
  partyId: string | undefined;
  employeeId: string | undefined;
  gstRegistrationId: string | undefined;
  taxCode: string | undefined;
  narrative: string | undefined;
}

export interface JournalPort {
  /** Internal-only — no tRPC procedure exposes this. Called by other
   * backend services when a real posting event occurs (none exist yet;
   * EMD/SD is the first planned caller). Idempotent via the existing
   * IdempotencyKey registry (commandType-scoped); a repeat call with the
   * same key and an identical request returns the original entry
   * unchanged, a repeat with a different request throws
   * IDEMPOTENCY_CONFLICT. */
  postJournal(input: {
    organizationId: string;
    legalEntityId: string;
    accountingDate: string;
    sourceType: string;
    sourceId: string;
    postingEvent: string;
    description: string | undefined;
    lines: PostJournalLineInput[];
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<JournalEntrySummary>;

  listEntries(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: JournalEntryFilters;
  }): Promise<{ rows: JournalEntrySummary[]; total: number }>;

  getEntryDetail(input: { organizationId: string; id: string }): Promise<JournalEntryDetail>;

  /** Unlike postJournal, this IS a direct, human-triggered correction
   * action (docs/04: "Correction actions must request a reason") — it has
   * a real tRPC procedure, gated `journal.reverse` (ADR-067). Creates a
   * new, opposite-signed entry referencing the original (docs/06:
   * "Reversal entries reference the original entry" — the original's own
   * lines are never edited) and flips the original to REVERSED,
   * atomically. Only a POSTED entry may be reversed — an already-REVERSED
   * or (unreachable) DRAFT entry throws INVALID_STATE_TRANSITION. The
   * reversal's own accountingDate is independent of the original's — it
   * lands in whatever period is open today, not the original's
   * (possibly since-LOCKED) period. Idempotent via the same generic
   * IdempotencyKey registry every other command in this app uses. */
  reverseJournal(input: {
    organizationId: string;
    id: string;
    accountingDate: string;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<JournalEntrySummary>;

  /** Every posted line against one ledger account, chronological, with a
   * running balance — the "Ledger Viewer" docs/04 names. `legalEntityId`
   * is optional/backward-compatible (undefined = every legal entity's
   * activity summed together, today's original behavior); the UI always
   * supplies it going forward so one legal entity's books are never mixed
   * into another's balance (ledger accounts themselves are org-wide, not
   * legal-entity-scoped — ADR-062 — so without this filter two entities
   * posting against the same account code would share one number). */
  getLedgerActivity(input: {
    organizationId: string;
    ledgerAccountId: string;
    legalEntityId: string | undefined;
    dateFrom: string | undefined;
    dateTo: string | undefined;
  }): Promise<{ rows: LedgerActivityRow[]; openingBalance: string; closingBalance: string }>;
}
