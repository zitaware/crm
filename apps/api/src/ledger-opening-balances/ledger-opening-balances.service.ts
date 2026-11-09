import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type { LedgerOpeningBalancePort, LedgerOpeningBalanceSummary } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';

const SET_COMMAND_TYPE = 'ledger_opening_balance.set';
const VOID_COMMAND_TYPE = 'ledger_opening_balance.void';

const OPENING_BALANCE_EQUITY_CODE = 'OPENING_BALANCE_EQUITY';

/** Same local helper as posting.service.ts/invoices.service.ts. */
function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Same shallow-sorted-keys sha256 shape as every prior slice's own
 * hashRequest — reimplemented locally per that established precedent. */
function hashRequest(input: unknown): string {
  const normalized = JSON.stringify(input, Object.keys(input as object).sort());
  return createHash('sha256').update(normalized).digest('hex');
}

const summaryInclude = {
  legalEntity: true,
  ledgerAccount: true,
} satisfies Prisma.LedgerOpeningBalanceInclude;

type SummaryRow = Prisma.LedgerOpeningBalanceGetPayload<{ include: typeof summaryInclude }>;

function toSummary(row: SummaryRow): LedgerOpeningBalanceSummary {
  return {
    id: row.id,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    ledgerAccountId: row.ledgerAccountId,
    ledgerAccountCode: row.ledgerAccount.code,
    ledgerAccountName: row.ledgerAccount.name,
    asOfDate: toDateStr(row.asOfDate),
    amount: row.amount.toFixed(2),
    status: row.status,
    journalEntryId: row.journalEntryId,
    voidJournalEntryId: row.voidJournalEntryId,
    voidReason: row.voidReason,
    voidedBy: row.voidedBy,
    voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
  };
}

