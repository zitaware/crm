import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  JournalPort,
  JournalEntrySummary,
  JournalEntryDetail,
  JournalEntryFilters,
  JournalLineSummary,
  LedgerActivityRow,
  PostJournalLineInput,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isConstraintViolation } from '../organization/constraint-error.util';

/** Namespaces this command's rows in the existing, shared IdempotencyKey
 * registry (already in real use by UsersService.invite) — not a new table. */
const COMMAND_TYPE = 'journal.post';
const REVERSE_COMMAND_TYPE = 'journal.reverse';
/** A reversal's own sourceType — distinct from any real business event's
 * sourceType, and paired with the original entry's id as sourceId, so the
 * existing uq_journal_entries_org_source constraint doubles as "at most
 * one reversal per original entry" for free (ADR-067). */
const REVERSAL_SOURCE_TYPE = 'journal_entry_reversal';

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Prisma requires a full ISO-8601 DateTime (or a Date instance) for
 * @db.Date columns — a bare 'YYYY-MM-DD' string is rejected. */
function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** Same shallow-sorted-keys sha256 shape as hashRequest in
 * packages/contracts/src/routers/users.ts — reimplemented locally since
 * postJournal has no router boundary to share that helper with. */
function hashRequest(input: unknown): string {
  const normalized = JSON.stringify(input, Object.keys(input as object).sort());
  return createHash('sha256').update(normalized).digest('hex');
}

interface JournalEntryRow {
  id: string;
  legalEntityId: string;
  accountingDate: Date;
  accountingPeriodId: string;
  sourceType: string;
  sourceId: string;
  postingEvent: string;
  description: string | null;
  status: string;
  postedAt: Date;
  reversalOfJournalEntryId: string | null;
  reversalReason: string | null;
  reversedBy: string | null;
  reversedAt: Date | null;
  legalEntity: { legalName: string };
  reversedByEntry: { id: string } | null;
}

function sumDebits(lines: Array<{ debitAmount: Prisma.Decimal }>): Prisma.Decimal {
  return lines.reduce((sum, l) => sum.plus(l.debitAmount), new Prisma.Decimal(0));
}

function toEntrySummary(row: JournalEntryRow, totalAmount: Prisma.Decimal): JournalEntrySummary {
  return {
    id: row.id,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    accountingDate: toDateStr(row.accountingDate),
    accountingPeriodId: row.accountingPeriodId,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    postingEvent: row.postingEvent,
    description: row.description,
    status: row.status as JournalEntrySummary['status'],
    totalAmount: totalAmount.toFixed(2),
    postedAt: row.postedAt.toISOString(),
    reversalOfJournalEntryId: row.reversalOfJournalEntryId,
    reversedByJournalEntryId: row.reversedByEntry?.id ?? null,
    reversalReason: row.reversalReason,
    reversedBy: row.reversedBy,
    reversedAt: row.reversedAt ? row.reversedAt.toISOString() : null,
  };
}

interface JournalLineRow {
  id: string;
  ledgerAccountId: string;
  debitAmount: Prisma.Decimal;
  creditAmount: Prisma.Decimal;
  projectId: string | null;
  partyId: string | null;
  employeeId: string | null;
  gstRegistrationId: string | null;
  taxCode: string | null;
  narrative: string | null;
  ledgerAccount: { code: string; name: string };
  project: { name: string } | null;
  party: { name: string } | null;
  employee: { fullName: string } | null;
}

function toLineSummary(row: JournalLineRow): JournalLineSummary {
  return {
    id: row.id,
    ledgerAccountId: row.ledgerAccountId,
    ledgerAccountCode: row.ledgerAccount.code,
    ledgerAccountName: row.ledgerAccount.name,
    debitAmount: row.debitAmount.toFixed(2),
    creditAmount: row.creditAmount.toFixed(2),
    projectId: row.projectId,
    projectName: row.project?.name ?? null,
    partyId: row.partyId,
    partyName: row.party?.name ?? null,
    employeeId: row.employeeId,
    employeeName: row.employee?.fullName ?? null,
    gstRegistrationId: row.gstRegistrationId,
    taxCode: row.taxCode,
    narrative: row.narrative,
  };
}

const entryInclude = {
  legalEntity: true,
  reversedByEntry: { select: { id: true } },
} satisfies Prisma.JournalEntryInclude;
const lineDetailInclude = {
  ledgerAccount: true,
  project: true,
  party: true,
  employee: true,
} satisfies Prisma.JournalLineInclude;

