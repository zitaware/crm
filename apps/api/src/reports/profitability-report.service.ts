import { Injectable } from '@nestjs/common';
import { Prisma } from '@zitaware/database';
import { COST_CATEGORIES } from '@zitaware/contracts';
import type {
  CostCategory,
  CostToCompanyReport,
  CostToCompanyRow,
  LedgerReconciliation,
  ProjectPlAccountLine,
  ProjectPlReport,
  ProjectPlRow,
  ReportReadInput,
  ReportScope,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeAllocationsService } from '../employee-allocations/employee-allocations.service';
import { LedgerControlService } from './ledger-control.service';
import { REPORT_CATALOG } from './report-catalog';
import { ReportScopeService } from './report-scope.service';

const ZERO = new Prisma.Decimal(0);
const REVERSAL_SOURCE_TYPE = 'journal_entry_reversal';

/** Which cost category a posted expense belongs to, by the business event that posted it. */
const CATEGORY_BY_SOURCE_TYPE: Record<string, CostCategory> = {
  vendor_bill_approve: 'PURCHASE',
  'direct_expense.post': 'DIRECT_EXPENSE',
  'employee_expense_claim.approve': 'REIMBURSEMENT',
  inventory_consumption: 'MATERIAL',
  introducer_accrual: 'INTRODUCER',
};

interface Line {
  projectId: string | null;
  accountId: string;
  code: string;
  name: string;
  type: 'INCOME' | 'EXPENSE';
  /** In the account's natural direction. */
  amount: Prisma.Decimal;
  /** The originating event — for a reversal, the entry it reverses. */
  sourceType: string;
  sourceId: string;
}

interface Period {
  scope: ReportScope;
  projects: Array<{ id: string; name: string; clientName: string | null }>;
  /** Lines on the visible, selected projects, plus (unrestricted only) lines with no project. */
  lines: Line[];
  manpowerByProject: Map<string, Prisma.Decimal>;
}

function emptyAmounts(): Record<CostCategory, Prisma.Decimal> {
  return Object.fromEntries(COST_CATEGORIES.map((c) => [c, ZERO])) as Record<CostCategory, Prisma.Decimal>;
}
function toStrings(amounts: Record<CostCategory, Prisma.Decimal>): Record<CostCategory, string> {
  return Object.fromEntries(COST_CATEGORIES.map((c) => [c, amounts[c].toFixed(2)])) as Record<CostCategory, string>;
}
function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}
/** The first 1st-of-month on or after `date` (YYYY-MM-DD). */
export function firstMonthStartingOnOrAfter(date: string): string {
  if (date.endsWith('-01')) return date;
  const next = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1)); // Date.UTC months are 0-based, so this is the next month
  return next.toISOString().slice(0, 10);
}

/**
 * Accrual Project P&L and Cost to Company (Phase 8.2, ADR-109).
 *
 * Both read posted journal lines for the period and group them by the
 * project carried on the line — so they can only ever agree with the ledger,
 * and lines with no project are shown as such rather than spread by a formula.
 * Manpower is the one analytical figure: salary is posted company-wide and
 * split to projects by monthly allocation (ADR-095), so it is shown beside the
 * ledger figures, never added into their totals.
 */
