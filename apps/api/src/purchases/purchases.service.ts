import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { throwAppError } from '@zitaware/contracts';
import type {
  PurchaseEntryInput,
  PurchaseImportChoice,
  PurchaseImportPreview,
  PurchaseImportRow,
  PurchaseList,
  PurchasePayLine,
  PurchasePort,
  PurchaseRow,
  PurchaseStage,
  VendorBillLineInput,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { VendorBillsService } from '../vendor-bills/vendor-bills.service';
import { PaymentRequestsService } from '../payment-requests/payment-requests.service';
import { VendorPaymentsService } from '../vendor-payments/vendor-payments.service';
import { VendorsService } from '../vendors/vendors.service';
import { MastersService } from '../masters/masters.service';
import { decodeImportWorkbook } from '../employees/employee-import';
import { buildPurchaseSample, parsePurchaseWorkbook } from './purchase-import';

const ZERO = () => new Prisma.Decimal(0);
const STAGES: PurchaseStage[] = ['DRAFT', 'WAITING_APPROVAL', 'TO_PAY', 'PART_PAID', 'PAID', 'CLOSED'];
const PAID_DIRECTLY = 'Paid directly from Purchases (ADR-176).';

/** Names compared without case, spaces or punctuation, with "Private"/"Limited" read as "Pvt"/"Ltd". */
function key(value: string): string {
  return value.toLowerCase().replace(/\bprivate\b/g, 'pvt').replace(/\blimited\b/g, 'ltd').replace(/[^a-z0-9]/g, '');
}
const digitsOf = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');

function stageOf(status: string, total: Prisma.Decimal, paid: Prisma.Decimal): PurchaseStage {
  if (status === 'DRAFT') return 'DRAFT';
  if (status === 'SUBMITTED') return 'WAITING_APPROVAL';
  if (status !== 'FINALIZED') return 'CLOSED';
  if (paid.lessThanOrEqualTo(0)) return 'TO_PAY';
  return paid.greaterThanOrEqualTo(total) ? 'PAID' : 'PART_PAID';
}

/** One row of the purchase register, resolved: a bill already paid (ADR-178). */
interface SheetBill {
  rowNumber: number;
  vendorId: string | null;
  newVendor: { name: string; stateId: string } | null;
  /** A category not in Masters, added on import; the line's category id is filled in then. */
  newCategory: string | null;
  legalEntityId: string;
  projectId: string | null;
  gstRegistrationId: string;
  billNumber: string;
  date: string;
  line: VendorBillLineInput & { gstAmount: string; gstSplit: 'CGST_SGST' | 'IGST' };
  total: Prisma.Decimal;
  invoiceLink: string | undefined;
  receipt: string | undefined;
  bankAccountId: string | null;
  cardAccountId: string | null;
  /** Null: approved and left to pay. */
  paymentModeId: string | null;
}

/**
 * Purchases (ADR-176): a vendor bill's whole life on one screen, its stage
 * derived from the bill's status and what has been paid against it, payment
 * straight from an approved bill, and existing bills brought in from Excel.
 * It reuses the bill, payment request and vendor payment services as they
 * are, so the books are written exactly as before.
 */
@Injectable()
export class PurchasesService implements PurchasePort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly vendorBills: VendorBillsService,
    private readonly paymentRequests: PaymentRequestsService,
    private readonly vendorPayments: VendorPaymentsService,
    private readonly vendors: VendorsService,
    private readonly masters: MastersService,
  ) {}

  /** What posted vendor payments have settled on each bill, TDS included. */
  private async settledByBill(billIds: string[]): Promise<Map<string, Prisma.Decimal>> {
    if (billIds.length === 0) return new Map();
    const lines = await this.prisma.client.paymentRequestLine.findMany({
      where: { vendorBillId: { in: billIds } },
      select: { vendorBillId: true, allocations: { where: { payment: { status: 'POSTED' } }, select: { settledAmount: true } } },
    });
    const settled = new Map<string, Prisma.Decimal>();
    for (const line of lines) {
      const sum = line.allocations.reduce((s, a) => s.plus(a.settledAmount), ZERO());
      settled.set(line.vendorBillId, (settled.get(line.vendorBillId) ?? ZERO()).plus(sum));
    }
    return settled;
  }

  async list(input: {
    organizationId: string;
    stage?: PurchaseStage | undefined;
    search?: string | undefined;
    projectId?: string | undefined;
    vendorId?: string | undefined;
    page: number;
    pageSize: number;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<PurchaseList> {
    const where: Prisma.VendorBillWhereInput = { organizationId: input.organizationId };
    if (input.vendorId) where.vendorId = input.vendorId;
    if (input.projectId) where.projectId = input.projectId;
    if (!input.canSeeAll) {
      const assigned = (await this.projects.list({ organizationId: input.organizationId, actorId: input.actorId, canSeeAll: false })).map((p) => p.id);
      where.projectId = input.projectId ? (assigned.includes(input.projectId) ? input.projectId : '__none__') : { in: assigned };
    }
    const search = input.search?.trim();
    if (search) where.OR = [{ vendorBillNumber: { contains: search, mode: 'insensitive' } }, { vendor: { name: { contains: search, mode: 'insensitive' } } }];

    const bills = await this.prisma.client.vendorBill.findMany({
      where,
      select: {
        id: true, vendorId: true, vendorBillNumber: true, vendorBillDate: true, projectId: true, legalEntityId: true, status: true, totalAmount: true, createdBy: true, version: true,
        vendor: { select: { name: true } }, project: { select: { name: true } }, legalEntity: { select: { legalName: true } },
      },
      orderBy: [{ vendorBillDate: 'desc' }, { createdAt: 'desc' }],
    });
    const settled = await this.settledByBill(bills.map((b) => b.id));

    const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<PurchaseStage, number>;
    const all: PurchaseRow[] = bills.map((b) => {
      const total = b.totalAmount ?? ZERO();
      const paid = settled.get(b.id) ?? ZERO();
      const stage = stageOf(b.status, total, paid);
      counts[stage] += 1;
      const due = b.status === 'FINALIZED' ? Prisma.Decimal.max(total.minus(paid), 0) : ZERO();
      return {
        vendorBillId: b.id,
        vendorId: b.vendorId,
        vendorName: b.vendor.name,
        vendorBillNumber: b.vendorBillNumber,
        vendorBillDate: b.vendorBillDate.toISOString().slice(0, 10),
        projectId: b.projectId,
        projectName: b.project?.name ?? null,
        legalEntityId: b.legalEntityId,
        legalEntityName: b.legalEntity.legalName,
        status: b.status,
        stage,
        totalAmount: b.totalAmount ? b.totalAmount.toFixed(2) : null,
        paidAmount: paid.toFixed(2),
        dueAmount: due.toFixed(2),
        createdBy: b.createdBy,
        version: b.version,
      };
    });
    const filtered = input.stage ? all.filter((r) => r.stage === input.stage) : all;
    const start = (input.page - 1) * input.pageSize;
    return { rows: filtered.slice(start, start + input.pageSize), total: filtered.length, counts };
  }

  async pay(input: {
    organizationId: string;
    lines: PurchasePayLine[];
    bankAccountId?: string | undefined;
    cardAccountId?: string | undefined;
    paymentModeId: string;
    paymentDate: string;
    utrReference?: string | undefined;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<{ vendorPaymentId: string; cashPaid: string }> {
    const billIds = input.lines.map((l) => l.vendorBillId);
    if (new Set(billIds).size !== billIds.length) throwAppError('VALIDATION_FAILED', 'A bill appears twice in this payment.');
    const bills = await this.prisma.client.vendorBill.findMany({ where: { id: { in: billIds }, organizationId: input.organizationId } });
    if (bills.length !== billIds.length) throwAppError('NOT_FOUND', 'Vendor bill not found.');
    const vendorIds = new Set(bills.map((b) => b.vendorId));
    const entityIds = new Set(bills.map((b) => b.legalEntityId));
    if (vendorIds.size > 1 || entityIds.size > 1) throwAppError('VALIDATION_FAILED', 'One payment pays one vendor, from one legal entity. Pay the others separately.');
    const settled = await this.settledByBill(billIds);

    // Approved request lines of these bills not yet fully paid are used
    // first (bills requested before ADR-176); the rest gets a new request.
    const openLines = await this.prisma.client.paymentRequestLine.findMany({
      where: { vendorBillId: { in: billIds }, paymentRequest: { status: 'APPROVED' } },
      select: { id: true, vendorBillId: true, requestedAmount: true, allocations: { where: { payment: { status: 'POSTED' } }, select: { settledAmount: true } } },
    });
    const plan: Array<{ vendorBillId: string; lineId: string | null; amount: Prisma.Decimal }> = [];
    for (const line of input.lines) {
      const bill = bills.find((b) => b.id === line.vendorBillId)!;
      if (bill.status !== 'FINALIZED') throwAppError('VALIDATION_FAILED', `Bill ${bill.vendorBillNumber} is not approved yet.`);
      const amount = new Prisma.Decimal(line.amount);
      const tds = new Prisma.Decimal(line.tdsAmount ?? '0');
      const due = (bill.totalAmount ?? ZERO()).minus(settled.get(bill.id) ?? ZERO());
      if (!amount.greaterThan(0)) throwAppError('VALIDATION_FAILED', `Enter the amount to pay on bill ${bill.vendorBillNumber}.`);
      if (amount.greaterThan(due)) throwAppError('VALIDATION_FAILED', `Bill ${bill.vendorBillNumber} has only ${due.toFixed(2)} left to pay.`);
      if (tds.isNegative() || tds.greaterThanOrEqualTo(amount)) throwAppError('VALIDATION_FAILED', `TDS on bill ${bill.vendorBillNumber} must be less than the amount settled.`);
      let left = amount;
      for (const open of openLines.filter((l) => l.vendorBillId === bill.id)) {
        const remaining = open.requestedAmount.minus(open.allocations.reduce((s, a) => s.plus(a.settledAmount), ZERO()));
        if (left.lessThanOrEqualTo(0) || remaining.lessThanOrEqualTo(0)) continue;
        const take = Prisma.Decimal.min(left, remaining);
        plan.push({ vendorBillId: bill.id, lineId: open.id, amount: take });
        left = left.minus(take);
      }
      if (left.greaterThan(0)) plan.push({ vendorBillId: bill.id, lineId: null, amount: left });
    }

    const toRequest = plan.filter((p) => p.lineId === null);
    if (toRequest.length > 0) {
      const bill = bills[0]!;
      const draft = await this.paymentRequests.createDraft({
        organizationId: input.organizationId,
        vendorId: bill.vendorId,
        legalEntityId: bill.legalEntityId,
        requestedPaymentDate: input.paymentDate,
        priority: undefined,
        remarks: PAID_DIRECTLY,
        lines: toRequest.map((p) => ({ vendorBillId: p.vendorBillId, requestedAmount: p.amount.toFixed(2) })),
        idempotencyKey: `${input.idempotencyKey}:request`,
        actorId: input.actorId,
        canSeeAll: input.canSeeAll,
        correlationId: input.correlationId,
      });
      const submitted = await this.paymentRequests.submit({
        organizationId: input.organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: `${input.idempotencyKey}:submit`,
        actorId: input.actorId, canSeeAll: input.canSeeAll, correlationId: input.correlationId,
      });
      // The payer's own approval: posting the payment is the authority here (ADR-176).
      await this.paymentRequests.approve({
        organizationId: input.organizationId, id: submitted.id, expectedVersion: submitted.version, note: PAID_DIRECTLY, idempotencyKey: `${input.idempotencyKey}:approve`,
        actorId: input.actorId, canSeeAll: input.canSeeAll, hasSelfApprovePermission: true, correlationId: input.correlationId,
      });
      const created = await this.prisma.client.paymentRequestLine.findMany({ where: { paymentRequestId: draft.id }, select: { id: true, vendorBillId: true } });
      for (const p of toRequest) p.lineId = created.find((c) => c.vendorBillId === p.vendorBillId)!.id;
    }

    // TDS sits on the first part of each bill large enough to carry it.
    const allocations = plan.map((p) => ({ ...p, tds: ZERO() }));
    for (const line of input.lines) {
      const tds = new Prisma.Decimal(line.tdsAmount ?? '0');
      if (tds.lessThanOrEqualTo(0)) continue;
      const target = allocations.find((a) => a.vendorBillId === line.vendorBillId && a.amount.greaterThan(tds));
      if (!target) throwAppError('VALIDATION_FAILED', 'TDS must be less than the part of the bill it is withheld from.');
      target.tds = tds;
    }
    const cashTotal = allocations.reduce((s, a) => s.plus(a.amount.minus(a.tds)), ZERO());
    const payment = await this.vendorPayments.postVendorPayment({
      organizationId: input.organizationId,
      bankAccountId: input.bankAccountId,
      cardAccountId: input.cardAccountId,
      paymentModeId: input.paymentModeId,
      paymentDate: input.paymentDate,
      utrReference: input.utrReference,
      actualAmount: cashTotal.toFixed(2),
      allocations: allocations.map((a) => ({
        paymentRequestLineId: a.lineId!,
        cashPaid: a.amount.minus(a.tds).toFixed(2),
        deductions: a.tds.greaterThan(0) ? [{ type: 'TDS' as const, amount: a.tds.toFixed(2), ratePercent: undefined, narrative: undefined }] : [],
      })),
      idempotencyKey: `${input.idempotencyKey}:payment`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });
    return { vendorPaymentId: payment.id, cashPaid: cashTotal.toFixed(2) };
  }

  // ------------------------------------------------------------- import

  async downloadImportSample(): Promise<{ filename: string; contentBase64: string }> {
    return { filename: 'purchase-register-import-sample.xlsx', contentBase64: (await buildPurchaseSample()).toString('base64') };
  }

  async previewImport(input: { organizationId: string; contentBase64: string; choices?: PurchaseImportChoice[] | undefined; actorId: string; canSeeAll: boolean }): Promise<PurchaseImportPreview> {
    return (await this.loadImport(input.organizationId, input.contentBase64, input.choices ?? [], input.actorId, input.canSeeAll)).preview;
  }

  /** Each row becomes an approved bill, then paid on its date from the card or account given (ADR-178). */
  async importRows(input: {
    organizationId: string;
    contentBase64: string;
    choices?: PurchaseImportChoice[] | undefined;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<{ bills: number; vendorsCreated: number; categoriesCreated: number }> {
    const { preview, bills } = await this.loadImport(input.organizationId, input.contentBase64, input.choices ?? [], input.actorId, input.canSeeAll);
    if (preview.rows.length === 0) throwAppError('VALIDATION_FAILED', 'The sheet has no rows to import.');
    const blocked = preview.rows.find((r) => r.errors.length > 0);
    if (blocked) throwAppError('VALIDATION_FAILED', `Row ${blocked.rowNumber}: ${blocked.errors[0]} Fix the rows marked in the preview before importing.`);

    const posted = await this.postBills(bills, { ...input, note: 'Imported from the purchase register (ADR-178).' });
    return { bills: bills.length, vendorsCreated: posted.vendorsCreated, categoriesCreated: posted.categoriesCreated };
  }

  /** One bill entered as a register row (ADR-181): checked as an imported row is, then posted the same way. */
  async addEntry(input: { organizationId: string; entry: PurchaseEntryInput; idempotencyKey: string; actorId: string; canSeeAll: boolean; correlationId: string }): Promise<{ vendorBillId: string; paid: boolean; categoryCreated: boolean }> {
    const { organizationId, entry } = input;
    const db = this.prisma.client;
    const fail = (message: string): never => throwAppError('VALIDATION_FAILED', message);

    const entity = await db.legalEntity.findFirst({ where: { id: entry.legalEntityId, organizationId, deletedAt: null }, select: { id: true, legalName: true, isActive: true } });
    if (!entity) fail('Choose the company (legal entity).');
    if (!entity!.isActive) fail(`Company "${entity!.legalName}" is inactive.`);
    const registration = await db.gstRegistration.findFirst({ where: { organizationId, legalEntityId: entity!.id, deletedAt: null }, select: { id: true, stateId: true } });
    if (!registration) fail(`${entity!.legalName} has no GST registration.`);

    const vendor = await db.party.findFirst({
      where: { id: entry.vendorId, organizationId, deletedAt: null, vendorProfile: { isNot: null } },
      select: { name: true, isActive: true, stateId: true, vendorProfile: { select: { isActive: true } } },
    });
    if (!vendor) fail('Choose the supplier.');
    if (!vendor!.isActive || vendor!.vendorProfile?.isActive === false) fail(`Vendor "${vendor!.name}" is inactive.`);
    if (!vendor!.stateId && !entry.gstSplit) fail(`Vendor "${vendor!.name}" has no state; set it in Vendors or choose the GST type.`);

    if (entry.projectId) {
      const project = await db.project.findFirst({ where: { id: entry.projectId, organizationId }, select: { name: true, legalEntityId: true } });
      if (!project) fail('That project was not found.');
      if (project!.legalEntityId !== entity!.id) fail(`Project "${project!.name}" belongs to another company, not ${entity!.legalName}.`);
    }

    // Category: the one chosen, else the name matched to Masters (ignoring case and spaces) or added, else the default (ADR-180).
    const categories = await db.expenseCategory.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, code: true, name: true, isActive: true } });
    const categoryName = entry.categoryName?.replace(/\s+/g, ' ').trim();
    const category = entry.expenseCategoryId
      ? categories.find((c) => c.id === entry.expenseCategoryId)
      : categoryName
        ? categories.find((c) => key(c.name) === key(categoryName) || key(c.code) === key(categoryName))
        : categories.find((c) => c.code === 'office_administrative');
    if (entry.expenseCategoryId && !category) fail('That category was not found.');
    if (!entry.expenseCategoryId && !categoryName && !category) fail('Choose a category: no default category (Office / Administrative) is set up.');
    if (category && !category.isActive) fail(`Category "${category.name}" is inactive.`);
    const newCategory = !category && categoryName ? categoryName : null;

    const unit = (await db.unitOfMeasure.findFirst({ where: { organizationId, code: 'qty' }, select: { id: true } })) ?? (await db.unitOfMeasure.findFirst({ where: { organizationId }, select: { id: true } }));
    if (!unit) fail('No unit of measure is set up.');

    // Amounts, as the import reads them: GST is what the total has over Amount + Other Charges.
    const amount = new Prisma.Decimal(entry.amount);
    const taxable = amount.plus(entry.otherCharges || '0');
    const total = new Prisma.Decimal(entry.totalAmount);
    if (!amount.greaterThan(0)) fail('Amount must be more than zero.');
    if (total.lessThan(taxable)) fail(`Amount With GST ${total.toFixed(2)} is less than Amount + Other Charges (${taxable.toFixed(2)}).`);
    const gst = total.minus(taxable);
    if (gst.greaterThan(taxable.times(0.28))) fail(`The GST (${gst.toFixed(2)}) is more than 28% of the amount; check Amount and Amount With GST.`);
    const gstSplit = entry.gstSplit ?? (vendor!.stateId === registration!.stateId ? 'CGST_SGST' : 'IGST');

    // Payment: optional; when given, from a bank account of the company or one of its cards.
    let bankAccountId: string | null = null;
    let cardAccountId: string | null = null;
    if (entry.paymentModeId) {
      const mode = await db.paymentMode.findFirst({ where: { id: entry.paymentModeId, isActive: true }, select: { code: true, requiresCardSource: true } });
      if (!mode) fail('That payment mode was not found.');
      if (mode!.requiresCardSource) {
        const card = entry.cardAccountId
          ? await db.cardAccount.findFirst({ where: { id: entry.cardAccountId, organizationId, isActive: true }, select: { legalEntityId: true, type: true, maskedLastFour: true, bankAccountId: true, ledgerAccountId: true } })
          : null;
        if (!card) fail('Choose the card it was paid by.');
        if (card!.legalEntityId !== entity!.id || card!.type !== mode!.code) fail(`That card is not a ${mode!.code === 'CREDIT_CARD' ? 'credit' : 'debit'} card of ${entity!.legalName}.`);
        if (mode!.code === 'CREDIT_CARD') {
          if (!card!.ledgerAccountId) fail(`The credit card ending ${card!.maskedLastFour} has no payable ledger.`);
          cardAccountId = entry.cardAccountId!;
        } else {
          if (!card!.bankAccountId) fail(`The debit card ending ${card!.maskedLastFour} has no linked bank account.`);
          bankAccountId = card!.bankAccountId;
        }
      } else {
        const bank = entry.bankAccountId ? await db.bankAccount.findFirst({ where: { id: entry.bankAccountId, organizationId, isActive: true }, select: { legalEntityId: true } }) : null;
        if (!bank) fail('Choose the bank account it was paid from.');
        if (bank!.legalEntityId !== entity!.id) fail(`That bank account is not ${entity!.legalName}'s.`);
        bankAccountId = entry.bankAccountId!;
      }
    }

    const details = entry.details.trim();
    const fingerprint = createHash('sha1').update([key(vendor!.name), entry.date, key(details), total.toFixed(2)].join('|')).digest('hex').slice(0, 6).toUpperCase();
    const billNumber = entry.billNumber?.trim() || `REG-${entry.date.replace(/-/g, '')}-${fingerprint}`;
    const bill: SheetBill = {
      rowNumber: 1,
      vendorId: entry.vendorId,
      newVendor: null,
      newCategory,
      legalEntityId: entity!.id,
      projectId: entry.projectId ?? null,
      gstRegistrationId: registration!.id,
      billNumber,
      date: entry.date,
      line: {
        description: entry.paidBy?.trim() ? `${details}${details.endsWith('.') ? '' : '.'} Paid by ${entry.paidBy.trim()}.` : details,
        expenseCategoryId: category?.id,
        inventoryItemId: undefined,
        unitOfMeasureId: unit!.id,
        hsnSac: undefined,
        quantity: '1',
        unitPrice: taxable.toFixed(2),
        gstRatePercent: taxable.greaterThan(0) ? gst.times(50).dividedBy(taxable).toDecimalPlaces(2).toFixed(2) : '0',
        itcEligible: true,
        gstAmount: gst.toFixed(2),
        gstSplit,
      },
      total,
      invoiceLink: entry.invoiceLink?.trim() || undefined,
      receipt: entry.paymentReceiptLink?.trim() || undefined,
      bankAccountId,
      cardAccountId,
      paymentModeId: entry.paymentModeId ?? null,
    };
    const posted = await this.postBills([bill], { ...input, note: 'Entered on Purchases as a register row (ADR-181).' });
    return { vendorBillId: posted.billIds[0]!, paid: !!bill.paymentModeId, categoryCreated: posted.categoriesCreated > 0 };
  }

  /**
   * Posts resolved register rows: adds any new category and vendor (once
   * each), then each bill is drafted, submitted and approved, and paid on its
   * date when a payment mode is given. Every step is keyed, so a retry
   * repeats nothing.
   */
  private async postBills(
    bills: SheetBill[],
    input: { organizationId: string; idempotencyKey: string; note: string; actorId: string; canSeeAll: boolean; correlationId: string },
  ): Promise<{ billIds: string[]; vendorsCreated: number; categoriesCreated: number }> {
    const billIds: string[] = [];
    const createdVendors = new Map<string, string>();
    const createdCategories = new Map<string, string>();
    const takenCodes = new Set((await this.prisma.client.expenseCategory.findMany({ where: { organizationId: input.organizationId }, select: { code: true } })).map((c) => c.code));
    for (const bill of bills) {
      let expenseCategoryId = bill.line.expenseCategoryId;
      if (bill.newCategory) {
        const categoryKey = key(bill.newCategory);
        expenseCategoryId = createdCategories.get(categoryKey) ?? (await this.prisma.client.expenseCategory.findFirst({ where: { organizationId: input.organizationId, deletedAt: null, name: { equals: bill.newCategory, mode: 'insensitive' } }, select: { id: true } }))?.id;
        if (!expenseCategoryId) {
          // Books to Other Expenses until a ledger is set on it in Masters.
          const base = bill.newCategory.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'category';
          let code = base;
          for (let n = 2; takenCodes.has(code); n += 1) code = `${base}_${n}`;
          takenCodes.add(code);
          const created = await this.masters.create({
            organizationId: input.organizationId, type: 'expense_categories', code, name: bill.newCategory,
            description: 'Added from Purchases (ADR-180).', sortOrder: undefined, actorId: input.actorId, correlationId: input.correlationId,
          });
          expenseCategoryId = created.id;
          createdCategories.set(categoryKey, expenseCategoryId);
        }
      }
      let vendorId = bill.vendorId;
      if (!vendorId && bill.newVendor) {
        const vendorKey = key(bill.newVendor.name);
        vendorId = createdVendors.get(vendorKey) ?? null;
        if (!vendorId) {
          const vendor = await this.vendors.create({
            organizationId: input.organizationId, existingPartyId: undefined, name: bill.newVendor.name, shortCode: undefined, gstin: undefined, panNumber: undefined,
            paymentTerms: undefined, stateId: bill.newVendor.stateId, districtId: undefined, cityId: undefined, pinCode: undefined, officeAddress: undefined,
            internalNote: 'Added by the purchase register import (ADR-178).', actorId: input.actorId, correlationId: input.correlationId,
          });
          vendorId = vendor.id;
          createdVendors.set(vendorKey, vendorId);
        }
      }
      const billKey = `${input.idempotencyKey}:${bill.rowNumber}`;
      const draft = await this.vendorBills.createDraft({
        organizationId: input.organizationId, projectId: bill.projectId ?? undefined, legalEntityId: bill.legalEntityId, vendorId: vendorId!, priority: undefined,
        gstRegistrationId: bill.gstRegistrationId, vendorBillNumber: bill.billNumber, vendorBillDate: bill.date, lines: [{ ...bill.line, expenseCategoryId }],
        billUrl: bill.invoiceLink, paymentReceiptUrl: bill.receipt, idempotencyKey: `${billKey}:draft`,
        actorId: input.actorId, canSeeAll: input.canSeeAll, correlationId: input.correlationId,
      });
      if (draft.status === 'DRAFT') {
        const submitted = await this.vendorBills.submit({
          organizationId: input.organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: `${billKey}:submit`, actorId: input.actorId, canSeeAll: input.canSeeAll, correlationId: input.correlationId,
        });
        await this.vendorBills.approve({
          organizationId: input.organizationId, id: submitted.id, expectedVersion: submitted.version, note: input.note, idempotencyKey: `${billKey}:approve`,
          actorId: input.actorId, canSeeAll: input.canSeeAll, hasSelfApprovePermission: true, correlationId: input.correlationId,
        });
      }
      billIds.push(draft.id);
      if (!bill.paymentModeId) continue;
      const approved = await this.prisma.client.vendorBill.findUniqueOrThrow({ where: { id: draft.id }, select: { totalAmount: true } });
      // A retry after the payment went through finds nothing left to pay.
      const settled = (await this.settledByBill([draft.id])).get(draft.id) ?? ZERO();
      if (settled.greaterThanOrEqualTo(approved.totalAmount ?? bill.total)) continue;
      await this.pay({
        organizationId: input.organizationId,
        lines: [{ vendorBillId: draft.id, amount: (approved.totalAmount ?? bill.total).toFixed(2) }],
        bankAccountId: bill.bankAccountId ?? undefined, cardAccountId: bill.cardAccountId ?? undefined, paymentModeId: bill.paymentModeId, paymentDate: bill.date, utrReference: undefined,
        idempotencyKey: `${billKey}:pay`, actorId: input.actorId, canSeeAll: input.canSeeAll, correlationId: input.correlationId,
      });
    }
    return { billIds, vendorsCreated: createdVendors.size, categoriesCreated: createdCategories.size };
  }

  private async loadImport(
    organizationId: string,
    contentBase64: string,
    choices: PurchaseImportChoice[],
    actorId: string,
    canSeeAll: boolean,
  ): Promise<{ preview: PurchaseImportPreview; bills: SheetBill[] }> {
    const chosenSplit = new Map(choices.map((c) => [c.rowNumber, c.gstSplit]));
    let buffer: Buffer;
    try {
      buffer = decodeImportWorkbook(contentBase64);
    } catch (error) {
      throwAppError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Choose an Excel file.');
    }
    const parsed = await parsePurchaseWorkbook(buffer);
    if (!parsed.ok) throwAppError('VALIDATION_FAILED', parsed.message);

    const db = this.prisma.client;
    const [vendors, legalEntities, projects, gstRegistrations, categories, units, bankAccounts, cards, paymentModes] = await Promise.all([
      db.party.findMany({ where: { organizationId, deletedAt: null, vendorProfile: { isNot: null } }, select: { id: true, name: true, isActive: true, stateId: true, vendorProfile: { select: { isActive: true } } } }),
      db.legalEntity.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, legalName: true, isActive: true } }),
      canSeeAll
        ? db.project.findMany({ where: { organizationId }, select: { id: true, name: true, legalEntityId: true } })
        : this.projects.list({ organizationId, actorId, canSeeAll: false }).then((rows) => rows.map((p) => ({ id: p.id, name: p.name, legalEntityId: p.legalEntityId }))),
      db.gstRegistration.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, legalEntityId: true, stateId: true } }),
      db.expenseCategory.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, code: true, name: true, isActive: true } }),
      db.unitOfMeasure.findMany({ where: { organizationId }, select: { id: true, code: true } }),
      db.bankAccount.findMany({ where: { organizationId, isActive: true }, select: { id: true, legalEntityId: true, accountName: true, maskedAccountNumber: true, invoiceAccountNumber: true } }),
      db.cardAccount.findMany({ where: { organizationId, isActive: true }, select: { id: true, legalEntityId: true, type: true, displayName: true, maskedLastFour: true, bankAccountId: true, ledgerAccountId: true } }),
      db.paymentMode.findMany({ where: { isActive: true }, select: { id: true, code: true, label: true, requiresCardSource: true } }),
    ]);
    const unit = units.find((u) => u.code === 'qty') ?? units[0];
    const defaultCategory = categories.find((c) => c.code === 'office_administrative');
    const nameHint = (written: string, names: string[]) => {
      const target = key(written);
      const near = names.find((n) => key(n).includes(target) || target.includes(key(n)));
      return near ? ` Did you mean "${near}"?` : '';
    };

    const previewRows: PurchaseImportRow[] = [];
    const bills: SheetBill[] = [];
    const newVendorKeys = new Set<string>();
    const newCategoryKeys = new Set<string>();
    const billNumbers = new Map<string, number>();
    let total = ZERO();
    for (const row of parsed.rows) {
      const errors = [...row.errors];

      // Company -> legal entity, and its GST registration.
      const entityMatches = row.company ? legalEntities.filter((l) => key(l.legalName) === key(row.company)) : [];
      const entity = entityMatches.length === 1 ? entityMatches[0] : undefined;
      if (row.company && !entity) errors.push(`Company "${row.company}" is not in Legal Entities.${nameHint(row.company, legalEntities.map((l) => l.legalName))}`);
      else if (entity && !entity.isActive) errors.push(`Company "${entity.legalName}" is inactive.`);
      const registrations = entity ? gstRegistrations.filter((g) => g.legalEntityId === entity.id) : [];
      if (entity && registrations.length === 0) errors.push(`${entity.legalName} has no GST registration.`);

      // Project: optional; blank is company overhead.
      const project = row.project ? projects.find((p) => key(p.name) === key(row.project)) : undefined;
      if (row.project && !project) errors.push(`Project "${row.project}" is not in Projects (or not one you can see).${nameHint(row.project, projects.map((p) => p.name))}`);
      else if (project && entity && project.legalEntityId !== entity.id) errors.push(`Project "${project.name}" belongs to another company, not ${entity.legalName}.`);
      const registration = registrations.length > 0 ? registrations[0] : undefined;

      // Supplier -> vendor; one not found is added in the company's state.
      const vendorMatches = row.supplier ? vendors.filter((v) => key(v.name) === key(row.supplier)) : [];
      let vendorId: string | null = null;
      let vendorStateId: string | null = null;
      if (vendorMatches.length > 1) errors.push(`Supplier "${row.supplier}" matches more than one vendor.`);
      else if (vendorMatches.length === 1) {
        const v = vendorMatches[0]!;
        if (!v.isActive || v.vendorProfile?.isActive === false) errors.push(`Vendor "${v.name}" is inactive.`);
        vendorId = v.id;
        vendorStateId = v.stateId ?? registration?.stateId ?? null;
        if (!v.stateId) errors.push(`Vendor "${v.name}" has no state; set it in Vendors (needed for the GST split).`);
      } else if (row.supplier && registration) {
        vendorStateId = registration.stateId;
        if (!newVendorKeys.has(key(row.supplier))) newVendorKeys.add(key(row.supplier));
      }

      // Category: from Masters (ignoring case and spaces), added when not found (ADR-180), or the default when blank.
      const category = row.category ? categories.find((c) => key(c.name) === key(row.category) || key(c.code) === key(row.category)) : defaultCategory;
      const newCategory = row.category && !category ? row.category : null;
      if (newCategory) newCategoryKeys.add(key(newCategory));
      if (!row.category && !category) errors.push('Category is blank and no default category (Office / Administrative) is set up.');
      else if (category && !category.isActive) errors.push(`Category "${category.name}" is inactive.`);
      if (!unit) errors.push('No unit of measure is set up.');

      // Payment mode, and the card or account it was paid from.
      const writtenMode = key(row.mode);
      const modeKey = ['neft', 'rtgs', 'neftrtgs', 'imps'].includes(writtenMode) ? 'banktransfer' : writtenMode;
      const mode = row.mode ? paymentModes.find((m) => key(m.label) === modeKey || key(m.code) === modeKey) : undefined;
      if (row.mode && !mode) errors.push(`Payment Mode "${row.mode}" is not one of: ${paymentModes.map((m) => m.label).join(', ')}.`);
      let bankAccountId: string | null = null;
      let cardAccountId: string | null = null;
      let paymentSourceLabel: string | null = null;
      if (mode && entity && row.account) {
        const digits = digitsOf(row.account);
        if (mode.requiresCardSource) {
          // A debit card pays from its bank account; a credit card's payable takes the debt (ADR-179).
          const credit = mode.code === 'CREDIT_CARD';
          const kind = credit ? 'credit card' : 'debit card';
          const matches = cards.filter((c) => c.legalEntityId === entity.id && c.type === (credit ? 'CREDIT_CARD' : 'DEBIT_CARD') && digits.length >= 4 && c.maskedLastFour === digits.slice(-4));
          if (matches.length !== 1) errors.push(matches.length === 0 ? `No ${kind} ending ${digits.slice(-4) || row.account} for ${entity.legalName} in Card Accounts.` : `More than one ${kind} ends in ${digits.slice(-4)}.`);
          else if (credit && !matches[0]!.ledgerAccountId) errors.push(`The credit card ending ${matches[0]!.maskedLastFour} has no payable ledger.`);
          else if (!credit && !matches[0]!.bankAccountId) errors.push(`The debit card ending ${matches[0]!.maskedLastFour} has no linked bank account.`);
          else {
            if (credit) cardAccountId = matches[0]!.id;
            else bankAccountId = matches[0]!.bankAccountId;
            paymentSourceLabel = `${matches[0]!.displayName.trim()} •••• ${matches[0]!.maskedLastFour}`;
          }
        } else {
          const own = bankAccounts.filter((b) => b.legalEntityId === entity.id);
          const matches = own.filter(
            (b) => key(b.accountName) === key(row.account) || (digits.length >= 4 && [b.maskedAccountNumber, b.invoiceAccountNumber].some((n) => digitsOf(n).length >= 4 && digitsOf(n).slice(-4) === digits.slice(-4))),
          );
          if (matches.length === 0) errors.push(`No bank account "${row.account}" for ${entity.legalName} in Bank Accounts.`);
          else if (matches.length > 1) errors.push(`"${row.account}" matches more than one bank account; use its last four digits or its name.`);
          else {
            bankAccountId = matches[0]!.id;
            paymentSourceLabel = matches[0]!.accountName;
          }
        }
      }

      // Amounts: GST is what the total has over Amount + Other Charges.
      const taxable = row.amount ? row.amount.plus(row.otherCharges) : null;
      const gst = taxable && row.total ? row.total.minus(taxable) : null;
      const sameState = !!vendorStateId && vendorStateId === registration?.stateId;
      const gstSplit = chosenSplit.get(row.rowNumber) ?? (sameState ? 'CGST_SGST' : 'IGST');

      // The sheet has no bill number: one is made from the row, so the same row imported twice is caught.
      const fingerprint = createHash('sha1').update([key(row.supplier), row.date, key(row.details), row.total?.toFixed(2)].join('|')).digest('hex').slice(0, 6).toUpperCase();
      const billNumber = row.billNo || `REG-${(row.date ?? '').replace(/-/g, '')}-${fingerprint}`;
      const seenAt = billNumbers.get(`${key(row.supplier)}|${billNumber}`);
      if (seenAt) errors.push(`Same bill as row ${seenAt}.`);
      else billNumbers.set(`${key(row.supplier)}|${billNumber}`, row.rowNumber);
      if (vendorId) {
        const existing = await db.vendorBill.findFirst({ where: { organizationId, vendorId, vendorBillNumber: billNumber, status: { notIn: ['VOID', 'CANCELLED'] } }, select: { id: true } });
        if (existing) errors.push('This bill is already recorded (same supplier, date, details and amount).');
      }

      const details = row.paidBy ? `${row.details}${row.details.endsWith('.') ? '' : '.'} Paid by ${row.paidBy}.` : row.details;
      previewRows.push({
        rowNumber: row.rowNumber,
        date: row.date,
        details: row.details,
        supplier: row.supplier,
        vendorId,
        vendorIsNew: !vendorId && !!row.supplier,
        legalEntityName: entity?.legalName ?? (row.company || null),
        projectName: project?.name ?? (row.project || null),
        categoryName: category?.name ?? (row.category || null),
        categoryIsNew: !!newCategory,
        taxableAmount: taxable ? taxable.toFixed(2) : null,
        gstAmount: gst ? gst.toFixed(2) : null,
        totalAmount: row.total ? row.total.toFixed(2) : null,
        gstSplit: gst && gst.greaterThan(0) ? gstSplit : null,
        paymentModeLabel: mode?.label ?? (row.mode || null),
        paymentSourceLabel,
        invoiceLink: row.invoiceLink || null,
        errors,
      });

      if (errors.length === 0 && entity && registration && (category || newCategory) && unit && mode && (bankAccountId || cardAccountId) && taxable && gst && row.date && row.total) {
        total = total.plus(row.total);
        bills.push({
          rowNumber: row.rowNumber,
          vendorId,
          newVendor: vendorId ? null : { name: row.supplier.trim(), stateId: registration.stateId },
          newCategory,
          legalEntityId: entity.id,
          projectId: project?.id ?? null,
          gstRegistrationId: registration.id,
          billNumber,
          date: row.date,
          line: {
            description: details,
            expenseCategoryId: category?.id,
            inventoryItemId: undefined,
            unitOfMeasureId: unit.id,
            hsnSac: undefined,
            quantity: '1',
            unitPrice: taxable.toFixed(2),
            gstRatePercent: taxable.greaterThan(0) ? gst.times(50).dividedBy(taxable).toDecimalPlaces(2).toFixed(2) : '0',
            itcEligible: true,
            gstAmount: gst.toFixed(2),
            gstSplit,
          },
          total: row.total,
          invoiceLink: row.invoiceLink || undefined,
          receipt: row.receipt || undefined,
          bankAccountId,
          cardAccountId,
          paymentModeId: mode.id,
        });
      }
    }

    return {
      preview: {
        rows: previewRows,
        billCount: parsed.rows.length,
        newVendorCount: newVendorKeys.size,
        newCategoryCount: newCategoryKeys.size,
        errorCount: previewRows.filter((r) => r.errors.length > 0).length,
        totalAmount: total.toFixed(2),
      },
      bills,
    };
  }
}
