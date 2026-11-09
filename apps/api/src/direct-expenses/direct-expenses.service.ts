import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type { DirectExpensePort, DirectExpenseSummary, DirectExpenseFilters } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';

const CREATE_DRAFT_COMMAND_TYPE = 'direct_expense.create_draft';
const CANCEL_COMMAND_TYPE = 'direct_expense.cancel';
const POST_COMMAND_TYPE = 'direct_expense.post';
const CREATE_AND_POST_COMMAND_TYPE = 'direct_expense.create_and_post';
const REVERSE_COMMAND_TYPE = 'direct_expense.reverse';

const INPUT_CGST_RECEIVABLE_CODE = 'INPUT_CGST_RECEIVABLE';
const INPUT_SGST_RECEIVABLE_CODE = 'INPUT_SGST_RECEIVABLE';
const INPUT_IGST_RECEIVABLE_CODE = 'INPUT_IGST_RECEIVABLE';
const TDS_PAYABLE_CODE = 'TDS_PAYABLE';
const DEFAULT_EXPENSE_CODE = 'OTHER_EXPENSES';

function hashRequest(input: unknown): string {
  const normalized = JSON.stringify(input, Object.keys(input as object).sort());
  return createHash('sha256').update(normalized).digest('hex');
}

function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatCardAccountLabel(card: { displayName: string; maskedLastFour: string; cardNumber?: string | null }): string {
  const number = card.cardNumber ? card.cardNumber.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ') : `•••• ${card.maskedLastFour}`;
  return `${number} · ${card.displayName.trim()}`;
}

/** Same split as computeLines: the entered percent is CGST and is SGST.
 * A different state charges both percents together as IGST. */
function computeGstSplit(
  taxableAmount: Prisma.Decimal,
  gstRatePercent: Prisma.Decimal,
  supplyType: 'INTRASTATE' | 'INTERSTATE',
): { cgstAmount: Prisma.Decimal; sgstAmount: Prisma.Decimal; igstAmount: Prisma.Decimal } {
  const component = taxableAmount.times(gstRatePercent).dividedBy(100).toDecimalPlaces(2);
  if (supplyType === 'INTRASTATE') {
    return { cgstAmount: component, sgstAmount: component, igstAmount: new Prisma.Decimal(0) };
  }
  return { cgstAmount: new Prisma.Decimal(0), sgstAmount: new Prisma.Decimal(0), igstAmount: component.times(2) };
}

const directExpenseInclude = {
  legalEntity: true,
  expenseCategory: true,
  vendor: true,
  project: true,
  paymentMode: true,
  bankAccount: true,
  cardAccount: { include: { bankAccount: true } },
  purchasedByEmployee: true,
} satisfies Prisma.DirectExpenseInclude;

type DirectExpenseRow = Prisma.DirectExpenseGetPayload<{ include: typeof directExpenseInclude }>;

function toSummary(row: DirectExpenseRow): DirectExpenseSummary {
  return {
    id: row.id,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    expenseCategoryId: row.expenseCategoryId,
    expenseCategoryName: row.expenseCategory.name,
    vendorId: row.vendorId,
    vendorName: row.vendor?.name ?? null,
    title: row.title,
    projectId: row.projectId,
    projectName: row.project?.name ?? null,
    taxableAmount: row.taxableAmount.toFixed(2),
    amount: row.amount.toFixed(2),
    expenseDate: row.expenseDate.toISOString().slice(0, 10),
    gstInvoiceAvailable: row.gstInvoiceAvailable,
    gstRatePercent: row.gstRatePercent ? row.gstRatePercent.toFixed(2) : null,
    supplyType: row.supplyType,
    cgstAmount: row.cgstAmount.toFixed(2),
    sgstAmount: row.sgstAmount.toFixed(2),
    igstAmount: row.igstAmount.toFixed(2),
    gstAmount: row.cgstAmount.plus(row.sgstAmount).plus(row.igstAmount).toFixed(2),
    itcEligible: row.itcEligible,
    tdsAmount: row.tdsAmount.toFixed(2),
    tdsRatePercent: row.tdsRatePercent ? row.tdsRatePercent.toFixed(2) : null,
    paymentModeId: row.paymentModeId,
    paymentModeLabel: row.paymentMode.label,
    bankAccountId: row.bankAccountId,
    bankAccountName: row.bankAccount?.accountName ?? null,
    cardAccountId: row.cardAccountId,
    cardAccountLabel: row.cardAccount ? formatCardAccountLabel(row.cardAccount) : null,
    transactionReference: row.transactionReference,
    purchasedByEmployeeId: row.purchasedByEmployeeId,
    purchasedByEmployeeName: row.purchasedByEmployee?.fullName ?? null,
    note: row.note,
    spendType: row.spendType,
    billUrl: row.billUrl,
    status: row.status,
    postedAt: row.postedAt ? row.postedAt.toISOString() : null,
    postedBy: row.postedBy,
    journalEntryId: row.journalEntryId,
    reversalJournalEntryId: row.reversalJournalEntryId,
    reversalReason: row.reversalReason,
    reversedBy: row.reversedBy,
    reversedAt: row.reversedAt ? row.reversedAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelledBy: row.cancelledBy,
    cancelledReason: row.cancelledReason,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    version: row.version,
  };
}