@Injectable()
export class ProfitabilityReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ReportScopeService,
    private readonly allocations: EmployeeAllocationsService,
    private readonly ledger: LedgerControlService,
  ) {}

  async projectPl(input: ReportReadInput): Promise<ProjectPlReport> {
    const period = await this.period(input);

    const row = (projectId: string | null, projectName: string, clientName: string | null, lines: Line[], manpower: Prisma.Decimal | null): ProjectPlRow => {
      const income = lines.filter((l) => l.type === 'INCOME').reduce((s, l) => s.plus(l.amount), ZERO);
      const expense = lines.filter((l) => l.type === 'EXPENSE').reduce((s, l) => s.plus(l.amount), ZERO);
      const contribution = income.minus(expense);
      return {
        projectId,
        projectName,
        clientName,
        income: income.toFixed(2),
        expense: expense.toFixed(2),
        contribution: contribution.toFixed(2),
        manpower: manpower ? manpower.toFixed(2) : null,
        contributionAfterManpower: manpower ? contribution.minus(manpower).toFixed(2) : null,
      };
    };

    const projects = period.projects.map((p) =>
      row(p.id, p.name, p.clientName, period.lines.filter((l) => l.projectId === p.id), period.manpowerByProject.get(p.id) ?? ZERO),
    );
    const unassigned = period.scope.restricted ? null : row(null, 'Not assigned to a project', null, period.lines.filter((l) => l.projectId === null), null);
    const totals = row(null, 'Total', null, period.lines, null);

    const byAccount = new Map<string, { line: Line; assigned: Prisma.Decimal; unassigned: Prisma.Decimal }>();
    for (const l of period.lines) {
      const entry = byAccount.get(l.accountId) ?? { line: l, assigned: ZERO, unassigned: ZERO };
      if (l.projectId) entry.assigned = entry.assigned.plus(l.amount);
      else entry.unassigned = entry.unassigned.plus(l.amount);
      byAccount.set(l.accountId, entry);
    }
    const accounts: ProjectPlAccountLine[] = [...byAccount.values()]
      .map(({ line, assigned, unassigned: none }) => ({
        ledgerAccountId: line.accountId,
        code: line.code,
        name: line.name,
        accountType: line.type,
        assignedAmount: assigned.toFixed(2),
        unassignedAmount: none.toFixed(2),
        totalAmount: assigned.plus(none).toFixed(2),
      }))
      .sort((a, b) => (a.accountType === b.accountType ? a.code.localeCompare(b.code) : a.accountType === 'INCOME' ? -1 : 1));

    const reconciliation = await this.reconcile(input, period.scope, [
      { key: 'INCOME', label: 'Income (projects + not assigned)', amount: new Prisma.Decimal(totals.income) },
      { key: 'EXPENSE', label: 'Expense (projects + not assigned)', amount: new Prisma.Decimal(totals.expense) },
    ]);

    return { catalog: REPORT_CATALOG['project-pl'], scope: period.scope, projects, unassigned, totals, accounts, reconciliation };
  }

  async costToCompany(input: ReportReadInput): Promise<CostToCompanyReport> {
    const period = await this.period(input);
    const expenseLines = period.lines.filter((l) => l.type === 'EXPENSE');

    // A direct expense tagged server or subscription (ADR-169) is shown as its own cost head.
    const directExpenseIds = [...new Set(expenseLines.filter((l) => l.sourceType === 'direct_expense.post').map((l) => l.sourceId))];
    const recurring = new Set(
      directExpenseIds.length
        ? (
            await this.prisma.client.directExpense.findMany({
              where: { organizationId: input.organizationId, id: { in: directExpenseIds }, spendType: { not: null } },
              select: { id: true },
            })
          ).map((r) => r.id)
        : [],
    );
    const categoryOf = (l: Line): CostCategory =>
      l.sourceType === 'direct_expense.post' && recurring.has(l.sourceId) ? 'RECURRING' : (CATEGORY_BY_SOURCE_TYPE[l.sourceType] ?? 'OTHER');

    const totals = emptyAmounts();
    const rows: CostToCompanyRow[] = period.projects.map((p) => {
      const amounts = emptyAmounts();
      for (const l of expenseLines) if (l.projectId === p.id) amounts[categoryOf(l)] = amounts[categoryOf(l)].plus(l.amount);
      amounts.MANPOWER = period.manpowerByProject.get(p.id) ?? ZERO;
      for (const c of COST_CATEGORIES) totals[c] = totals[c].plus(amounts[c]);
      const postedTotal = COST_CATEGORIES.filter((c) => c !== 'MANPOWER').reduce((s, c) => s.plus(amounts[c]), ZERO);
      return {
        projectId: p.id,
        projectName: p.name,
        clientName: p.clientName,
        amounts: toStrings(amounts),
        postedTotal: postedTotal.toFixed(2),
        total: postedTotal.plus(amounts.MANPOWER).toFixed(2),
      };
    });
    const postedTotal = COST_CATEGORIES.filter((c) => c !== 'MANPOWER').reduce((s, c) => s.plus(totals[c]), ZERO);
    const unassigned = expenseLines.filter((l) => l.projectId === null).reduce((s, l) => s.plus(l.amount), ZERO);

    const reconciliation = await this.reconcile(input, period.scope, [
      { key: 'EXPENSE', label: 'Posted cost (projects + not assigned)', amount: postedTotal.plus(unassigned) },
    ]);

    return {
      catalog: REPORT_CATALOG['cost-to-company'],
      scope: period.scope,
      rows,
      totals: { amounts: toStrings(totals), postedTotal: postedTotal.toFixed(2), total: postedTotal.plus(totals.MANPOWER).toFixed(2) },
      unassignedPostedCost: period.scope.restricted ? null : unassigned.toFixed(2),
      reconciliation,
    };
  }

  private async reconcile(
    input: ReportReadInput,
    scope: ReportScope,
    figures: Array<{ key: 'INCOME' | 'EXPENSE'; label: string; amount: Prisma.Decimal }>,
  ): Promise<LedgerReconciliation> {
    if (scope.restricted) {
      return {
        applicable: false,
        notApplicableReason: input.canSeeAllProjects
          ? 'Filtered to one client or project. The ledger total includes every project and all unassigned cost, so it is compared only on the unfiltered view.'
          : 'You can see only the projects assigned to you, so these totals cannot be compared with the whole ledger.',
        lines: [],
        allReconciled: false,
      };
    }
    const movement = await this.ledger.periodMovementByType({
      organizationId: input.organizationId,
      legalEntityId: scope.legalEntityId,
      dateFrom: scope.dateFrom,
      dateTo: scope.asOfDate,
    });
    const lines = figures.map((f) => {
      const difference = f.amount.minus(movement[f.key]);
      return {
        key: f.key,
        label: f.label,
        ledgerAccounts: movement.accountIds[f.key],
        reportAmount: f.amount.toFixed(2),
        ledgerAmount: movement[f.key].toFixed(2),
        difference: difference.toFixed(2),
        reconciled: difference.isZero(),
      };
    });
    return { applicable: true, notApplicableReason: null, lines, allReconciled: lines.every((l) => l.reconciled) };
  }

  private async period(input: ReportReadInput): Promise<Period> {
    const { organizationId, filters } = input;
    const db = this.prisma.client;
    const { scope, projects: scoped } = await this.scopes.resolve(input);
    const projects = scoped.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName }));
    const selectedIds = projects.map((p) => p.id);

    const projectFilter = scope.restricted ? { projectId: { in: selectedIds } } : { OR: [{ projectId: { in: selectedIds } }, { projectId: null }] };
    const raw = selectedIds.length || !scope.restricted
      ? await db.journalLine.findMany({
          where: {
            organizationId,
            ...projectFilter,
            ledgerAccount: { accountGroup: { accountType: { in: ['INCOME', 'EXPENSE'] } } },
            journalEntry: {
              accountingDate: { lte: new Date(`${filters.asOfDate}T00:00:00.000Z`), ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) } : {}) },
              ...(filters.legalEntityId ? { legalEntityId: filters.legalEntityId } : {}),
            },
          },
          select: {
            projectId: true,
            debitAmount: true,
            creditAmount: true,
            ledgerAccount: { select: { id: true, code: true, name: true, accountGroup: { select: { accountType: true } } } },
            journalEntry: { select: { sourceType: true, sourceId: true, reversalOf: { select: { sourceType: true, sourceId: true } } } },
          },
        })
      : [];

    const lines: Line[] = raw.map((l) => {
      const type = l.ledgerAccount.accountGroup.accountType as 'INCOME' | 'EXPENSE';
      const origin = l.journalEntry.sourceType === REVERSAL_SOURCE_TYPE && l.journalEntry.reversalOf ? l.journalEntry.reversalOf : l.journalEntry;
      return {
        projectId: l.projectId,
        accountId: l.ledgerAccount.id,
        code: l.ledgerAccount.code,
        name: l.ledgerAccount.name,
        type,
        amount: type === 'INCOME' ? l.creditAmount.minus(l.debitAmount) : l.debitAmount.minus(l.creditAmount),
        sourceType: origin.sourceType,
        sourceId: origin.sourceId,
      };
    });

    // Manpower counts an allocation month when the month starts inside the
    // period (salary for a month is posted at its end).
    const manpowerByProject = new Map<string, Prisma.Decimal>();
    if (selectedIds.length) {
      const fromMonth = filters.dateFrom ? firstMonthStartingOnOrAfter(filters.dateFrom) : '1900-01-01';
      const toMonth = firstOfMonth(filters.asOfDate);
      if (fromMonth <= toMonth) {
        const report = await this.allocations.getProjectManpowerCost({
          organizationId,
          fromMonth,
          toMonth,
          projectId: filters.projectId,
          actorId: input.actorId,
          canSeeAllProjects: input.canSeeAllProjects,
        });
        for (const r of report.rows) {
          if (!selectedIds.includes(r.projectId)) continue;
          manpowerByProject.set(r.projectId, (manpowerByProject.get(r.projectId) ?? ZERO).plus(r.manpowerCostAmount));
        }
      }
    }

    return { scope, projects, lines, manpowerByProject };
  }
}
