import { Injectable } from '@nestjs/common';
import { Prisma } from '@zitaware/database';
import { CASH_CATEGORIES, CASH_CATEGORY_LABELS, CASH_INFLOW_CATEGORIES } from '@zitaware/contracts';
import type { CashFlowMonthRow, CashFlowReport, ReportReadInput } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerControlService } from './ledger-control.service';
import { PerformanceReportService } from './performance-report.service';
import { REPORT_CATALOG } from './report-catalog';
import { ReportScopeService } from './report-scope.service';

const ZERO = new Prisma.Decimal(0);
const dateOf = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Calendar months from `from` to `to` inclusive, as YYYY-MM. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endKey = to.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    months.push(key);
    if (key >= endKey) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

/**
 * Cash Flow (Phase 8.6b, ADR-115): each registered bank account's money in
 * and out by month from its ledger account — opening + in − out = closing —
 * with how much of the month the bank's own statement has confirmed, the
 * month's reconciliation status, and the period's net movement by kind.
 * Company-level: client and project filters do not apply.
 */
@Injectable()
export class CashFlowReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ReportScopeService,
    private readonly ledger: LedgerControlService,
    private readonly performance: PerformanceReportService,
  ) {}

  async cashFlow(input: ReportReadInput): Promise<CashFlowReport> {
    const companyInput: ReportReadInput = { ...input, canSeeAllProjects: true, filters: { ...input.filters, clientId: undefined, projectId: undefined } };
    const { scope } = await this.scopes.resolve(companyInput);
    const db = this.prisma.client;
    const asOf = scope.asOfDate;
    const accounts = await db.bankAccount.findMany({
      where: { organizationId: input.organizationId, ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}) },
      select: { id: true, accountName: true, ledgerAccountId: true },
      orderBy: { accountName: 'asc' },
    });

    const firstLine = scope.dateFrom
      ? null
      : await db.journalLine.findFirst({
          where: { ledgerAccountId: { in: accounts.map((a) => a.ledgerAccountId) }, journalEntry: { accountingDate: { lte: asDate(asOf) } } },
          select: { journalEntry: { select: { accountingDate: true } } },
          orderBy: { journalEntry: { accountingDate: 'asc' } },
        });
    const from = scope.dateFrom ?? (firstLine ? `${dateOf(firstLine.journalEntry.accountingDate).slice(0, 7)}-01` : `${asOf.slice(0, 7)}-01`);
    const months = monthsBetween(from, asOf);

    const monthRows: CashFlowMonthRow[] = [];
    const accountRows: CashFlowReport['accounts'] = [];
    let totalOpening = ZERO;
    let totalIn = ZERO;
    let totalOut = ZERO;
    for (const account of accounts) {
      const [openingSum, lines, periods] = await Promise.all([
        db.journalLine.aggregate({ where: { ledgerAccountId: account.ledgerAccountId, journalEntry: { accountingDate: { lt: asDate(from) } } }, _sum: { debitAmount: true, creditAmount: true } }),
        db.journalLine.findMany({
          where: { ledgerAccountId: account.ledgerAccountId, journalEntry: { accountingDate: { gte: asDate(from), lte: asDate(asOf) } } },
          select: { debitAmount: true, creditAmount: true, journalEntry: { select: { accountingDate: true } }, bankReconciliationMatches: { where: { unmatchedAt: null }, select: { amount: true } } },
        }),
        db.bankReconciliationPeriod.findMany({ where: { bankAccountId: account.id }, select: { periodStart: true, status: true } }),
      ]);
      const opening = (openingSum._sum.debitAmount ?? ZERO).minus(openingSum._sum.creditAmount ?? ZERO);
      const statusByMonth = new Map(periods.map((p) => [dateOf(p.periodStart).slice(0, 7), p.status]));
      let running = opening;
      let accountIn = ZERO;
      let accountOut = ZERO;
      for (const month of months) {
        const inMonth = lines.filter((l) => dateOf(l.journalEntry.accountingDate).startsWith(month));
        let inflow = ZERO;
        let outflow = ZERO;
        let matchedIn = ZERO;
        let matchedOut = ZERO;
        for (const l of inMonth) {
          const matched = l.bankReconciliationMatches.reduce((s, m) => s.plus(m.amount), ZERO).abs();
          inflow = inflow.plus(l.debitAmount);
          outflow = outflow.plus(l.creditAmount);
          if (l.debitAmount.greaterThan(0)) matchedIn = matchedIn.plus(Prisma.Decimal.min(matched, l.debitAmount));
          if (l.creditAmount.greaterThan(0)) matchedOut = matchedOut.plus(Prisma.Decimal.min(matched, l.creditAmount));
        }
        const closing = running.plus(inflow).minus(outflow);
        monthRows.push({
          bankAccountId: account.id,
          bankAccountName: account.accountName,
          month,
          opening: running.toFixed(2),
          inflow: inflow.toFixed(2),
          outflow: outflow.toFixed(2),
          closing: closing.toFixed(2),
          matchedInflow: matchedIn.toFixed(2),
          matchedOutflow: matchedOut.toFixed(2),
          reconciliationStatus: statusByMonth.get(month) ?? (inMonth.some((l) => l.bankReconciliationMatches.length) ? 'IN_PROGRESS' : 'OPEN'),
        });
        running = closing;
        accountIn = accountIn.plus(inflow);
        accountOut = accountOut.plus(outflow);
      }
      accountRows.push({ bankAccountId: account.id, bankAccountName: account.accountName, opening: opening.toFixed(2), inflow: accountIn.toFixed(2), outflow: accountOut.toFixed(2), closing: running.toFixed(2) });
      totalOpening = totalOpening.plus(opening);
      totalIn = totalIn.plus(accountIn);
      totalOut = totalOut.plus(accountOut);
    }

    const cash = await this.performance.cashProfitability({ ...companyInput, filters: { ...companyInput.filters, dateFrom: from } });
    const byCategory = CASH_CATEGORIES.map((category) => {
      const amount = new Prisma.Decimal(cash.totals.amounts[category]);
      return { category, label: CASH_CATEGORY_LABELS[category], amount: (CASH_INFLOW_CATEGORIES.includes(category) ? amount : amount.negated()).toFixed(2) };
    }).filter((c) => !new Prisma.Decimal(c.amount).isZero());

    const lines = await this.ledger.reconcile({
      organizationId: input.organizationId,
      legalEntityId: scope.legalEntityId,
      asOfDate: asOf,
      requests: accountRows.map((a) => ({ key: a.bankAccountId, label: `${a.bankAccountName} closing balance`, ledgerCodes: [], ledgerAccountIds: [accounts.find((x) => x.id === a.bankAccountId)!.ledgerAccountId], reportAmount: new Prisma.Decimal(a.closing) })),
    });

    return {
      catalog: REPORT_CATALOG['cash-flow'],
      scope: { ...scope, dateFrom: from, restricted: false },
      months: monthRows,
      accounts: accountRows,
      totals: { opening: totalOpening.toFixed(2), inflow: totalIn.toFixed(2), outflow: totalOut.toFixed(2), closing: totalOpening.plus(totalIn).minus(totalOut).toFixed(2) },
      byCategory,
      reconciliation: { applicable: true, notApplicableReason: null, lines, allReconciled: lines.every((l) => l.reconciled) },
    };
  }
}
