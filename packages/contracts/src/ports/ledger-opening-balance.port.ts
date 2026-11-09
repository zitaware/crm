export type LedgerOpeningBalanceStatus = 'ACTIVE' | 'VOID';

export interface LedgerOpeningBalanceSummary {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  ledgerAccountId: string;
  ledgerAccountCode: string;
  ledgerAccountName: string;
  /** 'YYYY-MM-DD'. */
  asOfDate: string;
  /** Signed exactly like LedgerActivityRow.runningBalance: positive = the
   * account's own normal-balance side, negative = the abnormal side. */
  amount: string;
  status: LedgerOpeningBalanceStatus;
  journalEntryId: string;
  voidJournalEntryId: string | null;
  voidReason: string | null;
  voidedBy: string | null;
  voidedAt: string | null;
}

export interface LedgerOpeningBalancePort {
  /** Posts a normal Dr/Cr journal entry (via the existing postJournal,
   * dated asOfDate) against the fixed OPENING_BALANCE_EQUITY account —
   * getLedgerActivity's existing sum-of-journal-lines formula picks it up
   * automatically, no separate balance-computation path. Rejects if an
   * ACTIVE opening balance already exists for this legal entity + ledger
   * account (void it first). */
  set(input: {
    organizationId: string;
    legalEntityId: string;
    ledgerAccountId: string;
    asOfDate: string;
    amount: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<LedgerOpeningBalanceSummary>;

  /** Reverses the opening-balance journal via the existing reverseJournal
   * (same mechanism Invoice/CreditDebitNote/Receipt void already reuse).
   * Correcting a balance means voiding this one, then calling set() again
   * with the right figure. */
  void(input: {
    organizationId: string;
    id: string;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<LedgerOpeningBalanceSummary>;

  /** The current ACTIVE opening balance for one legal entity + ledger
   * account, or null if none has been set — the only read this feature
   * needs; the posting/reversal itself is already visible on the Journal
   * Entries page like any other entry. */
  getForAccount(input: {
    organizationId: string;
    legalEntityId: string;
    ledgerAccountId: string;
  }): Promise<LedgerOpeningBalanceSummary | null>;
}
