import { Injectable } from '@nestjs/common';
import { Prisma } from '@zitaware/database';
import { GST_REGISTER_DOCUMENT_TYPES } from '@zitaware/contracts';
import type {
  GstAdjustmentRow,
  GstInputPeriodRow,
  GstInputReport,
  GstInputRow,
  GstInputTax,
  GstNetComponent,
  GstNetLine,
  GstNetReport,
  GstOutputReport,
  GstOutputRow,
  GstPendingInputRow,
  GstPeriodSummaryRow,
  GstRegisterLine,
  GstRegisterReport,
  GstRegisterTypeTotal,
  GstTaxTotals,
  LedgerReconciliation,
  LedgerReconciliationLine,
  ReportReadInput,
  ReportScope,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerControlService } from './ledger-control.service';
import { REPORT_CATALOG } from './report-catalog';
import { ReportScopeService } from './report-scope.service';

const ZERO = new Prisma.Decimal(0);
const REVERSAL_SOURCE_TYPE = 'journal_entry_reversal';

const OUTPUT_CODES = { CGST: 'OUTPUT_CGST_PAYABLE', SGST: 'OUTPUT_SGST_PAYABLE', IGST: 'OUTPUT_IGST_PAYABLE' } as const;
const INPUT_CODES = { CGST: 'INPUT_CGST_RECEIVABLE', SGST: 'INPUT_SGST_RECEIVABLE', IGST: 'INPUT_IGST_RECEIVABLE', NOT_SPLIT: 'INPUT_GST_RECEIVABLE_EXPENSE' } as const;
const COMPONENT_BY_CODE: Record<string, GstNetComponent> = {
  OUTPUT_CGST_PAYABLE: 'CGST',
  OUTPUT_SGST_PAYABLE: 'SGST',
  OUTPUT_IGST_PAYABLE: 'IGST',
  INPUT_CGST_RECEIVABLE: 'CGST',
  INPUT_SGST_RECEIVABLE: 'SGST',
  INPUT_IGST_RECEIVABLE: 'IGST',
  INPUT_GST_RECEIVABLE_EXPENSE: 'NOT_SPLIT',
};
const COMPONENTS: GstNetComponent[] = ['CGST', 'SGST', 'IGST', 'NOT_SPLIT'];
const COMPONENT_LABELS: Record<GstNetComponent, string> = {
  CGST: 'CGST',
  SGST: 'SGST',
  IGST: 'IGST',
  NOT_SPLIT: 'Expense-claim GST credit (not split)',
};
/** The events whose GST the Output and Input reports read from the documents themselves; any other GST posting is an adjustment. */
const DOCUMENT_SOURCE_TYPES = new Set([
  'invoice_finalize',
  'credit_note_issue',
  'debit_note_issue',
  'vendor_bill_approve',
  'direct_expense.post',
  'employee_expense_claim.approve',
]);

type Tax = { taxable: Prisma.Decimal; cgst: Prisma.Decimal; sgst: Prisma.Decimal; igst: Prisma.Decimal };
type InputTax = { cgst: Prisma.Decimal; sgst: Prisma.Decimal; igst: Prisma.Decimal; notSplit: Prisma.Decimal };

const dateOf = (d: Date) => d.toISOString().slice(0, 10);
const taxPeriodOf = (date: string) => date.slice(0, 7);
const d = (v: Prisma.Decimal | null | undefined) => v ?? ZERO;
const zeroTax = (): Tax => ({ taxable: ZERO, cgst: ZERO, sgst: ZERO, igst: ZERO });
const zeroInput = (): InputTax => ({ cgst: ZERO, sgst: ZERO, igst: ZERO, notSplit: ZERO });

function taxTotals(t: Tax): GstTaxTotals {
  return {
    taxable: t.taxable.toFixed(2),
    cgst: t.cgst.toFixed(2),
    sgst: t.sgst.toFixed(2),
    igst: t.igst.toFixed(2),
    total: t.taxable.plus(t.cgst).plus(t.sgst).plus(t.igst).toFixed(2),
  };
}
function inputTax(t: InputTax): GstInputTax {
  return {
    cgst: t.cgst.toFixed(2),
    sgst: t.sgst.toFixed(2),
    igst: t.igst.toFixed(2),
    notSplit: t.notSplit.toFixed(2),
    total: t.cgst.plus(t.sgst).plus(t.igst).plus(t.notSplit).toFixed(2),
  };
}
function addInput(a: InputTax, b: InputTax, sign = 1): InputTax {
  return {
    cgst: a.cgst.plus(b.cgst.times(sign)),
    sgst: a.sgst.plus(b.sgst.times(sign)),
    igst: a.igst.plus(b.igst.times(sign)),
    notSplit: a.notSplit.plus(b.notSplit.times(sign)),
  };
}
const inputOf = (t: GstInputTax): InputTax => ({ cgst: new Prisma.Decimal(t.cgst), sgst: new Prisma.Decimal(t.sgst), igst: new Prisma.Decimal(t.igst), notSplit: new Prisma.Decimal(t.notSplit) });

