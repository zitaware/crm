import { Injectable } from '@nestjs/common';
import { Prisma } from '@zitaware/database';
import { AUDIT_ACTION_GROUP_LABELS } from '@zitaware/contracts';
import type {
  AuditActionGroup,
  AuditActivityReport,
  ExceptionItem,
  ExceptionsReport,
  LedgerCheckRow,
  LedgerReconciliation,
  ReportCatalogEntry,
  ReportReadInput,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { auditActionGroup } from './audit-group.util';
import { CashFlowReportService } from './cash-flow-report.service';
import { OperationsReportService } from './operations-report.service';
import { PayablesReportService } from './payables-report.service';
import { notComparable } from './reconciliation.util';
import { ReceivablesReportService } from './receivables-report.service';
import { REPORT_CATALOG } from './report-catalog';
import { ReportScopeService } from './report-scope.service';
import { TdsReportService } from './tds-report.service';

const ZERO = new Prisma.Decimal(0);
const dateOf = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dayAfter = (s: string) => new Date(asDate(s).getTime() + 86_400_000);
const sum = (values: Array<Prisma.Decimal | string>) => values.reduce<Prisma.Decimal>((t, v) => t.plus(v), ZERO);
const minDate = (dates: string[]) => (dates.length ? [...dates].sort()[0]! : null);

const SENSITIVE_EVENT_LIMIT = 200;
/** docs/09: alert on repeated authentication failure. */
const REPEATED_FAILURE_THRESHOLD = 3;
const AUDIT_GROUP_ORDER: AuditActionGroup[] = ['CORRECTION', 'DELETION', 'PERIOD_CONTROL', 'ACCESS', 'SIGN_IN', 'EXPORT', 'EXCEPTION', 'ROUTINE'];

/**
 * Audit Activity and Exceptions (Phase 8.9b, ADR-120): the controls views.
 * Neither is an accounting figure; Exceptions gathers what the other reports
 * and the work queues leave open, including every report's ledger check.
 */
@Injectable()
export class ControlsReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ReportScopeService,
    private readonly receivables: ReceivablesReportService,
    private readonly payables: PayablesReportService,
    private readonly tds: TdsReportService,
    private readonly cashFlowReports: CashFlowReportService,
    private readonly operations: OperationsReportService,
  ) {}

  /** docs/09 audit coverage: what was done in the period, with the sensitive actions and repeated sign-in failures called out. */
  async auditActivity(input: ReportReadInput): Promise<AuditActivityReport> {
    const { scope } = await this.scopes.resolve({ ...input, canSeeAllProjects: true, filters: { ...input.filters, legalEntityId: undefined, clientId: undefined, projectId: undefined } });
    const db = this.prisma.client;
    const createdAt = { lt: dayAfter(scope.asOfDate), ...(scope.dateFrom ? { gte: asDate(scope.dateFrom) } : {}) };
    const where = { organizationId: input.organizationId, createdAt };

    const counts = await db.auditEvent.groupBy({ by: ['action', 'entityType', 'actorEmail'], where, _count: { _all: true } });
    const groups = new Map<AuditActionGroup, number>();
    const actors = new Map<string, { events: number; sensitive: number }>();
    const entityTypes = new Map<string, { events: number; sensitive: number }>();
    const sensitiveActions = new Set<string>();
    let events = 0;
    let sensitive = 0;
    for (const c of counts) {
      const group = auditActionGroup(c.action);
      const n = c._count._all;
      const isSensitive = group !== 'ROUTINE';
      if (isSensitive) sensitiveActions.add(c.action);
      events += n;
      if (isSensitive) sensitive += n;
      groups.set(group, (groups.get(group) ?? 0) + n);
      const actorKey = c.actorEmail ?? 'System or signed-out user';
      const actor = actors.get(actorKey) ?? { events: 0, sensitive: 0 };
      actor.events += n;
      if (isSensitive) actor.sensitive += n;
      actors.set(actorKey, actor);
      const entity = entityTypes.get(c.entityType) ?? { events: 0, sensitive: 0 };
      entity.events += n;
      if (isSensitive) entity.sensitive += n;
      entityTypes.set(c.entityType, entity);
    }

    const [sensitiveRows, failures] = await Promise.all([
      sensitiveActions.size
        ? db.auditEvent.findMany({
            where: { ...where, action: { in: [...sensitiveActions] } },
            select: { id: true, createdAt: true, action: true, entityType: true, entityId: true, actorEmail: true, reason: true },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: SENSITIVE_EVENT_LIMIT,
          })
        : Promise.resolve([]),
      db.auditEvent.groupBy({ by: ['entityId'], where: { ...where, action: 'USER_LOGIN_FAILED' }, _count: { _all: true }, _max: { createdAt: true } }),
    ]);
    const repeated = failures.filter((f) => f._count._all >= REPEATED_FAILURE_THRESHOLD);
    const emails = new Map(
      (repeated.length ? await db.user.findMany({ where: { organizationId: input.organizationId, id: { in: repeated.map((f) => f.entityId) } }, select: { id: true, email: true } }) : []).map((u) => [u.id, u.email]),
    );

    const byCount = <T extends { events: number }>(a: T & { name: string }, b: T & { name: string }) => b.events - a.events || a.name.localeCompare(b.name);
    return {
      catalog: REPORT_CATALOG['audit-activity'],
      scope,
      totals: { events, sensitive },
      byGroup: AUDIT_GROUP_ORDER.map((group) => ({ group, label: AUDIT_ACTION_GROUP_LABELS[group], count: groups.get(group) ?? 0 })),
      byActor: [...actors.entries()].map(([name, a]) => ({ name, ...a })).sort(byCount).map(({ name, ...a }) => ({ actorEmail: name, ...a })),
      byEntityType: [...entityTypes.entries()].map(([name, e]) => ({ name, ...e })).sort(byCount).map(({ name, ...e }) => ({ entityType: name, ...e })),
      repeatedSignInFailures: repeated
        .map((f) => ({ userId: f.entityId, email: emails.get(f.entityId) ?? null, failures: f._count._all, lastAt: f._max.createdAt!.toISOString() }))
        .sort((a, b) => b.failures - a.failures || b.lastAt.localeCompare(a.lastAt)),
      sensitiveEvents: sensitiveRows.map((r) => ({ id: r.id, occurredAt: r.createdAt.toISOString(), action: r.action, group: auditActionGroup(r.action), entityType: r.entityType, entityId: r.entityId, actorEmail: r.actorEmail, reason: r.reason })),
      reconciliation: notComparable({ ...input, canSeeAllProjects: true }, 'The audit trail records who did what; it holds no accounting figures to compare with the ledger.'),
    };
  }

  /** Everything left open on the as-of date: ledger checks that differ, unmatched bank lines, TDS exceptions, approvals waiting, overdue billing and unallocated salary. */
  async exceptions(input: ReportReadInput): Promise<ExceptionsReport> {
    const companyInput: ReportReadInput = { ...input, canSeeAllProjects: true, filters: { ...input.filters, dateFrom: undefined, clientId: undefined, projectId: undefined } };
    const { scope } = await this.scopes.resolve(companyInput);
    const db = this.prisma.client;
    const asOf = scope.asOfDate;
    const legalEntity = scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {};

    const [aging, outstanding, payablesAging, employeeAdvances, holds, introducers, tdsInward, tdsOutward, tdsReconciliation, cashFlow, pending] = await Promise.all([
      this.receivables.aging(companyInput),
      this.receivables.outstandingSummary(companyInput),
      this.payables.payablesAging(companyInput),
      this.payables.employeeAdvances(companyInput),
      this.operations.paymentHolds(companyInput),
      this.operations.introducerStatement(companyInput),
      this.tds.inward(companyInput),
      this.tds.outward(companyInput),
      this.tds.reconciliation(companyInput),
      this.cashFlowReports.cashFlow(companyInput),
      this.receivables.pendingInvoices(companyInput),
    ]);
    const checked: Array<{ catalog: ReportCatalogEntry; reconciliation: LedgerReconciliation }> = [aging, outstanding, payablesAging, employeeAdvances, holds, introducers, tdsInward, tdsOutward, cashFlow];
    const ledgerChecks: LedgerCheckRow[] = checked.map((r) => ({
      reportKey: r.catalog.key,
      title: r.catalog.title,
      path: r.catalog.path,
      allReconciled: r.reconciliation.allReconciled,
      lines: r.reconciliation.lines.map((l) => ({ label: l.label, reportAmount: l.reportAmount, ledgerAmount: l.ledgerAmount, difference: l.difference, reconciled: l.reconciled })),
    }));

    const items: ExceptionItem[] = [];
    const add = (item: ExceptionItem) => items.push(item);

    // Bank: statement lines dated by the as-of date that nothing explains yet.
    const bankAccounts = await db.bankAccount.findMany({ where: { organizationId: input.organizationId, ...legalEntity }, select: { id: true } });
    const accountIds = bankAccounts.map((b) => b.id);
    const [lines, periods] = await Promise.all([
      accountIds.length
        ? db.bankStatementLine.findMany({
            where: { organizationId: input.organizationId, bankAccountId: { in: accountIds }, transactionDate: { lte: asDate(asOf) } },
            select: { bankAccountId: true, transactionDate: true, amount: true, exceptionMarkedAt: true, exceptionApprovedAt: true, matches: { where: { unmatchedAt: null }, select: { amount: true } } },
          })
        : Promise.resolve([]),
      accountIds.length ? db.bankReconciliationPeriod.findMany({ where: { bankAccountId: { in: accountIds }, status: { in: ['RECONCILED', 'LOCKED'] } }, select: { bankAccountId: true, periodStart: true } }) : Promise.resolve([]),
    ]);
    const open = lines.map((l) => ({ ...l, open: l.amount.minus(sum(l.matches.map((m) => m.amount))) })).filter((l) => !l.open.isZero());
    const unexplained = open.filter((l) => !l.exceptionMarkedAt);
    const awaitingApproval = open.filter((l) => l.exceptionMarkedAt && !l.exceptionApprovedAt);
    add({ area: 'BANK', key: 'UNMATCHED_STATEMENT_LINES', label: 'Statement lines not matched or explained', count: unexplained.length, amount: sum(unexplained.map((l) => l.open.abs())).toFixed(2), oldestDate: minDate(unexplained.map((l) => dateOf(l.transactionDate))), href: '/bank-reconciliation' });
    add({ area: 'BANK', key: 'EXCEPTIONS_AWAITING_APPROVAL', label: 'Bank exceptions awaiting approval', count: awaitingApproval.length, amount: sum(awaitingApproval.map((l) => l.open.abs())).toFixed(2), oldestDate: minDate(awaitingApproval.map((l) => dateOf(l.transactionDate))), href: '/bank-reconciliation' });
    const reconciledMonths = new Set(periods.map((p) => `${p.bankAccountId}|${dateOf(p.periodStart).slice(0, 7)}`));
    const monthsWithLines = new Set(
      lines
        .map((l) => `${l.bankAccountId}|${dateOf(l.transactionDate).slice(0, 7)}`)
        // Only months that have ended by the as-of date are due for reconciliation.
        .filter((key) => dateOf(new Date(Date.UTC(Number(key.slice(-7, -3)), Number(key.slice(-2)), 0))) <= asOf),
    );
    const unreconciled = [...monthsWithLines].filter((key) => !reconciledMonths.has(key));
    add({ area: 'BANK', key: 'MONTHS_NOT_RECONCILED', label: 'Ended months with statement lines not yet reconciled', count: unreconciled.length, amount: null, oldestDate: minDate(unreconciled.map((key) => `${key.slice(-7)}-01`)), href: '/bank-reconciliation' });

    // TDS: reconciliation exceptions and withheld tax past its deposit due date.
    add({ area: 'TDS', key: 'TDS_RECONCILIATION_EXCEPTIONS', label: 'TDS certificate and 26AS exceptions', count: tdsReconciliation.totals.exceptionCount, amount: null, oldestDate: null, href: '/reports/tds-reconciliation' });
    add({
      area: 'TDS', key: 'TDS_DEPOSITS_OVERDUE', label: 'Withheld tax past its deposit due date',
      count: tdsOutward.summary.reduce((n, s) => n + s.overdueCount, 0), amount: sum(tdsOutward.summary.map((s) => s.overdueAmount)).toFixed(2),
      oldestDate: minDate(tdsOutward.rows.filter((r) => r.overdue && r.remaining !== '0.00').map((r) => r.dueDate)), href: '/reports/tds-outward',
    });

    // Approvals waiting on a second person (docs/09 maker-checker), submitted by the as-of date.
    const submittedBy = { lt: dayAfter(asOf) };
    const [bills, requests, claims] = await Promise.all([
      db.vendorBill.findMany({
        where: { organizationId: input.organizationId, status: 'SUBMITTED', submittedAt: submittedBy, ...legalEntity },
        // The bill's total is fixed at approval; until then its lines carry the amounts as submitted.
        select: { submittedAt: true, lines: { select: { taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true } } },
      }),
      db.paymentRequest.findMany({ where: { organizationId: input.organizationId, status: 'SUBMITTED', submittedAt: submittedBy, ...legalEntity }, select: { totalRequestedAmount: true, submittedAt: true } }),
      db.employeeExpenseClaim.findMany({ where: { organizationId: input.organizationId, status: 'SUBMITTED', submittedAt: submittedBy, ...legalEntity }, select: { amount: true, submittedAt: true } }),
    ]);
    const oldestSubmitted = (rows: Array<{ submittedAt: Date | null }>) => minDate(rows.flatMap((r) => (r.submittedAt ? [dateOf(r.submittedAt)] : [])));
    add({ area: 'APPROVALS', key: 'VENDOR_BILLS_AWAITING_APPROVAL', label: 'Vendor bills awaiting approval', count: bills.length, amount: sum(bills.flatMap((b) => b.lines.flatMap((l) => [l.taxableAmount, l.cgstAmount, l.sgstAmount, l.igstAmount]))).toFixed(2), oldestDate: oldestSubmitted(bills), href: '/vendor-bills' });
    add({ area: 'APPROVALS', key: 'PAYMENT_REQUESTS_AWAITING_APPROVAL', label: 'Payment requests awaiting approval', count: requests.length, amount: sum(requests.map((r) => r.totalRequestedAmount ?? ZERO)).toFixed(2), oldestDate: oldestSubmitted(requests), href: '/payment-requests' });
    add({ area: 'APPROVALS', key: 'EXPENSE_CLAIMS_AWAITING_APPROVAL', label: 'Expense claims awaiting approval', count: claims.length, amount: sum(claims.map((c) => c.amount)).toFixed(2), oldestDate: oldestSubmitted(claims), href: '/employee-expenses' });

    // Billing: milestones past their due date with no finalized invoice.
    const overdueBilling = pending.billingPending.filter((b) => b.dueDate < asOf);
    add({ area: 'BILLING', key: 'BILLING_OVERDUE', label: 'Milestones past due and not invoiced', count: overdueBilling.length, amount: sum(overdueBilling.map((b) => b.amount)).toFixed(2), oldestDate: minDate(overdueBilling.map((b) => b.dueDate)), href: '/reports/pending-invoices' });

    // Allocations: posted salary whose month has no submitted allocation, so no project carries it.
    const salaryLines = await db.salaryImportLine.findMany({
      where: { organizationId: input.organizationId, salaryImport: { status: 'POSTED', salaryMonth: { lte: asDate(asOf) }, ...legalEntity } },
      select: { employeeId: true, grossSalaryAmount: true, salaryImport: { select: { salaryMonth: true } } },
    });
    const submitted = new Set(
      (await db.employeeMonthlyAllocation.findMany({ where: { organizationId: input.organizationId, status: 'SUBMITTED', allocationMonth: { lte: asDate(asOf) } }, select: { employeeId: true, allocationMonth: true } })).map(
        (a) => `${a.employeeId}|${dateOf(a.allocationMonth)}`,
      ),
    );
    const unallocated = salaryLines.filter((l) => !submitted.has(`${l.employeeId}|${dateOf(l.salaryImport.salaryMonth)}`));
    add({ area: 'ALLOCATIONS', key: 'SALARY_NOT_ALLOCATED', label: 'Salary months without a submitted allocation', count: unallocated.length, amount: sum(unallocated.map((l) => l.grossSalaryAmount)).toFixed(2), oldestDate: minDate(unallocated.map((l) => dateOf(l.salaryImport.salaryMonth))), href: '/employee-costing?tab=allocation' });

    return {
      catalog: REPORT_CATALOG.exceptions,
      scope: { ...scope, restricted: false },
      ledgerChecks,
      items,
      openCount: ledgerChecks.filter((c) => !c.allReconciled).length + items.filter((i) => i.count > 0).length,
      reconciliation: notComparable(companyInput, 'Each report\'s own ledger check is listed above; exceptions themselves are not accounting figures.'),
    };
  }
}