/**
 * The input shape shared by `postJournal` and `postJournalWithin` — one
 * definition so the transactional variant can never drift from the
 * self-contained one.
 */
export interface PostJournalInput {
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
}

@Injectable()
export class PostingService implements JournalPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Posts a journal in a transaction of its own.
   *
   * This is the form every caller should use unless it genuinely cannot:
   * the caller has no transaction to join, so the posting owns one
   * outright. Callers that DO already hold a transaction — because the
   * posted amount can only be determined under a row lock they are already
   * holding — use `postJournalWithin` instead.
   */
  async postJournal(input: PostJournalInput): Promise<JournalEntrySummary> {
    return await this.prisma.client.$transaction(async (tx) => this.postJournalWithin(tx, input));
  }

  /**
   * The whole of the posting engine, executed inside a transaction the
   * caller supplies (Phase 7.3, ADR-093).
   *
   * Extracted from `postJournal` — which is now a thin wrapper that opens a
   * transaction and delegates here — so that every mandatory posting
   * control in docs/06 is enforced in exactly one place regardless of who
   * owns the transaction. Behaviour is byte-for-byte what `postJournal`
   * always did; the only change is that the validating reads now run on the
   * caller's transaction rather than on a fresh connection, which is
   * strictly safer (they see the caller's own uncommitted writes and the
   * rows it has locked).
   *
   * Exists because Inventory Consumption is the first business event in
   * this codebase whose posted amount is not knowable before the
   * transaction starts: the consumption value IS the ruling weighted
   * average read under the item's `FOR UPDATE` lock, and full depletion
   * carries out the entire residual balance rather than quantity x rate.
   * Posting first and writing second — the pattern every earlier caller
   * uses — would have to guess that figure and could post an Inventory
   * credit that the movement then disagrees with, silently breaking Phase
   * 7's "inventory movement reconciles to stock value" exit criterion.
   *
   * A duplicate-source constraint violation is translated here, so both
   * entry points report it identically.
   */
  async postJournalWithin(tx: Prisma.TransactionClient, input: PostJournalInput): Promise<JournalEntrySummary> {
    const requestHash = hashRequest({
      legalEntityId: input.legalEntityId,
      accountingDate: input.accountingDate,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      postingEvent: input.postingEvent,
      description: input.description,
      lines: input.lines,
      idempotencyKey: input.idempotencyKey,
    });

    const existingKey = await tx.idempotencyKey.findUnique({
      where: {
        organizationId_commandType_idempotencyKey: {
          organizationId: input.organizationId,
          commandType: COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) {
        throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      }
      return existingKey.resultReference as unknown as JournalEntrySummary;
    }

    // Mandatory posting controls (docs/06) — validated before any write.
    if (input.lines.length === 0) {
      throwAppError('VALIDATION_FAILED', 'A journal entry requires at least one line.');
    }
    let totalDebit = new Prisma.Decimal(0);
    let totalCredit = new Prisma.Decimal(0);
    for (const line of input.lines) {
      const debit = new Prisma.Decimal(line.debit);
      const credit = new Prisma.Decimal(line.credit);
      if (debit.isNegative() || credit.isNegative()) {
        throwAppError('VALIDATION_FAILED', 'Debit and credit amounts must not be negative.');
      }
      const debitSet = debit.greaterThan(0);
      const creditSet = credit.greaterThan(0);
      if (debitSet === creditSet) {
        throwAppError('VALIDATION_FAILED', 'Each line must have exactly one of debit or credit set — never both, never neither.');
      }
      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);
    }
    if (!totalDebit.equals(totalCredit)) {
      throwAppError(
        'VALIDATION_FAILED',
        `Journal entry is unbalanced — debit ${totalDebit.toFixed(2)} does not equal credit ${totalCredit.toFixed(2)}.`,
      );
    }

    const accountingDate = toDate(input.accountingDate);
    const period = await this.resolveAccountingPeriod(tx, input.organizationId, input.legalEntityId, accountingDate);

    const ledgerAccountIds = [...new Set(input.lines.map((l) => l.ledgerAccountId))];
    const ledgerAccounts = await tx.ledgerAccount.findMany({
      where: { id: { in: ledgerAccountIds }, organizationId: input.organizationId },
    });
    const ledgerAccountById = new Map(ledgerAccounts.map((a) => [a.id, a]));
    for (const id of ledgerAccountIds) {
      const account = ledgerAccountById.get(id);
      if (!account) throwAppError('NOT_FOUND', 'One or more ledger accounts were not found.');
      if (!account.isActive) throwAppError('VALIDATION_FAILED', `Ledger account ${account.code} is inactive and cannot receive postings.`);
      if (!account.allowManualPosting) throwAppError('VALIDATION_FAILED', `Ledger account ${account.code} does not allow postings.`);
    }

    const existingForSource = await tx.journalEntry.findUnique({
      where: { organizationId_sourceType_sourceId: { organizationId: input.organizationId, sourceType: input.sourceType, sourceId: input.sourceId } },
    });
    if (existingForSource) {
      throwAppError('VALIDATION_FAILED', 'A journal entry already exists for this source event.');
    }

    const journalEntryId = generateId();
    try {
      return await (async () => {
        await tx.journalEntry.create({
          data: {
            id: journalEntryId,
            organizationId: input.organizationId,
            legalEntityId: input.legalEntityId,
            accountingDate,
            financialYearId: period.financialYearId,
            accountingPeriodId: period.id,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            postingEvent: input.postingEvent,
            idempotencyKey: input.idempotencyKey,
            description: input.description ?? null,
            status: 'POSTED',
            postedBy: input.actorId,
          },
        });

        await tx.journalLine.createMany({
          data: input.lines.map((line) => ({
            id: generateId(),
            organizationId: input.organizationId,
            journalEntryId,
            ledgerAccountId: line.ledgerAccountId,
            debitAmount: new Prisma.Decimal(line.debit),
            creditAmount: new Prisma.Decimal(line.credit),
            projectId: line.projectId ?? null,
            partyId: line.partyId ?? null,
            employeeId: line.employeeId ?? null,
            gstRegistrationId: line.gstRegistrationId ?? null,
            taxCode: line.taxCode ?? null,
            narrative: line.narrative ?? null,
          })),
        });

        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'JOURNAL_ENTRY',
          entityId: journalEntryId,
          action: 'JOURNAL_POSTED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: {
            legalEntityId: input.legalEntityId,
            accountingDate: input.accountingDate,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            postingEvent: input.postingEvent,
            totalAmount: totalDebit.toFixed(2),
            lineCount: input.lines.length,
          },
        });

        const created = await tx.journalEntry.findFirstOrThrow({ where: { id: journalEntryId }, include: entryInclude });
        const summary = toEntrySummary(created, totalDebit);

        await tx.idempotencyKey.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            commandType: COMMAND_TYPE,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            sourceRecordType: 'JOURNAL_ENTRY',
            sourceRecordId: journalEntryId,
            resultReference: summary as unknown as Prisma.InputJsonValue,
          },
        });

        return summary;
      })();
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'A journal entry already exists for this source event.');
      }
      throw error;
    }
  }

  /** Shared by postJournal and reverseJournal (ADR-067) — identical
   * behavior to postJournal's own pre-extraction inline logic. Takes the
   * client to read on so it works equally on a transaction the caller owns
   * (ADR-093) and on a fresh connection. */
  private async resolveAccountingPeriod(
    client: Prisma.TransactionClient | PrismaService['client'],
    organizationId: string,
    legalEntityId: string,
    accountingDate: Date,
  ) {
    const period = await client.accountingPeriod.findFirst({
      where: {
        organizationId,
        startDate: { lte: accountingDate },
        endDate: { gte: accountingDate },
        financialYear: { legalEntityId },
      },
    });
    if (!period) {
      throwAppError('VALIDATION_FAILED', 'No accounting period covers this accounting date for the selected legal entity.');
    }
    if (period.status === 'LOCKED') {
      throwAppError('INVALID_STATE_TRANSITION', 'This accounting period is locked and cannot accept new postings.');
    }
    return period;
  }

  async reverseJournal(input: {
    organizationId: string;
    id: string;
    accountingDate: string;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<JournalEntrySummary> {
    const requestHash = hashRequest({
      id: input.id,
      accountingDate: input.accountingDate,
      reason: input.reason,
    });

    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: {
        organizationId_commandType_idempotencyKey: {
          organizationId: input.organizationId,
          commandType: REVERSE_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) {
        throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      }
      return existingKey.resultReference as unknown as JournalEntrySummary;
    }

    const reason = input.reason.trim();
    if (!reason) {
      throwAppError('VALIDATION_FAILED', 'A reason is required to reverse a journal entry.');
    }

    const original = await this.prisma.client.journalEntry.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: { lines: true },
    });
    if (!original) throwAppError('NOT_FOUND', 'Journal entry not found.');
    if (original.status !== 'POSTED') {
      throwAppError('INVALID_STATE_TRANSITION', 'Only a posted journal entry can be reversed.');
    }

    // The reversal's own date is independent of the original's — it lands
    // in whatever period is open today, not the original's (possibly
    // since-LOCKED) period. Ledger accounts are deliberately not
    // re-validated here (unlike postJournal) — they were already valid
    // when the original posted, and a legitimate correction must remain
    // possible even if an account was deactivated afterward.
    const accountingDate = toDate(input.accountingDate);
    const period = await this.resolveAccountingPeriod(this.prisma.client, input.organizationId, original.legalEntityId, accountingDate);
    const totalAmount = sumDebits(original.lines);

    const reversalEntryId = generateId();
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        await tx.journalEntry.create({
          data: {
            id: reversalEntryId,
            organizationId: input.organizationId,
            legalEntityId: original.legalEntityId,
            accountingDate,
            financialYearId: period.financialYearId,
            accountingPeriodId: period.id,
            sourceType: REVERSAL_SOURCE_TYPE,
            sourceId: original.id,
            postingEvent: 'journal.reversed',
            idempotencyKey: input.idempotencyKey,
            description: `Reversal of ${original.description ?? original.postingEvent}`,
            status: 'POSTED',
            postedBy: input.actorId,
            reversalOfJournalEntryId: original.id,
          },
        });

        await tx.journalLine.createMany({
          data: original.lines.map((line) => ({
            id: generateId(),
            organizationId: input.organizationId,
            journalEntryId: reversalEntryId,
            ledgerAccountId: line.ledgerAccountId,
            // The opposite of the original — a debit becomes a credit and
            // vice versa; docs/06: "Create an opposite journal."
            debitAmount: line.creditAmount,
            creditAmount: line.debitAmount,
            projectId: line.projectId,
            partyId: line.partyId,
            employeeId: line.employeeId,
            gstRegistrationId: line.gstRegistrationId,
            taxCode: line.taxCode,
            narrative: line.narrative,
          })),
        });

        // Guards against a concurrent double-reversal race — if another
        // request reversed this entry between our read above and here,
        // count is 0 and the whole transaction (including the new entry
        // just created) rolls back.
        const { count } = await tx.journalEntry.updateMany({
          where: { id: original.id, status: 'POSTED' },
          data: {
            status: 'REVERSED',
            reversalReason: reason,
            reversedBy: input.actorId,
            reversedAt: new Date(),
          },
        });
        if (count === 0) {
          throwAppError('INVALID_STATE_TRANSITION', 'Only a posted journal entry can be reversed.');
        }

        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'JOURNAL_ENTRY',
          entityId: reversalEntryId,
          action: 'JOURNAL_POSTED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: {
            legalEntityId: original.legalEntityId,
            accountingDate: input.accountingDate,
            sourceType: REVERSAL_SOURCE_TYPE,
            sourceId: original.id,
            postingEvent: 'journal.reversed',
            totalAmount: totalAmount.toFixed(2),
            lineCount: original.lines.length,
          },
        });

        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'JOURNAL_ENTRY',
          entityId: original.id,
          action: 'JOURNAL_REVERSED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: {
            reversalReason: reason,
            reversedBy: input.actorId,
            reversalEntryId,
          },
        });

        const created = await tx.journalEntry.findFirstOrThrow({ where: { id: reversalEntryId }, include: entryInclude });
        const summary = toEntrySummary(created, totalAmount);

        await tx.idempotencyKey.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            commandType: REVERSE_COMMAND_TYPE,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            sourceRecordType: 'JOURNAL_ENTRY',
            sourceRecordId: reversalEntryId,
            resultReference: summary as unknown as Prisma.InputJsonValue,
          },
        });

        return summary;
      });
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'This journal entry has already been reversed.');
      }
      throw error;
    }
  }

  async listEntries(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: JournalEntryFilters;
  }): Promise<{ rows: JournalEntrySummary[]; total: number }> {
    const where: Prisma.JournalEntryWhereInput = { organizationId: input.organizationId };
    if (input.filters.legalEntityId) where.legalEntityId = input.filters.legalEntityId;
    if (input.filters.sourceType) where.sourceType = input.filters.sourceType;
    if (input.filters.dateFrom || input.filters.dateTo) {
      where.accountingDate = {
        ...(input.filters.dateFrom ? { gte: toDate(input.filters.dateFrom) } : {}),
        ...(input.filters.dateTo ? { lte: toDate(input.filters.dateTo) } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.journalEntry.findMany({
        where,
        include: { ...entryInclude, lines: { select: { debitAmount: true } } },
        orderBy: { accountingDate: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.client.journalEntry.count({ where }),
    ]);

    return { rows: rows.map((row) => toEntrySummary(row, sumDebits(row.lines))), total };
  }

  async getEntryDetail(input: { organizationId: string; id: string }): Promise<JournalEntryDetail> {
    const row = await this.prisma.client.journalEntry.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: {
        ...entryInclude,
        lines: { include: lineDetailInclude, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) throwAppError('NOT_FOUND', 'Journal entry not found.');

    return {
      ...toEntrySummary(row, sumDebits(row.lines)),
      lines: row.lines.map(toLineSummary),
    };
  }

  async getLedgerActivity(input: {
    organizationId: string;
    ledgerAccountId: string;
    legalEntityId: string | undefined;
    dateFrom: string | undefined;
    dateTo: string | undefined;
  }): Promise<{ rows: LedgerActivityRow[]; openingBalance: string; closingBalance: string }> {
    const account = await this.prisma.client.ledgerAccount.findFirst({
      where: { id: input.ledgerAccountId, organizationId: input.organizationId },
      include: { accountGroup: true },
    });
    if (!account) throwAppError('NOT_FOUND', 'Ledger account not found.');

    const isDebitNormal = account.accountGroup.normalBalance === 'DEBIT';

    let openingBalance = new Prisma.Decimal(0);
    if (input.dateFrom) {
      const priorLines = await this.prisma.client.journalLine.findMany({
        where: {
          organizationId: input.organizationId,
          ledgerAccountId: input.ledgerAccountId,
          journalEntry: {
            accountingDate: { lt: toDate(input.dateFrom) },
            ...(input.legalEntityId ? { legalEntityId: input.legalEntityId } : {}),
          },
        },
        select: { debitAmount: true, creditAmount: true },
      });
      for (const line of priorLines) {
        openingBalance = isDebitNormal
          ? openingBalance.plus(line.debitAmount).minus(line.creditAmount)
          : openingBalance.plus(line.creditAmount).minus(line.debitAmount);
      }
    }

    const lines = await this.prisma.client.journalLine.findMany({
      where: {
        organizationId: input.organizationId,
        ledgerAccountId: input.ledgerAccountId,
        journalEntry: {
          ...(input.legalEntityId ? { legalEntityId: input.legalEntityId } : {}),
          ...(input.dateFrom || input.dateTo
            ? {
                accountingDate: {
                  ...(input.dateFrom ? { gte: toDate(input.dateFrom) } : {}),
                  ...(input.dateTo ? { lte: toDate(input.dateTo) } : {}),
                },
              }
            : {}),
        },
      },
      include: { journalEntry: true },
      // Accounting date alone is NOT a total order: several postings share a
      // date routinely, and Postgres is then free to return them in any
      // order — which makes the running balance below differ between two
      // reads of the same ledger. `createdAt` then `id` break the tie
      // deterministically, and because ids are UUID v7 the tiebreak is also
      // chronological rather than arbitrary. Found by a full-suite run of
      // this spec's own running-balance test, which passed in isolation and
      // failed under load (Phase 7.6).
      orderBy: [
        { journalEntry: { accountingDate: 'asc' } },
        { journalEntry: { createdAt: 'asc' } },
        { id: 'asc' },
      ],
    });

    let runningBalance = openingBalance;
    const rows: LedgerActivityRow[] = lines.map((line) => {
      runningBalance = isDebitNormal
        ? runningBalance.plus(line.debitAmount).minus(line.creditAmount)
        : runningBalance.plus(line.creditAmount).minus(line.debitAmount);
      return {
        id: line.id,
        journalEntryId: line.journalEntryId,
        accountingDate: toDateStr(line.journalEntry.accountingDate),
        postingEvent: line.journalEntry.postingEvent,
        sourceType: line.journalEntry.sourceType,
        sourceId: line.journalEntry.sourceId,
        debitAmount: line.debitAmount.toFixed(2),
        creditAmount: line.creditAmount.toFixed(2),
        runningBalance: runningBalance.toFixed(2),
        narrative: line.narrative,
      };
    });

    return { rows, openingBalance: openingBalance.toFixed(2), closingBalance: runningBalance.toFixed(2) };
  }
}
