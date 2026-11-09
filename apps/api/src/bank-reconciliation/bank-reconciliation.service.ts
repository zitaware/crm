import { Injectable } from '@nestjs/common';
import { Prisma, generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  BankBookLineRow,
  BankLineStatus,
  BankReconciliationPeriodRow,
  BankReconciliationPort,
  BankReconciliationStatement,
  BankReconciliationWorkspace,
  BankStatementCsv,
  BankStatementImportPreview,
  BankStatementLineRow,
  BankStatementPreviewRow,
  BankStatementProfile,
  BankStatementProfileInput,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { parseStatementAmount, parseStatementDate, rowAmount, statementFingerprint } from './statement-parse.util';

const ZERO = new Prisma.Decimal(0);
/** Auto-match pairs lines with the same signed amount no more than this many days apart. */
const AUTO_MATCH_DAYS = 5;

const dateOf = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const daysApart = (a: string, b: string) => Math.abs((asDate(a).getTime() - asDate(b).getTime()) / 86_400_000);
const monthEnd = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const previousMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
const monthLabel = (month: string) => new Date(`${month}-01T00:00:00.000Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
type Actor = { organizationId: string; actorId: string; correlationId: string };

function lineStatus(amount: Prisma.Decimal, matched: Prisma.Decimal): BankLineStatus {
  if (matched.isZero()) return 'UNMATCHED';
  return matched.abs().greaterThanOrEqualTo(amount.abs()) ? 'MATCHED' : 'PARTIALLY_MATCHED';
}

type ProfileRow = Prisma.BankStatementProfileGetPayload<object>;
function toProfile(row: ProfileRow): BankStatementProfile {
  return {
    id: row.id,
    bankAccountId: row.bankAccountId,
    dateColumn: row.dateColumn,
    dateFormat: row.dateFormat,
    descriptionColumn: row.descriptionColumn,
    referenceColumn: row.referenceColumn,
    amountMode: row.amountMode,
    debitColumn: row.debitColumn,
    creditColumn: row.creditColumn,
    amountColumn: row.amountColumn,
    indicatorColumn: row.indicatorColumn,
    creditIndicator: row.creditIndicator,
    balanceColumn: row.balanceColumn,
    version: row.version,
  };
}

type StatementLineRecord = Prisma.BankStatementLineGetPayload<{ include: { matches: { select: { amount: true } } } }>;
function toStatementRow(line: StatementLineRecord): BankStatementLineRow {
  const matched = line.matches.reduce((s, m) => s.plus(m.amount), ZERO);
  return {
    id: line.id,
    transactionDate: dateOf(line.transactionDate),
    description: line.description,
    reference: line.reference,
    amount: line.amount.toFixed(2),
    balance: line.balance?.toFixed(2) ?? null,
    matchedAmount: matched.toFixed(2),
    remaining: line.amount.minus(matched).toFixed(2),
    status: lineStatus(line.amount, matched),
    exception: line.exceptionApprovedAt ? 'APPROVED' : line.exceptionMarkedAt ? 'PENDING_APPROVAL' : 'NONE',
    exceptionReason: line.exceptionReason,
  };
}
const activeMatches = { matches: { where: { unmatchedAt: null }, select: { amount: true } } } as const;

/**
 * Bank statement import and reconciliation matching (Phase 8.6a, ADR-114).
 *
 * Statement lines are the bank's record, bank journal lines the books'.
 * Matching links equal amounts of the same sign; neither side is ever edited.
 * Every change for one bank account runs under that account's advisory lock,
 * so two people matching the same lines serialise.
 */
@Injectable()
export class BankReconciliationService implements BankReconciliationPort {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(input: { organizationId: string; bankAccountId: string }): Promise<BankStatementProfile | null> {
    await this.bankAccount(input.organizationId, input.bankAccountId);
    const row = await this.prisma.client.bankStatementProfile.findFirst({ where: { organizationId: input.organizationId, bankAccountId: input.bankAccountId } });
    return row ? toProfile(row) : null;
  }

  async saveProfile(input: BankStatementProfileInput & { organizationId: string; bankAccountId: string; expectedVersion: number | undefined; actorId: string; correlationId: string }): Promise<BankStatementProfile> {
    const account = await this.bankAccount(input.organizationId, input.bankAccountId);
    const missing = this.missingProfileColumns(input);
    if (missing.length) throwAppError('VALIDATION_FAILED', `Choose the ${missing.join(' and ')} column${missing.length > 1 ? 's' : ''}.`);
    const data = {
      dateColumn: input.dateColumn,
      dateFormat: input.dateFormat,
      descriptionColumn: input.descriptionColumn,
      referenceColumn: input.referenceColumn ?? null,
      amountMode: input.amountMode,
      debitColumn: input.amountMode === 'DEBIT_CREDIT_COLUMNS' ? (input.debitColumn ?? null) : null,
      creditColumn: input.amountMode === 'DEBIT_CREDIT_COLUMNS' ? (input.creditColumn ?? null) : null,
      amountColumn: input.amountMode === 'DEBIT_CREDIT_COLUMNS' ? null : (input.amountColumn ?? null),
      indicatorColumn: input.amountMode === 'AMOUNT_WITH_INDICATOR' ? (input.indicatorColumn ?? null) : null,
      creditIndicator: input.amountMode === 'AMOUNT_WITH_INDICATOR' ? (input.creditIndicator ?? 'CR') : null,
      balanceColumn: input.balanceColumn ?? null,
      updatedBy: input.actorId,
      updatedAt: new Date(),
    };
    const saved = await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.bankStatementProfile.findFirst({ where: { organizationId: input.organizationId, bankAccountId: input.bankAccountId } });
      let row: ProfileRow;
      if (existing) {
        if (input.expectedVersion !== existing.version) throwAppError('VERSION_CONFLICT', 'This mapping was changed by someone else. Reload and try again.');
        row = await tx.bankStatementProfile.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } });
      } else {
        row = await tx.bankStatementProfile.create({ data: { id: generateId(), organizationId: input.organizationId, bankAccountId: input.bankAccountId, createdBy: input.actorId, ...data } });
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: account.legalEntityId,
        entityType: 'BANK_STATEMENT_PROFILE',
        entityId: row.id,
        action: existing ? 'BANK_STATEMENT_PROFILE_UPDATED' : 'BANK_STATEMENT_PROFILE_CREATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: existing ? toProfile(existing) : undefined,
        newValues: toProfile(row),
      });
      return row;
    });
    return toProfile(saved);
  }

  async previewImport(input: BankStatementCsv & { organizationId: string; bankAccountId: string }): Promise<BankStatementImportPreview> {
    return (await this.parse(input)).preview;
  }

  /** All or nothing: a file with any error row imports nothing; duplicates and summary rows are skipped. */
  async importStatement(input: BankStatementCsv & { organizationId: string; bankAccountId: string; actorId: string; correlationId: string }): Promise<{ importId: string; created: number; duplicates: number; skipped: number }> {
    const account = await this.bankAccount(input.organizationId, input.bankAccountId);
    const importId = generateId();
    return this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, input.bankAccountId);
      // Parsed again under the lock, so a concurrent import of an overlapping file cannot slip duplicates past the check.
      const { preview, lines } = await this.parse(input, tx);
      if (preview.errorCount) throwAppError('VALIDATION_FAILED', `${preview.errorCount} row(s) cannot be read — nothing was imported. First: row ${preview.rows.find((r) => r.outcome === 'ERROR')!.rowNumber}: ${preview.rows.find((r) => r.outcome === 'ERROR')!.errors[0]}`);
      if (!lines.length) throwAppError('VALIDATION_FAILED', 'Every line in this file is already imported or has no amount.');
      await tx.bankStatementImport.create({
        data: {
          id: importId,
          organizationId: input.organizationId,
          bankAccountId: input.bankAccountId,
          fileName: input.fileName,
          lineCount: lines.length,
          duplicateCount: preview.duplicateCount,
          firstDate: asDate(lines.reduce((min, l) => (l.transactionDate < min ? l.transactionDate : min), lines[0]!.transactionDate)),
          lastDate: asDate(lines.reduce((max, l) => (l.transactionDate > max ? l.transactionDate : max), lines[0]!.transactionDate)),
          createdBy: input.actorId,
        },
      });
      await tx.bankStatementLine.createMany({
        data: lines.map((l) => ({
          id: generateId(),
          organizationId: input.organizationId,
          bankAccountId: input.bankAccountId,
          importId,
          lineNumber: l.rowNumber,
          transactionDate: asDate(l.transactionDate),
          description: l.description,
          reference: l.reference,
          amount: l.amount,
          balance: l.balance,
          fingerprint: l.fingerprint,
        })),
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: account.legalEntityId,
        entityType: 'BANK_STATEMENT_IMPORT',
        entityId: importId,
        action: 'BANK_STATEMENT_IMPORTED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { bankAccountId: input.bankAccountId, fileName: input.fileName, lines: lines.length, duplicates: preview.duplicateCount, skipped: preview.skippedCount, firstDate: preview.firstDate, lastDate: preview.lastDate },
      });
      return { importId, created: lines.length, duplicates: preview.duplicateCount, skipped: preview.skippedCount };
    });
  }

  async getWorkspace(input: { organizationId: string; bankAccountId: string; from: string; to: string }): Promise<BankReconciliationWorkspace> {
    if (input.from > input.to) throwAppError('VALIDATION_FAILED', 'The period cannot start after it ends.');
    const account = await this.bankAccount(input.organizationId, input.bankAccountId);
    const db = this.prisma.client;
    const [profile, statementLines, bookLines] = await Promise.all([
      db.bankStatementProfile.findFirst({ where: { organizationId: input.organizationId, bankAccountId: input.bankAccountId } }),
      db.bankStatementLine.findMany({
        where: { organizationId: input.organizationId, bankAccountId: input.bankAccountId, transactionDate: { lte: asDate(input.to) } },
        include: activeMatches,
        orderBy: [{ transactionDate: 'asc' }, { lineNumber: 'asc' }],
      }),
      this.bookLines(db, input.organizationId, account.ledgerAccountId, { lte: asDate(input.to) }),
    ]);

    // In range, plus older lines still open — they carry forward until cleared.
    const statementRows = statementLines
      .map(toStatementRow)
      .filter((r) => r.transactionDate >= input.from || (r.status !== 'MATCHED' && r.exception === 'NONE'));
    const bookRows = bookLines.filter((r) => r.accountingDate >= input.from || r.status !== 'MATCHED');
    const ids = statementRows.map((r) => r.id);
    const matches = ids.length
      ? await db.bankReconciliationMatch.findMany({ where: { statementLineId: { in: ids }, unmatchedAt: null }, select: { id: true, statementLineId: true, journalLineId: true, amount: true, createdAt: true }, orderBy: { createdAt: 'asc' } })
      : [];

    const inRange = <T extends { amount: string }>(rows: T[], date: (r: T) => string) => rows.filter((r) => date(r) >= input.from && date(r) <= input.to);
    const sumSign = <T extends { amount: string }>(rows: T[], positive: boolean) =>
      rows.reduce((s, r) => (new Prisma.Decimal(r.amount).isPositive() === positive ? s.plus(new Prisma.Decimal(r.amount).abs()) : s), ZERO).toFixed(2);
    const statementInRange = inRange(statementRows, (r) => r.transactionDate);
    const bookInRange = inRange(bookRows, (r) => r.accountingDate);
    const openStatement = statementRows.filter((r) => r.status !== 'MATCHED' && r.exception !== 'APPROVED');
    const openBook = bookRows.filter((r) => r.status !== 'MATCHED');

    return {
      bankAccountId: account.id,
      bankAccountName: account.accountName,
      legalEntityName: account.legalEntity.legalName,
      from: input.from,
      to: input.to,
      profile: profile ? toProfile(profile) : null,
      statementLines: statementRows,
      bookLines: bookRows,
      matches: matches.map((m) => ({ id: m.id, statementLineId: m.statementLineId, journalLineId: m.journalLineId, amount: m.amount.toFixed(2), createdAt: m.createdAt.toISOString() })),
      summary: {
        statementIn: sumSign(statementInRange, true),
        statementOut: sumSign(statementInRange, false),
        bookIn: sumSign(bookInRange, true),
        bookOut: sumSign(bookInRange, false),
        unmatchedStatementCount: openStatement.length,
        unmatchedStatementAmount: openStatement.reduce((s, r) => s.plus(r.remaining), ZERO).toFixed(2),
        unmatchedBookCount: openBook.length,
        unmatchedBookAmount: openBook.reduce((s, r) => s.plus(r.remaining), ZERO).toFixed(2),
        pendingExceptionCount: statementRows.filter((r) => r.exception === 'PENDING_APPROVAL').length,
      },
    };
  }

  /**
   * Matches the chosen statement lines to the chosen book lines. Their open
   * amounts must be of one sign and add up to the same total; pairs are then
   * allocated in date order, so one deposit can clear several receipts.
   */
  async matchSelected(input: { organizationId: string; bankAccountId: string; statementLineIds: string[]; journalLineIds: string[]; actorId: string; correlationId: string }): Promise<{ matchCount: number }> {
    if (new Set(input.statementLineIds).size !== input.statementLineIds.length || new Set(input.journalLineIds).size !== input.journalLineIds.length) {
      throwAppError('VALIDATION_FAILED', 'A line is selected twice.');
    }
    const account = await this.bankAccount(input.organizationId, input.bankAccountId);
    return this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, input.bankAccountId);
      const statement = await tx.bankStatementLine.findMany({ where: { id: { in: input.statementLineIds }, organizationId: input.organizationId, bankAccountId: input.bankAccountId }, include: activeMatches });
      if (statement.length !== input.statementLineIds.length) throwAppError('NOT_FOUND', 'A statement line was not found on this bank account.');
      if (statement.some((l) => l.exceptionMarkedAt)) throwAppError('VALIDATION_FAILED', 'A line marked as an exception cannot be matched. Clear the exception first.');
      await this.guardStatementDates(tx, input, input.bankAccountId, account.legalEntityId, statement.map((l) => dateOf(l.transactionDate)));
      const book = (await this.bookLines(tx, input.organizationId, account.ledgerAccountId, undefined, input.journalLineIds));
      if (book.length !== input.journalLineIds.length) throwAppError('NOT_FOUND', 'A book entry was not found on this bank account.');

      const open = [
        ...statement.map((l) => ({ side: 'S' as const, id: l.id, date: dateOf(l.transactionDate), remaining: l.amount.minus(l.matches.reduce((s, m) => s.plus(m.amount), ZERO)) })),
        ...book.map((b) => ({ side: 'B' as const, id: b.journalLineId, date: b.accountingDate, remaining: new Prisma.Decimal(b.remaining) })),
      ];
      if (open.some((o) => o.remaining.isZero())) throwAppError('VALIDATION_FAILED', 'A selected line is already fully matched.');
      const positive = open[0]!.remaining.isPositive();
      if (open.some((o) => o.remaining.isPositive() !== positive)) throwAppError('VALIDATION_FAILED', 'Money in and money out cannot be matched together.');
      const statementTotal = open.filter((o) => o.side === 'S').reduce((s, o) => s.plus(o.remaining), ZERO);
      const bookTotal = open.filter((o) => o.side === 'B').reduce((s, o) => s.plus(o.remaining), ZERO);
      if (!statementTotal.equals(bookTotal)) throwAppError('VALIDATION_FAILED', `The statement lines total ${statementTotal.toFixed(2)} but the book entries total ${bookTotal.toFixed(2)}.`);

      const queue = (side: 'S' | 'B') => open.filter((o) => o.side === side).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      const s = queue('S');
      const b = queue('B');
      const pairs: Array<{ statementLineId: string; journalLineId: string; amount: Prisma.Decimal }> = [];
      let i = 0;
      let j = 0;
      while (i < s.length && j < b.length) {
        const amount = s[i]!.remaining.abs().lessThan(b[j]!.remaining.abs()) ? s[i]!.remaining : b[j]!.remaining;
        pairs.push({ statementLineId: s[i]!.id, journalLineId: b[j]!.id, amount });
        s[i]!.remaining = s[i]!.remaining.minus(amount);
        b[j]!.remaining = b[j]!.remaining.minus(amount);
        if (s[i]!.remaining.isZero()) i++;
        if (b[j]!.remaining.isZero()) j++;
      }
      await this.createMatches(tx, input, account.legalEntityId, pairs, 'BANK_STATEMENT_MATCHED');
      return { matchCount: pairs.length };
    });
  }

  /**
   * Matches every statement line to the one book entry with the same open
   * amount no more than five days away — only where that pairing is unique
   * in both directions, so auto-match never guesses between candidates.
   */
  async autoMatch(input: { organizationId: string; bankAccountId: string; from: string; to: string; actorId: string; correlationId: string }): Promise<{ matchCount: number }> {
    const account = await this.bankAccount(input.organizationId, input.bankAccountId);
    return this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, input.bankAccountId);
      const statement = (
        await tx.bankStatementLine.findMany({
          where: { organizationId: input.organizationId, bankAccountId: input.bankAccountId, exceptionMarkedAt: null, transactionDate: { gte: asDate(input.from), lte: asDate(input.to) } },
          include: activeMatches,
        })
      )
        .map((l) => ({ id: l.id, date: dateOf(l.transactionDate), remaining: l.amount.minus(l.matches.reduce((s, m) => s.plus(m.amount), ZERO)) }))
        .filter((l) => !l.remaining.isZero());
      const locked = await tx.bankReconciliationPeriod.findMany({ where: { bankAccountId: input.bankAccountId, status: 'LOCKED' }, select: { periodStart: true, periodEnd: true } });
      const inLockedMonth = (date: string) => locked.some((p) => date >= dateOf(p.periodStart) && date <= dateOf(p.periodEnd));
      statement.splice(0, statement.length, ...statement.filter((l) => !inLockedMonth(l.date)));
      const windowStart = new Date(asDate(input.from).getTime() - AUTO_MATCH_DAYS * 86_400_000);
      const windowEnd = new Date(asDate(input.to).getTime() + AUTO_MATCH_DAYS * 86_400_000);
      const book = (await this.bookLines(tx, input.organizationId, account.ledgerAccountId, { gte: windowStart, lte: windowEnd })).filter((b) => b.status !== 'MATCHED');

      const candidates = (line: { date: string; remaining: Prisma.Decimal }, pool: Array<{ id: string; date: string; remaining: Prisma.Decimal }>) =>
        pool.filter((p) => p.remaining.equals(line.remaining) && daysApart(p.date, line.date) <= AUTO_MATCH_DAYS);
      const bookPool = book.map((b) => ({ id: b.journalLineId, date: b.accountingDate, remaining: new Prisma.Decimal(b.remaining) }));
      const statementPool = statement.map((l) => ({ id: l.id, date: l.date, remaining: l.remaining }));

      const pairs: Array<{ statementLineId: string; journalLineId: string; amount: Prisma.Decimal }> = [];
      for (const line of statement) {
        const found = candidates(line, bookPool);
        if (found.length !== 1) continue;
        if (candidates(found[0]!, statementPool).length !== 1) continue;
        pairs.push({ statementLineId: line.id, journalLineId: found[0]!.id, amount: line.remaining });
      }
      const statementDate = new Map(statement.map((l) => [l.id, l.date]));
      await this.guardStatementDates(tx, input, input.bankAccountId, account.legalEntityId, pairs.map((p) => statementDate.get(p.statementLineId)!));
      await this.createMatches(tx, input, account.legalEntityId, pairs, 'BANK_STATEMENT_AUTO_MATCHED');
      return { matchCount: pairs.length };
    });
  }

  async unmatchStatementLine(input: { organizationId: string; statementLineId: string; reason: string; actorId: string; correlationId: string }): Promise<{ unmatchedCount: number }> {
    const line = await this.statementLine(input.organizationId, input.statementLineId);
    return this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, line.bankAccountId);
      await this.guardStatementDates(tx, input, line.bankAccountId, line.bankAccount.legalEntityId, [dateOf(line.transactionDate)]);
      const matches = await tx.bankReconciliationMatch.findMany({ where: { statementLineId: line.id, unmatchedAt: null }, select: { id: true, journalLineId: true, amount: true } });
      if (!matches.length) throwAppError('INVALID_STATE_TRANSITION', 'This statement line is not matched.');
      await tx.bankReconciliationMatch.updateMany({ where: { id: { in: matches.map((m) => m.id) } }, data: { unmatchedAt: new Date(), unmatchedBy: input.actorId, unmatchReason: input.reason } });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: line.bankAccount.legalEntityId,
        entityType: 'BANK_STATEMENT_LINE',
        entityId: line.id,
        action: 'BANK_STATEMENT_UNMATCHED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { matches: matches.map((m) => ({ journalLineId: m.journalLineId, amount: m.amount.toFixed(2) })) },
        reason: input.reason,
      });
      return { unmatchedCount: matches.length };
    });
  }

  async markException(input: { organizationId: string; statementLineId: string; reason: string; actorId: string; correlationId: string }): Promise<BankStatementLineRow> {
    const line = await this.statementLine(input.organizationId, input.statementLineId);
    await this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, line.bankAccountId);
      await this.guardStatementDates(tx, input, line.bankAccountId, line.bankAccount.legalEntityId, [dateOf(line.transactionDate)]);
      const current = await tx.bankStatementLine.findUniqueOrThrow({ where: { id: line.id }, include: activeMatches });
      if (current.exceptionMarkedAt) throwAppError('INVALID_STATE_TRANSITION', 'This line is already marked as an exception.');
      if (current.matches.length) throwAppError('VALIDATION_FAILED', 'Only an unmatched line can be an exception. Unmatch it first.');
      await tx.bankStatementLine.update({ where: { id: line.id }, data: { exceptionReason: input.reason, exceptionMarkedAt: new Date(), exceptionMarkedBy: input.actorId } });
      await this.audit(tx, input, line.bankAccount.legalEntityId, line.id, 'BANK_STATEMENT_EXCEPTION_MARKED', { reason: input.reason });
    });
    return this.statementRow(line.id);
  }

  async approveException(input: { organizationId: string; statementLineId: string; actorId: string; correlationId: string }): Promise<BankStatementLineRow> {
    const line = await this.statementLine(input.organizationId, input.statementLineId);
    await this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, line.bankAccountId);
      await this.guardStatementDates(tx, input, line.bankAccountId, line.bankAccount.legalEntityId, [dateOf(line.transactionDate)]);
      const current = await tx.bankStatementLine.findUniqueOrThrow({ where: { id: line.id } });
      if (!current.exceptionMarkedAt) throwAppError('INVALID_STATE_TRANSITION', 'This line is not marked as an exception.');
      if (current.exceptionApprovedAt) throwAppError('INVALID_STATE_TRANSITION', 'This exception is already approved.');
      if (current.exceptionMarkedBy === input.actorId) throwAppError('SELF_APPROVAL_NOT_ALLOWED', 'The person who marked an exception cannot approve it.');
      await tx.bankStatementLine.update({ where: { id: line.id }, data: { exceptionApprovedAt: new Date(), exceptionApprovedBy: input.actorId } });
      await this.audit(tx, input, line.bankAccount.legalEntityId, line.id, 'BANK_STATEMENT_EXCEPTION_APPROVED', { reason: current.exceptionReason });
    });
    return this.statementRow(line.id);
  }

  async clearException(input: { organizationId: string; statementLineId: string; reason: string; actorId: string; correlationId: string; canApprove: boolean }): Promise<BankStatementLineRow> {
    const line = await this.statementLine(input.organizationId, input.statementLineId);
    await this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, line.bankAccountId);
      await this.guardStatementDates(tx, input, line.bankAccountId, line.bankAccount.legalEntityId, [dateOf(line.transactionDate)]);
      const current = await tx.bankStatementLine.findUniqueOrThrow({ where: { id: line.id } });
      if (!current.exceptionMarkedAt) throwAppError('INVALID_STATE_TRANSITION', 'This line is not marked as an exception.');
      if (current.exceptionApprovedAt && !input.canApprove) throwAppError('FORBIDDEN', 'Missing permission: bank_reconciliation.approve');
      await tx.bankStatementLine.update({ where: { id: line.id }, data: { exceptionReason: null, exceptionMarkedAt: null, exceptionMarkedBy: null, exceptionApprovedAt: null, exceptionApprovedBy: null } });
      await this.audit(tx, input, line.bankAccount.legalEntityId, line.id, 'BANK_STATEMENT_EXCEPTION_CLEARED', { previousReason: current.exceptionReason, wasApproved: Boolean(current.exceptionApprovedAt), reason: input.reason });
    });
    return this.statementRow(line.id);
  }

  async getStatement(input: { organizationId: string; bankAccountId: string; month: string; statementOpeningBalance: string | undefined; statementClosingBalance: string | undefined }): Promise<BankReconciliationStatement> {
    const account = await this.bankAccount(input.organizationId, input.bankAccountId);
    return this.computeStatement(this.prisma.client, account, input.month, input.statementOpeningBalance, input.statementClosingBalance);
  }

  /** Every month with a reconciliation record or with statement lines, newest first. */
  async listPeriods(input: { organizationId: string; bankAccountId: string }): Promise<BankReconciliationPeriodRow[]> {
    await this.bankAccount(input.organizationId, input.bankAccountId);
    const db = this.prisma.client;
    const [periods, lines] = await Promise.all([
      db.bankReconciliationPeriod.findMany({ where: { bankAccountId: input.bankAccountId } }),
      db.bankStatementLine.findMany({ where: { bankAccountId: input.bankAccountId }, select: { transactionDate: true, exceptionMarkedAt: true, matches: { where: { unmatchedAt: null }, select: { id: true }, take: 1 } } }),
    ]);
    const rows = new Map<string, BankReconciliationPeriodRow>();
    for (const l of lines) {
      const month = dateOf(l.transactionDate).slice(0, 7);
      const started = Boolean(l.exceptionMarkedAt) || l.matches.length > 0;
      const row = rows.get(month) ?? { month, status: 'OPEN' as const, statementClosingBalance: null, bookClosingBalance: null, preparedAt: null, lockedAt: null };
      if (started) row.status = 'IN_PROGRESS';
      rows.set(month, row);
    }
    for (const p of periods) {
      const month = dateOf(p.periodStart).slice(0, 7);
      rows.set(month, {
        month,
        status: p.status,
        statementClosingBalance: p.status === 'IN_PROGRESS' ? null : p.statementClosingBalance.toFixed(2),
        bookClosingBalance: p.status === 'IN_PROGRESS' ? null : p.bookClosingBalance.toFixed(2),
        preparedAt: p.status === 'IN_PROGRESS' ? null : p.preparedAt.toISOString(),
        lockedAt: p.lockedAt?.toISOString() ?? null,
      });
    }
    return [...rows.values()].sort((a, b) => b.month.localeCompare(a.month));
  }

  /** docs/05: RECONCILED requires the statement's closing balance, nothing unexplained, and the month before reconciled. */
  async markReconciled(input: { organizationId: string; bankAccountId: string; month: string; statementOpeningBalance: string | undefined; statementClosingBalance: string; actorId: string; correlationId: string }): Promise<BankReconciliationStatement> {
    const account = await this.bankAccount(input.organizationId, input.bankAccountId);
    await this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, input.bankAccountId);
      const statement = await this.computeStatement(tx, account, input.month, input.statementOpeningBalance, input.statementClosingBalance, true);
      if (statement.status === 'RECONCILED' || statement.status === 'LOCKED') throwAppError('INVALID_STATE_TRANSITION', `${monthLabel(input.month)} is already ${statement.status.toLowerCase()}.`);
      if (statement.blockers.length) throwAppError('VALIDATION_FAILED', statement.blockers.join(' '));
      const figures = {
        status: 'RECONCILED' as const,
        statementOpeningBalance: new Prisma.Decimal(statement.statementOpeningBalance!),
        statementClosingBalance: new Prisma.Decimal(statement.statementClosingBalance!),
        bookClosingBalance: new Prisma.Decimal(statement.bookClosingBalance),
        unclearedBookAmount: new Prisma.Decimal(statement.unclearedBookAmount),
        exceptionAmount: new Prisma.Decimal(statement.bankOnlyAmount),
        preparedAt: new Date(),
        preparedBy: input.actorId,
        updatedAt: new Date(),
      };
      const existing = await tx.bankReconciliationPeriod.findFirst({ where: { bankAccountId: input.bankAccountId, periodStart: asDate(statement.periodStart) } });
      const period = existing
        ? await tx.bankReconciliationPeriod.update({ where: { id: existing.id }, data: { ...figures, version: { increment: 1 } } })
        : await tx.bankReconciliationPeriod.create({ data: { id: generateId(), organizationId: input.organizationId, bankAccountId: input.bankAccountId, periodStart: asDate(statement.periodStart), periodEnd: asDate(statement.periodEnd), ...figures } });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: account.legalEntityId,
        entityType: 'BANK_RECONCILIATION_PERIOD',
        entityId: period.id,
        action: 'BANK_RECONCILIATION_RECONCILED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { month: input.month, statementOpeningBalance: statement.statementOpeningBalance, statementClosingBalance: statement.statementClosingBalance, bookClosingBalance: statement.bookClosingBalance, unclearedBookAmount: statement.unclearedBookAmount, bankOnlyAmount: statement.bankOnlyAmount },
      });
    });
    return this.getStatement({ ...input, statementOpeningBalance: undefined, statementClosingBalance: undefined });
  }

  /** docs/05 LOCKED, docs/09: by someone other than the preparer, in month order, with the month still reconciling to zero. */
  async lockPeriod(input: { organizationId: string; bankAccountId: string; month: string; expectedVersion: number; actorId: string; correlationId: string }): Promise<BankReconciliationStatement> {
    const account = await this.bankAccount(input.organizationId, input.bankAccountId);
    await this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, input.bankAccountId);
      const period = await tx.bankReconciliationPeriod.findFirst({ where: { bankAccountId: input.bankAccountId, periodStart: asDate(`${input.month}-01`) } });
      if (!period || period.status !== 'RECONCILED') throwAppError('INVALID_STATE_TRANSITION', `${monthLabel(input.month)} must be reconciled before it can be locked.`);
      if (period.version !== input.expectedVersion) throwAppError('VERSION_CONFLICT', 'This month was changed by someone else. Reload and try again.');
      if (period.preparedBy === input.actorId) throwAppError('SELF_APPROVAL_NOT_ALLOWED', 'The person who reconciled a month cannot lock it.');
      const earlier = await tx.bankReconciliationPeriod.findFirst({ where: { bankAccountId: input.bankAccountId, periodStart: { lt: period.periodStart }, status: { not: 'LOCKED' } }, orderBy: { periodStart: 'asc' } });
      if (earlier) throwAppError('VALIDATION_FAILED', `Lock ${monthLabel(dateOf(earlier.periodStart).slice(0, 7))} first.`);
      const check = await this.computeStatement(tx, account, input.month, undefined, period.statementClosingBalance.toFixed(2), true);
      if (check.unexplainedDifference !== '0.00') throwAppError('VALIDATION_FAILED', `The month no longer reconciles: unexplained difference ${check.unexplainedDifference}.`);
      await tx.bankReconciliationPeriod.update({ where: { id: period.id }, data: { status: 'LOCKED', lockedAt: new Date(), lockedBy: input.actorId, updatedAt: new Date(), version: { increment: 1 } } });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: account.legalEntityId,
        entityType: 'BANK_RECONCILIATION_PERIOD',
        entityId: period.id,
        action: 'BANK_RECONCILIATION_LOCKED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { status: 'RECONCILED' },
        newValues: { status: 'LOCKED', month: input.month },
      });
    });
    return this.getStatement({ organizationId: input.organizationId, bankAccountId: input.bankAccountId, month: input.month, statementOpeningBalance: undefined, statementClosingBalance: undefined });
  }

  // ---------------------------------------------------------------- private

  /**
   * A change to statement lines dated `dates`: refused in a LOCKED month; any
   * RECONCILED month from the earliest date on goes back to IN_PROGRESS, since
   * every later month's statement is computed from the earlier ones.
   */
  private async guardStatementDates(tx: Prisma.TransactionClient, actor: Actor, bankAccountId: string, legalEntityId: string, dates: string[]): Promise<void> {
    if (!dates.length) return;
    const earliest = [...dates].sort()[0]!;
    const periods = await tx.bankReconciliationPeriod.findMany({ where: { bankAccountId, periodEnd: { gte: asDate(earliest) }, status: { in: ['RECONCILED', 'LOCKED'] } } });
    const locked = periods.find((p) => p.status === 'LOCKED' && dates.some((d) => d >= dateOf(p.periodStart) && d <= dateOf(p.periodEnd)));
    if (locked) throwAppError('INVALID_STATE_TRANSITION', `${monthLabel(dateOf(locked.periodStart).slice(0, 7))} is locked for this bank account; its statement lines cannot change.`);
    for (const p of periods.filter((x) => x.status === 'RECONCILED')) {
      await tx.bankReconciliationPeriod.update({ where: { id: p.id }, data: { status: 'IN_PROGRESS', updatedAt: new Date(), version: { increment: 1 } } });
      await recordAuditEvent(tx, {
        organizationId: actor.organizationId,
        legalEntityId,
        entityType: 'BANK_RECONCILIATION_PERIOD',
        entityId: p.id,
        action: 'BANK_RECONCILIATION_REOPENED',
        actorId: actor.actorId,
        correlationId: actor.correlationId,
        oldValues: { status: 'RECONCILED' },
        newValues: { status: 'IN_PROGRESS', month: dateOf(p.periodStart).slice(0, 7), becauseOfChangeDatedFrom: earliest },
      });
    }
  }

  private async ledgerBalance(db: Prisma.TransactionClient, ledgerAccountId: string, accountingDate: Prisma.DateTimeFilter): Promise<Prisma.Decimal> {
    const sum = await db.journalLine.aggregate({ where: { ledgerAccountId, journalEntry: { accountingDate } }, _sum: { debitAmount: true, creditAmount: true } });
    return (sum._sum.debitAmount ?? ZERO).minus(sum._sum.creditAmount ?? ZERO);
  }

  /** The bank reconciliation statement for a month; `live` ignores a stored snapshot (used when reconciling and locking). */
  private async computeStatement(
    db: Prisma.TransactionClient,
    account: { id: string; ledgerAccountId: string },
    month: string,
    openingInput: string | undefined,
    closingInput: string | undefined,
    live = false,
  ): Promise<BankReconciliationStatement> {
    if (!/^\d{4}-\d{2}$/.test(month)) throwAppError('VALIDATION_FAILED', 'Month must be YYYY-MM.');
    const periodStart = `${month}-01`;
    const periodEnd = monthEnd(month);
    const periods = await db.bankReconciliationPeriod.findMany({ where: { bankAccountId: account.id }, orderBy: { periodStart: 'asc' } });
    const current = periods.find((p) => dateOf(p.periodStart) === periodStart) ?? null;
    const first = periods[0] ?? null;
    const isFirstPeriod = !first || dateOf(first.periodStart) >= periodStart;
    const start = isFirstPeriod ? periodStart : dateOf(first.periodStart);
    const stored = current && current.status !== 'IN_PROGRESS' && !live ? current : null;

    const openingAtStart = isFirstPeriod ? (current && current.status !== 'IN_PROGRESS' ? current.statementOpeningBalance : openingInput !== undefined ? new Prisma.Decimal(openingInput) : null) : first.statementOpeningBalance;
    const previous = periods.find((p) => dateOf(p.periodStart).slice(0, 7) === previousMonth(month)) ?? null;
    const monthOpening = isFirstPeriod ? openingAtStart : previous && previous.status !== 'IN_PROGRESS' ? previous.statementClosingBalance : null;

    const [bookOpeningAtStart, bookClosing, statementLines, bookLines] = await Promise.all([
      this.ledgerBalance(db, account.ledgerAccountId, { lt: asDate(start) }),
      this.ledgerBalance(db, account.ledgerAccountId, { lte: asDate(periodEnd) }),
      db.bankStatementLine.findMany({
        where: { bankAccountId: account.id, transactionDate: { gte: asDate(start), lte: asDate(periodEnd) } },
        select: { transactionDate: true, amount: true, exceptionMarkedAt: true, exceptionApprovedAt: true, matches: { where: { unmatchedAt: null }, select: { amount: true, journalLine: { select: { journalEntry: { select: { accountingDate: true } } } } } } },
      }),
      db.journalLine.findMany({
        where: { ledgerAccountId: account.ledgerAccountId, journalEntry: { accountingDate: { gte: asDate(start), lte: asDate(periodEnd) } } },
        select: { debitAmount: true, creditAmount: true, bankReconciliationMatches: { where: { unmatchedAt: null }, select: { amount: true, statementLine: { select: { transactionDate: true } } } } },
      }),
    ]);

    const inMonth = (d: Date) => dateOf(d) >= periodStart;
    let statementLinesTotal = ZERO;
    let bankOnly = ZERO;
    let exceptionAmount = ZERO;
    let openStatementCount = 0;
    let pendingExceptions = 0;
    for (const l of statementLines) {
      const matchedByEnd = l.matches.filter((m) => dateOf(m.journalLine.journalEntry.accountingDate) <= periodEnd).reduce((s, m) => s.plus(m.amount), ZERO);
      bankOnly = bankOnly.plus(l.amount.minus(matchedByEnd));
      if (l.exceptionApprovedAt) exceptionAmount = exceptionAmount.plus(l.amount);
      if (!inMonth(l.transactionDate)) continue;
      statementLinesTotal = statementLinesTotal.plus(l.amount);
      const open = l.amount.minus(l.matches.reduce((s, m) => s.plus(m.amount), ZERO));
      if (!open.isZero() && !l.exceptionApprovedAt) openStatementCount += 1;
      if (l.exceptionMarkedAt && !l.exceptionApprovedAt) pendingExceptions += 1;
    }
    let uncleared = ZERO;
    let unclearedCount = 0;
    for (const b of bookLines) {
      const amount = b.debitAmount.minus(b.creditAmount);
      const clearedByEnd = b.bankReconciliationMatches.filter((m) => dateOf(m.statementLine.transactionDate) <= periodEnd).reduce((s, m) => s.plus(m.amount), ZERO);
      const open = amount.minus(clearedByEnd);
      if (!open.isZero()) {
        uncleared = uncleared.plus(open);
        unclearedCount += 1;
      }
    }

    const closing = stored ? stored.statementClosingBalance : closingInput !== undefined ? new Prisma.Decimal(closingInput) : (current?.statementClosingBalance ?? null);
    const adjusted = openingAtStart ? bookClosing.minus(bookOpeningAtStart).plus(openingAtStart).minus(uncleared).plus(bankOnly) : null;
    const unexplained = closing && adjusted ? closing.minus(adjusted) : null;

    const status: BankReconciliationStatement['status'] = current ? current.status : statementLines.some((l) => inMonth(l.transactionDate) && (l.matches.length || l.exceptionMarkedAt)) ? 'IN_PROGRESS' : 'OPEN';
    const blockers: string[] = [];
    if (status === 'LOCKED') blockers.push(`${monthLabel(month)} is locked.`);
    if (!isFirstPeriod && (!previous || previous.status === 'IN_PROGRESS')) blockers.push(`Reconcile ${monthLabel(previousMonth(month))} first.`);
    if (isFirstPeriod && !openingAtStart) blockers.push(`Enter the bank's opening balance for ${monthLabel(month)} — this is the account's first reconciled month.`);
    if (!closing) blockers.push("Enter the bank's closing balance from the statement.");
    if (openStatementCount) blockers.push(`${openStatementCount} statement line(s) in the month are not matched or explained.`);
    if (pendingExceptions) blockers.push(`${pendingExceptions} exception(s) are awaiting approval.`);
    if (unexplained && !unexplained.isZero()) blockers.push(`Unexplained difference of ${unexplained.toFixed(2)} between the statement and the books.`);

    const figure = (live: Prisma.Decimal, snapshot: Prisma.Decimal | undefined) => (stored && snapshot ? snapshot : live).toFixed(2);
    return {
      bankAccountId: account.id,
      month,
      periodStart,
      periodEnd,
      status,
      isFirstPeriod,
      reconciliationStart: start,
      statementOpeningBalance: stored ? stored.statementOpeningBalance.toFixed(2) : (monthOpening?.toFixed(2) ?? null),
      statementLinesTotal: statementLinesTotal.toFixed(2),
      statementClosingBalance: closing?.toFixed(2) ?? null,
      bookOpeningAtStart: bookOpeningAtStart.toFixed(2),
      bookClosingBalance: figure(bookClosing, stored?.bookClosingBalance),
      unclearedBookAmount: figure(uncleared, stored?.unclearedBookAmount),
      unclearedBookCount: unclearedCount,
      bankOnlyAmount: figure(bankOnly, stored?.exceptionAmount),
      exceptionAmount: exceptionAmount.toFixed(2),
      adjustedBookBalance: stored ? stored.statementClosingBalance.toFixed(2) : (adjusted?.toFixed(2) ?? null),
      unexplainedDifference: stored ? '0.00' : (unexplained?.toFixed(2) ?? null),
      blockers: stored ? (status === 'LOCKED' ? [`${monthLabel(month)} is locked.`] : []) : blockers,
      preparedAt: current && current.status !== 'IN_PROGRESS' ? current.preparedAt.toISOString() : null,
      preparedBy: current && current.status !== 'IN_PROGRESS' ? current.preparedBy : null,
      lockedAt: current?.lockedAt?.toISOString() ?? null,
      lockedBy: current?.lockedBy ?? null,
      version: current?.version ?? null,
    };
  }

  private async lock(tx: Prisma.TransactionClient, bankAccountId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bank_reconciliation:${bankAccountId}`}, 0))`;
  }

  private async bankAccount(organizationId: string, bankAccountId: string) {
    const account = await this.prisma.client.bankAccount.findFirst({
      where: { id: bankAccountId, organizationId },
      select: { id: true, accountName: true, legalEntityId: true, ledgerAccountId: true, legalEntity: { select: { legalName: true } } },
    });
    if (!account) throwAppError('NOT_FOUND', 'Bank account not found.');
    return account;
  }

  private async statementLine(organizationId: string, id: string) {
    const line = await this.prisma.client.bankStatementLine.findFirst({ where: { id, organizationId }, select: { id: true, bankAccountId: true, transactionDate: true, bankAccount: { select: { legalEntityId: true } } } });
    if (!line) throwAppError('NOT_FOUND', 'Statement line not found.');
    return line;
  }

  private async statementRow(id: string): Promise<BankStatementLineRow> {
    return toStatementRow(await this.prisma.client.bankStatementLine.findUniqueOrThrow({ where: { id }, include: activeMatches }));
  }

  private async audit(tx: Prisma.TransactionClient, input: { organizationId: string; actorId: string; correlationId: string }, legalEntityId: string, lineId: string, action: string, values: Record<string, unknown>) {
    await recordAuditEvent(tx, { organizationId: input.organizationId, legalEntityId, entityType: 'BANK_STATEMENT_LINE', entityId: lineId, action, actorId: input.actorId, correlationId: input.correlationId, newValues: values });
  }

  private async createMatches(
    tx: Prisma.TransactionClient,
    input: { organizationId: string; bankAccountId: string; actorId: string; correlationId: string },
    legalEntityId: string,
    pairs: Array<{ statementLineId: string; journalLineId: string; amount: Prisma.Decimal }>,
    action: string,
  ): Promise<void> {
    if (!pairs.length) return;
    await tx.bankReconciliationMatch.createMany({
      data: pairs.map((p) => ({ id: generateId(), organizationId: input.organizationId, bankAccountId: input.bankAccountId, statementLineId: p.statementLineId, journalLineId: p.journalLineId, amount: p.amount, createdBy: input.actorId })),
    });
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      legalEntityId,
      entityType: 'BANK_ACCOUNT',
      entityId: input.bankAccountId,
      action,
      actorId: input.actorId,
      correlationId: input.correlationId,
      newValues: { matches: pairs.map((p) => ({ statementLineId: p.statementLineId, journalLineId: p.journalLineId, amount: p.amount.toFixed(2) })) },
    });
  }

  /** Journal lines on the bank account's ledger account, with their matched amounts. */
  private async bookLines(db: Prisma.TransactionClient, organizationId: string, ledgerAccountId: string, accountingDate: Prisma.DateTimeFilter | undefined, ids?: string[]): Promise<BankBookLineRow[]> {
    const lines = await db.journalLine.findMany({
      where: { organizationId, ledgerAccountId, ...(ids ? { id: { in: ids } } : {}), ...(accountingDate ? { journalEntry: { accountingDate } } : {}) },
      select: {
        id: true,
        debitAmount: true,
        creditAmount: true,
        narrative: true,
        journalEntry: { select: { id: true, accountingDate: true, sourceType: true, description: true } },
        bankReconciliationMatches: { where: { unmatchedAt: null }, select: { amount: true } },
      },
    });
    return lines
      .map((l): BankBookLineRow => {
        const amount = l.debitAmount.minus(l.creditAmount);
        const matched = l.bankReconciliationMatches.reduce((s, m) => s.plus(m.amount), ZERO);
        return {
          journalLineId: l.id,
          journalEntryId: l.journalEntry.id,
          accountingDate: dateOf(l.journalEntry.accountingDate),
          sourceType: l.journalEntry.sourceType,
          description: l.narrative ?? l.journalEntry.description ?? l.journalEntry.sourceType,
          amount: amount.toFixed(2),
          matchedAmount: matched.toFixed(2),
          remaining: amount.minus(matched).toFixed(2),
          status: lineStatus(amount, matched),
        };
      })
      .filter((r) => !new Prisma.Decimal(r.amount).isZero())
      .sort((a, b) => a.accountingDate.localeCompare(b.accountingDate) || a.journalLineId.localeCompare(b.journalLineId));
  }

  private missingProfileColumns(p: BankStatementProfileInput): string[] {
    const missing: string[] = [];
    if (p.amountMode === 'DEBIT_CREDIT_COLUMNS') {
      if (!p.debitColumn) missing.push('withdrawal');
      if (!p.creditColumn) missing.push('deposit');
    } else if (!p.amountColumn) missing.push('amount');
    if (p.amountMode === 'AMOUNT_WITH_INDICATOR' && !p.indicatorColumn) missing.push('Dr/Cr indicator');
    return missing;
  }

  private async parse(input: BankStatementCsv & { organizationId: string; bankAccountId: string }, db: Prisma.TransactionClient = this.prisma.client) {
    await this.bankAccount(input.organizationId, input.bankAccountId);
    const profileRow = await db.bankStatementProfile.findFirst({ where: { organizationId: input.organizationId, bankAccountId: input.bankAccountId } });
    if (!profileRow) throwAppError('VALIDATION_FAILED', 'Map this bank account\'s CSV columns before importing.');
    const profile = toProfile(profileRow);
    const profileInput: BankStatementProfileInput = {
      ...profile,
      referenceColumn: profile.referenceColumn ?? undefined,
      debitColumn: profile.debitColumn ?? undefined,
      creditColumn: profile.creditColumn ?? undefined,
      amountColumn: profile.amountColumn ?? undefined,
      indicatorColumn: profile.indicatorColumn ?? undefined,
      creditIndicator: profile.creditIndicator ?? undefined,
      balanceColumn: profile.balanceColumn ?? undefined,
    };

    const index = new Map(input.headers.map((h, i) => [h.trim().toLowerCase(), i]));
    const wanted = [profile.dateColumn, profile.descriptionColumn, profile.referenceColumn, profile.debitColumn, profile.creditColumn, profile.amountColumn, profile.indicatorColumn, profile.balanceColumn].filter((c): c is string => Boolean(c));
    const absent = wanted.filter((c) => !index.has(c.trim().toLowerCase()));
    if (absent.length) throwAppError('VALIDATION_FAILED', `This file has no ${absent.map((c) => `"${c}"`).join(', ')} column — check the file or the column mapping.`);

    const lockedPeriods = await db.bankReconciliationPeriod.findMany({ where: { bankAccountId: input.bankAccountId, status: 'LOCKED' }, select: { periodStart: true, periodEnd: true } });
    const occurrences = new Map<string, number>();
    const parsed = input.rows.map((cells, i) => {
      const cell = (column: string | undefined) => (column ? cells[index.get(column.trim().toLowerCase())!] : undefined);
      const rowNumber = i + 1;
      const rawDate = (cell(profile.dateColumn) ?? '').trim();
      const transactionDate = parseStatementDate(rawDate, profile.dateFormat);
      const amount = rowAmount(profileInput, cell);
      const description = (cell(profile.descriptionColumn) ?? '').trim();
      const reference = (cell(profile.referenceColumn ?? undefined) ?? '').trim() || null;
      const rawBalance = cell(profile.balanceColumn ?? undefined);
      const balance = parseStatementAmount(rawBalance);
      const errors: string[] = [];
      const blank = cells.every((c) => !c.trim());
      let outcome = 'READY' as BankStatementPreviewRow['outcome'];
      // A date-shaped value that fails to parse is an error; a first cell that is not
      // date-shaped at all ("Closing Balance", a repeated header) marks a summary row.
      const dateShaped = /^\d{1,4}[/\-\s][A-Za-z0-9]{1,9}[/\-\s]\d{2,4}$/.test(rawDate);
      if (blank || (!transactionDate && (!dateShaped || amount === null || typeof amount === 'string'))) {
        // Blank, header-repeat and totals rows carry no dated amount.
        outcome = 'SKIPPED';
      } else {
        if (!transactionDate) errors.push(`"${rawDate}" is not a date in the mapped format.`);
        if (typeof amount === 'string') errors.push(amount);
        if (balance === undefined) errors.push('The balance is not a number.');
        if (transactionDate && lockedPeriods.some((lp) => transactionDate >= dateOf(lp.periodStart) && transactionDate <= dateOf(lp.periodEnd))) {
          errors.push(`${monthLabel(transactionDate.slice(0, 7))} is locked for this bank account.`);
        }
        if (!errors.length && amount === null) outcome = 'SKIPPED';
        if (errors.length) outcome = 'ERROR';
      }
      return { rowNumber, transactionDate, description: description || '(no description)', reference, amount: amount instanceof Prisma.Decimal ? amount : null, balance: balance ?? null, outcome, errors };
    });

    const ready = parsed.filter((p) => p.outcome === 'READY');
    const withFingerprint = ready.map((p) => {
      const base = { transactionDate: p.transactionDate!, amount: p.amount!, description: p.description, reference: p.reference, balance: p.balance };
      const key = statementFingerprint(base, 0);
      const occurrence = occurrences.get(key) ?? 0;
      occurrences.set(key, occurrence + 1);
      return { row: p, fingerprint: statementFingerprint(base, occurrence) };
    });
    const existing = withFingerprint.length
      ? new Set((await db.bankStatementLine.findMany({ where: { bankAccountId: input.bankAccountId, fingerprint: { in: withFingerprint.map((w) => w.fingerprint) } }, select: { fingerprint: true } })).map((l) => l.fingerprint))
      : new Set<string>();
    for (const w of withFingerprint) if (existing.has(w.fingerprint)) w.row.outcome = 'DUPLICATE';

    const importable = withFingerprint.filter((w) => w.row.outcome === 'READY');
    const dates = importable.map((w) => w.row.transactionDate!).sort();
    const preview: BankStatementImportPreview = {
      rows: parsed.map((p) => ({ rowNumber: p.rowNumber, transactionDate: p.transactionDate, description: p.description, reference: p.reference, amount: p.amount?.toFixed(2) ?? null, balance: p.balance?.toFixed(2) ?? null, outcome: p.outcome, errors: p.errors })),
      readyCount: importable.length,
      duplicateCount: parsed.filter((p) => p.outcome === 'DUPLICATE').length,
      skippedCount: parsed.filter((p) => p.outcome === 'SKIPPED').length,
      errorCount: parsed.filter((p) => p.outcome === 'ERROR').length,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      totalIn: importable.reduce((s, w) => (w.row.amount!.isPositive() ? s.plus(w.row.amount!) : s), ZERO).toFixed(2),
      totalOut: importable.reduce((s, w) => (w.row.amount!.isNegative() ? s.plus(w.row.amount!.abs()) : s), ZERO).toFixed(2),
    };
    return {
      preview,
      lines: importable.map((w) => ({ rowNumber: w.row.rowNumber, transactionDate: w.row.transactionDate!, description: w.row.description, reference: w.row.reference, amount: w.row.amount!, balance: w.row.balance, fingerprint: w.fingerprint })),
    };
  }
}