/**
 * GST Output, GST Input, GST Net and the GST Document Register (Phase 8.4,
 * ADR-111). Output and Input are built from the documents' own tax amounts
 * and reconciled to the GST ledger accounts; Net is Output − eligible Input ±
 * the GST postings no document explains. The register lists document tax
 * lines as issued. None of them files a return.
 */
@Injectable()
export class GstReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ReportScopeService,
    private readonly ledger: LedgerControlService,
  ) {}

  async output(input: ReportReadInput): Promise<GstOutputReport> {
    const { scope, projects } = await this.scopes.resolve(input);
    const documents = await this.outputDocuments(input, scope, projects.map((p) => p.id));

    const periods = new Map<string, { row: Omit<GstPeriodSummaryRow, keyof GstTaxTotals | 'documentCount'>; tax: Tax; count: number }>();
    const totals = zeroTax();
    for (const doc of documents) {
      const key = `${doc.gstRegistrationId}|${doc.taxPeriod}`;
      const entry = periods.get(key) ?? { row: { gstRegistrationId: doc.gstRegistrationId, gstin: doc.gstin, taxPeriod: doc.taxPeriod }, tax: zeroTax(), count: 0 };
      for (const k of ['taxable', 'cgst', 'sgst', 'igst'] as const) {
        entry.tax[k] = entry.tax[k].plus(doc[k]);
        totals[k] = totals[k].plus(doc[k]);
      }
      entry.count += 1;
      periods.set(key, entry);
    }

    const totalStrings = taxTotals(totals);
    const reconciliation = await this.reconcileComponents(input, scope, [
      { key: 'OUTPUT_CGST', label: 'Output CGST', codes: [OUTPUT_CODES.CGST], reportAmount: totals.cgst, liabilitySign: -1 },
      { key: 'OUTPUT_SGST', label: 'Output SGST', codes: [OUTPUT_CODES.SGST], reportAmount: totals.sgst, liabilitySign: -1 },
      { key: 'OUTPUT_IGST', label: 'Output IGST', codes: [OUTPUT_CODES.IGST], reportAmount: totals.igst, liabilitySign: -1 },
    ]);

    return {
      catalog: REPORT_CATALOG['gst-output'],
      scope,
      documents,
      periods: [...periods.values()]
        .map((p) => ({ ...p.row, documentCount: p.count, ...taxTotals(p.tax) }))
        .sort((a, b) => (a.gstin ?? '').localeCompare(b.gstin ?? '') || a.taxPeriod.localeCompare(b.taxPeriod)),
      totals: totalStrings,
      reconciliation,
    };
  }

  async input(input: ReportReadInput): Promise<GstInputReport> {
    const { scope, projects } = await this.scopes.resolve(input);
    const selectedIds = projects.map((p) => p.id);
    const [documents, pending] = await Promise.all([this.inputDocuments(input, scope, selectedIds), this.pendingInput(input, scope, selectedIds)]);

    const periods = new Map<string, { row: Pick<GstInputPeriodRow, 'gstRegistrationId' | 'gstin' | 'taxPeriod'>; taxable: Prisma.Decimal; eligible: InputTax; ineligible: InputTax; count: number }>();
    let taxable = ZERO;
    let eligible = zeroInput();
    let ineligible = zeroInput();
    for (const doc of documents) {
      const key = `${doc.gstRegistrationId ?? 'none'}|${doc.taxPeriod}`;
      const entry = periods.get(key) ?? { row: { gstRegistrationId: doc.gstRegistrationId, gstin: doc.gstin, taxPeriod: doc.taxPeriod }, taxable: ZERO, eligible: zeroInput(), ineligible: zeroInput(), count: 0 };
      entry.taxable = entry.taxable.plus(doc.taxable);
      entry.eligible = addInput(entry.eligible, inputOf(doc.eligible));
      entry.ineligible = addInput(entry.ineligible, inputOf(doc.ineligible));
      entry.count += 1;
      periods.set(key, entry);
      taxable = taxable.plus(doc.taxable);
      eligible = addInput(eligible, inputOf(doc.eligible));
      ineligible = addInput(ineligible, inputOf(doc.ineligible));
    }
    let pendingTaxable = ZERO;
    let pendingEligible = zeroInput();
    for (const p of pending) {
      pendingTaxable = pendingTaxable.plus(p.taxable);
      pendingEligible = addInput(pendingEligible, inputOf(p.eligible));
    }

    const reconciliation = await this.reconcileComponents(input, scope, [
      { key: 'INPUT_CGST', label: 'Eligible input CGST', codes: [INPUT_CODES.CGST], reportAmount: eligible.cgst, liabilitySign: 1 },
      { key: 'INPUT_SGST', label: 'Eligible input SGST', codes: [INPUT_CODES.SGST], reportAmount: eligible.sgst, liabilitySign: 1 },
      { key: 'INPUT_IGST', label: 'Eligible input IGST', codes: [INPUT_CODES.IGST], reportAmount: eligible.igst, liabilitySign: 1 },
      { key: 'INPUT_NOT_SPLIT', label: 'Expense-claim GST credit', codes: [INPUT_CODES.NOT_SPLIT], reportAmount: eligible.notSplit, liabilitySign: 1 },
    ]);

    return {
      catalog: REPORT_CATALOG['gst-input'],
      scope,
      documents,
      periods: [...periods.values()]
        .map((p) => ({ ...p.row, documentCount: p.count, taxable: p.taxable.toFixed(2), eligible: inputTax(p.eligible), ineligible: inputTax(p.ineligible) }))
        .sort((a, b) => Number(a.gstin === null) - Number(b.gstin === null) || (a.gstin ?? '').localeCompare(b.gstin ?? '') || a.taxPeriod.localeCompare(b.taxPeriod)), // no-registration rows last
      totals: { taxable: taxable.toFixed(2), eligible: inputTax(eligible), ineligible: inputTax(ineligible) },
      pending,
      pendingTotals: { taxable: pendingTaxable.toFixed(2), eligible: inputTax(pendingEligible) },
      reconciliation,
    };
  }

  async net(input: ReportReadInput): Promise<GstNetReport> {
    const [output, inputReport] = await Promise.all([this.output(input), this.input(input)]);
    const scope = output.scope;
    const adjustments = scope.restricted ? [] : await this.adjustments(input, scope);

    const outputBy: Record<GstNetComponent, Prisma.Decimal> = {
      CGST: new Prisma.Decimal(output.totals.cgst),
      SGST: new Prisma.Decimal(output.totals.sgst),
      IGST: new Prisma.Decimal(output.totals.igst),
      NOT_SPLIT: ZERO,
    };
    const inputBy: Record<GstNetComponent, Prisma.Decimal> = {
      CGST: new Prisma.Decimal(inputReport.totals.eligible.cgst),
      SGST: new Prisma.Decimal(inputReport.totals.eligible.sgst),
      IGST: new Prisma.Decimal(inputReport.totals.eligible.igst),
      NOT_SPLIT: new Prisma.Decimal(inputReport.totals.eligible.notSplit),
    };
    const adjustmentBy = Object.fromEntries(COMPONENTS.map((c) => [c, ZERO])) as Record<GstNetComponent, Prisma.Decimal>;
    for (const a of adjustments) adjustmentBy[a.component] = adjustmentBy[a.component].plus(a.amount);

    const line = (component: GstNetLine['component'], label: string, out: Prisma.Decimal, inp: Prisma.Decimal, adj: Prisma.Decimal): GstNetLine => ({
      component,
      label,
      output: out.toFixed(2),
      eligibleInput: inp.toFixed(2),
      adjustments: adj.toFixed(2),
      net: out.minus(inp).plus(adj).toFixed(2),
    });
    const components = COMPONENTS.map((c) => line(c, COMPONENT_LABELS[c], outputBy[c], inputBy[c], adjustmentBy[c]));
    const sum = (m: Record<GstNetComponent, Prisma.Decimal>) => COMPONENTS.reduce((s, c) => s.plus(m[c]), ZERO);
    const totals = line('TOTAL', 'Net GST', sum(outputBy), sum(inputBy), sum(adjustmentBy));

    const periods = new Map<string, { output: Prisma.Decimal; input: Prisma.Decimal; adjustments: Prisma.Decimal }>();
    const period = (p: string) => periods.get(p) ?? { output: ZERO, input: ZERO, adjustments: ZERO };
    for (const doc of output.documents) {
      const e = period(doc.taxPeriod);
      e.output = e.output.plus(doc.cgst).plus(doc.sgst).plus(doc.igst);
      periods.set(doc.taxPeriod, e);
    }
    for (const doc of inputReport.documents) {
      const e = period(doc.taxPeriod);
      e.input = e.input.plus(doc.eligible.total);
      periods.set(doc.taxPeriod, e);
    }
    for (const a of adjustments) {
      const p = taxPeriodOf(a.accountingDate);
      const e = period(p);
      e.adjustments = e.adjustments.plus(a.amount);
      periods.set(p, e);
    }

    let reconciliation: LedgerReconciliation;
    if (scope.restricted) {
      reconciliation = this.notComparable(input);
    } else {
      const movement = await this.ledger.periodMovementByCode({
        organizationId: input.organizationId,
        legalEntityId: scope.legalEntityId,
        dateFrom: scope.dateFrom,
        dateTo: scope.asOfDate,
        codes: Object.keys(COMPONENT_BY_CODE),
      });
      const lines: LedgerReconciliationLine[] = components.map((c) => {
        const accounts = [...movement.values()].filter((m) => COMPONENT_BY_CODE[m.account.code] === c.component);
        // Liability direction: credit − debit on both the payable and the receivable side.
        const ledgerAmount = accounts.reduce((s, m) => s.minus(m.debitMinusCredit), ZERO);
        const difference = new Prisma.Decimal(c.net).minus(ledgerAmount);
        return {
          key: `NET_${c.component}`,
          label: `Net ${c.label}`,
          ledgerAccounts: accounts.map((m) => m.account).sort((a, b) => a.code.localeCompare(b.code)),
          reportAmount: c.net,
          ledgerAmount: ledgerAmount.toFixed(2),
          difference: difference.toFixed(2),
          reconciled: difference.isZero(),
        };
      });
      reconciliation = { applicable: true, notApplicableReason: null, lines, allReconciled: lines.every((l) => l.reconciled) };
    }

    return {
      catalog: REPORT_CATALOG['gst-net'],
      scope,
      components,
      totals,
      periods: [...periods.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([taxPeriod, e]) => ({ taxPeriod, output: e.output.toFixed(2), eligibleInput: e.input.toFixed(2), adjustments: e.adjustments.toFixed(2), net: e.output.minus(e.input).plus(e.adjustments).toFixed(2) })),
      adjustments,
      reconciliation,
    };
  }

  async register(input: ReportReadInput): Promise<GstRegisterReport> {
    const { scope, projects } = await this.scopes.resolve(input);
    const { organizationId } = input;
    const db = this.prisma.client;
    const docDate = { lte: new Date(`${scope.asOfDate}T00:00:00.000Z`), ...(scope.dateFrom ? { gte: new Date(`${scope.dateFrom}T00:00:00.000Z`) } : {}) };
    const where = {
      organizationId,
      journalEntryId: { not: null },
      ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}),
      ...(scope.restricted ? { projectId: { in: projects.map((p) => p.id) } } : {}),
    };
    const lineSelect = { sequence: true, description: true, hsnSac: true, gstRatePercent: true, taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true, lineTotal: true } as const;
    const [invoices, notes, bills] = await Promise.all([
      db.invoice.findMany({
        where: { ...where, invoiceDate: docDate },
        select: {
          id: true, projectId: true, invoiceNumber: true, invoiceDate: true, buyerName: true, buyerGstin: true, buyerState: true,
          gstRegistration: { select: { gstin: true } },
          voidJournalEntry: { select: { accountingDate: true } },
          lines: { select: lineSelect, orderBy: { sequence: 'asc' } },
        },
      }),
      db.creditDebitNote.findMany({
        where: { ...where, noteDate: docDate },
        select: {
          id: true, invoiceId: true, projectId: true, type: true, noteNumber: true, noteDate: true,
          invoice: { select: { buyerName: true, buyerGstin: true, buyerState: true } },
          gstRegistration: { select: { gstin: true } },
          voidJournalEntry: { select: { accountingDate: true } },
          lines: { select: lineSelect, orderBy: { sequence: 'asc' } },
        },
      }),
      db.vendorBill.findMany({
        where: { ...where, vendorBillDate: docDate },
        select: {
          id: true, projectId: true, vendorBillNumber: true, vendorBillDate: true,
          vendor: { select: { name: true, state: { select: { name: true } }, vendorProfile: { select: { gstin: true } } } },
          gstRegistration: { select: { gstin: true } },
          voidJournalEntry: { select: { accountingDate: true } },
          lines: { select: { ...lineSelect, itcEligible: true }, orderBy: { sequence: 'asc' } },
        },
      }),
    ]);

    const statusOf = (voidJe: { accountingDate: Date } | null): GstRegisterLine['status'] => (voidJe && dateOf(voidJe.accountingDate) <= scope.asOfDate ? 'VOID' : 'FINALIZED');
    const lineFields = (l: { sequence: number; description: string; hsnSac: string | null; gstRatePercent: Prisma.Decimal; taxableAmount: Prisma.Decimal; cgstAmount: Prisma.Decimal; sgstAmount: Prisma.Decimal; igstAmount: Prisma.Decimal; lineTotal: Prisma.Decimal }) => ({
      lineNumber: l.sequence,
      description: l.description,
      hsnSac: l.hsnSac,
      // The stored rate meant the total GST before 2026-10-05 and each of
      // CGST/SGST after it, with no migration, so it cannot be printed as is.
      // The register shows the rate the line's tax actually comes to.
      ratePercent: l.taxableAmount.greaterThan(0)
        ? l.cgstAmount.plus(l.sgstAmount).plus(l.igstAmount).times(100).dividedBy(l.taxableAmount).toFixed(2)
        : l.gstRatePercent.toFixed(2),
      taxable: l.taxableAmount.toFixed(2),
      cgst: l.cgstAmount.toFixed(2),
      sgst: l.sgstAmount.toFixed(2),
      igst: l.igstAmount.toFixed(2),
      lineTotal: l.lineTotal.toFixed(2),
    });

    const lines: GstRegisterLine[] = [
      ...invoices.flatMap((i) =>
        i.lines.map((l): GstRegisterLine => ({
          direction: 'OUTWARD' as const, documentType: 'INVOICE' as const, documentId: i.id, invoiceId: i.id, projectId: i.projectId,
          number: i.invoiceNumber ?? '', documentDate: dateOf(i.invoiceDate!), status: statusOf(i.voidJournalEntry),
          gstin: i.gstRegistration.gstin, counterpartyName: i.buyerName, counterpartyGstin: i.buyerGstin, placeOfSupply: i.buyerState,
          ...lineFields(l), itcEligible: null,
        })),
      ),
      ...notes.flatMap((n) =>
        n.lines.map((l): GstRegisterLine => ({
          direction: 'OUTWARD' as const, documentType: (n.type === 'CREDIT' ? 'CREDIT_NOTE' : 'DEBIT_NOTE'), documentId: n.id, invoiceId: n.invoiceId, projectId: n.projectId,
          number: n.noteNumber ?? '', documentDate: dateOf(n.noteDate!), status: statusOf(n.voidJournalEntry),
          gstin: n.gstRegistration.gstin, counterpartyName: n.invoice.buyerName, counterpartyGstin: n.invoice.buyerGstin, placeOfSupply: n.invoice.buyerState,
          ...lineFields(l), itcEligible: null,
        })),
      ),
      ...bills.flatMap((b) =>
        b.lines.map((l): GstRegisterLine => ({
          direction: 'INWARD' as const, documentType: 'VENDOR_BILL' as const, documentId: b.id, invoiceId: null, projectId: b.projectId,
          number: b.vendorBillNumber, documentDate: dateOf(b.vendorBillDate), status: statusOf(b.voidJournalEntry),
          gstin: b.gstRegistration.gstin, counterpartyName: b.vendor.name, counterpartyGstin: b.vendor.vendorProfile?.gstin ?? null, placeOfSupply: b.vendor.state?.name ?? null,
          ...lineFields(l), itcEligible: l.itcEligible,
        })),
      ),
    ].sort((a, b) => a.direction.localeCompare(b.direction) || a.documentDate.localeCompare(b.documentDate) || a.number.localeCompare(b.number) || a.lineNumber - b.lineNumber);

    const totals: GstRegisterTypeTotal[] = GST_REGISTER_DOCUMENT_TYPES.map((documentType) => {
      const counted = lines.filter((l) => l.documentType === documentType && l.status === 'FINALIZED');
      const tax = counted.reduce(
        (t, l) => ({ taxable: t.taxable.plus(l.taxable), cgst: t.cgst.plus(l.cgst), sgst: t.sgst.plus(l.sgst), igst: t.igst.plus(l.igst) }),
        zeroTax(),
      );
      return { documentType, documentCount: new Set(counted.map((l) => l.documentId)).size, lineCount: counted.length, ...taxTotals(tax) };
    });

    return {
      catalog: REPORT_CATALOG['gst-register'],
      scope,
      lines,
      totals,
      reconciliation: {
        applicable: false,
        notApplicableReason: 'The register lists documents by their own date and current status. Their tax is reconciled to the GST ledger on the GST Output and GST Input reports, which count each void in its own period.',
        lines: [],
        allReconciled: false,
      },
    };
  }

  private notComparable(input: ReportReadInput): LedgerReconciliation {
    return {
      applicable: false,
      notApplicableReason: input.canSeeAllProjects
        ? 'Filtered to one client or project. The GST ledger accounts cover every project and documents with no project, so they are compared only on the unfiltered view.'
        : 'You can see only the projects assigned to you, so these totals cannot be compared with the whole ledger.',
      lines: [],
      allReconciled: false,
    };
  }

  /** `liabilitySign` −1 reads an account credit-normal (output), 1 debit-normal (input). */
  private async reconcileComponents(
    input: ReportReadInput,
    scope: ReportScope,
    figures: Array<{ key: string; label: string; codes: string[]; reportAmount: Prisma.Decimal; liabilitySign: 1 | -1 }>,
  ): Promise<LedgerReconciliation> {
    if (scope.restricted) return this.notComparable(input);
    const movement = await this.ledger.periodMovementByCode({
      organizationId: input.organizationId,
      legalEntityId: scope.legalEntityId,
      dateFrom: scope.dateFrom,
      dateTo: scope.asOfDate,
      codes: figures.flatMap((f) => f.codes),
    });
    const lines = figures.map((f) => {
      const found = f.codes.map((c) => movement.get(c)).filter((m): m is NonNullable<typeof m> => Boolean(m));
      const ledgerAmount = found.reduce((s, m) => s.plus(m.debitMinusCredit.times(f.liabilitySign)), ZERO);
      const difference = f.reportAmount.minus(ledgerAmount);
      return {
        key: f.key,
        label: f.label,
        ledgerAccounts: found.map((m) => m.account),
        reportAmount: f.reportAmount.toFixed(2),
        ledgerAmount: ledgerAmount.toFixed(2),
        difference: difference.toFixed(2),
        reconciled: difference.isZero(),
      };
    });
    return { applicable: true, notApplicableReason: null, lines, allReconciled: lines.every((l) => l.reconciled) };
  }

  private journalDateFilter(scope: ReportScope) {
    return { accountingDate: { lte: new Date(`${scope.asOfDate}T00:00:00.000Z`), ...(scope.dateFrom ? { gte: new Date(`${scope.dateFrom}T00:00:00.000Z`) } : {}) } };
  }

  private async outputDocuments(input: ReportReadInput, scope: ReportScope, selectedIds: string[]): Promise<GstOutputRow[]> {
    const { organizationId } = input;
    const db = this.prisma.client;
    const range = this.journalDateFilter(scope);
    const inRange = (date: Date) => {
      const s = dateOf(date);
      return s <= scope.asOfDate && (!scope.dateFrom || s >= scope.dateFrom);
    };
    const where = {
      organizationId,
      ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}),
      ...(scope.restricted ? { projectId: { in: selectedIds } } : {}),
      OR: [{ journalEntry: range }, { voidJournalEntry: range }],
    };
    const journal = { select: { id: true, accountingDate: true } } as const;
    const [invoices, notes] = await Promise.all([
      db.invoice.findMany({
        where,
        select: {
          id: true, projectId: true, invoiceNumber: true, buyerName: true, buyerGstin: true, buyerState: true,
          taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true,
          gstRegistration: { select: { id: true, gstin: true } },
          journalEntry: journal,
          voidJournalEntry: journal,
        },
      }),
      db.creditDebitNote.findMany({
        where,
        select: {
          id: true, invoiceId: true, projectId: true, type: true, noteNumber: true,
          taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true,
          invoice: { select: { buyerName: true, buyerGstin: true, buyerState: true } },
          gstRegistration: { select: { id: true, gstin: true } },
          journalEntry: journal,
          voidJournalEntry: journal,
        },
      }),
    ]);

    const rows: GstOutputRow[] = [];
    const push = (
      base: Omit<GstOutputRow, keyof GstTaxTotals | 'documentType' | 'ledgerDate' | 'taxPeriod' | 'journalEntryId'>,
      amounts: { taxableAmount: Prisma.Decimal | null; cgstAmount: Prisma.Decimal | null; sgstAmount: Prisma.Decimal | null; igstAmount: Prisma.Decimal | null },
      documentType: GstOutputRow['documentType'],
      je: { id: string; accountingDate: Date },
      sign: 1 | -1,
    ) => {
      const ledgerDate = dateOf(je.accountingDate);
      rows.push({
        ...base,
        documentType,
        ledgerDate,
        taxPeriod: taxPeriodOf(ledgerDate),
        journalEntryId: je.id,
        ...taxTotals({ taxable: d(amounts.taxableAmount).times(sign), cgst: d(amounts.cgstAmount).times(sign), sgst: d(amounts.sgstAmount).times(sign), igst: d(amounts.igstAmount).times(sign) }),
      });
    };
    for (const i of invoices) {
      const base = { documentId: i.id, invoiceId: i.id, projectId: i.projectId, number: i.invoiceNumber ?? '', gstRegistrationId: i.gstRegistration.id, gstin: i.gstRegistration.gstin, buyerName: i.buyerName, buyerGstin: i.buyerGstin, placeOfSupply: i.buyerState };
      if (i.journalEntry && inRange(i.journalEntry.accountingDate)) push(base, i, 'INVOICE', i.journalEntry, 1);
      if (i.voidJournalEntry && inRange(i.voidJournalEntry.accountingDate)) push(base, i, 'INVOICE_VOID', i.voidJournalEntry, -1);
    }
    for (const n of notes) {
      const credit = n.type === 'CREDIT';
      const base = { documentId: n.id, invoiceId: n.invoiceId, projectId: n.projectId, number: n.noteNumber ?? '', gstRegistrationId: n.gstRegistration.id, gstin: n.gstRegistration.gstin, buyerName: n.invoice.buyerName, buyerGstin: n.invoice.buyerGstin, placeOfSupply: n.invoice.buyerState };
      if (n.journalEntry && inRange(n.journalEntry.accountingDate)) push(base, n, credit ? 'CREDIT_NOTE' : 'DEBIT_NOTE', n.journalEntry, credit ? -1 : 1);
      if (n.voidJournalEntry && inRange(n.voidJournalEntry.accountingDate)) push(base, n, credit ? 'CREDIT_NOTE_VOID' : 'DEBIT_NOTE_VOID', n.voidJournalEntry, credit ? 1 : -1);
    }
    return rows.sort((a, b) => a.ledgerDate.localeCompare(b.ledgerDate) || a.number.localeCompare(b.number) || a.documentType.localeCompare(b.documentType));
  }

  private async inputDocuments(input: ReportReadInput, scope: ReportScope, selectedIds: string[]): Promise<GstInputRow[]> {
    const { organizationId } = input;
    const db = this.prisma.client;
    const range = this.journalDateFilter(scope);
    const inRange = (date: Date) => {
      const s = dateOf(date);
      return s <= scope.asOfDate && (!scope.dateFrom || s >= scope.dateFrom);
    };
    const common = {
      organizationId,
      ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}),
      ...(scope.restricted ? { projectId: { in: selectedIds } } : {}),
    };
    const journal = { select: { id: true, accountingDate: true } } as const;
    const [bills, expenses, claims] = await Promise.all([
      db.vendorBill.findMany({
        where: { ...common, OR: [{ journalEntry: range }, { voidJournalEntry: range }] },
        select: {
          id: true, projectId: true, vendorBillNumber: true,
          vendor: { select: { name: true, vendorProfile: { select: { gstin: true } } } },
          gstRegistration: { select: { id: true, gstin: true } },
          lines: { select: { taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true, itcEligible: true } },
          journalEntry: journal,
          voidJournalEntry: journal,
        },
      }),
      db.directExpense.findMany({
        where: { ...common, OR: [{ journalEntry: range }, { reversalJournalEntry: range }] },
        select: {
          id: true, projectId: true, title: true, taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true, itcEligible: true,
          vendor: { select: { name: true, vendorProfile: { select: { gstin: true } } } },
          journalEntry: journal,
          reversalJournalEntry: journal,
        },
      }),
      db.employeeExpenseClaim.findMany({
        where: { ...common, gstCreditAmount: { gt: 0 }, journalEntry: range },
        select: { id: true, projectId: true, title: true, amount: true, gstCreditAmount: true, employee: { select: { fullName: true } }, journalEntry: journal },
      }),
    ]);

    const rows: GstInputRow[] = [];
    const push = (
      base: Pick<GstInputRow, 'documentId' | 'projectId' | 'number' | 'gstRegistrationId' | 'gstin' | 'supplierName' | 'supplierGstin'>,
      documentType: GstInputRow['documentType'],
      je: { id: string; accountingDate: Date },
      sign: 1 | -1,
      taxable: Prisma.Decimal,
      eligible: InputTax,
      ineligible: InputTax,
    ) => {
      const ledgerDate = dateOf(je.accountingDate);
      rows.push({
        ...base,
        documentType,
        ledgerDate,
        taxPeriod: taxPeriodOf(ledgerDate),
        journalEntryId: je.id,
        taxable: taxable.times(sign).toFixed(2),
        eligible: inputTax(addInput(zeroInput(), eligible, sign)),
        ineligible: inputTax(addInput(zeroInput(), ineligible, sign)),
      });
    };

    for (const b of bills) {
      let taxable = ZERO;
      let eligible = zeroInput();
      let ineligible = zeroInput();
      for (const l of b.lines) {
        taxable = taxable.plus(l.taxableAmount);
        const tax = { cgst: l.cgstAmount, sgst: l.sgstAmount, igst: l.igstAmount, notSplit: ZERO };
        if (l.itcEligible) eligible = addInput(eligible, tax);
        else ineligible = addInput(ineligible, tax);
      }
      const base = { documentId: b.id, projectId: b.projectId, number: b.vendorBillNumber, gstRegistrationId: b.gstRegistration.id, gstin: b.gstRegistration.gstin, supplierName: b.vendor.name, supplierGstin: b.vendor.vendorProfile?.gstin ?? null };
      if (b.journalEntry && inRange(b.journalEntry.accountingDate)) push(base, 'VENDOR_BILL', b.journalEntry, 1, taxable, eligible, ineligible);
      if (b.voidJournalEntry && inRange(b.voidJournalEntry.accountingDate)) push(base, 'VENDOR_BILL_VOID', b.voidJournalEntry, -1, taxable, eligible, ineligible);
    }
    for (const e of expenses) {
      const tax = { cgst: e.cgstAmount, sgst: e.sgstAmount, igst: e.igstAmount, notSplit: ZERO };
      if (tax.cgst.plus(tax.sgst).plus(tax.igst).isZero()) continue; // no GST on it — nothing to report
      const eligible = e.itcEligible ? tax : zeroInput();
      const ineligible = e.itcEligible ? zeroInput() : tax;
      const base = { documentId: e.id, projectId: e.projectId, number: e.title, gstRegistrationId: null, gstin: null, supplierName: e.vendor?.name ?? null, supplierGstin: e.vendor?.vendorProfile?.gstin ?? null };
      if (e.journalEntry && inRange(e.journalEntry.accountingDate)) push(base, 'DIRECT_EXPENSE', e.journalEntry, 1, e.taxableAmount, eligible, ineligible);
      if (e.reversalJournalEntry && inRange(e.reversalJournalEntry.accountingDate)) push(base, 'DIRECT_EXPENSE_REVERSAL', e.reversalJournalEntry, -1, e.taxableAmount, eligible, ineligible);
    }
    for (const c of claims) {
      if (!c.journalEntry) continue;
      const base = { documentId: c.id, projectId: c.projectId, number: c.title, gstRegistrationId: null, gstin: null, supplierName: c.employee.fullName, supplierGstin: null };
      push(base, 'EXPENSE_CLAIM', c.journalEntry, 1, c.amount.minus(c.gstCreditAmount), { ...zeroInput(), notSplit: c.gstCreditAmount }, zeroInput());
    }
    return rows.sort((a, b) => a.ledgerDate.localeCompare(b.ledgerDate) || a.number.localeCompare(b.number) || a.documentType.localeCompare(b.documentType));
  }

  /** Today's submitted-but-unapproved bills and claims dated on or before the as-of date. */
  private async pendingInput(input: ReportReadInput, scope: ReportScope, selectedIds: string[]): Promise<GstPendingInputRow[]> {
    const { organizationId } = input;
    const db = this.prisma.client;
    const asOf = new Date(`${scope.asOfDate}T00:00:00.000Z`);
    const common = {
      organizationId,
      status: 'SUBMITTED' as const,
      ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}),
      ...(scope.restricted ? { projectId: { in: selectedIds } } : {}),
    };
    const [bills, claims] = await Promise.all([
      db.vendorBill.findMany({
        where: { ...common, vendorBillDate: { lte: asOf } },
        select: { id: true, projectId: true, vendorBillNumber: true, vendorBillDate: true, vendor: { select: { name: true } }, lines: { select: { taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true, itcEligible: true } } },
      }),
      db.employeeExpenseClaim.findMany({
        where: { ...common, expenseDate: { lte: asOf }, gstCreditAmount: { gt: 0 } },
        select: { id: true, projectId: true, title: true, expenseDate: true, amount: true, gstCreditAmount: true, employee: { select: { fullName: true } } },
      }),
    ]);
    return [
      ...bills.map((b) => {
        let taxable = ZERO;
        let eligible = zeroInput();
        for (const l of b.lines) {
          taxable = taxable.plus(l.taxableAmount);
          if (l.itcEligible) eligible = addInput(eligible, { cgst: l.cgstAmount, sgst: l.sgstAmount, igst: l.igstAmount, notSplit: ZERO });
        }
        return { documentType: 'VENDOR_BILL' as const, documentId: b.id, projectId: b.projectId, number: b.vendorBillNumber, documentDate: dateOf(b.vendorBillDate), status: 'SUBMITTED', supplierName: b.vendor.name, taxable: taxable.toFixed(2), eligible: inputTax(eligible) };
      }),
      ...claims.map((c) => ({
        documentType: 'EXPENSE_CLAIM' as const, documentId: c.id, projectId: c.projectId, number: c.title, documentDate: dateOf(c.expenseDate), status: 'SUBMITTED', supplierName: c.employee.fullName,
        taxable: c.amount.minus(c.gstCreditAmount).toFixed(2), eligible: inputTax({ ...zeroInput(), notSplit: c.gstCreditAmount }),
      })),
    ].sort((a, b) => a.documentDate.localeCompare(b.documentDate) || a.number.localeCompare(b.number));
  }

  /** GST ledger lines in the period posted by anything other than the documents the Output and Input reports read. */
  private async adjustments(input: ReportReadInput, scope: ReportScope): Promise<GstAdjustmentRow[]> {
    const lines = await this.prisma.client.journalLine.findMany({
      where: {
        organizationId: input.organizationId,
        ledgerAccount: { code: { in: Object.keys(COMPONENT_BY_CODE) } },
        journalEntry: { ...this.journalDateFilter(scope), ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}) },
      },
      select: {
        debitAmount: true,
        creditAmount: true,
        ledgerAccount: { select: { code: true, name: true } },
        journalEntry: { select: { id: true, accountingDate: true, sourceType: true, description: true, reversalOf: { select: { sourceType: true } } } },
      },
    });
    return lines
      .filter((l) => {
        const origin = l.journalEntry.sourceType === REVERSAL_SOURCE_TYPE && l.journalEntry.reversalOf ? l.journalEntry.reversalOf.sourceType : l.journalEntry.sourceType;
        return !DOCUMENT_SOURCE_TYPES.has(origin);
      })
      .map((l) => ({
        journalEntryId: l.journalEntry.id,
        accountingDate: dateOf(l.journalEntry.accountingDate),
        sourceType: l.journalEntry.sourceType,
        description: l.journalEntry.description,
        ledgerAccountCode: l.ledgerAccount.code,
        ledgerAccountName: l.ledgerAccount.name,
        component: COMPONENT_BY_CODE[l.ledgerAccount.code]!,
        amount: l.creditAmount.minus(l.debitAmount).toFixed(2),
      }))
      .sort((a, b) => a.accountingDate.localeCompare(b.accountingDate));
  }
}