interface DirectExpenseWriteInput {
  organizationId: string;
  expenseCategoryId: string;
  vendorId?: string | undefined;
  title: string;
  projectId?: string | undefined;
  legalEntityId?: string | undefined;
  taxableAmount: string;
  expenseDate: string;
  gstInvoiceAvailable: boolean;
  gstRatePercent?: string | undefined;
  supplyType?: 'INTRASTATE' | 'INTERSTATE' | undefined;
  itcEligible?: boolean | undefined;
  tdsAmount?: string | undefined;
  tdsRatePercent?: string | undefined;
  paymentModeId: string;
  bankAccountId?: string | undefined;
  cardAccountId?: string | undefined;
  transactionReference?: string | undefined;
  purchasedByEmployeeId?: string | undefined;
  note?: string | undefined;
  spendType?: 'SERVER' | 'SUBSCRIPTION' | null | undefined;
  billUrl?: string | null | undefined;
}

/** What only the Server & Subscription import sets (ADR-169): the GST amount
 * as printed on the bill, split by supply type instead of recomputed from a
 * rate. */
export interface DirectExpenseImportFields {
  gstAmount?: string | undefined;
}

interface ResolvedGst {
  taxableAmount: Prisma.Decimal;
  amount: Prisma.Decimal;
  gstRatePercent: Prisma.Decimal | null;
  supplyType: 'INTRASTATE' | 'INTERSTATE' | null;
  cgstAmount: Prisma.Decimal;
  sgstAmount: Prisma.Decimal;
  igstAmount: Prisma.Decimal;
  itcEligible: boolean;
  tdsAmount: Prisma.Decimal;
  tdsRatePercent: Prisma.Decimal | null;
}

interface ResolvedPaymentSource {
  bankAccountId: string | null;
  cardAccountId: string | null;
}