@Injectable()
export class LedgerOpeningBalancesService implements LedgerOpeningBalancePort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  async set(input: {
    organizationId: string;
    legalEntityId: string;
    ledgerAccountId: string;
    asOfDate: string;
    amount: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<LedgerOpeningBalanceSummary> {
    const requestHash = hashRequest({
      legalEntityId: input.legalEntityId,
      ledgerAccountId: input.ledgerAccountId,
      asOfDate: input.asOfDate,
      amount: input.amount,
    });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: SET_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as LedgerOpeningBalanceSummary;
    }

    const amount = new Prisma.Decimal(input.amount);
    if (amount.isZero()) throwAppError('VALIDATION_FAILED', 'Opening balance amount must not be zero.');

    const account = await this.prisma.client.ledgerAccount.findFirst({
      where: { id: input.ledgerAccountId, organizationId: input.organizationId },
      include: { accountGroup: true },
    });
    if (!account) throwAppError('NOT_FOUND', 'Ledger account not found.');

    const legalEntity = await this.prisma.client.legalEntity.findFirst({
      where: { id: input.legalEntityId, organizationId: input.organizationId },
    });
    if (!legalEntity) throwAppError('NOT_FOUND', 'Legal entity not found.');

    const existingActive = await this.prisma.client.ledgerOpeningBalance.findFirst({
      where: { organizationId: input.organizationId, legalEntityId: input.legalEntityId, ledgerAccountId: input.ledgerAccountId, status: 'ACTIVE' },
    });
    if (existingActive) {
      throwAppError('VALIDATION_FAILED', 'An opening balance is already active for this legal entity and account — void it before setting a new one.');
    }

    const equityAccount = await this.prisma.client.ledgerAccount.findFirst({
      where: { organizationId: input.organizationId, code: OPENING_BALANCE_EQUITY_CODE },
    });
    if (!equityAccount) throwAppError('VALIDATION_FAILED', 'The Opening Balance Equity ledger account is not configured.');

    const isDebitNormal = account.accountGroup.normalBalance === 'DEBIT';
    // Mirrors getLedgerActivity's own signed formula in reverse
    // (runningBalance = isDebitNormal ? +debit-credit : +credit-debit): the
    // account itself gets debited when a debit-normal account has a
    // non-negative amount, or a credit-normal account has a negative
    // (abnormal-side) amount -- equity always takes the opposite side to
    // keep the journal balanced.
    const amountIsNonNegative = amount.greaterThanOrEqualTo(0);
    const magnitude = amount.abs().toFixed(2);
    const debitsAccount = isDebitNormal === amountIsNonNegative;
    const accountDebit = debitsAccount ? magnitude : '0';
    const accountCredit = debitsAccount ? '0' : magnitude;
    const equityDebit = debitsAccount ? '0' : magnitude;
    const equityCredit = debitsAccount ? magnitude : '0';

    const recordId = generateId();
    // Journal-first, then the record write -- the now five-times-
    // established ADR-066/067/068/069/070 sequential pattern (postJournal
    // always opens its own top-level transaction and cannot be nested).
    const journal = await this.posting.postJournal({
      organizationId: input.organizationId,
      legalEntityId: input.legalEntityId,
      accountingDate: input.asOfDate,
      sourceType: 'ledger_opening_balance_set',
      sourceId: recordId,
      postingEvent: 'ledger_opening_balance.set',
      description: `Opening balance for ${account.code}`,
      lines: [
        { ledgerAccountId: account.id, debit: accountDebit, credit: accountCredit, projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
        { ledgerAccountId: equityAccount.id, debit: equityDebit, credit: equityCredit, projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: undefined },
      ],
      idempotencyKey: `${SET_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      await tx.ledgerOpeningBalance.create({
        data: {
          id: recordId,
          organizationId: input.organizationId,
          legalEntityId: input.legalEntityId,
          ledgerAccountId: input.ledgerAccountId,
          asOfDate: toDate(input.asOfDate),
          amount,
          journalEntryId: journal.id,
          createdBy: input.actorId,
        },
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'LEDGER_OPENING_BALANCE',
        entityId: recordId,
        action: 'LEDGER_OPENING_BALANCE_SET',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { legalEntityId: input.legalEntityId, ledgerAccountId: input.ledgerAccountId, asOfDate: input.asOfDate, amount: amount.toFixed(2), journalEntryId: journal.id },
      });

      const created = await tx.ledgerOpeningBalance.findFirstOrThrow({ where: { id: recordId }, include: summaryInclude });
      const summary = toSummary(created);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: SET_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'LEDGER_OPENING_BALANCE',
          sourceRecordId: recordId,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async void(input: {
    organizationId: string;
    id: string;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<LedgerOpeningBalanceSummary> {
    const requestHash = hashRequest({ id: input.id, reason: input.reason, accountingDate: input.accountingDate });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: VOID_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as LedgerOpeningBalanceSummary;
    }

    const reason = input.reason.trim();
    if (!reason) throwAppError('VALIDATION_FAILED', 'A reason is required to void an opening balance.');

    const row = await this.prisma.client.ledgerOpeningBalance.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!row) throwAppError('NOT_FOUND', 'Opening balance not found.');
    if (row.status === 'VOID') throwAppError('INVALID_STATE_TRANSITION', 'This opening balance has already been voided.');

    const reversal = await this.posting.reverseJournal({
      organizationId: input.organizationId,
      id: row.journalEntryId,
      accountingDate: input.accountingDate,
      reason,
      idempotencyKey: `${VOID_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.ledgerOpeningBalance.updateMany({
        where: { id: row.id, status: 'ACTIVE' },
        data: { status: 'VOID', voidJournalEntryId: reversal.id, voidReason: reason, voidedBy: input.actorId, voidedAt: new Date() },
      });
      if (count === 0) throwAppError('INVALID_STATE_TRANSITION', 'This opening balance has already been voided.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'LEDGER_OPENING_BALANCE',
        entityId: row.id,
        action: 'LEDGER_OPENING_BALANCE_VOIDED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { voidReason: reason, voidJournalEntryId: reversal.id },
      });

      const updated = await tx.ledgerOpeningBalance.findFirstOrThrow({ where: { id: row.id }, include: summaryInclude });
      const summary = toSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: VOID_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'LEDGER_OPENING_BALANCE',
          sourceRecordId: row.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async getForAccount(input: { organizationId: string; legalEntityId: string; ledgerAccountId: string }): Promise<LedgerOpeningBalanceSummary | null> {
    const row = await this.prisma.client.ledgerOpeningBalance.findFirst({
      where: { organizationId: input.organizationId, legalEntityId: input.legalEntityId, ledgerAccountId: input.ledgerAccountId, status: 'ACTIVE' },
      include: summaryInclude,
    });
    return row ? toSummary(row) : null;
  }
}
