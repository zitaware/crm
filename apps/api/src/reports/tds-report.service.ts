import { Injectable } from '@nestjs/common';
import { Prisma } from '@zitaware/database';
import { TAX_DEDUCTION_TYPES, TDS_DEDUCTION_LIFECYCLES } from '@zitaware/contracts';
import type {
  ReportReadInput,
  ReportScope,
  TaxDeductionType,
  TdsDeductionLifecycle,
  TdsInwardReport,
  TdsOutwardReport,
  TdsOutwardTypeSummary,
  TdsInwardRow,
  TdsInwardTypeSummary,
  TdsReconciliationReport,
  TdsReconciliationTypeSummary,
  TdsReversedReceiptMatchRow,
  TdsUnmatchedCreditRow,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { deductionLifecycle, deductionPeriodEnd } from '../tds/tds-lifecycle.util';
import { TdsDepositsService } from '../tds/tds-deposits.service';
import { LedgerControlService } from './ledger-control.service';
import { REPORT_CATALOG } from './report-catalog';
import { ReportScopeService } from './report-scope.service';

const ZERO = new Prisma.Decimal(0);
const RECEIVABLE_CODES: Record<TaxDeductionType, string> = {
  TDS: 'TDS_RECEIVABLE',
  CGST_TDS: 'GST_TDS_RECEIVABLE_CGST',
  SGST_TDS: 'GST_TDS_RECEIVABLE_SGST',
  IGST_TDS: 'GST_TDS_RECEIVABLE_IGST',
};
const PAYABLE_CODES: Record<TaxDeductionType, string> = {
  TDS: 'TDS_PAYABLE',
  CGST_TDS: 'GST_TDS_PAYABLE_CGST',
  SGST_TDS: 'GST_TDS_PAYABLE_SGST',
  IGST_TDS: 'GST_TDS_PAYABLE_IGST',
};
const TYPE_LABELS: Record<TaxDeductionType, string> = { TDS: 'TDS', CGST_TDS: 'CGST-TDS', SGST_TDS: 'SGST-TDS', IGST_TDS: 'IGST-TDS' };

const dateOf = (d: Date) => d.toISOString().slice(0, 10);
/** A timestamped event (a match, a cancellation) counts on the as-of date when it happened before the next day began (UTC). */
const endOfDay = (date: string) => new Date(new Date(`${date}T00:00:00.000Z`).getTime() + 86_400_000);

interface InwardData {
  scope: ReportScope;
  rows: TdsInwardRow[];
  /** Matches standing on the as-of date against deductions of receipts reversed by then. */
  reversedMatches: TdsReversedReceiptMatchRow[];
  clientIds: Set<string> | null;
}

/**
 * TDS Inward and the TDS certificate/26AS reconciliation (Phase 8.5a, ADR-112).
 * Deductions come from receipts as the receivables reports read them (receipt
 * date, reversals from their own journal's date); their lifecycle comes from
 * the certificate matches standing on the as-of date.
 */
@Injectable()
export class TdsReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ReportScopeService,
    private readonly ledger: LedgerControlService,
    private readonly deposits: TdsDepositsService,
  ) {}

  /**
   * Tax withheld from payments, deposited and still payable, as of a date
   * (Phase 8.5b, ADR-113). Payable per type = withheld − deposits standing,
   * reconciled to the payable accounts. Deposits count at their full amount,
   * so a deposit whose payment was later reversed still reconciles.
   */
  async outward(input: ReportReadInput): Promise<TdsOutwardReport> {
    const { scope, projects } = await this.scopes.resolve({ ...input, filters: { ...input.filters, dateFrom: undefined } });
    const [rows, depositTotals] = await Promise.all([
      this.deposits.outwardItems({
        organizationId: input.organizationId,
        legalEntityId: scope.legalEntityId,
        deductionType: undefined,
        asOfDate: scope.asOfDate,
        projectIds: scope.clientId || scope.projectId ? projects.map((p) => p.id) : null,
      }),
      this.deposits.depositTotals({ organizationId: input.organizationId, legalEntityId: scope.legalEntityId, asOfDate: scope.asOfDate }),
    ]);
    const filtered = Boolean(scope.clientId || scope.projectId);

    const summary: TdsOutwardTypeSummary[] = TAX_DEDUCTION_TYPES.map((type) => {
      const ofType = rows.filter((r) => r.deductionType === type);
      const deducted = ofType.reduce((s, r) => s.plus(r.amount), ZERO);
      const deposited = filtered ? ofType.reduce((s, r) => s.plus(r.deposited), ZERO) : (depositTotals.get(type) ?? ZERO);
      const overdue = ofType.filter((r) => r.overdue);
      return {
        deductionType: type,
        count: ofType.length,
        deducted: deducted.toFixed(2),
        deposited: deposited.toFixed(2),
        payable: deducted.minus(deposited).toFixed(2),
        overdueCount: overdue.length,
        overdueAmount: overdue.reduce((s, r) => s.plus(r.remaining), ZERO).toFixed(2),
      };
    });

    let reconciliation: TdsOutwardReport['reconciliation'];
    if (filtered || !input.canSeeAllProjects) {
      reconciliation = {
        applicable: false,
        notApplicableReason: filtered
          ? 'Filtered to one client or project. The payable accounts also hold tax withheld from introducer and salary payments, so they are compared only on the unfiltered view.'
          : 'You can see only the projects assigned to you, so these totals cannot be compared with the whole ledger.',
        lines: [],
        allReconciled: false,
      };
    } else {
      const movement = await this.ledger.periodMovementByCode({
        organizationId: input.organizationId,
        legalEntityId: scope.legalEntityId,
        dateFrom: null,
        dateTo: scope.asOfDate,
        codes: TAX_DEDUCTION_TYPES.map((t) => PAYABLE_CODES[t]),
      });
      const lines = summary.map((s) => {
        const m = movement.get(PAYABLE_CODES[s.deductionType]);
        const ledgerAmount = m ? m.debitMinusCredit.negated() : ZERO; // a payable is credit-normal
        const difference = new Prisma.Decimal(s.payable).minus(ledgerAmount);
        return {
          key: s.deductionType,
          label: `${TYPE_LABELS[s.deductionType]} withheld, not yet deposited`,
          ledgerAccounts: m ? [m.account] : [],
          reportAmount: s.payable,
          ledgerAmount: ledgerAmount.toFixed(2),
          difference: difference.toFixed(2),
          reconciled: difference.isZero(),
        };
      });
      reconciliation = { applicable: true, notApplicableReason: null, lines, allReconciled: lines.every((l) => l.reconciled) };
    }

    return { catalog: REPORT_CATALOG['tds-outward'], scope: { ...scope, restricted: filtered || !input.canSeeAllProjects }, rows, summary, reconciliation };
  }


  async inward(input: ReportReadInput): Promise<TdsInwardReport> {
    const pointInTime: ReportReadInput = { ...input, filters: { ...input.filters, dateFrom: undefined } };
    const data = await this.inwardData(pointInTime);
    const summary = this.summarise(data.rows);

    const reconciliation = data.scope.restricted
      ? {
          applicable: false,
          notApplicableReason: input.canSeeAllProjects
            ? 'Filtered to one client or project. The receivable accounts hold every client\'s deductions, so they are compared only on the unfiltered view.'
            : 'You can see only the projects assigned to you, so these totals cannot be compared with the whole ledger.',
          lines: [],
          allReconciled: false,
        }
      : await (async () => {
          const lines = await this.ledger.reconcile({
            organizationId: input.organizationId,
            legalEntityId: data.scope.legalEntityId,
            asOfDate: data.scope.asOfDate,
            requests: summary.map((s) => ({ key: s.deductionType, label: `${TYPE_LABELS[s.deductionType]} deducted by clients`, ledgerCodes: [RECEIVABLE_CODES[s.deductionType]], reportAmount: new Prisma.Decimal(s.amount) })),
          });
          return { applicable: true, notApplicableReason: null, lines, allReconciled: lines.every((l) => l.reconciled) };
        })();

    return { catalog: REPORT_CATALOG['tds-inward'], scope: data.scope, rows: data.rows, summary, reconciliation };
  }

  async reconciliation(input: ReportReadInput): Promise<TdsReconciliationReport> {
    const pointInTime: ReportReadInput = { ...input, filters: { ...input.filters, dateFrom: undefined } };
    const data = await this.inwardData(pointInTime);
    const { scope } = data;
    const cutoff = endOfDay(scope.asOfDate);

    const certificates = await this.prisma.client.tdsCertificate.findMany({
      where: {
        organizationId: input.organizationId,
        createdAt: { lt: cutoff },
        OR: [{ cancelledAt: null }, { cancelledAt: { gte: cutoff } }],
        ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}),
        ...(data.clientIds ? { partyId: { in: [...data.clientIds] } } : {}),
      },
      select: {
        id: true, source: true, deductionType: true, referenceNumber: true, partyId: true, periodStart: true, periodEnd: true, creditDate: true, amount: true,
        party: { select: { name: true } },
        matches: { where: { createdAt: { lt: cutoff }, OR: [{ unmatchedAt: null }, { unmatchedAt: { gte: cutoff } }] }, select: { amount: true } },
      },
      orderBy: [{ creditDate: 'asc' }, { referenceNumber: 'asc' }],
    });

    const unmatchedCredits: TdsUnmatchedCreditRow[] = [];
    const credits = new Map<TaxDeductionType, { CERTIFICATE: Prisma.Decimal; STATEMENT: Prisma.Decimal }>(TAX_DEDUCTION_TYPES.map((t) => [t, { CERTIFICATE: ZERO, STATEMENT: ZERO }]));
    for (const c of certificates) {
      const type = c.deductionType;
      const entry = credits.get(type)!;
      entry[c.source] = entry[c.source].plus(c.amount);
      const matched = c.matches.reduce((s, m) => s.plus(m.amount), ZERO);
      const unmatched = c.amount.minus(matched);
      if (unmatched.greaterThan(0)) {
        unmatchedCredits.push({
          certificateId: c.id, source: c.source, deductionType: type, referenceNumber: c.referenceNumber, partyId: c.partyId, partyName: c.party.name,
          periodStart: dateOf(c.periodStart), periodEnd: dateOf(c.periodEnd), creditDate: dateOf(c.creditDate),
          amount: c.amount.toFixed(2), matchedAmount: matched.toFixed(2), unmatchedAmount: unmatched.toFixed(2),
        });
      }
    }

    const summary: TdsReconciliationTypeSummary[] = TAX_DEDUCTION_TYPES.map((type) => {
      const deducted = data.rows.filter((r) => r.deductionType === type).reduce((s, r) => s.plus(r.amount), ZERO);
      const c = credits.get(type)!;
      return {
        deductionType: type,
        deducted: deducted.toFixed(2),
        certificateCredits: c.CERTIFICATE.toFixed(2),
        statementCredits: c.STATEMENT.toFixed(2),
        statementDifference: deducted.minus(c.STATEMENT).toFixed(2),
      };
    });

    const pendingCertificates = data.rows.filter((r) => r.lifecycle === 'CERTIFICATE_PENDING');
    const partialMatches = data.rows.filter((r) => r.partiallyMatched);
    return {
      catalog: REPORT_CATALOG['tds-reconciliation'],
      scope,
      summary,
      pendingCertificates,
      partialMatches,
      unmatchedCredits,
      reversedReceiptMatches: data.reversedMatches,
      totals: {
        pendingAmount: pendingCertificates.reduce((s, r) => s.plus(r.amount).minus(Prisma.Decimal.max(new Prisma.Decimal(r.certificateMatched), new Prisma.Decimal(r.statementMatched))), ZERO).toFixed(2),
        unmatchedCreditAmount: unmatchedCredits.reduce((s, c) => s.plus(c.unmatchedAmount), ZERO).toFixed(2),
        exceptionCount: pendingCertificates.length + partialMatches.filter((r) => r.lifecycle !== 'CERTIFICATE_PENDING').length + unmatchedCredits.length + data.reversedMatches.length,
      },
      reconciliation: {
        applicable: false,
        notApplicableReason: 'Matching certificates to deductions has no accounting effect, so there is no ledger balance to compare. The deductions themselves are reconciled to the TDS receivable accounts on the TDS Inward report.',
        lines: [],
        allReconciled: false,
      },
    };
  }

  private summarise(rows: TdsInwardRow[]): TdsInwardTypeSummary[] {
    return TAX_DEDUCTION_TYPES.map((type) => {
      const ofType = rows.filter((r) => r.deductionType === type);
      const sum = (pick: (r: TdsInwardRow) => string, list = ofType) => list.reduce((s, r) => s.plus(pick(r)), ZERO).toFixed(2);
      return {
        deductionType: type,
        count: ofType.length,
        amount: sum((r) => r.amount),
        certificateMatched: sum((r) => r.certificateMatched),
        statementMatched: sum((r) => r.statementMatched),
        byLifecycle: Object.fromEntries(
          TDS_DEDUCTION_LIFECYCLES.map((l) => {
            const inState = ofType.filter((r) => r.lifecycle === l);
            return [l, { count: inState.length, amount: sum((r) => r.amount, inState) }];
          }),
        ) as Record<TdsDeductionLifecycle, { count: number; amount: string }>,
      };
    });
  }

  private async inwardData(input: ReportReadInput): Promise<InwardData> {
    const { scope, projects } = await this.scopes.resolve(input);
    const asOf = new Date(`${scope.asOfDate}T00:00:00.000Z`);
    const cutoff = endOfDay(scope.asOfDate);
    const standing = { createdAt: { lt: cutoff }, OR: [{ unmatchedAt: null }, { unmatchedAt: { gte: cutoff } }] };

    const deductions = await this.prisma.client.allocationDeduction.findMany({
      where: {
        organizationId: input.organizationId,
        type: { in: [...TAX_DEDUCTION_TYPES] },
        allocation: {
          receipt: { receiptDate: { lte: asOf }, ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}) },
          ...(scope.restricted ? { invoice: { projectId: { in: projects.map((p) => p.id) } } } : {}),
        },
      },
      select: {
        id: true,
        type: true,
        amount: true,
        allocation: {
          select: {
            invoice: { select: { id: true, invoiceNumber: true, project: { select: { id: true, name: true, clientId: true, client: { select: { name: true } } } } } },
            receipt: { select: { id: true, receiptDate: true, reversalJournalEntry: { select: { accountingDate: true } } } },
          },
        },
        tdsCertificateMatches: { where: standing, select: { id: true, amount: true, certificate: { select: { id: true, source: true, referenceNumber: true } } } },
      },
    });

    const rows: TdsInwardRow[] = [];
    const reversedMatches: TdsReversedReceiptMatchRow[] = [];
    for (const d of deductions) {
      const type = d.type as TaxDeductionType;
      const { receipt, invoice } = d.allocation;
      const reversed = receipt.reversalJournalEntry && receipt.reversalJournalEntry.accountingDate <= asOf;
      if (reversed) {
        for (const m of d.tdsCertificateMatches) {
          reversedMatches.push({ matchId: m.id, certificateId: m.certificate.id, referenceNumber: m.certificate.referenceNumber, deductionId: d.id, deductionType: type, receiptId: receipt.id, projectId: invoice.project.id, amount: m.amount.toFixed(2) });
        }
        continue;
      }
      const bySource = { CERTIFICATE: ZERO, STATEMENT: ZERO };
      const refs = { CERTIFICATE: new Set<string>(), STATEMENT: new Set<string>() };
      for (const m of d.tdsCertificateMatches) {
        bySource[m.certificate.source] = bySource[m.certificate.source].plus(m.amount);
        refs[m.certificate.source].add(m.certificate.referenceNumber);
      }
      const receiptDate = dateOf(receipt.receiptDate);
      const periodEnd = deductionPeriodEnd(type, receiptDate);
      const { lifecycle, partiallyMatched } = deductionLifecycle({ amount: d.amount, certificateMatched: bySource.CERTIFICATE, statementMatched: bySource.STATEMENT, periodEnd, asOfDate: scope.asOfDate });
      rows.push({
        deductionId: d.id,
        deductionType: type,
        receiptId: receipt.id,
        receiptDate,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        projectId: invoice.project.id,
        projectName: invoice.project.name,
        clientId: invoice.project.clientId,
        clientName: invoice.project.client.name,
        amount: d.amount.toFixed(2),
        certificateMatched: bySource.CERTIFICATE.toFixed(2),
        statementMatched: bySource.STATEMENT.toFixed(2),
        certificateReferences: [...refs.CERTIFICATE].sort(),
        statementReferences: [...refs.STATEMENT].sort(),
        periodEnd,
        lifecycle,
        partiallyMatched,
      });
    }
    rows.sort((a, b) => a.receiptDate.localeCompare(b.receiptDate) || (a.invoiceNumber ?? '').localeCompare(b.invoiceNumber ?? '') || TAX_DEDUCTION_TYPES.indexOf(a.deductionType) - TAX_DEDUCTION_TYPES.indexOf(b.deductionType));

    // A certificate belongs to a client, not a project: a restricted view shows its clients' certificates.
    return { scope, rows, reversedMatches, clientIds: scope.restricted ? new Set(projects.map((p) => p.clientId)) : null };
  }
}