@Injectable()
export class DirectExpensesService implements DirectExpensePort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  private async resolveLegalEntityId(
    organizationId: string,
    projectId: string | undefined,
    legalEntityId: string | undefined,
  ): Promise<{ legalEntityId: string; projectId: string | null }> {
    if (projectId) {
      const project = await this.prisma.client.project.findFirst({ where: { id: projectId, organizationId } });
      if (!project) throwAppError('NOT_FOUND', 'Project not found.');
      if (legalEntityId && legalEntityId !== project.legalEntityId) throwAppError('VALIDATION_FAILED', `Project "${project.name}" belongs to another legal entity.`);
      return { legalEntityId: project.legalEntityId, projectId: project.id };
    }
    if (!legalEntityId) throwAppError('VALIDATION_FAILED', 'Legal entity is required when no project is selected.');
    const legalEntity = await this.prisma.client.legalEntity.findFirst({ where: { id: legalEntityId, organizationId, deletedAt: null } });
    if (!legalEntity) throwAppError('NOT_FOUND', 'Legal entity not found.');
    if (!legalEntity.isActive) throwAppError('VALIDATION_FAILED', 'This legal entity is inactive.');
    return { legalEntityId: legalEntity.id, projectId: null };
  }

  private async resolveLedgerAccount(organizationId: string, code: string, label: string) {
    const account = await this.prisma.client.ledgerAccount.findFirst({ where: { organizationId, code } });
    if (!account) throwAppError('VALIDATION_FAILED', `Required ledger account (${label}) is not configured.`);
    return account;
  }

  private async assertVendorActive(organizationId: string, vendorId: string): Promise<void> {
    const vendor = await this.prisma.client.party.findFirst({ where: { id: vendorId, organizationId, deletedAt: null }, include: { vendorProfile: true } });
    if (!vendor || !vendor.vendorProfile) throwAppError('NOT_FOUND', 'Vendor not found.');
    if (!vendor.isActive || !vendor.vendorProfile.isActive) throwAppError('VALIDATION_FAILED', 'This vendor is inactive.');
  }

  private async assertEmployeeActive(organizationId: string, employeeId: string): Promise<void> {
    const employee = await this.prisma.client.employee.findFirst({ where: { id: employeeId, organizationId, deletedAt: null } });
    if (!employee) throwAppError('NOT_FOUND', 'Employee not found.');
    if (employee.status !== 'ACTIVE') throwAppError('VALIDATION_FAILED', 'This employee is not active.');
  }

  private async assertBankAccountUsable(organizationId: string, bankAccountId: string, legalEntityId: string) {
    const bankAccount = await this.prisma.client.bankAccount.findFirst({ where: { id: bankAccountId, organizationId }, include: { ledgerAccount: true } });
    if (!bankAccount) throwAppError('NOT_FOUND', 'Bank account not found.');
    if (!bankAccount.isActive) throwAppError('VALIDATION_FAILED', 'This bank account is inactive.');
    if (bankAccount.legalEntityId !== legalEntityId) throwAppError('VALIDATION_FAILED', 'The bank account must belong to the same legal entity.');
    return bankAccount;
  }

  private async assertCardAccountUsable(organizationId: string, cardAccountId: string, legalEntityId: string) {
    const card = await this.prisma.client.cardAccount.findFirst({
      where: { id: cardAccountId, organizationId },
      include: { bankAccount: { include: { ledgerAccount: true } }, ledgerAccount: true },
    });
    if (!card) throwAppError('NOT_FOUND', 'Card account not found.');
    if (!card.isActive) throwAppError('VALIDATION_FAILED', 'This card account is inactive.');
    if (card.legalEntityId !== legalEntityId) throwAppError('VALIDATION_FAILED', 'The card account must belong to the same legal entity.');
    if (card.type === 'DEBIT_CARD' && !card.bankAccount) throwAppError('VALIDATION_FAILED', 'This debit card has no linked bank account.');
    if (card.type === 'CREDIT_CARD' && !card.ledgerAccount) throwAppError('VALIDATION_FAILED', 'This credit card has no linked payable ledger account.');
    return card;
  }

  /** Resolves and validates the payment source (plain bank/cash/UPI vs.
   * Debit/Credit Card). The server always derives bankAccountId itself when
   * a card is involved -- the frontend never supplies an arbitrary ledger
   * account. Returns the values to persist on the DirectExpense row. */
  private async resolvePaymentSource(input: {
    organizationId: string;
    legalEntityId: string;
    paymentModeId: string;
    bankAccountId: string | undefined;
    cardAccountId: string | undefined;
  }): Promise<ResolvedPaymentSource> {
    const paymentMode = await this.prisma.client.paymentMode.findFirst({ where: { id: input.paymentModeId } });
    if (!paymentMode) throwAppError('NOT_FOUND', 'Payment mode not found.');

    if (paymentMode.requiresCardSource) {
      if (!input.cardAccountId) throwAppError('VALIDATION_FAILED', 'A card is required for this payment mode.');
      const card = await this.assertCardAccountUsable(input.organizationId, input.cardAccountId, input.legalEntityId);
      const expectedCode = card.type === 'DEBIT_CARD' ? 'DEBIT_CARD' : 'CREDIT_CARD';
      if (paymentMode.code !== expectedCode) throwAppError('VALIDATION_FAILED', 'The selected card does not match the selected payment mode.');
      return { cardAccountId: card.id, bankAccountId: card.type === 'DEBIT_CARD' ? card.bankAccountId : null };
    }

    if (input.cardAccountId) throwAppError('VALIDATION_FAILED', 'A card cannot be attached to this payment mode.');
    if (!input.bankAccountId) throwAppError('VALIDATION_FAILED', 'A bank account is required for this payment mode.');
    await this.assertBankAccountUsable(input.organizationId, input.bankAccountId, input.legalEntityId);
    return { cardAccountId: null, bankAccountId: input.bankAccountId };
  }

  private resolveGst(input: DirectExpenseWriteInput & DirectExpenseImportFields): ResolvedGst {
    const taxableAmount = new Prisma.Decimal(input.taxableAmount);
    if (taxableAmount.lessThanOrEqualTo(0)) throwAppError('VALIDATION_FAILED', 'Taxable amount must be greater than zero.');

    let gstRatePercent: Prisma.Decimal | null = null;
    let supplyType: 'INTRASTATE' | 'INTERSTATE' | null = null;
    let cgstAmount = new Prisma.Decimal(0);
    let sgstAmount = new Prisma.Decimal(0);
    let igstAmount = new Prisma.Decimal(0);

    if (input.gstInvoiceAvailable) {
      if (!input.gstRatePercent) throwAppError('VALIDATION_FAILED', 'A GST rate is required when a GST invoice is available.');
      if (!input.supplyType) throwAppError('VALIDATION_FAILED', 'Supply type is required when a GST invoice is available.');
      gstRatePercent = new Prisma.Decimal(input.gstRatePercent);
      if (gstRatePercent.isNegative()) throwAppError('VALIDATION_FAILED', 'GST rate must not be negative.');
      supplyType = input.supplyType;
      if (input.gstAmount !== undefined) {
        // The bill's own GST, split as it would be charged: half and half
        // within the state, all IGST across states.
        const gst = new Prisma.Decimal(input.gstAmount);
        if (gst.isNegative()) throwAppError('VALIDATION_FAILED', 'GST amount must not be negative.');
        cgstAmount = supplyType === 'INTRASTATE' ? gst.dividedBy(2).toDecimalPlaces(2) : new Prisma.Decimal(0);
        sgstAmount = supplyType === 'INTRASTATE' ? gst.minus(cgstAmount) : new Prisma.Decimal(0);
        igstAmount = supplyType === 'INTERSTATE' ? gst : new Prisma.Decimal(0);
      } else {
        ({ cgstAmount, sgstAmount, igstAmount } = computeGstSplit(taxableAmount, gstRatePercent, supplyType));
      }
    } else if (input.gstRatePercent || input.supplyType) {
      throwAppError('VALIDATION_FAILED', 'GST rate and supply type must not be set without a GST invoice.');
    }

    const amount = taxableAmount.plus(cgstAmount).plus(sgstAmount).plus(igstAmount);
    const itcEligible = input.itcEligible ?? true;

    const tdsAmount = input.tdsAmount ? new Prisma.Decimal(input.tdsAmount) : new Prisma.Decimal(0);
    if (tdsAmount.isNegative()) throwAppError('VALIDATION_FAILED', 'TDS amount must not be negative.');
    if (tdsAmount.greaterThan(amount)) throwAppError('VALIDATION_FAILED', 'TDS amount cannot exceed the expense amount.');
    const tdsRatePercent = input.tdsRatePercent ? new Prisma.Decimal(input.tdsRatePercent) : null;

    return { taxableAmount, amount, gstRatePercent, supplyType, cgstAmount, sgstAmount, igstAmount, itcEligible, tdsAmount, tdsRatePercent };
  }

  private async buildCreateData(
    organizationId: string,
    input: DirectExpenseWriteInput & DirectExpenseImportFields,
  ): Promise<Prisma.DirectExpenseUncheckedCreateInput> {
    const { legalEntityId, projectId } = await this.resolveLegalEntityId(organizationId, input.projectId, input.legalEntityId);

    const category = await this.prisma.client.expenseCategory.findFirst({ where: { id: input.expenseCategoryId, organizationId, deletedAt: null } });
    if (!category) throwAppError('NOT_FOUND', 'Expense category not found.');
    if (!category.isActive) throwAppError('VALIDATION_FAILED', `Expense category "${category.name}" is inactive.`);

    if (input.vendorId) await this.assertVendorActive(organizationId, input.vendorId);
    if (input.purchasedByEmployeeId) await this.assertEmployeeActive(organizationId, input.purchasedByEmployeeId);

    const gst = this.resolveGst(input);
    const paymentSource = await this.resolvePaymentSource({
      organizationId,
      legalEntityId,
      paymentModeId: input.paymentModeId,
      bankAccountId: input.bankAccountId,
      cardAccountId: input.cardAccountId,
    });

    return {
      id: generateId(),
      organizationId,
      legalEntityId,
      expenseCategoryId: input.expenseCategoryId,
      vendorId: input.vendorId ?? null,
      title: input.title,
      projectId,
      taxableAmount: gst.taxableAmount,
      amount: gst.amount,
      expenseDate: toDate(input.expenseDate),
      gstInvoiceAvailable: input.gstInvoiceAvailable,
      gstRatePercent: gst.gstRatePercent,
      supplyType: gst.supplyType,
      cgstAmount: gst.cgstAmount,
      sgstAmount: gst.sgstAmount,
      igstAmount: gst.igstAmount,
      itcEligible: gst.itcEligible,
      tdsAmount: gst.tdsAmount,
      tdsRatePercent: gst.tdsRatePercent,
      paymentModeId: input.paymentModeId,
      bankAccountId: paymentSource.bankAccountId,
      cardAccountId: paymentSource.cardAccountId,
      transactionReference: input.transactionReference ?? null,
      purchasedByEmployeeId: input.purchasedByEmployeeId ?? null,
      note: input.note ?? null,
      spendType: input.spendType ?? null,
      billUrl: input.billUrl ?? null,
      status: 'DRAFT',
    };
  }

  async createDraft(
    input: DirectExpenseWriteInput & { idempotencyKey: string; actorId: string; correlationId: string },
  ): Promise<DirectExpenseSummary> {
    const requestHash = hashRequest({ ...input, idempotencyKey: undefined, actorId: undefined, correlationId: undefined });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: CREATE_DRAFT_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as DirectExpenseSummary;
    }

    const data = await this.buildCreateData(input.organizationId, input);
    data.createdBy = input.actorId;

    return await this.prisma.client.$transaction(async (tx) => {
      await tx.directExpense.create({ data });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'DIRECT_EXPENSE',
        entityId: data.id,
        action: 'DIRECT_EXPENSE_DRAFT_CREATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { title: input.title, amount: (data.amount as Prisma.Decimal).toFixed(2) },
      });

      const created = await tx.directExpense.findFirstOrThrow({ where: { id: data.id }, include: directExpenseInclude });
      const summary = toSummary(created);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: CREATE_DRAFT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'DIRECT_EXPENSE',
          sourceRecordId: data.id,
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
    expenseCategoryId?: string | undefined;
    vendorId?: string | undefined;
    title?: string | undefined;
    projectId?: string | undefined;
    legalEntityId?: string | undefined;
    taxableAmount?: string | undefined;
    expenseDate?: string | undefined;
    gstInvoiceAvailable?: boolean | undefined;
    gstRatePercent?: string | undefined;
    supplyType?: 'INTRASTATE' | 'INTERSTATE' | undefined;
    itcEligible?: boolean | undefined;
    tdsAmount?: string | undefined;
    tdsRatePercent?: string | undefined;
    paymentModeId?: string | undefined;
    bankAccountId?: string | undefined;
    cardAccountId?: string | undefined;
    transactionReference?: string | undefined;
    purchasedByEmployeeId?: string | undefined;
    note?: string | undefined;
    spendType?: 'SERVER' | 'SUBSCRIPTION' | null | undefined;
    billUrl?: string | null | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<DirectExpenseSummary> {
    const existing = await this.prisma.client.directExpense.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!existing) throwAppError('NOT_FOUND', 'Direct expense not found.');
    if (existing.createdBy !== input.actorId) throwAppError('FORBIDDEN', 'You can only edit a direct expense you created yourself.');
    if (existing.status !== 'DRAFT') throwAppError('INVALID_STATE_TRANSITION', 'Only a draft direct expense can be updated.');

    const merged: DirectExpenseWriteInput = {
      organizationId: input.organizationId,
      expenseCategoryId: input.expenseCategoryId ?? existing.expenseCategoryId,
      vendorId: input.vendorId !== undefined ? (input.vendorId ?? undefined) : (existing.vendorId ?? undefined),
      title: input.title ?? existing.title,
      projectId: input.projectId !== undefined ? input.projectId : (existing.projectId ?? undefined),
      legalEntityId: input.legalEntityId !== undefined ? input.legalEntityId : (existing.projectId ? undefined : existing.legalEntityId),
      taxableAmount: input.taxableAmount ?? existing.taxableAmount.toFixed(2),
      expenseDate: input.expenseDate ?? toDateStr(existing.expenseDate),
      gstInvoiceAvailable: input.gstInvoiceAvailable ?? existing.gstInvoiceAvailable,
      gstRatePercent: input.gstRatePercent !== undefined ? (input.gstRatePercent ?? undefined) : (existing.gstRatePercent?.toFixed(2) ?? undefined),
      supplyType: input.supplyType !== undefined ? (input.supplyType ?? undefined) : (existing.supplyType ?? undefined),
      itcEligible: input.itcEligible ?? existing.itcEligible,
      tdsAmount: input.tdsAmount ?? existing.tdsAmount.toFixed(2),
      tdsRatePercent: input.tdsRatePercent !== undefined ? (input.tdsRatePercent ?? undefined) : (existing.tdsRatePercent?.toFixed(2) ?? undefined),
      paymentModeId: input.paymentModeId ?? existing.paymentModeId,
      bankAccountId: input.bankAccountId !== undefined ? (input.bankAccountId ?? undefined) : (existing.bankAccountId ?? undefined),
      cardAccountId: input.cardAccountId !== undefined ? (input.cardAccountId ?? undefined) : (existing.cardAccountId ?? undefined),
      transactionReference: input.transactionReference !== undefined ? input.transactionReference : (existing.transactionReference ?? undefined),
      purchasedByEmployeeId: input.purchasedByEmployeeId !== undefined ? (input.purchasedByEmployeeId ?? undefined) : (existing.purchasedByEmployeeId ?? undefined),
      note: input.note !== undefined ? input.note : (existing.note ?? undefined),
      spendType: input.spendType !== undefined ? input.spendType : existing.spendType,
      billUrl: input.billUrl !== undefined ? input.billUrl : existing.billUrl,
    };

    const data = await this.buildCreateData(input.organizationId, merged);

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.directExpense.updateMany({
        where: { id: existing.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'DRAFT' },
        data: {
          expenseCategoryId: data.expenseCategoryId,
          vendorId: data.vendorId ?? null,
          title: data.title,
          projectId: data.projectId ?? null,
          legalEntityId: data.legalEntityId,
          taxableAmount: data.taxableAmount,
          amount: data.amount,
          expenseDate: data.expenseDate as Date,
          gstInvoiceAvailable: data.gstInvoiceAvailable ?? false,
          gstRatePercent: data.gstRatePercent ?? null,
          supplyType: data.supplyType ?? null,
          cgstAmount: data.cgstAmount ?? 0,
          sgstAmount: data.sgstAmount ?? 0,
          igstAmount: data.igstAmount ?? 0,
          itcEligible: data.itcEligible ?? true,
          tdsAmount: data.tdsAmount ?? 0,
          tdsRatePercent: data.tdsRatePercent ?? null,
          paymentModeId: data.paymentModeId,
          bankAccountId: data.bankAccountId ?? null,
          cardAccountId: data.cardAccountId ?? null,
          transactionReference: data.transactionReference ?? null,
          purchasedByEmployeeId: data.purchasedByEmployeeId ?? null,
          note: data.note ?? null,
          spendType: data.spendType ?? null,
          billUrl: data.billUrl ?? null,
          updatedBy: input.actorId,
          version: { increment: 1 },
        },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This direct expense was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'DIRECT_EXPENSE',
        entityId: existing.id,
        action: 'DIRECT_EXPENSE_DRAFT_UPDATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { amount: (data.amount as Prisma.Decimal).toFixed(2) },
      });

      const updated = await tx.directExpense.findFirstOrThrow({ where: { id: existing.id }, include: directExpenseInclude });
      return toSummary(updated);
    });
  }

  async cancelDraft(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<DirectExpenseSummary> {
    const reason = input.reason.trim();
    if (!reason) throwAppError('VALIDATION_FAILED', 'A reason is required to cancel a direct expense.');

    const requestHash = hashRequest({ id: input.id, reason });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: CANCEL_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as DirectExpenseSummary;
    }

    const existing = await this.prisma.client.directExpense.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!existing) throwAppError('NOT_FOUND', 'Direct expense not found.');
    if (existing.createdBy !== input.actorId) throwAppError('FORBIDDEN', 'You can only cancel a direct expense you created yourself.');
    if (existing.status !== 'DRAFT') throwAppError('INVALID_STATE_TRANSITION', 'Only a draft direct expense can be cancelled.');

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.directExpense.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'DRAFT' },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: input.actorId, cancelledReason: reason, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This direct expense was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'DIRECT_EXPENSE',
        entityId: input.id,
        action: 'DIRECT_EXPENSE_CANCELLED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { reason },
      });

      const updated = await tx.directExpense.findFirstOrThrow({ where: { id: input.id }, include: directExpenseInclude });
      const summary = toSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: CANCEL_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'DIRECT_EXPENSE',
          sourceRecordId: input.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  /** Builds the journal lines for a DRAFT row that's about to post. Shared
   * by post() (existing draft, review-before-posting UX) and
   * createAndPostDraft() (one-hop path for the Server & Subscription
   * import, ADR-169). */
  private async buildPostingLines(existing: DirectExpenseRow) {
    const expenseLedgerAccountId = existing.expenseCategory.ledgerAccountId ?? (await this.resolveLedgerAccount(existing.organizationId, DEFAULT_EXPENSE_CODE, 'Other Expenses')).id;

    let creditLedgerAccountId: string;
    if (existing.cardAccount) {
      creditLedgerAccountId = existing.cardAccount.type === 'CREDIT_CARD' ? existing.cardAccount.ledgerAccountId! : existing.cardAccount.bankAccount!.ledgerAccountId;
    } else if (existing.bankAccount) {
      creditLedgerAccountId = existing.bankAccount.ledgerAccountId;
    } else {
      throwAppError('VALIDATION_FAILED', 'A bank account or card is required to post this direct expense.');
    }

    const eligibleCgst = existing.itcEligible ? existing.cgstAmount : new Prisma.Decimal(0);
    const eligibleSgst = existing.itcEligible ? existing.sgstAmount : new Prisma.Decimal(0);
    const eligibleIgst = existing.itcEligible ? existing.igstAmount : new Prisma.Decimal(0);
    const ineligibleGst = existing.itcEligible ? new Prisma.Decimal(0) : existing.cgstAmount.plus(existing.sgstAmount).plus(existing.igstAmount);
    const expenseDebit = existing.taxableAmount.plus(ineligibleGst);

    const paymentCredit = existing.amount.minus(existing.tdsAmount);

    const lines = [
      {
        ledgerAccountId: expenseLedgerAccountId,
        debit: expenseDebit.toFixed(2),
        credit: '0',
        projectId: existing.projectId ?? undefined,
        partyId: existing.vendorId ?? undefined,
        employeeId: undefined,
        gstRegistrationId: undefined,
        taxCode: undefined,
        narrative: undefined,
      },
      ...(eligibleCgst.greaterThan(0)
        ? [{ ledgerAccountId: (await this.resolveLedgerAccount(existing.organizationId, INPUT_CGST_RECEIVABLE_CODE, 'Input CGST Receivable')).id, debit: eligibleCgst.toFixed(2), credit: '0', projectId: existing.projectId ?? undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: 'CGST', narrative: undefined }]
        : []),
      ...(eligibleSgst.greaterThan(0)
        ? [{ ledgerAccountId: (await this.resolveLedgerAccount(existing.organizationId, INPUT_SGST_RECEIVABLE_CODE, 'Input SGST Receivable')).id, debit: eligibleSgst.toFixed(2), credit: '0', projectId: existing.projectId ?? undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: 'SGST', narrative: undefined }]
        : []),
      ...(eligibleIgst.greaterThan(0)
        ? [{ ledgerAccountId: (await this.resolveLedgerAccount(existing.organizationId, INPUT_IGST_RECEIVABLE_CODE, 'Input IGST Receivable')).id, debit: eligibleIgst.toFixed(2), credit: '0', projectId: existing.projectId ?? undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: 'IGST', narrative: undefined }]
        : []),
      {
        ledgerAccountId: creditLedgerAccountId,
        debit: '0',
        credit: paymentCredit.toFixed(2),
        projectId: existing.projectId ?? undefined,
        partyId: existing.vendorId ?? undefined,
        employeeId: undefined,
        gstRegistrationId: undefined,
        taxCode: undefined,
        narrative: undefined,
      },
      ...(existing.tdsAmount.greaterThan(0)
        ? [{ ledgerAccountId: (await this.resolveLedgerAccount(existing.organizationId, TDS_PAYABLE_CODE, 'TDS Payable')).id, debit: '0', credit: existing.tdsAmount.toFixed(2), projectId: existing.projectId ?? undefined, partyId: existing.vendorId ?? undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: 'TDS', narrative: undefined }]
        : []),
    ];

    return lines;
  }

  async post(input: { organizationId: string; id: string; expectedVersion: number; idempotencyKey: string; actorId: string; correlationId: string }): Promise<DirectExpenseSummary> {
    const requestHash = hashRequest({ id: input.id });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: POST_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as DirectExpenseSummary;
    }

    const existing = await this.prisma.client.directExpense.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: directExpenseInclude,
    });
    if (!existing) throwAppError('NOT_FOUND', 'Direct expense not found.');
    if (existing.status !== 'DRAFT') throwAppError('INVALID_STATE_TRANSITION', 'Only a draft direct expense can be posted.');

    const journalLines = await this.buildPostingLines(existing);

    const journal = await this.posting.postJournal({
      organizationId: input.organizationId,
      legalEntityId: existing.legalEntityId,
      accountingDate: toDateStr(existing.expenseDate),
      sourceType: POST_COMMAND_TYPE,
      sourceId: existing.id,
      postingEvent: 'direct_expense.posted',
      description: `Direct expense posted — ${existing.title}`,
      lines: journalLines,
      idempotencyKey: `${POST_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.directExpense.updateMany({
        where: { id: existing.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'DRAFT' },
        data: { status: 'POSTED', journalEntryId: journal.id, postedAt: new Date(), postedBy: input.actorId, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This direct expense was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'DIRECT_EXPENSE',
        entityId: existing.id,
        action: 'DIRECT_EXPENSE_POSTED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { amount: existing.amount.toFixed(2), journalEntryId: journal.id },
      });

      const updated = await tx.directExpense.findFirstOrThrow({ where: { id: existing.id }, include: directExpenseInclude });
      const summary = toSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: POST_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'DIRECT_EXPENSE',
          sourceRecordId: existing.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  /** One-hop create+post, used by callers (the Server & Subscription
   * import, ADR-169) that need an already-POSTED result without the manual review-before-
   * posting two-step. Idempotency-key guarded exactly like createDraft/post
   * -- a retry with the same key returns the already-posted result instead
   * of creating a duplicate. */
  async createAndPostDraft(
    input: DirectExpenseWriteInput & DirectExpenseImportFields & { idempotencyKey: string; actorId: string; correlationId: string },
  ): Promise<DirectExpenseSummary> {
    const requestHash = hashRequest({ ...input, idempotencyKey: undefined, actorId: undefined, correlationId: undefined });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: CREATE_AND_POST_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as DirectExpenseSummary;
    }

    const data = await this.buildCreateData(input.organizationId, input);
    data.createdBy = input.actorId;
    const id = data.id;

    await this.prisma.client.directExpense.create({ data });
    await this.prisma.client.$transaction(async (tx) => {
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'DIRECT_EXPENSE',
        entityId: id,
        action: 'DIRECT_EXPENSE_DRAFT_CREATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { title: input.title, amount: (data.amount as Prisma.Decimal).toFixed(2) },
      });
    });

    const existing = await this.prisma.client.directExpense.findFirstOrThrow({
      where: { id, organizationId: input.organizationId },
      include: directExpenseInclude,
    });
    const journalLines = await this.buildPostingLines(existing);

    const journal = await this.posting.postJournal({
      organizationId: input.organizationId,
      legalEntityId: existing.legalEntityId,
      accountingDate: toDateStr(existing.expenseDate),
      sourceType: POST_COMMAND_TYPE,
      sourceId: existing.id,
      postingEvent: 'direct_expense.posted',
      description: `Direct expense posted — ${existing.title}`,
      lines: journalLines,
      idempotencyKey: `${CREATE_AND_POST_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      await tx.directExpense.update({
        where: { id: existing.id },
        data: { status: 'POSTED', journalEntryId: journal.id, postedAt: new Date(), postedBy: input.actorId, updatedBy: input.actorId, version: { increment: 1 } },
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'DIRECT_EXPENSE',
        entityId: existing.id,
        action: 'DIRECT_EXPENSE_POSTED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { amount: existing.amount.toFixed(2), journalEntryId: journal.id },
      });

      const updated = await tx.directExpense.findFirstOrThrow({ where: { id: existing.id }, include: directExpenseInclude });
      const summary = toSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: CREATE_AND_POST_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'DIRECT_EXPENSE',
          sourceRecordId: existing.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async reverse(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<DirectExpenseSummary> {
    const requestHash = hashRequest({ id: input.id, reason: input.reason, accountingDate: input.accountingDate });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: REVERSE_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as DirectExpenseSummary;
    }

    const reason = input.reason.trim();
    if (!reason) throwAppError('VALIDATION_FAILED', 'A reason is required to reverse a direct expense.');

    const existing = await this.prisma.client.directExpense.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!existing) throwAppError('NOT_FOUND', 'Direct expense not found.');
    if (existing.status !== 'POSTED') throwAppError('INVALID_STATE_TRANSITION', 'Only a posted direct expense can be reversed.');
    if (!existing.journalEntryId) throwAppError('VALIDATION_FAILED', 'This direct expense has no journal entry to reverse.');

    const reversal = await this.posting.reverseJournal({
      organizationId: input.organizationId,
      id: existing.journalEntryId,
      accountingDate: input.accountingDate,
      reason,
      idempotencyKey: `${REVERSE_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.directExpense.updateMany({
        where: { id: existing.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'POSTED' },
        data: { status: 'REVERSED', reversalJournalEntryId: reversal.id, reversalReason: reason, reversedBy: input.actorId, reversedAt: new Date(), updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This direct expense was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'DIRECT_EXPENSE',
        entityId: existing.id,
        action: 'DIRECT_EXPENSE_REVERSED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { reversalReason: reason, reversalJournalEntryId: reversal.id },
      });

      const updated = await tx.directExpense.findFirstOrThrow({ where: { id: existing.id }, include: directExpenseInclude });
      const summary = toSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: REVERSE_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'DIRECT_EXPENSE',
          sourceRecordId: existing.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async list(input: { organizationId: string; page: number; pageSize: number; filters: DirectExpenseFilters }): Promise<{ rows: DirectExpenseSummary[]; total: number }> {
    const where: Prisma.DirectExpenseWhereInput = { organizationId: input.organizationId };
    if (input.filters.expenseCategoryId) where.expenseCategoryId = input.filters.expenseCategoryId;
    if (input.filters.projectId) where.projectId = input.filters.projectId;
    if (input.filters.status) where.status = input.filters.status;
    if (input.filters.spendType === 'ANY') where.spendType = { not: null };
    else if (input.filters.spendType) where.spendType = input.filters.spendType;
    if (input.filters.expenseDateFrom || input.filters.expenseDateTo) {
      where.expenseDate = {
        ...(input.filters.expenseDateFrom ? { gte: toDate(input.filters.expenseDateFrom) } : {}),
        ...(input.filters.expenseDateTo ? { lte: toDate(input.filters.expenseDateTo) } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.directExpense.findMany({ where, include: directExpenseInclude, orderBy: { createdAt: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
      this.prisma.client.directExpense.count({ where }),
    ]);
    return { rows: rows.map(toSummary), total };
  }

  async getDetail(input: { organizationId: string; id: string }): Promise<DirectExpenseSummary> {
    const row = await this.prisma.client.directExpense.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: directExpenseInclude });
    if (!row) throwAppError('NOT_FOUND', 'Direct expense not found.');
    return toSummary(row);
  }
}
