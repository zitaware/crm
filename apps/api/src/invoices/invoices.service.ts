import { Injectable } from '@nestjs/common';
import { ReceiptsService } from '../receipts/receipts.service';
import { formatDisplayDate } from '../common/display-date.util';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  InvoicePort,
  InvoiceSummary,
  InvoiceDetail,
  InvoiceFilters,
  InvoiceDraftDefaults,
  InvoiceLineInput,
  InvoiceCollection,
  InvoiceReceiptAllocation,
  InvoiceSourceBilling,
} from '@zitaware/contracts';
import { INVOICE_INWARD_COPY_LINK_TYPE } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';
import { ProjectsService } from '../projects/projects.service';
import { isConstraintViolation } from '../organization/constraint-error.util';
import { FinancialYearService } from '../organization/financial-year.service';
import { renderInvoicePdf } from './invoice-pdf.util';
import { toDeductionSummary } from '../receipts/receipts.service';
import {
  addAmounts,
  collectionBySource,
  emptyAmounts,
  invoiceAmounts,
  toCollection,
  type CollectionAllocation,
  type CollectionAmounts,
} from './invoice-collection.util';
import { loadSourceAmounts, loadSourceBilling, remainingOf } from './source-billing';
import { loadBrandingImage } from '../organization/branding-image-store';

const CREATE_DRAFT_COMMAND_TYPE = 'invoice.create_draft';
const START_CONVERSION_COMMAND_TYPE = 'invoice.start_conversion';
const FINALIZE_COMMAND_TYPE = 'invoice.finalize';
const VOID_COMMAND_TYPE = 'invoice.void';

/**
 * How many distinct invoice numbers the series has handed out. A voided
 * number used again by a later invoice counts once, so the next generated
 * number does not skip one (ADR-163).
 */
async function numbersInUse(
  db: Pick<Prisma.TransactionClient, 'invoice'>,
  scope: { organizationId: string; gstRegistrationId: string; financialYearId: string },
): Promise<number> {
  const groups = await db.invoice.groupBy({ by: ['invoiceNumber'], where: { ...scope, invoiceNumber: { not: null } } });
  return groups.length;
}

/** VOID and CONVERTED stay stored and do not occupy the billing event. */
const SLOT_FREE_STATUSES = ['VOID', 'CONVERTED'] as const;
/** Not yet finalized: a draft, or an issued proforma. One per event or installment at a time (ADR-156). */
const OPEN_STATUSES = ['DRAFT', 'ISSUED'] as const;
const MAX_NUMBER_ATTEMPTS = 5;
// GST rule 46(b): a tax invoice serial of up to 16 characters, using
// letters, digits, hyphen and slash.
const INVOICE_NUMBER_PATTERN = /^[A-Za-z0-9/-]{1,16}$/;

/** Shared with CreditDebitNotesService, whose finalize journal posts the
 * mirror (Credit Note) or identical-direction (Debit Note) version of this
 * same set of accounts. */
export const LEDGER_CODES = {
  ar: 'ACCOUNTS_RECEIVABLE',
  revenue: 'SOFTWARE_PROJECT_REVENUE',
  cgst: 'OUTPUT_CGST_PAYABLE',
  sgst: 'OUTPUT_SGST_PAYABLE',
  igst: 'OUTPUT_IGST_PAYABLE',
} as const;

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Prisma requires a full ISO-8601 DateTime (or a Date instance) for
 * @db.Date columns — a bare 'YYYY-MM-DD' string is rejected. Same local
 * helper as posting.service.ts/security-instruments.service.ts. */
function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** Same shallow-sorted-keys sha256 shape as hashRequest in every prior
 * slice's own service — reimplemented locally per that established
 * precedent. */
function hashRequest(input: unknown): string {
  const normalized = JSON.stringify(input, Object.keys(input as object).sort());
  return createHash('sha256').update(normalized).digest('hex');
}

