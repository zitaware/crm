/// Phase 6.8 (ADR-088). Settles part or all of a Credit Card's outstanding
/// payable balance -- see the CardSettlement schema model's own doc
/// comment for the accounting effect and why it has no reversal of its own.
export interface CardSettlementSummary {
  id: string;
  cardAccountId: string;
  cardAccountLabel: string;
  amount: string;
  settlementDate: string;
  bankAccountId: string;
  bankAccountName: string;
  transactionReference: string | null;
  journalEntryId: string;
  createdAt: string;
  createdBy: string | null;
}

export interface CardSettlementPort {
  /** Amount is capped at the card's live outstanding balance (computed from
   * its own ledger account's journal lines, not a locally-stored running
   * total) -- rejected if it would overpay past what was actually charged.
   * Posts Dr CardAccount.ledgerAccountId / Cr the paying BankAccount. */
  settleCreditCard(input: {
    organizationId: string;
    cardAccountId: string;
    amount: string;
    settlementDate: string;
    bankAccountId: string;
    transactionReference: string | undefined;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<CardSettlementSummary>;

  listByCardAccount(input: { organizationId: string; cardAccountId: string }): Promise<CardSettlementSummary[]>;

  getOutstandingBalance(input: { organizationId: string; cardAccountId: string }): Promise<string>;
}
