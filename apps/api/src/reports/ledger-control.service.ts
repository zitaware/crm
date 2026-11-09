import { Injectable } from '@nestjs/common';
import { Prisma } from '@zitaware/database';
import type { LedgerReconciliationLine } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';

const ZERO = new Prisma.Decimal(0);

export interface ReconciliationRequest {
  key: string;
  label: string;
  /** Control accounts, by their fixed code. */
  ledgerCodes: string[];
  /** Further accounts by id — e.g. a penalty category's own disputed account. */
  ledgerAccountIds?: string[] | undefined;
  reportAmount: Prisma.Decimal;
}

/**
 * Compares report totals with the ledger — Phase 8's "report totals reconcile
 * to ledger control accounts" (docs/11).
 *
 * A balance here is debit minus credit over every journal line dated on or
 * before the as-of date. A reversed entry and its reversal both count, so
 * they cancel, exactly as the Ledger screen's getLedgerActivity computes it.
 * The receivable accounts are all debit-normal, so a positive balance is
 * money still to come in.
 */
@Injectable()
export class LedgerControlService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Income and expense movement over a period — credit − debit for income,
   * debit − credit for expense — for comparing a P&L's totals with the ledger
   * (ADR-109). A null `dateFrom` means from the first entry.
   */
  async periodMovementByType(input: {
    organizationId: string;
    legalEntityId: string | null;
    dateFrom: string | null;
    dateTo: string;
  }): Promise<{ INCOME: Prisma.Decimal; EXPENSE: Prisma.Decimal; accountIds: { INCOME: Array<{ id: string; code: string; name: string }>; EXPENSE: Array<{ id: string; code: string; name: string }> } }> {
    const accounts = await this.prisma.client.ledgerAccount.findMany({
      where: { organizationId: input.organizationId, accountGroup: { accountType: { in: ['INCOME', 'EXPENSE'] } } },
      select: { id: true, code: true, name: true, accountGroup: { select: { accountType: true } } },
      orderBy: { code: 'asc' },
    });
    const sums = accounts.length
      ? await this.prisma.client.journalLine.groupBy({
          by: ['ledgerAccountId'],
          where: {
            organizationId: input.organizationId,
            ledgerAccountId: { in: accounts.map((a) => a.id) },
            journalEntry: {
              accountingDate: {
                lte: new Date(`${input.dateTo}T00:00:00.000Z`),
                ...(input.dateFrom ? { gte: new Date(`${input.dateFrom}T00:00:00.000Z`) } : {}),
              },
              ...(input.legalEntityId ? { legalEntityId: input.legalEntityId } : {}),
            },
          },
          _sum: { debitAmount: true, creditAmount: true },
        })
      : [];
    const sumById = new Map(sums.map((s) => [s.ledgerAccountId, s._sum]));
    const result = { INCOME: ZERO, EXPENSE: ZERO, accountIds: { INCOME: [] as Array<{ id: string; code: string; name: string }>, EXPENSE: [] as Array<{ id: string; code: string; name: string }> } };
    for (const account of accounts) {
      const type = account.accountGroup.accountType as 'INCOME' | 'EXPENSE';
      const sum = sumById.get(account.id);
      result.accountIds[type].push({ id: account.id, code: account.code, name: account.name });
      if (!sum) continue;
      const debit = sum.debitAmount ?? ZERO;
      const credit = sum.creditAmount ?? ZERO;
      result[type] = result[type].plus(type === 'INCOME' ? credit.minus(debit) : debit.minus(credit));
    }
    return result;
  }

  /**
   * Debit − credit over a period for accounts by code, with the account
   * behind each code (ADR-111). Missing codes are absent from the map.
   */
  async periodMovementByCode(input: {
    organizationId: string;
    legalEntityId: string | null;
    dateFrom: string | null;
    dateTo: string;
    codes: string[];
  }): Promise<Map<string, { account: { id: string; code: string; name: string }; debitMinusCredit: Prisma.Decimal }>> {
    const accounts = await this.prisma.client.ledgerAccount.findMany({
      where: { organizationId: input.organizationId, code: { in: input.codes } },
      select: { id: true, code: true, name: true },
    });
    const sums = accounts.length
      ? await this.prisma.client.journalLine.groupBy({
          by: ['ledgerAccountId'],
          where: {
            organizationId: input.organizationId,
            ledgerAccountId: { in: accounts.map((a) => a.id) },
            journalEntry: {
              accountingDate: { lte: new Date(`${input.dateTo}T00:00:00.000Z`), ...(input.dateFrom ? { gte: new Date(`${input.dateFrom}T00:00:00.000Z`) } : {}) },
              ...(input.legalEntityId ? { legalEntityId: input.legalEntityId } : {}),
            },
          },
          _sum: { debitAmount: true, creditAmount: true },
        })
      : [];
    const byId = new Map(sums.map((s) => [s.ledgerAccountId, (s._sum.debitAmount ?? ZERO).minus(s._sum.creditAmount ?? ZERO)]));
    return new Map(accounts.map((a) => [a.code, { account: a, debitMinusCredit: byId.get(a.id) ?? ZERO }]));
  }

  /**
   * Debit − credit over a period on accounts by code, counting only lines
   * posted by the given business events — or by reversals of them (ADR-116).
   * Lets a report whose figures come from documents be compared with exactly
   * the postings those documents made.
   */
  async movementBySource(input: {
    organizationId: string;
    legalEntityId: string | null;
    dateFrom: string | null;
    dateTo: string;
    codes: string[];
    /** Also every account of these types (e.g. EXPENSE). */
    accountTypes?: Array<'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'>;
    sourceTypes: string[];
  }): Promise<Map<string, { account: { id: string; code: string; name: string }; debitMinusCredit: Prisma.Decimal }>> {
    const accounts = await this.prisma.client.ledgerAccount.findMany({
      where: { organizationId: input.organizationId, OR: [{ code: { in: input.codes } }, ...(input.accountTypes?.length ? [{ accountGroup: { accountType: { in: input.accountTypes } } }] : [])] },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
    const lines = accounts.length
      ? await this.prisma.client.journalLine.findMany({
          where: {
            organizationId: input.organizationId,
            ledgerAccountId: { in: accounts.map((a) => a.id) },
            journalEntry: {
              accountingDate: { lte: new Date(`${input.dateTo}T00:00:00.000Z`), ...(input.dateFrom ? { gte: new Date(`${input.dateFrom}T00:00:00.000Z`) } : {}) },
              ...(input.legalEntityId ? { legalEntityId: input.legalEntityId } : {}),
              OR: [{ sourceType: { in: input.sourceTypes } }, { reversalOf: { sourceType: { in: input.sourceTypes } } }],
            },
          },
          select: { ledgerAccountId: true, debitAmount: true, creditAmount: true },
        })
      : [];
    const byId = new Map<string, Prisma.Decimal>();
    for (const l of lines) byId.set(l.ledgerAccountId, (byId.get(l.ledgerAccountId) ?? ZERO).plus(l.debitAmount).minus(l.creditAmount));
    return new Map(accounts.map((a) => [a.code, { account: a, debitMinusCredit: byId.get(a.id) ?? ZERO }]));
  }

  /**
   * The ledger accounts behind the registered bank accounts, with their
   * combined opening balance (before `dateFrom`), movement over the period and
   * closing balance — debit − credit, so money in is positive (ADR-110).
   */
  async bankMovement(input: {
    organizationId: string;
    legalEntityId: string | null;
    dateFrom: string | null;
    dateTo: string;
  }): Promise<{ accounts: Array<{ id: string; code: string; name: string }>; opening: Prisma.Decimal; movement: Prisma.Decimal; closing: Prisma.Decimal }> {
    const bankAccounts = await this.prisma.client.bankAccount.findMany({
      where: { organizationId: input.organizationId, ...(input.legalEntityId ? { legalEntityId: input.legalEntityId } : {}) },
      select: { ledgerAccount: { select: { id: true, code: true, name: true } } },
    });
    const accounts = [...new Map(bankAccounts.map((b) => [b.ledgerAccount.id, b.ledgerAccount])).values()].sort((a, b) => a.code.localeCompare(b.code));
    if (!accounts.length) return { accounts, opening: ZERO, movement: ZERO, closing: ZERO };

    const sum = async (accountingDate: Prisma.DateTimeFilter) => {
      const result = await this.prisma.client.journalLine.aggregate({
        where: {
          organizationId: input.organizationId,
          ledgerAccountId: { in: accounts.map((a) => a.id) },
          journalEntry: { accountingDate, ...(input.legalEntityId ? { legalEntityId: input.legalEntityId } : {}) },
        },
        _sum: { debitAmount: true, creditAmount: true },
      });
      return (result._sum.debitAmount ?? ZERO).minus(result._sum.creditAmount ?? ZERO);
    };
    const end = new Date(`${input.dateTo}T00:00:00.000Z`);
    const start = input.dateFrom ? new Date(`${input.dateFrom}T00:00:00.000Z`) : null;
    const [opening, movement] = await Promise.all([start ? sum({ lt: start }) : Promise.resolve(ZERO), sum({ lte: end, ...(start ? { gte: start } : {}) })]);
    return { accounts, opening, movement, closing: opening.plus(movement) };
  }

  async reconcile(input: {
    organizationId: string;
    legalEntityId: string | null;
    asOfDate: string;
    requests: ReconciliationRequest[];
  }): Promise<LedgerReconciliationLine[]> {
    const codes = [...new Set(input.requests.flatMap((r) => r.ledgerCodes))];
    const extraIds = [...new Set(input.requests.flatMap((r) => r.ledgerAccountIds ?? []))];
    const accounts = await this.prisma.client.ledgerAccount.findMany({
      where: { organizationId: input.organizationId, OR: [{ code: { in: codes } }, { id: { in: extraIds } }] },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });

    const sums = accounts.length
      ? await this.prisma.client.journalLine.groupBy({
          by: ['ledgerAccountId'],
          where: {
            organizationId: input.organizationId,
            ledgerAccountId: { in: accounts.map((a) => a.id) },
            journalEntry: {
              accountingDate: { lte: new Date(`${input.asOfDate}T00:00:00.000Z`) },
              ...(input.legalEntityId ? { legalEntityId: input.legalEntityId } : {}),
            },
          },
          _sum: { debitAmount: true, creditAmount: true },
        })
      : [];
    const balanceById = new Map(sums.map((s) => [s.ledgerAccountId, (s._sum.debitAmount ?? ZERO).minus(s._sum.creditAmount ?? ZERO)]));

    return input.requests.map((request) => {
      const matched = accounts.filter((a) => request.ledgerCodes.includes(a.code) || (request.ledgerAccountIds ?? []).includes(a.id));
      const ledgerAmount = matched.reduce((sum, a) => sum.plus(balanceById.get(a.id) ?? ZERO), ZERO);
      const difference = request.reportAmount.minus(ledgerAmount);
      return {
        key: request.key,
        label: request.label,
        ledgerAccounts: matched.map((a) => ({ id: a.id, code: a.code, name: a.name })),
        reportAmount: request.reportAmount.toFixed(2),
        ledgerAmount: ledgerAmount.toFixed(2),
        difference: difference.toFixed(2),
        reconciled: difference.isZero(),
      };
    });
  }
}