/** Buyer address on the tax invoice: the client's address, then city and PIN when they are not already in that text. */
function invoiceBuyerAddress(client: {
  officeAddress: string | null;
  pinCode: string | null;
  city: { name: string } | null;
}): string | null {
  const street = client.officeAddress?.trim() ?? '';
  const city = client.city?.name?.trim() ?? '';
  const pin = client.pinCode?.trim() ?? '';
  const parts: string[] = [];
  if (street) parts.push(street.replace(/[,\s]+$/, ''));
  if (city && !street.toLowerCase().includes(city.toLowerCase())) parts.push(city);
  if (pin && !street.includes(pin)) parts.push(pin);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** The tax invoice prints the account number, never a masked value. */
function invoiceBankAccountNumber(account: { invoiceAccountNumber: string | null; maskedAccountNumber: string | null } | null | undefined): string | null {
  const printed = account?.invoiceAccountNumber?.trim();
  if (printed && !printed.includes('*')) return printed;
  const stored = account?.maskedAccountNumber?.trim();
  if (stored && !stored.includes('*')) return stored;
  return null;
}

export interface ComputedLine {
  sequence: number;
  description: string;
  hsnSac: string | null;
  sourceEventId: string | null;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  taxableAmount: Prisma.Decimal;
  gstRatePercent: Prisma.Decimal;
  cgstAmount: Prisma.Decimal;
  sgstAmount: Prisma.Decimal;
  igstAmount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
}

/** The entered GST percent is the rate for each of CGST and SGST.
 * Same state as the seller's GST registration: that percent is CGST and
 * that percent is SGST. A different state: IGST is both percents together.
 * CGST+SGST and IGST stay mutually exclusive. */
/** Exported for CreditDebitNotesService and VendorBillsService, which compute
 * their lines the same way. */
export function computeLines(lines: InvoiceLineInput[], sameState: boolean): ComputedLine[] {
  return lines.map((line, index) => {
    const quantity = new Prisma.Decimal(line.quantity);
    const unitPrice = new Prisma.Decimal(line.unitPrice);
    if (quantity.lessThanOrEqualTo(0)) throwAppError('VALIDATION_FAILED', 'Quantity must be greater than zero.');
    if (unitPrice.isNegative()) throwAppError('VALIDATION_FAILED', 'Unit price must not be negative.');
    const gstRatePercent = new Prisma.Decimal(line.gstRatePercent);
    if (gstRatePercent.isNegative()) throwAppError('VALIDATION_FAILED', 'GST rate must not be negative.');
    if (!line.description.trim()) throwAppError('VALIDATION_FAILED', 'Each line requires a description.');

    const taxableAmount = quantity.times(unitPrice).toDecimalPlaces(2);
    const component = taxableAmount.times(gstRatePercent).dividedBy(100).toDecimalPlaces(2);
    let cgstAmount = new Prisma.Decimal(0);
    let sgstAmount = new Prisma.Decimal(0);
    let igstAmount = new Prisma.Decimal(0);
    if (sameState) {
      cgstAmount = component;
      sgstAmount = component;
    } else {
      igstAmount = component.times(2);
    }
    const lineTotal = taxableAmount.plus(cgstAmount).plus(sgstAmount).plus(igstAmount);

    return {
      sequence: index + 1,
      description: line.description.trim(),
      sourceEventId: line.sourceEventId ?? null,
      hsnSac: line.hsnSac?.trim() || null,
      quantity,
      unitPrice,
      taxableAmount,
      gstRatePercent,
      cgstAmount,
      sgstAmount,
      igstAmount,
      lineTotal,
    };
  });
}

const summaryInclude = {
  project: true,
  legalEntity: true,
  gstRegistration: true,
  sourceEvent: { include: { milestone: true } },
  sourceInstallment: { include: { milestone: true } },
  capexSources: { include: { sourceEvent: true }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.InvoiceInclude;

const detailInclude = {
  ...summaryInclude,
  lines: { orderBy: { sequence: 'asc' as const } },
  convertedFromInvoice: { select: { id: true, proformaNumber: true } },
  convertedTaxInvoices: { select: { id: true, invoiceNumber: true, status: true }, orderBy: { createdAt: 'desc' as const }, take: 1 },
} satisfies Prisma.InvoiceInclude;

type SummaryRow = Prisma.InvoiceGetPayload<{ include: typeof summaryInclude }>;
type DetailRow = Prisma.InvoiceGetPayload<{ include: typeof detailInclude }>;

function sourceTitle(row: SummaryRow): string {
  if (row.capexSources.length > 1) {
    return row.capexSources.map((source) => `${source.sourceEvent.code} — ${source.sourceEvent.name}`).join(', ');
  }
  if (row.sourceEvent) return `${row.sourceEvent.code} — ${row.sourceEvent.name}`;
  if (row.sourceInstallment) {
    return `${row.sourceInstallment.milestone.name} — Installment ${row.sourceInstallment.sequenceNumber}`;
  }
  return '—';
}

/** A collection only exists for a FINALIZED invoice; drafts, proformas and voids have none. */
function collectionOf(
  row: { status: string; totalAmount: Prisma.Decimal | null },
  inputs: { creditDebitNet: Prisma.Decimal; allocations: CollectionAllocation[] } | undefined,
): InvoiceCollection | null {
  if (row.status !== 'FINALIZED' || !row.totalAmount || !inputs) return null;
  return toCollection(invoiceAmounts(row.totalAmount, inputs.creditDebitNet, inputs.allocations));
}

// Callers on the write paths pass no collection: a just-finalized invoice
// has nothing settled against it yet.
function toSummary(
  row: SummaryRow,
  collection: InvoiceCollection | null = collectionOf(row, { creditDebitNet: new Prisma.Decimal(0), allocations: [] }),
  hasInwardCopy: boolean = false,
): InvoiceSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.project.name,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    gstRegistrationId: row.gstRegistrationId,
    gstRegistrationGstin: row.gstRegistration.gstin,
    paymentAlertId: row.paymentAlertId,
    milestoneType: row.milestoneType,
    sourceEventId: row.sourceEventId,
    sourceInstallmentId: row.sourceInstallmentId,
    sourceTitle: sourceTitle(row),
    status: row.status,
    kind: row.kind,
    invoiceNumber: row.invoiceNumber,
    proformaNumber: row.proformaNumber,
    invoiceDate: row.invoiceDate ? toDateStr(row.invoiceDate) : null,
    dueDate: row.dueDate ? toDateStr(row.dueDate) : null,
    paymentTermsDays: row.paymentTermsDays,
    servicePeriodStart: row.servicePeriodStart ? toDateStr(row.servicePeriodStart) : null,
    servicePeriodEnd: row.servicePeriodEnd ? toDateStr(row.servicePeriodEnd) : null,
    taxableAmount: row.taxableAmount?.toFixed(2) ?? null,
    cgstAmount: row.cgstAmount?.toFixed(2) ?? null,
    sgstAmount: row.sgstAmount?.toFixed(2) ?? null,
    igstAmount: row.igstAmount?.toFixed(2) ?? null,
    totalAmount: row.totalAmount?.toFixed(2) ?? null,
    outstandingAmount: collection?.outstanding ?? null,
    collection,
    hasInwardCopy,
    narrative: row.narrative,
    journalEntryId: row.journalEntryId,
    voidJournalEntryId: row.voidJournalEntryId,
    voidReason: row.voidReason,
    voidedBy: row.voidedBy,
    voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    version: row.version,
  };
}

function toDetail(
  row: DetailRow,
  collection: InvoiceCollection | null,
  receipts: InvoiceReceiptAllocation[],
  hasInwardCopy: boolean,
  previousOpex: { label: string; lines: NonNullable<InvoiceDetail['previousOpexLines']> } | null,
  gap: { over: string | null; under: string | null },
): InvoiceDetail {
  return {
    ...toSummary(row, collection, hasInwardCopy),
    receipts,
    overBilledBy: gap.over,
    underBilledBy: gap.under,
    completesSource: row.completesSource,
    sellerLegalName: row.sellerLegalName,
    sellerPan: row.sellerPan,
    sellerGstin: row.sellerGstin,
    sellerState: row.sellerState,
    sellerAddress: row.sellerAddress,
    buyerName: row.buyerName,
    buyerGstin: row.buyerGstin,
    buyerState: row.buyerState,
    buyerAddress: row.buyerAddress,
    convertedFromInvoiceId: row.convertedFromInvoice?.id ?? null,
    convertedFromProformaNumber: row.convertedFromInvoice?.proformaNumber ?? null,
    convertedToInvoiceId: row.convertedTaxInvoices[0]?.id ?? null,
    convertedToInvoiceNumber: row.convertedTaxInvoices[0]?.invoiceNumber ?? null,
    convertedToStatus: row.convertedTaxInvoices[0]?.status ?? null,
    lines: row.lines.map((l) => ({
      id: l.id,
      sequence: l.sequence,
      description: l.description,
      hsnSac: l.hsnSac,
      sourceEventId: l.sourceEventId,
      quantity: l.quantity.toFixed(2),
      unitPrice: l.unitPrice.toFixed(2),
      taxableAmount: l.taxableAmount.toFixed(2),
      gstRatePercent: l.gstRatePercent.toFixed(2),
      cgstAmount: l.cgstAmount.toFixed(2),
      sgstAmount: l.sgstAmount.toFixed(2),
      igstAmount: l.igstAmount.toFixed(2),
      lineTotal: l.lineTotal.toFixed(2),
    })),
    previousOpexLabel: previousOpex?.label ?? null,
    previousOpexLines: previousOpex?.lines ?? null,
  };
}

@Injectable()
export class InvoicesService implements InvoicePort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
    private readonly projects: ProjectsService,
    private readonly financialYears: FinancialYearService,
    private readonly receipts: ReceiptsService,
  ) {}

  private async generateInvoiceNumber(
    tx: Prisma.TransactionClient,
    organizationId: string,
    gstRegistrationId: string,
    financialYearId: string,
    attempt: number,
  ): Promise<string> {
    const count = await numbersInUse(tx, { organizationId, gstRegistrationId, financialYearId });
    return String(count + 1 + attempt).padStart(4, '0');
  }

  /**
   * Numbers of voided invoices, in the GST registration and financial year
   * that `invoiceDate` would put this draft in, that no other invoice holds
   * now (ADR-163). Empty when that financial year does not exist yet.
   */
  async reusableNumbers(input: { organizationId: string; id: string; invoiceDate: string }): Promise<string[]> {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      select: { gstRegistrationId: true, legalEntityId: true },
    });
    if (!invoice) throwAppError('NOT_FOUND', 'Invoice not found.');
    const date = toDate(input.invoiceDate);
    const financialYear = await this.prisma.client.financialYear.findFirst({
      where: { organizationId: input.organizationId, legalEntityId: invoice.legalEntityId, startDate: { lte: date }, endDate: { gte: date } },
      select: { id: true },
    });
    if (!financialYear) return [];
    const rows = await this.prisma.client.invoice.findMany({
      where: { organizationId: input.organizationId, gstRegistrationId: invoice.gstRegistrationId, financialYearId: financialYear.id, invoiceNumber: { not: null } },
      select: { invoiceNumber: true, status: true },
    });
    const held = new Set(rows.filter((r) => r.status !== 'VOID').map((r) => r.invoiceNumber!.toUpperCase()));
    const voided = rows.filter((r) => r.status === 'VOID' && !held.has(r.invoiceNumber!.toUpperCase())).map((r) => r.invoiceNumber!);
    return [...new Set(voided)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  /** The latest earlier OPEX invoice on this schedule, else the latest other OPEX invoice on the project. */
  private async findPreviousOpexLines(input: {
    organizationId: string;
    projectId: string;
    milestoneId: string | null;
    currentSequence: number | null;
    excludeInstallmentId: string | null;
  }): Promise<{ label: string; lines: NonNullable<InvoiceDraftDefaults['previousOpexLines']> } | null> {
    const exclude = input.excludeInstallmentId ? { sourceInstallmentId: { not: input.excludeInstallmentId } } : {};
    const earlier =
      input.milestoneId && input.currentSequence !== null
        ? await this.prisma.client.invoice.findFirst({
            where: {
              organizationId: input.organizationId,
              projectId: input.projectId,
              milestoneType: 'OPEX',
              status: { notIn: [...SLOT_FREE_STATUSES] },
              ...exclude,
              sourceInstallment: { milestoneId: input.milestoneId, sequenceNumber: { lt: input.currentSequence } },
            },
            include: { lines: { orderBy: { sequence: 'asc' } }, sourceInstallment: true },
            orderBy: { sourceInstallment: { sequenceNumber: 'desc' } },
          })
        : null;
    const row =
      earlier ??
      (await this.prisma.client.invoice.findFirst({
        where: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          milestoneType: 'OPEX',
          status: { notIn: [...SLOT_FREE_STATUSES] },
          ...exclude,
        },
        include: { lines: { orderBy: { sequence: 'asc' } }, sourceInstallment: true },
        orderBy: { createdAt: 'desc' },
      }));
    if (!row || row.lines.length === 0) return null;
    const number = row.invoiceNumber ?? row.proformaNumber;
    const period =
      row.servicePeriodStart && row.servicePeriodEnd
        ? `${toDateStr(row.servicePeriodStart)} – ${toDateStr(row.servicePeriodEnd)}`
        : null;
    const installment = row.sourceInstallment ? `Installment ${row.sourceInstallment.sequenceNumber}` : null;
    const label = [number, period, installment].filter(Boolean).join(' · ') || 'the previous invoice';
    return {
      label,
      lines: row.lines.map((line) => ({
        description: line.description,
        hsnSac: line.hsnSac,
        unitPrice: line.unitPrice.toFixed(2),
        gstRatePercent: line.gstRatePercent.toFixed(2),
      })),
    };
  }

  async getDraftDefaults(input: {
    organizationId: string;
    paymentAlertId: string;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<InvoiceDraftDefaults> {
    const alert = await this.prisma.client.paymentAlert.findFirst({
      where: { id: input.paymentAlertId, organizationId: input.organizationId },
      include: { sourceEvent: { include: { milestone: true } }, sourceInstallment: { include: { milestone: true } } },
    });
    if (!alert) throwAppError('NOT_FOUND', 'Payment alert not found.');
    await this.projects.getDetail({ organizationId: input.organizationId, id: alert.projectId, actorId: input.actorId, canSeeAll: input.canSeeAll });

    const project = await this.prisma.client.project.findFirstOrThrow({
      where: { id: alert.projectId, organizationId: input.organizationId },
      include: { client: { include: { clientProfile: true, state: true } }, legalEntity: { include: { gstRegistrations: { where: { isActive: true, deletedAt: null } } } } },
    });

    let suggestedDescription: string;
    let sourceAmount: Prisma.Decimal;
    let servicePeriodStart: string | null = null;
    let servicePeriodEnd: string | null = null;
    if (alert.sourceEvent) {
      suggestedDescription = `${alert.sourceEvent.code} — ${alert.sourceEvent.name}`;
      sourceAmount = alert.sourceEvent.amount;
    } else if (alert.sourceInstallment) {
      sourceAmount = alert.sourceInstallment.scheduledAmount;
      servicePeriodStart = toDateStr(alert.sourceInstallment.servicePeriodStart);
      servicePeriodEnd = toDateStr(alert.sourceInstallment.servicePeriodEnd);
      // The period sits beside the installment, as it prints on the invoice.
      suggestedDescription = `${alert.sourceInstallment.milestone.name} — Installment ${alert.sourceInstallment.sequenceNumber} (${formatDisplayDate(servicePeriodStart)} to ${formatDisplayDate(servicePeriodEnd)})`;
    } else {
      throwAppError('VALIDATION_FAILED', 'This alert has no linked billing source.');
    }

    const sourceId = (alert.sourceEventId ?? alert.sourceInstallmentId)!;
    const billed = (await loadSourceBilling(this.prisma.client, input.organizationId, [sourceId])).get(sourceId);
    const invoicedAmount = billed?.invoiced ?? new Prisma.Decimal(0);

    const [capexChoices, bankAccounts, previousOpex] = await Promise.all([
      this.listOtherOpenCapex(input.organizationId, alert),
      this.prisma.client.bankAccount.findMany({
        where: { organizationId: input.organizationId, legalEntityId: project.legalEntityId, isActive: true },
        select: { id: true, accountName: true, bankName: true, maskedAccountNumber: true, invoiceAccountNumber: true, ifsc: true },
        orderBy: { accountName: 'asc' },
      }),
      alert.sourceInstallment
        ? this.findPreviousOpexLines({
            organizationId: input.organizationId,
            projectId: alert.projectId,
            milestoneId: alert.sourceInstallment.milestoneId,
            currentSequence: alert.sourceInstallment.sequenceNumber,
            excludeInstallmentId: alert.sourceInstallmentId,
          })
        : Promise.resolve(null),
    ]);

    return {
      paymentAlertId: alert.id,
      sourceEventId: alert.sourceEventId,
      projectId: project.id,
      legalEntityId: project.legalEntityId,
      legalEntityName: project.legalEntity.legalName,
      gstRegistrationOptions: project.legalEntity.gstRegistrations.map((g) => ({ id: g.id, gstin: g.gstin, tradeName: g.tradeName })),
      bankAccountOptions: bankAccounts,
      milestoneType: alert.sourceType === 'CAPEX_EVENT' ? 'CAPEX' : 'OPEX',
      suggestedDescription,
      suggestedTaxableAmount: remainingOf(sourceAmount, billed).toFixed(2),
      sourceAmount: sourceAmount.toFixed(2),
      invoicedAmount: invoicedAmount.toFixed(2),
      servicePeriodStart,
      servicePeriodEnd,
      buyerName: project.client.name,
      buyerGstin: project.client.clientProfile?.gstin ?? null,
      buyerState: project.client.state?.name ?? null,
      buyerAddress: project.client.officeAddress,
      capexChoices,
      previousOpexLabel: previousOpex?.label ?? null,
      previousOpexLines: previousOpex?.lines ?? null,
    };
  }

  /** One active account is used as-is. Several means the creator must pick. None leaves the invoice without a bank block. */
  private async resolveInvoiceBankAccount(
    organizationId: string,
    legalEntityId: string,
    bankAccountId: string | undefined,
  ): Promise<string | null> {
    const accounts = await this.prisma.client.bankAccount.findMany({
      where: { organizationId, legalEntityId, isActive: true },
      select: { id: true },
      orderBy: { accountName: 'asc' },
    });
    if (accounts.length === 0) {
      if (bankAccountId) throwAppError('VALIDATION_FAILED', 'That bank account is not on this legal entity.');
      return null;
    }
    if (accounts.length === 1) {
      const only = accounts[0]!.id;
      if (bankAccountId && bankAccountId !== only) {
        throwAppError('VALIDATION_FAILED', 'That bank account is not on this legal entity.');
      }
      return only;
    }
    if (!bankAccountId) throwAppError('VALIDATION_FAILED', 'Choose the bank account for this invoice.');
    if (!accounts.some((account) => account.id === bankAccountId)) {
      throwAppError('VALIDATION_FAILED', 'That bank account is not on this legal entity.');
    }
    return bankAccountId;
  }

  /** Other open CAPEX alerts on this project that are not already on an invoice. */
  private async listOtherOpenCapex(
    organizationId: string,
    alert: { id: string; projectId: string; sourceType: string },
  ): Promise<InvoiceDraftDefaults['capexChoices']> {
    if (alert.sourceType !== 'CAPEX_EVENT') return [];
    const others = await this.prisma.client.paymentAlert.findMany({
      where: {
        organizationId,
        projectId: alert.projectId,
        sourceType: 'CAPEX_EVENT',
        status: { in: ['OPEN', 'SNOOZED'] },
        id: { not: alert.id },
        sourceEventId: { not: null },
      },
      include: { sourceEvent: true },
      orderBy: { openedAt: 'asc' },
    });
    const eventIds = others.flatMap((row) => (row.sourceEventId ? [row.sourceEventId] : []));
    if (eventIds.length === 0) return [];
    const [openSources, activeHeaders, billed] = await Promise.all([
      this.prisma.client.invoiceCapexSource.findMany({
        where: { sourceEventId: { in: eventIds }, releasedAt: null, finalizedAt: null },
        select: { sourceEventId: true },
      }),
      this.prisma.client.invoice.findMany({
        where: { sourceEventId: { in: eventIds }, status: { in: [...OPEN_STATUSES] } },
        select: { sourceEventId: true },
      }),
      loadSourceBilling(this.prisma.client, organizationId, eventIds),
    ]);
    const busy = new Set([
      ...openSources.map((row) => row.sourceEventId),
      ...activeHeaders.flatMap((row) => (row.sourceEventId ? [row.sourceEventId] : [])),
    ]);
    return others.flatMap((row) => {
      if (!row.sourceEvent || !row.sourceEventId || busy.has(row.sourceEventId)) return [];
      const left = remainingOf(row.sourceEvent.amount, billed.get(row.sourceEventId));
      if (!left.greaterThan(0)) return [];
      return [
        {
          paymentAlertId: row.id,
          sourceEventId: row.sourceEventId,
          description: `${row.sourceEvent.code} — ${row.sourceEvent.name}`,
          taxableAmount: left.toFixed(2),
        },
      ];
    });
  }

  /**
   * Brings each source's alert and installment status in line with what is
   * finalized (ADR-156). A fully invoiced source closes its alert; one with
   * an amount left keeps it open, and a void reopens it. An installment is
   * INVOICED when fully invoiced, INVOICE_DRAFT while an invoice is open,
   * otherwise PLANNED. Skipped and cancelled installments are left alone.
   */
  private async syncSourceState(tx: Prisma.TransactionClient, organizationId: string, sourceIds: string[], closingInvoiceId: string | null): Promise<void> {
    if (sourceIds.length === 0) return;
    const [billed, amounts, alerts, installments] = await Promise.all([
      loadSourceBilling(tx, organizationId, sourceIds),
      loadSourceAmounts(tx, sourceIds),
      tx.paymentAlert.findMany({ where: { organizationId, OR: [{ sourceEventId: { in: sourceIds } }, { sourceInstallmentId: { in: sourceIds } }] } }),
      tx.milestoneInstallment.findMany({ where: { id: { in: sourceIds }, status: { notIn: ['SKIPPED', 'CANCELLED'] } } }),
    ]);
    const fully = (sourceId: string) => {
      const source = amounts.get(sourceId);
      return !!source && !!billed.get(sourceId) && !remainingOf(source.amount, billed.get(sourceId)).greaterThan(0);
    };
    const cleared = { snoozedUntil: null, snoozedAt: null, snoozedBy: null, snoozeNote: null };
    for (const alert of alerts) {
      const sourceId = (alert.sourceEventId ?? alert.sourceInstallmentId)!;
      if (fully(sourceId)) {
        if (alert.status !== 'CLOSED') {
          const invoiceId = closingInvoiceId ?? billed.get(sourceId)!.invoices.at(-1)!.id;
          await tx.paymentAlert.update({ where: { id: alert.id }, data: { status: 'CLOSED', invoiceId, ...cleared, version: { increment: 1 } } });
        }
      } else if (alert.status === 'CLOSED') {
        await tx.paymentAlert.update({ where: { id: alert.id }, data: { status: 'OPEN', invoiceId: null, ...cleared, version: { increment: 1 } } });
      }
    }
    for (const installment of installments) {
      const open = await tx.invoice.count({ where: { sourceInstallmentId: installment.id, status: { in: [...OPEN_STATUSES] } } });
      const status = fully(installment.id) ? 'INVOICED' : open > 0 ? 'INVOICE_DRAFT' : 'PLANNED';
      if (installment.status !== status) await tx.milestoneInstallment.update({ where: { id: installment.id }, data: { status } });
    }
  }

  /** The events or installment this invoice bills, open or finalized. */
  private async sourceIdsOf(db: Prisma.TransactionClient, invoice: { id: string; sourceEventId: string | null; sourceInstallmentId: string | null }): Promise<string[]> {
    if (invoice.sourceInstallmentId) return [invoice.sourceInstallmentId];
    const sources = await db.invoiceCapexSource.findMany({ where: { invoiceId: invoice.id }, select: { sourceEventId: true } });
    return [...new Set([...(invoice.sourceEventId ? [invoice.sourceEventId] : []), ...sources.map((source) => source.sourceEventId)])];
  }

  async createDraftFromAlert(input: {
    organizationId: string;
    paymentAlertId: string;
    gstRegistrationId: string;
    bankAccountId?: string | undefined;
    dueDate: string;
    paymentTermsDays: number | undefined;
    narrative: string | undefined;
    lines: InvoiceLineInput[];
    additionalPaymentAlertIds?: string[];
    kind?: 'REGULAR' | 'PROFORMA';
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<InvoiceSummary> {
    const requestHash = hashRequest({
      paymentAlertId: input.paymentAlertId,
      gstRegistrationId: input.gstRegistrationId,
      bankAccountId: input.bankAccountId ?? null,
      dueDate: input.dueDate,
      paymentTermsDays: input.paymentTermsDays,
      narrative: input.narrative,
      lines: input.lines,
      additionalPaymentAlertIds: input.additionalPaymentAlertIds ?? [],
      kind: input.kind ?? 'REGULAR',
    });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: CREATE_DRAFT_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as InvoiceSummary;
    }

    if (input.lines.length === 0) throwAppError('VALIDATION_FAILED', 'At least one line item is required.');

    const additionalIds = [...new Set(input.additionalPaymentAlertIds ?? [])].filter((id) => id !== input.paymentAlertId);
    const alerts = await this.prisma.client.paymentAlert.findMany({
      where: { id: { in: [input.paymentAlertId, ...additionalIds] }, organizationId: input.organizationId },
      include: { sourceEvent: true },
    });
    const alert = alerts.find((row) => row.id === input.paymentAlertId);
    if (!alert) throwAppError('NOT_FOUND', 'Payment alert not found.');
    if (alerts.length !== additionalIds.length + 1) throwAppError('NOT_FOUND', 'One of the selected payment alerts was not found.');
    if (alerts.some((row) => row.projectId !== alert.projectId)) {
      throwAppError('VALIDATION_FAILED', 'Every event on an invoice must belong to the same project.');
    }
    const isCapex = alert.sourceType === 'CAPEX_EVENT';
    if (!isCapex && additionalIds.length > 0) {
      throwAppError('VALIDATION_FAILED', 'An OPEX invoice covers one installment.');
    }
    if (alerts.some((row) => row.sourceType !== alert.sourceType)) {
      throwAppError('VALIDATION_FAILED', 'CAPEX events and OPEX installments cannot share an invoice.');
    }

    const eventIds = alerts.flatMap((row) => (row.sourceEventId ? [row.sourceEventId] : []));
    if (isCapex && eventIds.length !== alerts.length) throwAppError('VALIDATION_FAILED', 'Each CAPEX alert must name an event.');
    if (new Set(eventIds).size !== eventIds.length) throwAppError('VALIDATION_FAILED', 'The same CAPEX event was selected twice.');

    // Finalized invoices no longer hold the source: it can be billed again
    // until its amount is reached (ADR-156). Only an open one blocks.
    const existingActive = await this.prisma.client.invoice.findFirst({
      where: {
        organizationId: input.organizationId,
        status: { in: [...OPEN_STATUSES] },
        ...(alert.sourceEventId ? { sourceEventId: alert.sourceEventId } : { sourceInstallmentId: alert.sourceInstallmentId }),
      },
    });
    if (existingActive) throwAppError('VALIDATION_FAILED', 'An invoice for this billing event is already open. Finalize or void it first.');
    if (eventIds.length > 0) {
      const taken = await this.prisma.client.invoiceCapexSource.findFirst({
        where: { sourceEventId: { in: eventIds }, releasedAt: null, finalizedAt: null },
      });
      if (taken) throwAppError('VALIDATION_FAILED', 'An invoice for one of these CAPEX events is already open. Finalize or void it first.');
      const takenHeader = await this.prisma.client.invoice.findFirst({
        where: { organizationId: input.organizationId, status: { in: [...OPEN_STATUSES] }, sourceEventId: { in: eventIds } },
      });
      if (takenHeader) throwAppError('VALIDATION_FAILED', 'An invoice for one of these CAPEX events is already open. Finalize or void it first.');
    }
    const sourceIds = isCapex ? eventIds : [alert.sourceInstallmentId!];
    const [billedSoFar, sourceAmounts] = await Promise.all([
      loadSourceBilling(this.prisma.client, input.organizationId, sourceIds),
      loadSourceAmounts(this.prisma.client, sourceIds),
    ]);
    for (const sourceId of sourceIds) {
      const source = sourceAmounts.get(sourceId);
      if (source && !remainingOf(source.amount, billedSoFar.get(sourceId)).greaterThan(0)) {
        throwAppError('INVALID_STATE_TRANSITION', `${source.label} is already fully invoiced.`);
      }
    }
    if (isCapex && eventIds.length > 1) {
      const allowed = new Set(eventIds);
      if (input.lines.some((line) => !line.sourceEventId || !allowed.has(line.sourceEventId))) {
        throwAppError('VALIDATION_FAILED', 'Each line must belong to one of the selected CAPEX events.');
      }
    }

    const project = await this.prisma.client.project.findFirstOrThrow({
      where: { id: alert.projectId, organizationId: input.organizationId },
      include: { client: { include: { state: true } } },
    });
    if (!project.client.stateId) throwAppError('VALIDATION_FAILED', "The client's state must be set to compute GST — set it on the client's address.");

    const gstRegistration = await this.prisma.client.gstRegistration.findFirst({
      where: { id: input.gstRegistrationId, organizationId: input.organizationId, legalEntityId: project.legalEntityId },
    });
    if (!gstRegistration) throwAppError('NOT_FOUND', "GST registration not found for this project's legal entity.");

    const bankAccountId = await this.resolveInvoiceBankAccount(input.organizationId, project.legalEntityId, input.bankAccountId);

    let servicePeriodStart: Date | null = null;
    let servicePeriodEnd: Date | null = null;
    if (alert.sourceInstallmentId) {
      const installment = await this.prisma.client.milestoneInstallment.findFirstOrThrow({ where: { id: alert.sourceInstallmentId } });
      servicePeriodStart = installment.servicePeriodStart;
      servicePeriodEnd = installment.servicePeriodEnd;
    }

    const sameState = project.client.stateId === gstRegistration.stateId;
    const computedLines = computeLines(input.lines, sameState);

    const invoiceId = generateId();
    return await this.prisma.client.$transaction(async (tx) => {
      await tx.invoice.create({
        data: {
          id: invoiceId,
          organizationId: input.organizationId,
          projectId: alert.projectId,
          legalEntityId: project.legalEntityId,
          gstRegistrationId: input.gstRegistrationId,
          bankAccountId,
          paymentAlertId: alert.id,
          milestoneType: alert.sourceType === 'CAPEX_EVENT' ? 'CAPEX' : 'OPEX',
          sourceEventId: alert.sourceEventId,
          sourceInstallmentId: alert.sourceInstallmentId,
          status: 'DRAFT',
          kind: input.kind ?? 'REGULAR',
          dueDate: toDate(input.dueDate),
          paymentTermsDays: input.paymentTermsDays ?? null,
          servicePeriodStart,
          servicePeriodEnd,
          narrative: input.narrative ?? null,
          createdBy: input.actorId,
        },
      });

      if (isCapex) {
        await tx.invoiceCapexSource.createMany({
          data: alerts.flatMap((row) =>
            row.sourceEventId
              ? [
                  {
                    id: generateId(),
                    organizationId: input.organizationId,
                    invoiceId,
                    paymentAlertId: row.id,
                    sourceEventId: row.sourceEventId,
                  },
                ]
              : [],
          ),
        });
      }

      await tx.invoiceLine.createMany({
        data: computedLines.map((l) => ({
          id: generateId(),
          organizationId: input.organizationId,
          invoiceId,
          sequence: l.sequence,
          description: l.description,
          hsnSac: l.hsnSac,
          sourceEventId: l.sourceEventId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxableAmount: l.taxableAmount,
          gstRatePercent: l.gstRatePercent,
          cgstAmount: l.cgstAmount,
          sgstAmount: l.sgstAmount,
          igstAmount: l.igstAmount,
          lineTotal: l.lineTotal,
        })),
      });

      if (alert.sourceInstallmentId) {
        await tx.milestoneInstallment.update({ where: { id: alert.sourceInstallmentId }, data: { status: 'INVOICE_DRAFT' } });
      }

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'INVOICE',
        entityId: invoiceId,
        action: 'INVOICE_DRAFT_CREATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: {
          paymentAlertId: alert.id,
          additionalPaymentAlertIds: additionalIds,
          gstRegistrationId: input.gstRegistrationId,
          lineCount: input.lines.length,
        },
      });

      const created = await tx.invoice.findFirstOrThrow({ where: { id: invoiceId }, include: summaryInclude });
      const summary = toSummary(created);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: CREATE_DRAFT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'INVOICE',
          sourceRecordId: invoiceId,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async updateDraft(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    gstRegistrationId: string | undefined;
    dueDate: string | undefined;
    paymentTermsDays: number | undefined;
    narrative: string | undefined;
    lines: InvoiceLineInput[] | undefined;
    kind?: 'REGULAR' | 'PROFORMA';
    actorId: string;
    correlationId: string;
  }): Promise<InvoiceSummary> {
    const invoice = await this.prisma.client.invoice.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!invoice) throwAppError('NOT_FOUND', 'Invoice not found.');
    if (invoice.status !== 'DRAFT') throwAppError('INVALID_STATE_TRANSITION', 'Only a draft invoice can be updated.');
    if (invoice.convertedFromInvoiceId && input.kind === 'PROFORMA') {
      throwAppError('VALIDATION_FAILED', 'A tax invoice raised from a proforma stays a tax invoice.');
    }

    const gstRegistrationId = input.gstRegistrationId ?? invoice.gstRegistrationId;
    const project = await this.prisma.client.project.findFirstOrThrow({
      where: { id: invoice.projectId, organizationId: input.organizationId },
      include: { client: { include: { state: true } } },
    });
    const gstRegistration = await this.prisma.client.gstRegistration.findFirst({
      where: { id: gstRegistrationId, organizationId: input.organizationId, legalEntityId: project.legalEntityId },
    });
    if (!gstRegistration) throwAppError('NOT_FOUND', "GST registration not found for this project's legal entity.");

    if (input.lines !== undefined && invoice.milestoneType === 'CAPEX') {
      const sources = await this.prisma.client.invoiceCapexSource.findMany({
        where: { invoiceId: invoice.id, releasedAt: null },
      });
      if (sources.length > 1) {
        const allowed = new Set(sources.map((source) => source.sourceEventId));
        if (input.lines.some((line) => !line.sourceEventId || !allowed.has(line.sourceEventId))) {
          throwAppError('VALIDATION_FAILED', 'Each line must belong to one of the selected CAPEX events.');
        }
      }
    }

    // gstRegistrationId sits behind a composite FK (organizationId pair),
    // which Prisma's generated InvoiceUpdateManyMutationInput type
    // excludes entirely — neither a scalar assignment nor a relation
    // `connect` is valid inside updateMany()'s own data shape for it.
    // Handled separately below via a real update() once the version check
    // has already claimed the row. (A real, previously-latent bug: the old
    // `connect` form here compiled fine — a pre-typed variable passed to a
    // narrower parameter type isn't excess-property-checked — but failed
    // at runtime; only Prisma's own runtime validation ever caught it.)
    const data: Prisma.InvoiceUpdateManyMutationInput = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.kind !== undefined) data.kind = input.kind;
    if (input.dueDate !== undefined) data.dueDate = toDate(input.dueDate);
    if (input.paymentTermsDays !== undefined) data.paymentTermsDays = input.paymentTermsDays;
    if (input.narrative !== undefined) data.narrative = input.narrative;

    return await this.prisma.client.$transaction(async (tx) => {
      if (input.lines !== undefined) {
        if (input.lines.length === 0) throwAppError('VALIDATION_FAILED', 'At least one line item is required.');
        if (!project.client.stateId) throwAppError('VALIDATION_FAILED', "The client's state must be set to compute GST.");
        const sameState = project.client.stateId === gstRegistration.stateId;
        const computedLines = computeLines(input.lines, sameState);
        await tx.invoiceLine.deleteMany({ where: { invoiceId: invoice.id } });
        await tx.invoiceLine.createMany({
          data: computedLines.map((l) => ({
            id: generateId(),
            organizationId: input.organizationId,
            invoiceId: invoice.id,
            sequence: l.sequence,
            description: l.description,
            hsnSac: l.hsnSac,
            sourceEventId: l.sourceEventId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            taxableAmount: l.taxableAmount,
            gstRatePercent: l.gstRatePercent,
            cgstAmount: l.cgstAmount,
            sgstAmount: l.sgstAmount,
            igstAmount: l.igstAmount,
            lineTotal: l.lineTotal,
          })),
        });
      }

      const { count } = await tx.invoice.updateMany({ where: { id: invoice.id, version: input.expectedVersion }, data });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This invoice was changed by someone else. Reload and try again.');

      // Safe unconditionally here (no separate version re-check needed):
      // the updateMany() above already atomically claimed this row — its
      // own version-bump took the row lock, which Postgres holds until
      // this transaction commits — so no concurrent writer can have
      // slipped in between.
      if (input.gstRegistrationId !== undefined) {
        await tx.invoice.update({ where: { id: invoice.id }, data: { gstRegistration: { connect: { id: input.gstRegistrationId } } } });
      }

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'INVOICE',
        entityId: invoice.id,
        action: 'INVOICE_UPDATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { gstRegistrationId: input.gstRegistrationId, dueDate: input.dueDate, paymentTermsDays: input.paymentTermsDays },
      });

      const updated = await tx.invoice.findFirstOrThrow({ where: { id: invoice.id }, include: summaryInclude });
      return toSummary(updated);
    });
  }

  /** Gives the proforma a number and freezes the document. Posts nothing. */
  private async issueProforma(
    input: {
      organizationId: string;
      id: string;
      expectedVersion: number;
      invoiceDate: string;
      idempotencyKey: string;
      actorId: string;
      correlationId: string;
    },
    invoice: {
      id: string;
      legalEntityId: string;
      gstRegistrationId: string;
      lines: Array<{ taxableAmount: Prisma.Decimal; cgstAmount: Prisma.Decimal; sgstAmount: Prisma.Decimal; igstAmount: Prisma.Decimal }>;
      legalEntity: { legalName: string; panNumber: string | null; registeredAddress: string | null };
      gstRegistration: { gstin: string; state: { name: string } };
      project: { client: { name: string; officeAddress: string | null; pinCode: string | null; city: { name: string } | null; clientProfile: { gstin: string | null } | null; state: { name: string } | null } };
    },
  ): Promise<InvoiceSummary> {
    if (invoice.lines.length === 0) throwAppError('VALIDATION_FAILED', 'At least one line item is required.');
    const accountingDate = toDate(input.invoiceDate);
    const financialYear = await this.financialYears.findOrCreateCovering({
      organizationId: input.organizationId,
      legalEntityId: invoice.legalEntityId,
      date: input.invoiceDate,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    const taxableAmount = invoice.lines.reduce((sum, l) => sum.plus(l.taxableAmount), new Prisma.Decimal(0));
    const cgstAmount = invoice.lines.reduce((sum, l) => sum.plus(l.cgstAmount), new Prisma.Decimal(0));
    const sgstAmount = invoice.lines.reduce((sum, l) => sum.plus(l.sgstAmount), new Prisma.Decimal(0));
    const igstAmount = invoice.lines.reduce((sum, l) => sum.plus(l.igstAmount), new Prisma.Decimal(0));
    const totalAmount = taxableAmount.plus(cgstAmount).plus(sgstAmount).plus(igstAmount);

    for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          const count = await tx.invoice.count({
            where: { organizationId: input.organizationId, gstRegistrationId: invoice.gstRegistrationId, financialYearId: financialYear.id, proformaNumber: { not: null } },
          });
          const proformaNumber = `PF${String(count + 1 + attempt).padStart(4, '0')}`;
          const { count: updated } = await tx.invoice.updateMany({
            where: { id: invoice.id, status: 'DRAFT', version: input.expectedVersion },
            data: {
              status: 'ISSUED',
              proformaNumber,
              invoiceDate: accountingDate,
              financialYearId: financialYear.id,
              sellerLegalName: invoice.legalEntity.legalName,
              sellerPan: invoice.legalEntity.panNumber,
              sellerGstin: invoice.gstRegistration.gstin,
              sellerState: invoice.gstRegistration.state.name,
              sellerAddress: invoice.legalEntity.registeredAddress,
              buyerName: invoice.project.client.name,
              buyerGstin: invoice.project.client.clientProfile?.gstin ?? null,
              buyerState: invoice.project.client.state?.name ?? null,
              buyerAddress: invoiceBuyerAddress(invoice.project.client),
              taxableAmount,
              cgstAmount,
              sgstAmount,
              igstAmount,
              totalAmount,
              updatedBy: input.actorId,
              version: { increment: 1 },
            },
          });
          if (updated === 0) throwAppError('VERSION_CONFLICT', 'This invoice was changed by someone else. Reload and try again.');

          await recordAuditEvent(tx, {
            organizationId: input.organizationId,
            entityType: 'INVOICE',
            entityId: invoice.id,
            action: 'INVOICE_PROFORMA_ISSUED',
            actorId: input.actorId,
            correlationId: input.correlationId,
            newValues: { proformaNumber, totalAmount: totalAmount.toFixed(2) },
          });

          const updatedRow = await tx.invoice.findFirstOrThrow({ where: { id: invoice.id }, include: summaryInclude });
          const summary = toSummary(updatedRow);
          await tx.idempotencyKey.create({
            data: {
              id: generateId(),
              organizationId: input.organizationId,
              commandType: FINALIZE_COMMAND_TYPE,
              idempotencyKey: input.idempotencyKey,
              requestHash: hashRequest({ id: input.id, invoiceDate: input.invoiceDate }),
              sourceRecordType: 'INVOICE',
              sourceRecordId: invoice.id,
              resultReference: summary as unknown as Prisma.InputJsonValue,
            },
          });
          return summary;
        });
      } catch (error) {
        if (isConstraintViolation(error) && attempt < MAX_NUMBER_ATTEMPTS - 1) continue;
        throw error;
      }
    }
    throw new Error('unreachable');
  }

  async startConversion(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<InvoiceSummary> {
    const requestHash = hashRequest({ id: input.id, expectedVersion: input.expectedVersion });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: START_CONVERSION_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as InvoiceSummary;
    }

    const proforma = await this.prisma.client.invoice.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: { lines: { orderBy: { sequence: 'asc' } }, capexSources: { where: { releasedAt: null } } },
    });
    if (!proforma) throwAppError('NOT_FOUND', 'Invoice not found.');
    if (proforma.lines.length === 0) throwAppError('VALIDATION_FAILED', 'At least one line item is required.');

    const live = await this.prisma.client.invoice.findFirst({
      where: { organizationId: input.organizationId, convertedFromInvoiceId: proforma.id, status: { not: 'VOID' } },
      include: summaryInclude,
    });
    if (live) return toSummary(live);
    if (proforma.status === 'CONVERTED') throwAppError('INVALID_STATE_TRANSITION', 'This proforma was already converted.');
    if (proforma.kind !== 'PROFORMA' || proforma.status !== 'ISSUED') {
      throwAppError('INVALID_STATE_TRANSITION', 'Only an issued proforma can be converted to a tax invoice.');
    }

    const taxInvoiceId = generateId();
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const { count } = await tx.invoice.updateMany({
          where: { id: proforma.id, status: 'ISSUED', version: input.expectedVersion },
          data: { status: 'CONVERTED', updatedBy: input.actorId, version: { increment: 1 } },
        });
        if (count === 0) {
          const raced = await tx.invoice.findFirst({
            where: { organizationId: input.organizationId, convertedFromInvoiceId: proforma.id, status: { not: 'VOID' } },
            include: summaryInclude,
          });
          if (raced) return toSummary(raced);
          throwAppError('VERSION_CONFLICT', 'This proforma was changed by someone else. Reload and try again.');
        }

        await tx.invoice.create({
          data: {
            id: taxInvoiceId,
            organizationId: input.organizationId,
            projectId: proforma.projectId,
            legalEntityId: proforma.legalEntityId,
            gstRegistrationId: proforma.gstRegistrationId,
            bankAccountId: proforma.bankAccountId,
            paymentAlertId: proforma.paymentAlertId,
            milestoneType: proforma.milestoneType,
            sourceEventId: proforma.sourceEventId,
            sourceInstallmentId: proforma.sourceInstallmentId,
            status: 'DRAFT',
            kind: 'REGULAR',
            dueDate: proforma.dueDate,
            paymentTermsDays: proforma.paymentTermsDays,
            servicePeriodStart: proforma.servicePeriodStart,
            servicePeriodEnd: proforma.servicePeriodEnd,
            narrative: proforma.narrative,
            convertedFromInvoiceId: proforma.id,
            createdBy: input.actorId,
          },
        });

        if (proforma.capexSources.length > 0) {
          const releasedAt = new Date();
          await tx.invoiceCapexSource.updateMany({
            where: { id: { in: proforma.capexSources.map((source) => source.id) } },
            data: { releasedAt },
          });
          await tx.invoiceCapexSource.createMany({
            data: proforma.capexSources.map((source) => ({
              id: generateId(),
              organizationId: input.organizationId,
              invoiceId: taxInvoiceId,
              paymentAlertId: source.paymentAlertId,
              sourceEventId: source.sourceEventId,
            })),
          });
        }

        await tx.invoiceLine.createMany({
          data: proforma.lines.map((line) => ({
            id: generateId(),
            organizationId: input.organizationId,
            invoiceId: taxInvoiceId,
            sequence: line.sequence,
            description: line.description,
            hsnSac: line.hsnSac,
            sourceEventId: line.sourceEventId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            taxableAmount: line.taxableAmount,
            gstRatePercent: line.gstRatePercent,
            cgstAmount: line.cgstAmount,
            sgstAmount: line.sgstAmount,
            igstAmount: line.igstAmount,
            lineTotal: line.lineTotal,
          })),
        });

        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'INVOICE',
          entityId: proforma.id,
          action: 'INVOICE_CONVERSION_STARTED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { taxInvoiceId, proformaNumber: proforma.proformaNumber },
        });
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'INVOICE',
          entityId: taxInvoiceId,
          action: 'INVOICE_DRAFT_CREATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { convertedFromInvoiceId: proforma.id, proformaNumber: proforma.proformaNumber },
        });

        const created = await tx.invoice.findFirstOrThrow({ where: { id: taxInvoiceId }, include: summaryInclude });
        const summary = toSummary(created);
        await tx.idempotencyKey.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            commandType: START_CONVERSION_COMMAND_TYPE,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            sourceRecordType: 'INVOICE',
            sourceRecordId: taxInvoiceId,
            resultReference: summary as unknown as Prisma.InputJsonValue,
          },
        });
        return summary;
      });
    } catch (error) {
      if (!isConstraintViolation(error)) throw error;
      const raced = await this.prisma.client.invoice.findFirst({
        where: { organizationId: input.organizationId, convertedFromInvoiceId: proforma.id, status: { not: 'VOID' } },
        include: summaryInclude,
      });
      if (raced) return toSummary(raced);
      throw error;
    }
  }

  async finalize(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    invoiceDate: string;
    invoiceNumber?: string | undefined;
    /** This invoice is the full bill for its source(s) even if it bills less than was left (ADR-167). */
    completesSource?: boolean | undefined;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<InvoiceSummary> {
    const manualNumber = input.invoiceNumber?.trim() || undefined;
    const requestHash = hashRequest({
      id: input.id,
      invoiceDate: input.invoiceDate,
      ...(manualNumber ? { invoiceNumber: manualNumber } : {}),
      ...(input.completesSource ? { completesSource: true } : {}),
    });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: FINALIZE_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as InvoiceSummary;
    }

    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: { lines: true, project: { include: { client: { include: { clientProfile: true, state: true, city: true } } } }, legalEntity: true, gstRegistration: { include: { state: true } } },
    });
    if (!invoice) throwAppError('NOT_FOUND', 'Invoice not found.');
    if (invoice.kind === 'PROFORMA' && invoice.status === 'DRAFT') return this.issueProforma(input, invoice);
    if (invoice.status === 'ISSUED' || invoice.status === 'CONVERTED') {
      throwAppError('INVALID_STATE_TRANSITION', 'An issued proforma stays as issued. Convert it to a tax invoice.');
    }
    if (invoice.status !== 'DRAFT') throwAppError('INVALID_STATE_TRANSITION', 'Only a draft invoice can be finalized.');
    if (invoice.lines.length === 0) throwAppError('VALIDATION_FAILED', 'At least one line item is required.');

    // No cap: an invoice may bill more than its event, installment or
    // milestone amount. The Finalize dialog shows how much more (ADR-165).

    const accountingDate = toDate(input.invoiceDate);
    const financialYear = await this.financialYears.findOrCreateCovering({
      organizationId: input.organizationId,
      legalEntityId: invoice.legalEntityId,
      date: input.invoiceDate,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    if (manualNumber) {
      if (!INVOICE_NUMBER_PATTERN.test(manualNumber)) {
        throwAppError('VALIDATION_FAILED', 'Invoice number can have up to 16 letters, digits, "-" or "/".');
      }
      // Checked before the journal posts: a clash found only at the
      // invoice update would leave a posted journal with no invoice.
      const taken = await this.prisma.client.invoice.findFirst({
        where: {
          organizationId: input.organizationId,
          gstRegistrationId: invoice.gstRegistrationId,
          financialYearId: financialYear.id,
          invoiceNumber: { equals: manualNumber, mode: 'insensitive' },
          // A voided invoice's number may be used again (ADR-163).
          status: { not: 'VOID' },
        },
      });
      if (taken) {
        throwAppError('VALIDATION_FAILED', `Invoice number ${manualNumber} is already used for this GST registration in ${financialYear.label}.`);
      }
    }

    const ledgerAccounts = await this.prisma.client.ledgerAccount.findMany({
      where: { organizationId: input.organizationId, code: { in: Object.values(LEDGER_CODES) } },
    });
    const byCode = new Map(ledgerAccounts.map((a) => [a.code, a]));
    const arAccount = byCode.get(LEDGER_CODES.ar);
    const revenueAccount = byCode.get(LEDGER_CODES.revenue);
    if (!arAccount || !revenueAccount) throwAppError('VALIDATION_FAILED', 'Required ledger accounts (Accounts Receivable / Project Revenue) are not configured.');

    const taxableAmount = invoice.lines.reduce((sum, l) => sum.plus(l.taxableAmount), new Prisma.Decimal(0));
    const cgstAmount = invoice.lines.reduce((sum, l) => sum.plus(l.cgstAmount), new Prisma.Decimal(0));
    const sgstAmount = invoice.lines.reduce((sum, l) => sum.plus(l.sgstAmount), new Prisma.Decimal(0));
    const igstAmount = invoice.lines.reduce((sum, l) => sum.plus(l.igstAmount), new Prisma.Decimal(0));
    const totalAmount = taxableAmount.plus(cgstAmount).plus(sgstAmount).plus(igstAmount);

    if (cgstAmount.greaterThan(0) && !byCode.get(LEDGER_CODES.cgst)) throwAppError('VALIDATION_FAILED', 'Output CGST Payable ledger account is not configured.');
    if (sgstAmount.greaterThan(0) && !byCode.get(LEDGER_CODES.sgst)) throwAppError('VALIDATION_FAILED', 'Output SGST Payable ledger account is not configured.');
    if (igstAmount.greaterThan(0) && !byCode.get(LEDGER_CODES.igst)) throwAppError('VALIDATION_FAILED', 'Output IGST Payable ledger account is not configured.');

    const countSoFar = await numbersInUse(this.prisma.client, { organizationId: input.organizationId, gstRegistrationId: invoice.gstRegistrationId, financialYearId: financialYear.id });
    const previewNumber = String(countSoFar + 1).padStart(4, '0');

    const journalLines = [
      { ledgerAccountId: arAccount.id, debit: totalAmount.toFixed(2), credit: '0', projectId: invoice.projectId, partyId: invoice.project.clientId, employeeId: undefined, gstRegistrationId: invoice.gstRegistrationId, taxCode: undefined, narrative: undefined },
      { ledgerAccountId: revenueAccount.id, debit: '0', credit: taxableAmount.toFixed(2), projectId: invoice.projectId, partyId: undefined, employeeId: undefined, gstRegistrationId: invoice.gstRegistrationId, taxCode: undefined, narrative: undefined },
      ...(cgstAmount.greaterThan(0) ? [{ ledgerAccountId: byCode.get(LEDGER_CODES.cgst)!.id, debit: '0', credit: cgstAmount.toFixed(2), projectId: invoice.projectId, partyId: undefined, employeeId: undefined, gstRegistrationId: invoice.gstRegistrationId, taxCode: 'CGST', narrative: undefined }] : []),
      ...(sgstAmount.greaterThan(0) ? [{ ledgerAccountId: byCode.get(LEDGER_CODES.sgst)!.id, debit: '0', credit: sgstAmount.toFixed(2), projectId: invoice.projectId, partyId: undefined, employeeId: undefined, gstRegistrationId: invoice.gstRegistrationId, taxCode: 'SGST', narrative: undefined }] : []),
      ...(igstAmount.greaterThan(0) ? [{ ledgerAccountId: byCode.get(LEDGER_CODES.igst)!.id, debit: '0', credit: igstAmount.toFixed(2), projectId: invoice.projectId, partyId: undefined, employeeId: undefined, gstRegistrationId: invoice.gstRegistrationId, taxCode: 'IGST', narrative: undefined }] : []),
    ];

    // Journal-first, then the invoice update, mirroring the sequential
    // pattern SecurityInstrumentsService.lodge already established
    // (ADR-066) — postJournal always opens its own top-level transaction,
    // so true single-transaction atomicity across both isn't achievable
    // without touching PostingService itself. A deterministic key derived
    // from this command's own idempotency key keeps retries safe.
    const journal = await this.posting.postJournal({
      organizationId: input.organizationId,
      legalEntityId: invoice.legalEntityId,
      accountingDate: input.invoiceDate,
      sourceType: 'invoice_finalize',
      sourceId: invoice.id,
      postingEvent: 'invoice.finalized',
      description: `Invoice ${manualNumber ?? previewNumber} finalized`,
      lines: journalLines,
      idempotencyKey: `${FINALIZE_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          const invoiceNumber =
            manualNumber ?? (await this.generateInvoiceNumber(tx, input.organizationId, invoice.gstRegistrationId, financialYear.id, attempt));

          const { count } = await tx.invoice.updateMany({
            where: { id: invoice.id, status: invoice.status },
            data: {
              status: 'FINALIZED',
              kind: 'REGULAR',
              invoiceNumber,
              completesSource: input.completesSource === true,
              invoiceDate: accountingDate,
              financialYearId: financialYear.id,
              sellerLegalName: invoice.legalEntity.legalName,
              sellerPan: invoice.legalEntity.panNumber,
              sellerGstin: invoice.gstRegistration.gstin,
              sellerState: invoice.gstRegistration.state.name,
              sellerAddress: invoice.legalEntity.registeredAddress,
              buyerName: invoice.project.client.name,
              buyerGstin: invoice.project.client.clientProfile?.gstin ?? null,
              buyerState: invoice.project.client.state?.name ?? null,
              buyerAddress: invoiceBuyerAddress(invoice.project.client),
              taxableAmount,
              cgstAmount,
              sgstAmount,
              igstAmount,
              totalAmount,
              journalEntryId: journal.id,
              updatedBy: input.actorId,
              version: { increment: 1 },
            },
          });
          if (count === 0) throwAppError('INVALID_STATE_TRANSITION', 'This invoice was already finalized.');

          // The events stay billed by this invoice but are free for the
          // next one. Each alert closes only once its source is fully
          // invoiced (ADR-156); otherwise it stays open for the rest.
          await tx.invoiceCapexSource.updateMany({ where: { invoiceId: invoice.id, releasedAt: null }, data: { finalizedAt: new Date() } });
          await this.syncSourceState(tx, input.organizationId, await this.sourceIdsOf(tx, invoice), invoice.id);

          await recordAuditEvent(tx, {
            organizationId: input.organizationId,
            entityType: 'INVOICE',
            entityId: invoice.id,
            action: 'INVOICE_FINALIZED',
            actorId: input.actorId,
            correlationId: input.correlationId,
            newValues: { invoiceNumber, totalAmount: totalAmount.toFixed(2), journalEntryId: journal.id },
          });

          const updated = await tx.invoice.findFirstOrThrow({ where: { id: invoice.id }, include: summaryInclude });
          const summary = toSummary(updated);

          await tx.idempotencyKey.create({
            data: {
              id: generateId(),
              organizationId: input.organizationId,
              commandType: FINALIZE_COMMAND_TYPE,
              idempotencyKey: input.idempotencyKey,
              requestHash,
              sourceRecordType: 'INVOICE',
              sourceRecordId: invoice.id,
              resultReference: summary as unknown as Prisma.InputJsonValue,
            },
          });

          return summary;
        });
      } catch (error) {
        if (isConstraintViolation(error) && manualNumber) {
          throwAppError('VALIDATION_FAILED', `Invoice number ${manualNumber} is already used for this GST registration in ${financialYear.label}.`);
        }
        if (isConstraintViolation(error) && attempt < MAX_NUMBER_ATTEMPTS - 1) continue;
        throw error;
      }
    }
    throw new Error('unreachable');
  }

  async void(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string | undefined;
    /** Whether the actor holds receipt.reverse; needed when the invoice has posted receipts (ADR-164). */
    canReverseReceipts: boolean;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<InvoiceSummary> {
    const requestHash = hashRequest({ id: input.id, reason: input.reason, accountingDate: input.accountingDate });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: VOID_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as InvoiceSummary;
    }

    const reason = input.reason.trim();
    if (!reason) throwAppError('VALIDATION_FAILED', 'A reason is required to void an invoice.');

    const invoice = await this.prisma.client.invoice.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!invoice) throwAppError('NOT_FOUND', 'Invoice not found.');
    if (invoice.status === 'VOID') throwAppError('INVALID_STATE_TRANSITION', 'This invoice has already been voided.');
    if (invoice.status === 'CONVERTED') {
      throwAppError('INVALID_STATE_TRANSITION', 'This proforma was converted to a tax invoice and stays on record.');
    }
    const restoreProformaId = invoice.status === 'DRAFT' ? invoice.convertedFromInvoiceId : null;

    let voidJournalEntryId: string | null = null;
    if (invoice.status === 'FINALIZED') {
      if (!invoice.journalEntryId) throwAppError('VALIDATION_FAILED', 'This finalized invoice has no journal entry to reverse.');
      if (!input.accountingDate) throwAppError('VALIDATION_FAILED', 'An accounting date is required to void a finalized invoice.');
      await this.reverseReceiptsOf(invoice, { ...input, accountingDate: input.accountingDate, reason });
      const reversal = await this.posting.reverseJournal({
        organizationId: input.organizationId,
        id: invoice.journalEntryId,
        accountingDate: input.accountingDate,
        reason,
        idempotencyKey: `${VOID_COMMAND_TYPE}:${input.idempotencyKey}`,
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
      voidJournalEntryId = reversal.id;
    }

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.invoice.updateMany({
        where: { id: invoice.id, version: input.expectedVersion, status: { not: 'VOID' } },
        data: { status: 'VOID', voidReason: reason, voidedBy: input.actorId, voidedAt: new Date(), voidJournalEntryId, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This invoice was changed by someone else. Reload and try again.');

      const voidedSourceIds = await this.sourceIdsOf(tx, invoice);
      await tx.invoiceCapexSource.updateMany({
        where: { invoiceId: invoice.id, releasedAt: null },
        data: { releasedAt: new Date() },
      });
      if (restoreProformaId) {
        const { count: restored } = await tx.invoice.updateMany({
          where: { id: restoreProformaId, organizationId: input.organizationId, status: 'CONVERTED' },
          data: { status: 'ISSUED', updatedBy: input.actorId, version: { increment: 1 } },
        });
        if (restored !== 1) throwAppError('INVALID_STATE_TRANSITION', 'The proforma could not be restored.');
        const draftSources = await tx.invoiceCapexSource.findMany({ where: { invoiceId: invoice.id }, select: { sourceEventId: true } });
        if (draftSources.length > 0) {
          await tx.invoiceCapexSource.updateMany({
            where: { invoiceId: restoreProformaId, sourceEventId: { in: draftSources.map((source) => source.sourceEventId) } },
            data: { releasedAt: null },
          });
        }
        await tx.invoice.update({ where: { id: invoice.id }, data: { convertedFromInvoiceId: null } });
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'INVOICE',
          entityId: restoreProformaId,
          action: 'INVOICE_PROFORMA_RESTORED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { voidedTaxInvoiceId: invoice.id },
        });
      }
      // A voided finalized invoice gives its amount back, so a closed alert
      // reopens; a voided draft frees the installment for the next one.
      await this.syncSourceState(tx, input.organizationId, voidedSourceIds, null);

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'INVOICE',
        entityId: invoice.id,
        action: 'INVOICE_VOIDED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { voidReason: reason, voidJournalEntryId },
      });

      const updated = await tx.invoice.findFirstOrThrow({ where: { id: invoice.id }, include: summaryInclude });
      const summary = toSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: VOID_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'INVOICE',
          sourceRecordId: invoice.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  /**
   * Marks a finalized invoice as the full bill for its source(s), or undoes
   * that (ADR-167), for an invoice finalized before the question was asked
   * or answered the wrong way. Nothing is posted: it only changes whether
   * more billing is expected, so the installment's status and the alert
   * follow as they would at finalize.
   */
  async setCompletesSource(input: {
    organizationId: string;
    id: string;
    completesSource: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<InvoiceSummary> {
    const invoice = await this.prisma.client.invoice.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!invoice) throwAppError('NOT_FOUND', 'Invoice not found.');
    if (invoice.status !== 'FINALIZED') throwAppError('INVALID_STATE_TRANSITION', 'Only a finalized tax invoice can be marked as the full bill.');
    if (invoice.completesSource === input.completesSource) {
      return toSummary(await this.prisma.client.invoice.findFirstOrThrow({ where: { id: invoice.id }, include: summaryInclude }));
    }
    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.invoice.updateMany({
        where: { id: invoice.id, version: input.expectedVersion, status: 'FINALIZED' },
        data: { completesSource: input.completesSource, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This invoice was changed by someone else. Reload and try again.');
      await this.syncSourceState(tx, input.organizationId, await this.sourceIdsOf(tx, invoice), input.completesSource ? invoice.id : null);
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'INVOICE',
        entityId: invoice.id,
        action: input.completesSource ? 'INVOICE_MARKED_FULL_BILL' : 'INVOICE_FULL_BILL_UNDONE',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { completesSource: invoice.completesSource },
        newValues: { completesSource: input.completesSource },
      });
      return toSummary(await tx.invoice.findFirstOrThrow({ where: { id: invoice.id }, include: summaryInclude }));
    });
  }

  /**
   * Voiding a finalized invoice reverses its posted receipts first (ADR-164),
   * each through ReceiptsService.reverseReceipt on the void's accounting
   * date. Everything is checked before anything is reversed: a receipt that
   * also pays another invoice, or whose hold or retention was released, is
   * left to the user, since reversing it would undo more than this invoice.
   * Retries are safe: each reversal's key comes from the void's own key, and
   * a receipt already reversed is no longer posted.
   */
  private async reverseReceiptsOf(
    invoice: { id: string; organizationId: string; invoiceNumber: string | null },
    input: { accountingDate: string; reason: string; canReverseReceipts: boolean; idempotencyKey: string; actorId: string; correlationId: string },
  ): Promise<void> {
    const receipts = await this.prisma.client.clientReceipt.findMany({
      where: { organizationId: invoice.organizationId, status: 'POSTED', allocations: { some: { invoiceId: invoice.id } } },
      select: {
        id: true,
        version: true,
        receiptDate: true,
        actualAmount: true,
        allocations: { select: { invoiceId: true, invoice: { select: { invoiceNumber: true } }, deductions: { select: { releases: { select: { id: true } } } } } },
      },
      orderBy: { receiptDate: 'asc' },
    });
    if (receipts.length === 0) return;
    const label = (r: (typeof receipts)[number]) => `the receipt of ${formatDisplayDate(toDateStr(r.receiptDate))} (${r.actualAmount.toFixed(2)})`;
    if (!input.canReverseReceipts) {
      throwAppError('FORBIDDEN', 'This invoice has payments recorded. Voiding it reverses them, which needs the permission to reverse receipts.');
    }
    for (const r of receipts) {
      const other = r.allocations.find((a) => a.invoiceId !== invoice.id);
      if (other) {
        throwAppError(
          'INVALID_STATE_TRANSITION',
          `${label(r)} also pays invoice ${other.invoice.invoiceNumber ?? ''}. Reverse that receipt first, record the other invoice's payment again, then void this invoice.`,
        );
      }
      if (r.allocations.some((a) => a.deductions.some((d) => d.releases.length > 0))) {
        throwAppError('INVALID_STATE_TRANSITION', `Hold or retention on ${label(r)} has already been released. Sort that out before voiding this invoice.`);
      }
    }
    for (const r of receipts) {
      await this.receipts.reverseReceipt({
        organizationId: invoice.organizationId,
        id: r.id,
        expectedVersion: r.version,
        reason: `Invoice ${invoice.invoiceNumber ?? ''} voided: ${input.reason}`,
        accountingDate: input.accountingDate,
        idempotencyKey: `${VOID_COMMAND_TYPE}:${input.idempotencyKey}:receipt:${r.id}`,
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    }
  }

  async list(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: InvoiceFilters;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<{ rows: InvoiceSummary[]; total: number }> {
    const where: Prisma.InvoiceWhereInput = { organizationId: input.organizationId };
    if (input.filters.projectId) where.projectId = input.filters.projectId;
    if (input.filters.status) where.status = input.filters.status;
    if (input.filters.legalEntityId) where.legalEntityId = input.filters.legalEntityId;

    if (!input.canSeeAll) {
      const assignedProjects = await this.projects.list({ organizationId: input.organizationId, actorId: input.actorId, canSeeAll: false });
      const assignedProjectIds = assignedProjects.map((p) => p.id);
      where.projectId = input.filters.projectId ? (assignedProjectIds.includes(input.filters.projectId) ? input.filters.projectId : '__none__') : { in: assignedProjectIds };
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where,
        include: summaryInclude,
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.client.invoice.count({ where }),
    ]);

    const money = await this.collectionInputs(
      input.organizationId,
      rows.filter((row) => row.status === 'FINALIZED').map((row) => row.id),
    );

    const inwardCopyInvoiceIds = new Set<string>();
    if (rows.length > 0) {
      const inwardCopyLinks = await this.prisma.client.documentLink.findMany({
        where: {
          organizationId: input.organizationId,
          entityType: 'INVOICE',
          entityId: { in: rows.map((r) => r.id) },
          linkType: INVOICE_INWARD_COPY_LINK_TYPE,
        },
        select: { entityId: true },
        distinct: ['entityId'],
      });
      for (const link of inwardCopyLinks) inwardCopyInvoiceIds.add(link.entityId);
    }

    return {
      rows: rows.map((row) => toSummary(row, collectionOf(row, money.get(row.id)), inwardCopyInvoiceIds.has(row.id))),
      total,
    };
  }

  async getDetail(input: { organizationId: string; id: string; actorId: string; canSeeAll: boolean }): Promise<InvoiceDetail> {
    const row = await this.prisma.client.invoice.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: detailInclude });
    if (!row) throwAppError('NOT_FOUND', 'Invoice not found.');
    await this.projects.getDetail({ organizationId: input.organizationId, id: row.projectId, actorId: input.actorId, canSeeAll: input.canSeeAll });
    const inwardCopyLink = await this.prisma.client.documentLink.findFirst({
      where: { organizationId: input.organizationId, entityType: 'INVOICE', entityId: row.id, linkType: INVOICE_INWARD_COPY_LINK_TYPE },
    });
    const previousOpex =
      row.milestoneType === 'OPEX'
        ? await this.findPreviousOpexLines({
            organizationId: input.organizationId,
            projectId: row.projectId,
            milestoneId: row.sourceInstallment?.milestoneId ?? null,
            currentSequence: row.sourceInstallment?.sequenceNumber ?? null,
            excludeInstallmentId: row.sourceInstallmentId,
          })
        : null;
    const [money, allocations] = await Promise.all([
      this.collectionInputs(input.organizationId, row.status === 'FINALIZED' ? [row.id] : []),
      this.prisma.client.receiptAllocation.findMany({
        where: { invoiceId: row.id, organizationId: input.organizationId },
        include: {
          receipt: true,
          sourceEvent: { select: { name: true } },
          deductions: { include: { penaltyCategory: true, otherLedgerAccount: true, releases: true } },
        },
        orderBy: [{ receipt: { receiptDate: 'desc' } }, { createdAt: 'desc' }],
      }),
    ]);
    const receipts: InvoiceReceiptAllocation[] = allocations.map((a) => ({
      allocationId: a.id,
      receiptId: a.receiptId,
      receiptDate: toDateStr(a.receipt.receiptDate),
      receiptStatus: a.receipt.status,
      utrReference: a.receipt.utrReference,
      sourceEventId: a.sourceEventId,
      sourceEventName: a.sourceEvent?.name ?? null,
      cashAllocated: a.cashAllocated.toFixed(2),
      settledAmount: a.settledAmount.toFixed(2),
      deductions: a.deductions.map(toDeductionSummary),
    }));
    return toDetail(row, collectionOf(row, money.get(row.id)), receipts, !!inwardCopyLink, previousOpex, await this.sourceGap(row));
  }

  /**
   * How a draft compares with what is left on its sources: its taxable total
   * less each source's amount not yet billed by finalized invoices. `over`
   * when it bills more (ADR-165), `under` when it bills less, so Finalize
   * can ask whether it is the full bill (ADR-167). Both null when it bills
   * exactly what is left, or is not a draft.
   */
  private async sourceGap(row: { id: string; organizationId: string; status: string; sourceEventId: string | null; sourceInstallmentId: string | null; lines: Array<{ taxableAmount: Prisma.Decimal }> }): Promise<{ over: string | null; under: string | null }> {
    const none = { over: null, under: null };
    if (row.status !== 'DRAFT') return none;
    const sourceIds = await this.sourceIdsOf(this.prisma.client, row);
    if (sourceIds.length === 0) return none;
    const [billed, amounts] = await Promise.all([
      loadSourceBilling(this.prisma.client, row.organizationId, sourceIds, { excludeInvoiceId: row.id }),
      loadSourceAmounts(this.prisma.client, sourceIds),
    ]);
    const left = sourceIds.reduce((sum, id) => {
      const source = amounts.get(id);
      return source ? sum.plus(remainingOf(source.amount, billed.get(id))) : sum;
    }, new Prisma.Decimal(0));
    const gap = row.lines.reduce((sum, l) => sum.plus(l.taxableAmount), new Prisma.Decimal(0)).minus(left);
    return { over: gap.greaterThan(0) ? gap.toFixed(2) : null, under: gap.isNegative() ? gap.negated().toFixed(2) : null };
  }

  /**
   * What each FINALIZED invoice needs for its collection: allocations on
   * POSTED receipts with their deductions and releases, and the net of its
   * FINALIZED credit/debit notes (debit adds, credit subtracts).
   */
  private async collectionInputs(
    organizationId: string,
    invoiceIds: string[],
  ): Promise<Map<string, { creditDebitNet: Prisma.Decimal; allocations: CollectionAllocation[] }>> {
    const byInvoice = new Map<string, { creditDebitNet: Prisma.Decimal; allocations: CollectionAllocation[] }>();
    if (invoiceIds.length === 0) return byInvoice;
    for (const id of invoiceIds) byInvoice.set(id, { creditDebitNet: new Prisma.Decimal(0), allocations: [] });

    const [allocations, notes] = await Promise.all([
      this.prisma.client.receiptAllocation.findMany({
        where: { invoiceId: { in: invoiceIds }, receipt: { organizationId, status: { not: 'REVERSED' } } },
        select: {
          invoiceId: true,
          sourceEventId: true,
          cashAllocated: true,
          deductions: { select: { type: true, amount: true, releases: { select: { releasedAmount: true } } } },
        },
      }),
      this.prisma.client.creditDebitNote.groupBy({
        by: ['invoiceId', 'type'],
        where: { invoiceId: { in: invoiceIds }, organizationId, status: 'FINALIZED' },
        _sum: { totalAmount: true },
      }),
    ]);
    for (const allocation of allocations) byInvoice.get(allocation.invoiceId)!.allocations.push(allocation);
    for (const note of notes) {
      const amount = note._sum.totalAmount ?? new Prisma.Decimal(0);
      const entry = byInvoice.get(note.invoiceId)!;
      entry.creditDebitNet = entry.creditDebitNet.plus(note.type === 'DEBIT' ? amount : amount.negated());
    }
    return byInvoice;
  }

  async listBySource(input: { organizationId: string; projectId: string; actorId: string; canSeeAll: boolean }): Promise<InvoiceSourceBilling[]> {
    await this.projects.getDetail({ organizationId: input.organizationId, id: input.projectId, actorId: input.actorId, canSeeAll: input.canSeeAll });

    const invoices = await this.prisma.client.invoice.findMany({
      where: { organizationId: input.organizationId, projectId: input.projectId, status: 'FINALIZED' },
      include: {
        capexSources: { select: { sourceEventId: true, releasedAt: true } },
        lines: { select: { sourceEventId: true, taxableAmount: true, lineTotal: true } },
      },
      orderBy: [{ invoiceDate: 'asc' }, { createdAt: 'asc' }],
    });
    const money = await this.collectionInputs(input.organizationId, invoices.map((invoice) => invoice.id));

    const bySource = new Map<string, { billedTaxable: Prisma.Decimal; amounts: CollectionAmounts; invoices: InvoiceSourceBilling['invoices'] }>();
    for (const invoice of invoices) {
      const inputs = money.get(invoice.id)!;
      for (const share of collectionBySource(invoice, inputs.creditDebitNet, inputs.allocations)) {
        const entry = bySource.get(share.sourceId) ?? { billedTaxable: new Prisma.Decimal(0), amounts: emptyAmounts(), invoices: [] };
        entry.billedTaxable = entry.billedTaxable.plus(share.billedTaxable);
        entry.amounts = addAmounts(entry.amounts, share.amounts);
        entry.invoices.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate ? toDateStr(invoice.invoiceDate) : null,
          servicePeriodStart: invoice.servicePeriodStart ? toDateStr(invoice.servicePeriodStart) : null,
          servicePeriodEnd: invoice.servicePeriodEnd ? toDateStr(invoice.servicePeriodEnd) : null,
          billedTaxable: share.billedTaxable.toFixed(2),
          collection: toCollection(share.amounts),
        });
        bySource.set(share.sourceId, entry);
      }
    }
    return [...bySource.entries()].map(([sourceId, entry]) => ({
      sourceId,
      billedTaxable: entry.billedTaxable.toFixed(2),
      collection: toCollection(entry.amounts),
      invoices: entry.invoices,
    }));
  }

  async getPdf(input: { organizationId: string; id: string; actorId: string; canSeeAll: boolean }): Promise<{ filename: string; base64: string }> {
    const detail = await this.getDetail(input);
    const print = await this.prisma.client.invoice.findFirst({
      where: { id: detail.id, organizationId: input.organizationId },
      select: {
        legalEntity: {
          select: {
            registeredAddress: true,
            invoicePlaceOfSupply: true,
            invoiceJurisdiction: true,
            invoiceStateCode: true,
            logoContentType: true,
            logoStorageKey: true,
            logoBytes: true,
            sealContentType: true,
            sealStorageKey: true,
            sealBytes: true,
            authorizedSignContentType: true,
            authorizedSignStorageKey: true,
            authorizedSignBytes: true,
          },
        },
        gstRegistration: { select: { state: { select: { name: true, code: true } } } },
        project: {
          select: {
            name: true,
            client: {
              select: {
                name: true,
                officeAddress: true,
                pinCode: true,
                city: { select: { name: true } },
                clientProfile: { select: { gstin: true } },
                state: { select: { name: true, gstStateCode: true } },
              },
            },
          },
        },
        bankAccount: { select: { bankName: true, accountName: true, maskedAccountNumber: true, invoiceAccountNumber: true, ifsc: true } },
      },
    });
    const client = print?.project.client;
    const buyerGstin = detail.buyerGstin ?? client?.clientProfile?.gstin ?? null;
    // From S3, or the bytes of a row saved before ADR-193.
    const entity = print?.legalEntity;
    const [logo, seal, authorizedSign] = entity
      ? await Promise.all([
          loadBrandingImage(entity.logoContentType, entity.logoStorageKey, entity.logoBytes),
          loadBrandingImage(entity.sealContentType, entity.sealStorageKey, entity.sealBytes),
          loadBrandingImage(entity.authorizedSignContentType, entity.authorizedSignStorageKey, entity.authorizedSignBytes),
        ])
      : [null, null, null];
    const branding = {
      logo: logo?.bytes ?? null,
      seal: seal?.bytes ?? null,
      authorizedSign: authorizedSign?.bytes ?? null,
    };
    const buffer = await renderInvoicePdf({
      documentTitle: detail.status === 'ISSUED' || detail.status === 'CONVERTED' ? 'PROFORMA INVOICE' : 'TAX INVOICE',
      invoiceNumber: detail.invoiceNumber,
      proformaNumber: detail.proformaNumber,
      status: detail.status,
      invoiceDate: detail.invoiceDate,
      dueDate: detail.dueDate,
      servicePeriodStart: detail.servicePeriodStart,
      servicePeriodEnd: detail.servicePeriodEnd,
      sellerLegalName: detail.sellerLegalName ?? detail.legalEntityName,
      sellerPan: detail.sellerPan,
      sellerGstin: detail.sellerGstin ?? detail.gstRegistrationGstin,
      sellerState: detail.sellerState ?? print?.gstRegistration.state.name ?? null,
      sellerStateCode: print?.legalEntity.invoiceStateCode ?? print?.gstRegistration.state.code ?? null,
      sellerAddress: detail.sellerAddress ?? print?.legalEntity.registeredAddress ?? null,
      buyerName: detail.buyerName ?? client?.name ?? detail.projectName,
      buyerGstin,
      buyerState: detail.buyerState ?? client?.state?.name ?? null,
      buyerStateCode: buyerGstin ? buyerGstin.slice(0, 2) : (client?.state?.gstStateCode ?? null),
      buyerAddress: detail.buyerAddress ?? (client ? invoiceBuyerAddress(client) : null),
      placeOfSupply: print?.legalEntity.invoicePlaceOfSupply ?? detail.sellerState ?? print?.gstRegistration.state.name ?? null,
      jurisdiction: print?.legalEntity.invoiceJurisdiction ?? detail.sellerState ?? print?.gstRegistration.state.name ?? null,
      projectName: detail.projectName,
      taxableAmount: detail.taxableAmount ?? '0.00',
      cgstAmount: detail.cgstAmount ?? '0.00',
      sgstAmount: detail.sgstAmount ?? '0.00',
      igstAmount: detail.igstAmount ?? '0.00',
      totalAmount: detail.totalAmount ?? '0.00',
      narrative: detail.narrative,
      lines: detail.lines.map((l) => ({
        description: l.description,
        hsnSac: l.hsnSac,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxableAmount: l.taxableAmount,
        gstRatePercent: l.gstRatePercent,
        cgstAmount: l.cgstAmount,
        sgstAmount: l.sgstAmount,
        igstAmount: l.igstAmount,
        lineTotal: l.lineTotal,
      })),
      ...(branding.logo ? { logo: branding.logo } : {}),
      ...(branding.seal ? { seal: branding.seal } : {}),
      ...(branding.authorizedSign ? { authorizedSign: branding.authorizedSign } : {}),
      ...(print?.bankAccount?.bankName ? { bankName: print.bankAccount.bankName } : {}),
      ...(print?.bankAccount?.accountName ? { bankAccountName: print.bankAccount.accountName } : {}),
      ...(invoiceBankAccountNumber(print?.bankAccount) ? { bankAccountNumber: invoiceBankAccountNumber(print?.bankAccount) } : {}),
      ...(print?.bankAccount?.ifsc ? { bankIfsc: print.bankAccount.ifsc } : {}),
    });
    return { filename: `invoice-${detail.invoiceNumber ?? detail.proformaNumber ?? 'draft'}.pdf`, base64: buffer.toString('base64') };
  }
}
