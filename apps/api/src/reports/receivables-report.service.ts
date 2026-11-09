import { Injectable } from '@nestjs/common';
import { Prisma } from '@zitaware/database';
import { AGING_BUCKETS, throwAppError } from '@zitaware/contracts';
import type {
  AgingBucket,
  AgingBucketTotal,
  BillingPendingRow,
  HeldDeductionAgingRow,
  LedgerReconciliation,
  OutstandingDeductionRow,
  OutstandingDeductionType,
  OutstandingMeasure,
  OutstandingMeasureKey,
  OutstandingSummaryReport,
  PendingInvoiceReport,
  ReceivableAgingInvoiceRow,
  ReceivableAgingReport,
  ReportReadInput,
  ReportScope,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { agingBucket, daysBetween } from './aging.util';
import { LedgerControlService, type ReconciliationRequest } from './ledger-control.service';
import { REPORT_CATALOG } from './report-catalog';
import { loadSourceBilling, remainingOf } from '../invoices/source-billing';

const ZERO = new Prisma.Decimal(0);

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
function toDateStr(value: Date): string {
  return value.toISOString().slice(0, 10);
}
function sum(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((total, v) => total.plus(v), ZERO);
}

/** Receipt deductions that leave something still to recover, in display
 * order. ACCEPTED_PENALTY and OTHER settle the invoice for good and are not
 * receivables, so they never appear. */
const OUTSTANDING_TYPES: OutstandingDeductionType[] = ['TDS', 'CGST_TDS', 'SGST_TDS', 'IGST_TDS', 'HOLD', 'RETENTION', 'DISPUTED_PENALTY'];

const MEASURE_LABELS: Record<OutstandingMeasureKey, string> = {
  INVOICE_OUTSTANDING: 'Invoice outstanding',
  TDS: 'TDS pending reconciliation',
  CGST_TDS: 'CGST-TDS pending reconciliation',
  SGST_TDS: 'SGST-TDS pending reconciliation',
  IGST_TDS: 'IGST-TDS pending reconciliation',
  HOLD: 'Hold recoverable',
  RETENTION: 'Retention recoverable',
  DISPUTED_PENALTY: 'Disputed deductions',
};

/** The control account each measure reconciles to (docs/06 "Record client receipt with deductions"). */
const MEASURE_LEDGER_CODES: Record<OutstandingMeasureKey, string[]> = {
  INVOICE_OUTSTANDING: ['ACCOUNTS_RECEIVABLE'],
  TDS: ['TDS_RECEIVABLE'],
  CGST_TDS: ['GST_TDS_RECEIVABLE_CGST'],
  SGST_TDS: ['GST_TDS_RECEIVABLE_SGST'],
  IGST_TDS: ['GST_TDS_RECEIVABLE_IGST'],
  HOLD: ['HOLD_RECEIVABLE'],
  RETENTION: ['RETENTION_RECEIVABLE'],
  DISPUTED_PENALTY: ['DISPUTED_DEDUCTION_RECEIVABLE'],
};

function isOutstandingType(type: string): type is OutstandingDeductionType {
  return (OUTSTANDING_TYPES as string[]).includes(type);
}

interface DeductionPosition extends OutstandingDeductionRow {
  outstanding: Prisma.Decimal;
  penaltyCategoryId: string | null;
}

/** Everything receivable on the as-of date: the invoices, what had settled them and what notes had adjusted them. */
interface ReceivablePosition {
  scope: ReportScope;
  invoices: ReceivableAgingInvoiceRow[];
  invoiceTotal: Prisma.Decimal;
  deductions: DeductionPosition[];
  projects: Array<{ id: string; name: string; clientName: string | null }>;
}

function bucketTotals(entries: Array<{ bucket: AgingBucket; amount: string }>): AgingBucketTotal[] {
  return AGING_BUCKETS.map((bucket) => {
    const matching = entries.filter((e) => e.bucket === bucket);
    return { bucket, amount: sum(matching.map((e) => new Prisma.Decimal(e.amount))).toFixed(2), count: matching.length };
  });
}

function toRow(d: DeductionPosition): OutstandingDeductionRow {
  return {
    deductionId: d.deductionId,
    type: d.type,
    invoiceId: d.invoiceId,
    invoiceNumber: d.invoiceNumber,
    projectId: d.projectId,
    projectName: d.projectName,
    clientName: d.clientName,
    receiptId: d.receiptId,
    receiptDate: d.receiptDate,
    amount: d.amount,
    releasedAmount: d.releasedAmount,
    outstandingAmount: d.outstandingAmount,
    narrative: d.narrative,
  };
}

/**
 * Receivable Aging and Outstanding Summary (Phase 8.1, ADR-108).
 *
 * "As of" is read off the ledger's own dates, so the report and the ledger
 * can only agree: an invoice counts from its invoice date (its posting date),
 * a receipt from its receipt date, a note from its note date, a release from
 * its release date. A void or reversal counts from the accounting date of its
 * own journal, so one made after the as-of date had not happened yet.
 */
@Injectable()
export class ReceivablesReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly ledger: LedgerControlService,
  ) {}

  async aging(input: ReportReadInput): Promise<ReceivableAgingReport> {
    const position = await this.position(input);
    const held: HeldDeductionAgingRow[] = position.deductions
      .filter((d) => (d.type === 'HOLD' || d.type === 'RETENTION') && d.outstanding.greaterThan(0))
      .map((d) => {
        const daysHeld = daysBetween(d.receiptDate, input.filters.asOfDate);
        return {
          deductionId: d.deductionId,
          type: d.type as 'HOLD' | 'RETENTION',
          invoiceId: d.invoiceId,
          invoiceNumber: d.invoiceNumber,
          projectId: d.projectId,
          projectName: d.projectName,
          clientName: d.clientName,
          receiptId: d.receiptId,
          receiptDate: d.receiptDate,
          amount: d.amount,
          releasedAmount: d.releasedAmount,
          outstandingAmount: d.outstandingAmount,
          daysHeld,
          bucket: agingBucket(daysHeld),
        };
      });
    const heldOf = (type: 'HOLD' | 'RETENTION') => sum(held.filter((h) => h.type === type).map((h) => new Prisma.Decimal(h.outstandingAmount)));

    const reconciliation = await this.reconcile(input, position.scope, [
      { key: 'INVOICE_OUTSTANDING', label: MEASURE_LABELS.INVOICE_OUTSTANDING, ledgerCodes: MEASURE_LEDGER_CODES.INVOICE_OUTSTANDING, reportAmount: position.invoiceTotal },
      { key: 'HOLD', label: MEASURE_LABELS.HOLD, ledgerCodes: MEASURE_LEDGER_CODES.HOLD, reportAmount: heldOf('HOLD') },
      { key: 'RETENTION', label: MEASURE_LABELS.RETENTION, ledgerCodes: MEASURE_LEDGER_CODES.RETENTION, reportAmount: heldOf('RETENTION') },
    ]);

    return {
      catalog: REPORT_CATALOG['receivable-aging'],
      scope: position.scope,
      invoiceBuckets: bucketTotals(position.invoices.map((r) => ({ bucket: r.bucket, amount: r.outstandingAmount }))),
      invoiceTotal: position.invoiceTotal.toFixed(2),
      invoices: position.invoices,
      heldBuckets: bucketTotals(held.map((h) => ({ bucket: h.bucket, amount: h.outstandingAmount }))),
      heldTotal: sum(held.map((h) => new Prisma.Decimal(h.outstandingAmount))).toFixed(2),
      heldDeductions: held,
      reconciliation,
    };
  }

  async outstandingSummary(input: ReportReadInput): Promise<OutstandingSummaryReport> {
    const position = await this.position(input);
    const outstanding = position.deductions.filter((d) => d.outstanding.greaterThan(0));

    const measures: OutstandingMeasure[] = [
      { key: 'INVOICE_OUTSTANDING', label: MEASURE_LABELS.INVOICE_OUTSTANDING, amount: position.invoiceTotal.toFixed(2), itemCount: position.invoices.length },
      ...OUTSTANDING_TYPES.map((type) => {
        const items = outstanding.filter((d) => d.type === type);
        return { key: type, label: MEASURE_LABELS[type], amount: sum(items.map((i) => i.outstanding)).toFixed(2), itemCount: items.length };
      }),
    ];

    // A penalty category may send disputed amounts to its own account instead
    // of the default DISPUTED_DEDUCTION_RECEIVABLE, so those accounts join it.
    const categoryIds = [
      ...new Set(outstanding.flatMap((d) => (d.type === 'DISPUTED_PENALTY' && d.penaltyCategoryId ? [d.penaltyCategoryId] : []))),
    ];
    const categories = categoryIds.length
      ? await this.prisma.client.penaltyCategory.findMany({
          where: { id: { in: categoryIds }, organizationId: input.organizationId },
          select: { disputedLedgerAccountId: true },
        })
      : [];
    const disputedAccountIds = categories.flatMap((c) => (c.disputedLedgerAccountId ? [c.disputedLedgerAccountId] : []));

    const reconciliation = await this.reconcile(
      input,
      position.scope,
      measures.map((m) => ({
        key: m.key,
        label: m.label,
        ledgerCodes: MEASURE_LEDGER_CODES[m.key],
        ledgerAccountIds: m.key === 'DISPUTED_PENALTY' ? disputedAccountIds : undefined,
        reportAmount: new Prisma.Decimal(m.amount),
      })),
    );

    return {
      catalog: REPORT_CATALOG['outstanding-summary'],
      scope: position.scope,
      measures,
      deductions: outstanding.map(toRow),
      reconciliation,
    };
  }

  /**
   * Pending Invoice (Phase 8.8b, ADR-118): finalized invoice outstanding only,
   * as the aging computes it, with billing not yet invoiced — open or snoozed
   * payment alerts and their draft invoices — kept as a separate measure.
   */
  async pendingInvoices(input: ReportReadInput): Promise<PendingInvoiceReport> {
    const position = await this.position(input);
    const invoices = position.invoices.map((r) => ({ ...r, settlementState: new Prisma.Decimal(r.settledAmount).isZero() ? ('UNSETTLED' as const) : ('PARTIALLY_SETTLED' as const) }));
    const projectById = new Map(position.projects.map((p) => [p.id, p]));

    const alerts = projectById.size
      ? await this.prisma.client.paymentAlert.findMany({
          where: {
            organizationId: input.organizationId,
            status: { in: ['OPEN', 'SNOOZED'] },
            projectId: { in: [...projectById.keys()] },
            ...(input.filters.legalEntityId ? { project: { legalEntityId: input.filters.legalEntityId } } : {}),
          },
          select: {
            id: true, projectId: true, sourceType: true, status: true, snoozedUntil: true, sourceEventId: true, sourceInstallmentId: true,
            sourceEvent: { select: { name: true, amount: true, dueDate: true } },
            sourceInstallment: { select: { sequenceNumber: true, servicePeriodStart: true, servicePeriodEnd: true, plannedInvoiceDate: true, scheduledAmount: true } },
            originatedInvoices: { where: { status: 'DRAFT' }, select: { id: true } },
          },
        })
      : [];
    // An event or installment billed in part shows only what is left (ADR-156).
    const billed = await loadSourceBilling(this.prisma.client, input.organizationId, alerts.map((a) => (a.sourceEventId ?? a.sourceInstallmentId)!));
    const billingPending: BillingPendingRow[] = alerts.flatMap((a) => {
      const project = projectById.get(a.projectId)!;
      const event = a.sourceEvent;
      const installment = a.sourceInstallment;
      if (!event && !installment) return [];
      return [
        {
          alertId: a.id,
          projectId: a.projectId,
          projectName: project.name,
          clientName: project.clientName,
          sourceType: a.sourceType,
          sourceLabel: event ? event.name : `Installment ${installment!.sequenceNumber} (${toDateStr(installment!.servicePeriodStart)} – ${toDateStr(installment!.servicePeriodEnd)})`,
          amount: remainingOf(event ? event.amount : installment!.scheduledAmount, billed.get((a.sourceEventId ?? a.sourceInstallmentId)!)).toFixed(2),
          dueDate: toDateStr(event ? event.dueDate : installment!.plannedInvoiceDate),
          alertStatus: a.status as 'OPEN' | 'SNOOZED',
          snoozedUntil: a.snoozedUntil ? toDateStr(a.snoozedUntil) : null,
          draftInvoiceId: a.originatedInvoices[0]?.id ?? null,
        },
      ];
    });
    billingPending.sort((x, y) => x.dueDate.localeCompare(y.dueDate) || x.projectName.localeCompare(y.projectName));

    const reconciliation = await this.reconcile(input, position.scope, [
      { key: 'INVOICE_OUTSTANDING', label: MEASURE_LABELS.INVOICE_OUTSTANDING, ledgerCodes: MEASURE_LEDGER_CODES.INVOICE_OUTSTANDING, reportAmount: position.invoiceTotal },
    ]);

    return {
      catalog: REPORT_CATALOG['pending-invoices'],
      scope: position.scope,
      invoices,
      buckets: bucketTotals(invoices.map((r) => ({ bucket: r.bucket, amount: r.outstandingAmount }))),
      invoiceTotal: position.invoiceTotal.toFixed(2),
      overdueTotal: sum(invoices.filter((r) => r.daysPastDue > 0).map((r) => new Prisma.Decimal(r.outstandingAmount))).toFixed(2),
      billingPending,
      billingPendingTotal: sum(billingPending.map((b) => new Prisma.Decimal(b.amount))).toFixed(2),
      draftInvoiceCount: billingPending.filter((b) => b.draftInvoiceId).length,
      reconciliation,
    };
  }

  private async reconcile(input: ReportReadInput, scope: ReportScope, requests: ReconciliationRequest[]): Promise<LedgerReconciliation> {
    if (scope.restricted) {
      return {
        applicable: false,
        notApplicableReason: input.canSeeAllProjects
          ? 'Filtered to one client or project. The ledger is not split that way, so totals are compared with it only on the unfiltered view.'
          : 'You can see only the projects assigned to you. The ledger is not split by project, so these totals cannot be compared with it.',
        lines: [],
        allReconciled: false,
      };
    }
    const lines = await this.ledger.reconcile({
      organizationId: input.organizationId,
      legalEntityId: scope.legalEntityId,
      asOfDate: scope.asOfDate,
      requests,
    });
    return { applicable: true, notApplicableReason: null, lines, allReconciled: lines.every((l) => l.reconciled) };
  }

  private async position(input: ReportReadInput): Promise<ReceivablePosition> {
    const { organizationId, filters } = input;
    const db = this.prisma.client;
    const asOf = toDate(filters.asOfDate);

    // Same project scope as every other screen (ProjectsService.list).
    const visible = await this.projects.list({ organizationId, actorId: input.actorId, canSeeAll: input.canSeeAllProjects });
    if (filters.projectId && !visible.some((p) => p.id === filters.projectId)) throwAppError('NOT_FOUND', 'Project not found.');
    const projects = visible.filter(
      (p) => (!filters.clientId || p.clientId === filters.clientId) && (!filters.projectId || p.id === filters.projectId),
    );
    const projectById = new Map(projects.map((p) => [p.id, p]));

    const [legalEntity, client, clientParties] = await Promise.all([
      filters.legalEntityId ? db.legalEntity.findFirst({ where: { id: filters.legalEntityId, organizationId }, select: { legalName: true } }) : null,
      filters.clientId ? db.party.findFirst({ where: { id: filters.clientId, organizationId }, select: { name: true } }) : null,
      db.party.findMany({ where: { organizationId, id: { in: [...new Set(projects.map((p) => p.clientId))] } }, select: { id: true, name: true } }),
    ]);
    if (filters.legalEntityId && !legalEntity) throwAppError('NOT_FOUND', 'Legal entity not found.');
    if (filters.clientId && !client) throwAppError('NOT_FOUND', 'Client not found.');
    const clientNameById = new Map(clientParties.map((c) => [c.id, c.name]));

    const scope: ReportScope = {
      dateFrom: null,
      asOfDate: filters.asOfDate,
      legalEntityId: filters.legalEntityId ?? null,
      legalEntityName: legalEntity?.legalName ?? null,
      clientId: filters.clientId ?? null,
      clientName: client?.name ?? null,
      projectId: filters.projectId ?? null,
      projectName: filters.projectId ? (projectById.get(filters.projectId)?.name ?? null) : null,
      currency: 'INR',
      restricted: !input.canSeeAllProjects || Boolean(filters.clientId) || Boolean(filters.projectId),
    };
    if (projectById.size === 0) return { scope, invoices: [], invoiceTotal: ZERO, deductions: [], projects: [] };

    const invoices = await db.invoice.findMany({
      where: {
        organizationId,
        projectId: { in: [...projectById.keys()] },
        status: { in: ['FINALIZED', 'VOID'] },
        invoiceDate: { lte: asOf },
        ...(filters.legalEntityId ? { legalEntityId: filters.legalEntityId } : {}),
      },
      select: { id: true, invoiceNumber: true, projectId: true, invoiceDate: true, dueDate: true, totalAmount: true, status: true, voidJournalEntryId: true },
      orderBy: [{ invoiceDate: 'asc' }, { invoiceNumber: 'asc' }],
    });
    const invoiceIds = invoices.map((i) => i.id);

    const [allocations, notes] = await Promise.all([
      db.receiptAllocation.findMany({
        where: { organizationId, invoiceId: { in: invoiceIds } },
        select: {
          invoiceId: true,
          settledAmount: true,
          receipt: { select: { id: true, receiptDate: true, status: true, reversalJournalEntryId: true } },
          deductions: {
            select: { id: true, type: true, amount: true, narrative: true, penaltyCategoryId: true, releases: { select: { releasedAmount: true, releasedOn: true } } },
          },
        },
      }),
      db.creditDebitNote.findMany({
        where: { organizationId, invoiceId: { in: invoiceIds }, status: { in: ['FINALIZED', 'VOID'] }, noteDate: { lte: asOf } },
        select: { invoiceId: true, type: true, totalAmount: true, status: true, voidJournalEntryId: true },
      }),
    ]);

    // A void or reversal undoes a document only from its own journal's date.
    const undoIds = [
      ...invoices.map((i) => i.voidJournalEntryId),
      ...notes.map((n) => n.voidJournalEntryId),
      ...allocations.map((a) => a.receipt.reversalJournalEntryId),
    ].filter((id): id is string => Boolean(id));
    const undoDates = new Map(
      (undoIds.length ? await db.journalEntry.findMany({ where: { organizationId, id: { in: undoIds } }, select: { id: true, accountingDate: true } }) : []).map(
        (j) => [j.id, j.accountingDate],
      ),
    );
    const undoneByAsOf = (journalId: string | null): boolean => {
      if (!journalId) return true;
      const undoneOn = undoDates.get(journalId);
      return !undoneOn || undoneOn <= asOf;
    };

    const liveInvoices = invoices.filter((i) => i.status === 'FINALIZED' || !undoneByAsOf(i.voidJournalEntryId));
    const effectiveAllocations = allocations.filter(
      (a) => a.receipt.receiptDate <= asOf && (a.receipt.status !== 'REVERSED' || !undoneByAsOf(a.receipt.reversalJournalEntryId)),
    );
    const liveNotes = notes.filter((n) => n.status === 'FINALIZED' || !undoneByAsOf(n.voidJournalEntryId));

    const settledByInvoice = new Map<string, Prisma.Decimal>();
    for (const a of effectiveAllocations) settledByInvoice.set(a.invoiceId, (settledByInvoice.get(a.invoiceId) ?? ZERO).plus(a.settledAmount));
    const notesByInvoice = new Map<string, Prisma.Decimal>();
    for (const n of liveNotes) {
      const signed = n.type === 'DEBIT' ? (n.totalAmount ?? ZERO) : (n.totalAmount ?? ZERO).negated();
      notesByInvoice.set(n.invoiceId, (notesByInvoice.get(n.invoiceId) ?? ZERO).plus(signed));
    }

    const rows: ReceivableAgingInvoiceRow[] = [];
    let invoiceTotal = ZERO;
    const invoiceById = new Map(liveInvoices.map((i) => [i.id, i]));
    for (const invoice of liveInvoices) {
      const total = invoice.totalAmount ?? ZERO;
      const settled = settledByInvoice.get(invoice.id) ?? ZERO;
      const noteAdjustment = notesByInvoice.get(invoice.id) ?? ZERO;
      const outstanding = total.minus(settled).plus(noteAdjustment);
      if (outstanding.isZero()) continue;
      const project = projectById.get(invoice.projectId)!;
      const invoiceDate = toDateStr(invoice.invoiceDate!);
      const dueDate = invoice.dueDate ? toDateStr(invoice.dueDate) : invoiceDate;
      const daysPastDue = daysBetween(dueDate, filters.asOfDate);
      rows.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber ?? '',
        projectId: invoice.projectId,
        projectName: project.name,
        clientId: project.clientId,
        clientName: clientNameById.get(project.clientId) ?? '',
        invoiceDate,
        dueDate,
        totalAmount: total.toFixed(2),
        settledAmount: settled.toFixed(2),
        noteAdjustmentAmount: noteAdjustment.toFixed(2),
        outstandingAmount: outstanding.toFixed(2),
        daysPastDue,
        bucket: agingBucket(daysPastDue),
      });
      invoiceTotal = invoiceTotal.plus(outstanding);
    }

    const deductions: DeductionPosition[] = [];
    for (const allocation of effectiveAllocations) {
      const invoice = invoiceById.get(allocation.invoiceId);
      if (!invoice) continue;
      const project = projectById.get(invoice.projectId)!;
      for (const d of allocation.deductions) {
        if (!isOutstandingType(d.type)) continue;
        const released = sum(d.releases.filter((r) => r.releasedOn <= asOf).map((r) => r.releasedAmount));
        const outstanding = d.amount.minus(released);
        deductions.push({
          deductionId: d.id,
          type: d.type,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber ?? '',
          projectId: invoice.projectId,
          projectName: project.name,
          clientName: clientNameById.get(project.clientId) ?? '',
          receiptId: allocation.receipt.id,
          receiptDate: toDateStr(allocation.receipt.receiptDate),
          amount: d.amount.toFixed(2),
          releasedAmount: released.toFixed(2),
          outstandingAmount: outstanding.toFixed(2),
          narrative: d.narrative,
          outstanding,
          penaltyCategoryId: d.penaltyCategoryId,
        });
      }
    }

    return { scope, invoices: rows, invoiceTotal, deductions, projects: projects.map((p) => ({ id: p.id, name: p.name, clientName: clientNameById.get(p.clientId) ?? null })) };
  }
}
