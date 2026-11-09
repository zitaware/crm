import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type { CardSettlementPort, CardSettlementSummary } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';

const SETTLE_COMMAND_TYPE = 'card_account.settle';

function hashRequest(input: unknown): string {
  const normalized = JSON.stringify(input, Object.keys(input as object).sort());
  return createHash('sha256').update(normalized).digest('hex');
}

function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function formatCardAccountLabel(card: { displayName: string; maskedLastFour: string; cardNumber?: string | null }): string {
  const number = card.cardNumber ? card.cardNumber.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ') : `•••• ${card.maskedLastFour}`;
  return `${number} · ${card.displayName.trim()}`;
}

const cardSettlementInclude = { cardAccount: true, bankAccount: true } satisfies Prisma.CardSettlementInclude;
type CardSettlementRow = Prisma.CardSettlementGetPayload<{ include: typeof cardSettlementInclude }>;

function toSummary(row: CardSettlementRow): CardSettlementSummary {
  return {
    id: row.id,
    cardAccountId: row.cardAccountId,
    cardAccountLabel: formatCardAccountLabel(row.cardAccount),
    amount: row.amount.toFixed(2),
    settlementDate: row.settlementDate.toISOString().slice(0, 10),
    bankAccountId: row.bankAccountId,
    bankAccountName: row.bankAccount.accountName,
    transactionReference: row.transactionReference,
    journalEntryId: row.journalEntryId,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

/// Phase 6.8 (docs/12 ADR-088). A small, standalone posting action --
/// settling part or all of a Credit Card's outstanding payable is
/// deliberately NOT folded into DirectExpensesService (a Credit Card
/// purchase and its later bill settlement are two independent, differently-
/// shaped journal postings with no shared draft/post lifecycle). Kept
/// minimal per the plan's own "explicitly deferred" list: no statement
/// import, no due-date reminders, no reversal of a settlement itself (a
/// genuine correction is a new settlement or a manual journal adjustment).
@Injectable()
export class CardSettlementsService implements CardSettlementPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  /** Computed live from the card's own ledger account journal lines (credit
   * postings from Direct Expense purchases minus debit postings from prior
   * settlements) -- never a locally-stored running total, so it can never
   * drift out of sync with the actual journal. DRAFT journal entries (none
   * currently exist in this codebase's posting flows, but excluded
   * defensively) don't count. */
  async getOutstandingBalance(input: { organizationId: string; cardAccountId: string }): Promise<string> {
    const card = await this.prisma.client.cardAccount.findFirst({ where: { id: input.cardAccountId, organizationId: input.organizationId } });
    if (!card) throwAppError('NOT_FOUND', 'Card account not found.');
    if (card.type !== 'CREDIT_CARD' || !card.ledgerAccountId) throwAppError('VALIDATION_FAILED', 'Only a credit card has an outstanding payable balance.');

    const agg = await this.prisma.client.journalLine.aggregate({
      where: { organizationId: input.organizationId, ledgerAccountId: card.ledgerAccountId, journalEntry: { status: { not: 'DRAFT' } } },
      _sum: { creditAmount: true, debitAmount: true },
    });
    const credit = agg._sum.creditAmount ?? new Prisma.Decimal(0);
    const debit = agg._sum.debitAmount ?? new Prisma.Decimal(0);
    return credit.minus(debit).toFixed(2);
  }

  async settleCreditCard(input: {
    organizationId: string;
    cardAccountId: string;
    amount: string;
    settlementDate: string;
    bankAccountId: string;
    transactionReference: string | undefined;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<CardSettlementSummary> {
    const requestHash = hashRequest({
      cardAccountId: input.cardAccountId,
      amount: input.amount,
      settlementDate: input.settlementDate,
      bankAccountId: input.bankAccountId,
      transactionReference: input.transactionReference,
    });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: SETTLE_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as CardSettlementSummary;
    }

    const card = await this.prisma.client.cardAccount.findFirst({ where: { id: input.cardAccountId, organizationId: input.organizationId } });
    if (!card) throwAppError('NOT_FOUND', 'Card account not found.');
    if (!card.isActive) throwAppError('VALIDATION_FAILED', 'This card account is inactive.');
    if (card.type !== 'CREDIT_CARD' || !card.ledgerAccountId) throwAppError('VALIDATION_FAILED', 'Only a credit card can be settled.');

    const bankAccount = await this.prisma.client.bankAccount.findFirst({ where: { id: input.bankAccountId, organizationId: input.organizationId }, include: { ledgerAccount: true } });
    if (!bankAccount) throwAppError('NOT_FOUND', 'Bank account not found.');
    if (!bankAccount.isActive) throwAppError('VALIDATION_FAILED', 'This bank account is inactive.');
    if (bankAccount.legalEntityId !== card.legalEntityId) throwAppError('VALIDATION_FAILED', 'The bank account must belong to the same legal entity as the card.');

    const amount = new Prisma.Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) throwAppError('VALIDATION_FAILED', 'Settlement amount must be greater than zero.');

    const outstanding = new Prisma.Decimal(await this.getOutstandingBalance({ organizationId: input.organizationId, cardAccountId: input.cardAccountId }));
    if (amount.greaterThan(outstanding)) throwAppError('VALIDATION_FAILED', 'Settlement amount cannot exceed the outstanding balance.');

    const id = generateId();
    const journal = await this.posting.postJournal({
      organizationId: input.organizationId,
      legalEntityId: card.legalEntityId,
      accountingDate: input.settlementDate,
      sourceType: SETTLE_COMMAND_TYPE,
      sourceId: id,
      postingEvent: 'card_account.settled',
      description: `Credit card settlement — ${card.displayName}`,
      lines: [
        {
          ledgerAccountId: card.ledgerAccountId,
          debit: amount.toFixed(2),
          credit: '0',
          projectId: undefined,
          partyId: undefined,
          employeeId: undefined,
          gstRegistrationId: undefined,
          taxCode: undefined,
          narrative: undefined,
        },
        {
          ledgerAccountId: bankAccount.ledgerAccount.id,
          debit: '0',
          credit: amount.toFixed(2),
          projectId: undefined,
          partyId: undefined,
          employeeId: undefined,
          gstRegistrationId: undefined,
          taxCode: undefined,
          narrative: undefined,
        },
      ],
      idempotencyKey: `${SETTLE_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.cardSettlement.create({
        data: {
          id,
          organizationId: input.organizationId,
          cardAccountId: input.cardAccountId,
          amount,
          settlementDate: toDate(input.settlementDate),
          bankAccountId: input.bankAccountId,
          transactionReference: input.transactionReference ?? null,
          journalEntryId: journal.id,
          createdBy: input.actorId,
        },
        include: cardSettlementInclude,
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'CARD_ACCOUNT',
        entityId: input.cardAccountId,
        action: 'CARD_ACCOUNT_SETTLED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { amount: amount.toFixed(2), journalEntryId: journal.id },
      });

      const summary = toSummary(row);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: SETTLE_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'CARD_ACCOUNT',
          sourceRecordId: input.cardAccountId,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async listByCardAccount(input: { organizationId: string; cardAccountId: string }): Promise<CardSettlementSummary[]> {
    const rows = await this.prisma.client.cardSettlement.findMany({
      where: { organizationId: input.organizationId, cardAccountId: input.cardAccountId },
      include: cardSettlementInclude,
      orderBy: { settlementDate: 'desc' },
    });
    return rows.map(toSummary);
  }
}
