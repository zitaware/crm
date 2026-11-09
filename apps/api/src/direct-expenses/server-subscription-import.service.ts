import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  DirectExpenseSummary,
  ServerSubscriptionEntryInput,
  ServerSubscriptionImportChoice,
  ServerSubscriptionImportPort,
  ServerSubscriptionImportPreview,
  ServerSubscriptionImportRow,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { decodeImportWorkbook } from '../employees/employee-import';
import { DirectExpensesService } from './direct-expenses.service';
import { buildServerSubscriptionSample, parseServerSubscriptionWorkbook, type SheetRow } from './server-subscription-import';

const CREATE_AND_POST_COMMAND_TYPE = 'direct_expense.create_and_post';

/** The expense category a row books to when the sheet names none. */
const DEFAULT_CATEGORY_CODE: Record<'SERVER' | 'SUBSCRIPTION', string> = {
  SERVER: 'hosting_cloud_infra',
  SUBSCRIPTION: 'software_licenses',
};

/** Names compared without case, spaces or punctuation, and with "Private"/"Limited" read as "Pvt"/"Ltd". */
function key(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bprivate\b/g, 'pvt')
    .replace(/\blimited\b/g, 'ltd')
    .replace(/[^a-z0-9]/g, '');
}

const digitsOf = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length]!;
}

/** The closest name, when it is close enough to be a typo of the one written. */
function didYouMean(written: string, names: string[]): string {
  const target = key(written);
  let best: { name: string; distance: number } | null = null;
  for (const name of names) {
    const distance = editDistance(target, key(name));
    if (!best || distance < best.distance) best = { name, distance };
  }
  return best && best.distance <= Math.max(2, Math.floor(target.length * 0.2)) ? ` Did you mean "${best.name}"?` : '';
}

const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2);

interface ReadyRow {
  rowNumber: number;
  legalEntityId: string;
  projectId: string | undefined;
  expenseCategoryId: string;
  employeeId: string;
  title: string;
  spendType: 'SERVER' | 'SUBSCRIPTION';
  expenseDate: string;
  paymentModeId: string;
  cardAccountId: string | undefined;
  bankAccountId: string | undefined;
  taxableAmount: string;
  gstAmount: string;
  supplyType: 'INTRASTATE' | 'INTERSTATE' | undefined;
  transactionReference: string | undefined;
  note?: string | undefined;
  billUrl: string | undefined;
}

/**
 * Server & Subscription Excel import (ADR-169). Every row becomes a posted
 * direct expense tagged SERVER or SUBSCRIPTION. Names are matched to the
 * masters here; a row that matches nothing, or more than one record, gets
 * its own error, and nothing is imported until every row is clear.
 */
@Injectable()
export class ServerSubscriptionImportService implements ServerSubscriptionImportPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directExpenses: DirectExpensesService,
  ) {}

  async downloadSample(): Promise<{ filename: string; contentBase64: string }> {
    const buffer = await buildServerSubscriptionSample();
    return { filename: 'server-subscription-import-sample.xlsx', contentBase64: buffer.toString('base64') };
  }

  async preview(input: { organizationId: string; contentBase64: string; choices: ServerSubscriptionImportChoice[] }): Promise<ServerSubscriptionImportPreview> {
    return (await this.load(input.organizationId, input.contentBase64, input.choices, new Set())).preview;
  }

  async importRows(input: {
    organizationId: string;
    contentBase64: string;
    choices: ServerSubscriptionImportChoice[];
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<{ created: number; totalAmount: string }> {
    const rowKey = (rowNumber: number) => `${input.idempotencyKey}:${rowNumber}`;
    // A retry of an import that stopped part way: the rows it already posted
    // are not duplicates of themselves.
    const earlier = await this.prisma.client.idempotencyKey.findMany({
      where: { organizationId: input.organizationId, commandType: CREATE_AND_POST_COMMAND_TYPE, idempotencyKey: { startsWith: `${input.idempotencyKey}:` } },
      select: { sourceRecordId: true },
    });
    const ownIds = new Set(earlier.map((k) => k.sourceRecordId).filter((id): id is string => !!id));

    const { preview, ready } = await this.load(input.organizationId, input.contentBase64, input.choices, ownIds);
    if (preview.rows.length === 0) throwAppError('VALIDATION_FAILED', 'The sheet has no rows to import.');
    const blocked = preview.rows.find((r) => r.errors.length > 0);
    if (blocked) throwAppError('VALIDATION_FAILED', `Row ${blocked.rowNumber}: ${blocked.errors[0]} Fix the rows marked in the preview before importing.`);
    const unchosen = preview.rows.find((r) => !r.employeeId);
    if (unchosen) throwAppError('VALIDATION_FAILED', `Row ${unchosen.rowNumber}: choose which "${unchosen.employeeName}" by employee code.`);

    for (const row of ready) await this.post(input.organizationId, row, rowKey(row.rowNumber), input.actorId, input.correlationId);
    return { created: ready.length, totalAmount: preview.totalAmount };
  }

  async createEntry(input: { organizationId: string; entry: ServerSubscriptionEntryInput; idempotencyKey: string; actorId: string; correlationId: string }): Promise<DirectExpenseSummary> {
    // A retry of the same save returns what it posted.
    const done = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: CREATE_AND_POST_COMMAND_TYPE, idempotencyKey: `${input.idempotencyKey}:entry` } },
    });
    const row = await this.checkEntry(input.organizationId, input.entry, done?.sourceRecordId ?? null);
    return await this.post(input.organizationId, row, `${input.idempotencyKey}:entry`, input.actorId, input.correlationId);
  }

  async correctEntry(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    reversalDate: string;
    entry: ServerSubscriptionEntryInput;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<DirectExpenseSummary> {
    const existing = await this.prisma.client.directExpense.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!existing) throwAppError('NOT_FOUND', 'Bill not found.');
    if (!existing.spendType) throwAppError('VALIDATION_FAILED', 'Only a server or subscription bill can be corrected here.');
    const reason = input.reason.trim();
    if (!reason) throwAppError('VALIDATION_FAILED', 'Say why the bill is being corrected.');

    const newKey = `${input.idempotencyKey}:corrected`;
    const done = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: CREATE_AND_POST_COMMAND_TYPE, idempotencyKey: newKey } },
    });
    // Checked before anything is reversed, so a bad correction leaves the bill as it was.
    const row = await this.checkEntry(input.organizationId, input.entry, done?.sourceRecordId ?? existing.id);

    if (existing.status === 'REVERSED') {
      // Only a retry of this same correction may find the bill already reversed.
      const reversedHere = await this.prisma.client.idempotencyKey.findUnique({
        where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: 'direct_expense.reverse', idempotencyKey: `${input.idempotencyKey}:reverse` } },
      });
      if (!reversedHere) throwAppError('INVALID_STATE_TRANSITION', 'This bill is already reversed. Add the right bill as a new one.');
    } else if (existing.status !== 'POSTED') {
      throwAppError('INVALID_STATE_TRANSITION', 'Only a posted bill can be corrected.');
    } else {
      await this.directExpenses.reverse({
        organizationId: input.organizationId,
        id: existing.id,
        expectedVersion: input.expectedVersion,
        reason: `Corrected: ${reason}`,
        accountingDate: input.reversalDate,
        idempotencyKey: `${input.idempotencyKey}:reverse`,
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    }

    const corrected = await this.post(input.organizationId, row, newKey, input.actorId, input.correlationId);
    await this.prisma.client.$transaction(async (tx) => {
      // The bill's files belong to the corrected bill too; the old one keeps them.
      const links = await tx.documentLink.findMany({ where: { organizationId: input.organizationId, entityType: 'DIRECT_EXPENSE', entityId: existing.id } });
      const already = new Set(
        (await tx.documentLink.findMany({ where: { organizationId: input.organizationId, entityType: 'DIRECT_EXPENSE', entityId: corrected.id }, select: { documentId: true } })).map((l) => l.documentId),
      );
      for (const link of links.filter((l) => !already.has(l.documentId))) {
        await tx.documentLink.create({
          data: { id: generateId(), organizationId: input.organizationId, documentId: link.documentId, entityType: 'DIRECT_EXPENSE', entityId: corrected.id, linkType: link.linkType, createdBy: input.actorId },
        });
      }

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'DIRECT_EXPENSE',
        entityId: existing.id,
        action: 'DIRECT_EXPENSE_CORRECTED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        reason,
        oldValues: { amount: existing.amount.toFixed(2), title: existing.title, expenseDate: existing.expenseDate.toISOString().slice(0, 10) },
        newValues: { correctedById: corrected.id, amount: corrected.amount, title: corrected.title, expenseDate: corrected.expenseDate },
      });
    });
    return corrected;
  }

  /**
   * The form's bill, checked as an imported row is: the masters exist, are
   * active and belong together, the amounts make sense, and the same bill
   * is not already posted (other than `ignoreId`, the bill being corrected).
   */
  private async checkEntry(organizationId: string, entry: ServerSubscriptionEntryInput, ignoreId: string | null): Promise<ReadyRow> {
    const db = this.prisma.client;
    const fail = (message: string): never => throwAppError('VALIDATION_FAILED', message);

    const basic = new Prisma.Decimal(entry.basicAmount);
    const gst = new Prisma.Decimal(entry.gstAmount ?? '0');
    if (!basic.greaterThan(0)) fail('Basic Amount must be more than zero.');
    if (gst.isNegative()) fail('GST Amount cannot be negative.');
    if (gst.greaterThan(basic)) fail('GST Amount is more than the Basic Amount.');
    if (gst.greaterThan(0) && !entry.supplyType) fail('Choose IGST or CGST+SGST for the GST.');

    const legalEntity = await db.legalEntity.findFirst({ where: { id: entry.legalEntityId, organizationId, deletedAt: null } });
    if (!legalEntity) fail('Legal entity not found.');
    if (!legalEntity!.isActive) fail(`Legal entity "${legalEntity!.legalName}" is inactive.`);
    if (entry.projectId) {
      const project = await db.project.findFirst({ where: { id: entry.projectId, organizationId } });
      if (!project) fail('Project not found.');
      if (project!.legalEntityId !== entry.legalEntityId) fail(`Project "${project!.name}" belongs to another legal entity, not ${legalEntity!.legalName}.`);
    }

    let expenseCategoryId = entry.expenseCategoryId;
    if (!expenseCategoryId) {
      const category = await db.expenseCategory.findFirst({ where: { organizationId, code: DEFAULT_CATEGORY_CODE[entry.spendType], deletedAt: null } });
      if (!category) fail(`No default expense category for a ${entry.spendType.toLowerCase()}: choose one.`);
      expenseCategoryId = category!.id;
    }

    const taxable = money(basic);
    const gstAmount = money(gst);
    const amount = taxable.plus(gstAmount).toFixed(2);
    const duplicate = await db.directExpense.findFirst({
      where: {
        organizationId,
        status: 'POSTED',
        legalEntityId: entry.legalEntityId,
        expenseDate: new Date(`${entry.expenseDate}T00:00:00.000Z`),
        amount,
        title: { equals: entry.title.trim(), mode: 'insensitive' },
        ...(ignoreId ? { id: { not: ignoreId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) fail('This bill is already recorded (same legal entity, date, name and amount).');

    // Employee, payment mode and the card or bank account are checked by the
    // Direct Expense posting itself, against the same legal entity.
    return {
      rowNumber: 0,
      legalEntityId: entry.legalEntityId,
      projectId: entry.projectId,
      expenseCategoryId,
      employeeId: entry.employeeId,
      title: entry.title.trim(),
      spendType: entry.spendType,
      expenseDate: entry.expenseDate,
      paymentModeId: entry.paymentModeId,
      cardAccountId: entry.cardAccountId,
      bankAccountId: entry.cardAccountId ? undefined : entry.bankAccountId,
      taxableAmount: taxable.toFixed(2),
      gstAmount: gstAmount.toFixed(2),
      supplyType: gst.greaterThan(0) ? entry.supplyType : undefined,
      transactionReference: entry.transactionReference?.trim() || undefined,
      note: entry.note?.trim() || undefined,
      billUrl: entry.billUrl?.trim() || undefined,
    };
  }

  private async post(organizationId: string, row: ReadyRow, idempotencyKey: string, actorId: string, correlationId: string): Promise<DirectExpenseSummary> {
    return await this.directExpenses.createAndPostDraft({
      organizationId,
      legalEntityId: row.projectId ? undefined : row.legalEntityId,
      projectId: row.projectId,
      expenseCategoryId: row.expenseCategoryId,
      title: row.title,
      taxableAmount: row.taxableAmount,
      expenseDate: row.expenseDate,
      gstInvoiceAvailable: row.supplyType !== undefined,
      gstRatePercent: row.supplyType !== undefined ? this.halfRate(row.taxableAmount, row.gstAmount) : undefined,
      supplyType: row.supplyType,
      gstAmount: row.supplyType !== undefined ? row.gstAmount : undefined,
      itcEligible: true,
      paymentModeId: row.paymentModeId,
      cardAccountId: row.cardAccountId,
      bankAccountId: row.bankAccountId,
      transactionReference: row.transactionReference,
      purchasedByEmployeeId: row.employeeId,
      note: row.note,
      billUrl: row.billUrl,
      spendType: row.spendType,
      idempotencyKey,
      actorId,
      correlationId,
    });
  }

  /** The stored rate is the CGST (= SGST) percent, half the whole GST, as the Direct Expense form keeps it. */
  private halfRate(taxable: string, gst: string): string {
    const rate = new Prisma.Decimal(gst).times(50).dividedBy(taxable).toDecimalPlaces(2);
    return rate.toFixed(2);
  }

  private async load(
    organizationId: string,
    contentBase64: string,
    choices: ServerSubscriptionImportChoice[],
    ownIds: ReadonlySet<string>,
  ): Promise<{ preview: ServerSubscriptionImportPreview; ready: ReadyRow[] }> {
    let buffer: Buffer;
    try {
      buffer = decodeImportWorkbook(contentBase64);
    } catch (error) {
      throwAppError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Choose an Excel file.');
    }
    const parsed = await parseServerSubscriptionWorkbook(buffer);
    if (!parsed.ok) throwAppError('VALIDATION_FAILED', parsed.message);

    const db = this.prisma.client;
    const [legalEntities, projects, employees, paymentModes, cards, bankAccounts, categories] = await Promise.all([
      db.legalEntity.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, legalName: true, panNumber: true, isActive: true } }),
      db.project.findMany({ where: { organizationId }, select: { id: true, name: true, legalEntityId: true } }),
      db.employee.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, employeeCode: true, fullName: true, status: true } }),
      db.paymentMode.findMany({ select: { id: true, code: true, label: true, isActive: true, requiresCardSource: true } }),
      db.cardAccount.findMany({ where: { organizationId }, select: { id: true, legalEntityId: true, type: true, displayName: true, maskedLastFour: true, isActive: true } }),
      db.bankAccount.findMany({ where: { organizationId }, select: { id: true, legalEntityId: true, accountName: true, maskedAccountNumber: true, invoiceAccountNumber: true, isActive: true } }),
      db.expenseCategory.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, code: true, name: true, isActive: true } }),
    ]);
    const chosen = new Map(choices.map((c) => [c.rowNumber, c]));
    const legalNames = legalEntities.map((l) => l.legalName);

    const rows: ServerSubscriptionImportRow[] = [];
    const ready: ReadyRow[] = [];
    const seen = new Map<string, number>();

    for (const sheetRow of parsed.rows) {
      const errors = [...sheetRow.errors];
      const choice = chosen.get(sheetRow.rowNumber);

      // Legal entity: by legal name or PAN.
      let legalEntity: (typeof legalEntities)[number] | undefined;
      if (sheetRow.legalEntity) {
        const k = key(sheetRow.legalEntity);
        const matches = legalEntities.filter((l) => key(l.legalName) === k || l.panNumber.toUpperCase() === sheetRow.legalEntity.trim().toUpperCase());
        if (matches.length === 0) errors.push(`Legal Entity "${sheetRow.legalEntity}" is not in Legal Entities.${didYouMean(sheetRow.legalEntity, legalNames)}`);
        else if (matches.length > 1) errors.push(`Legal Entity "${sheetRow.legalEntity}" matches more than one legal entity.`);
        else if (!matches[0]!.isActive) errors.push(`Legal Entity "${matches[0]!.legalName}" is inactive.`);
        else legalEntity = matches[0];
      }

      // Project: optional; blank is company overhead.
      let project: (typeof projects)[number] | undefined;
      if (sheetRow.project) {
        const matches = projects.filter((p) => key(p.name) === key(sheetRow.project));
        if (matches.length === 0) errors.push(`Project "${sheetRow.project}" is not in Projects.${didYouMean(sheetRow.project, projects.map((p) => p.name))}`);
        else if (matches.length > 1) errors.push(`Project "${sheetRow.project}" matches more than one project.`);
        else if (legalEntity && matches[0]!.legalEntityId !== legalEntity.id) errors.push(`Project "${matches[0]!.name}" belongs to another legal entity, not ${legalEntity.legalName}.`);
        else project = matches[0];
      }

      // Employee: by name or code. Several active employees with one name: the user picks by code.
      let employeeId: string | null = null;
      let employeeChoices: ServerSubscriptionImportRow['employeeChoices'] = [];
      if (sheetRow.employee) {
        const k = key(sheetRow.employee);
        const matches = employees.filter((e) => key(e.fullName) === k || e.employeeCode.trim().toLowerCase() === sheetRow.employee.trim().toLowerCase());
        const active = matches.filter((e) => e.status === 'ACTIVE');
        if (matches.length === 0) errors.push(`Employee "${sheetRow.employee}" is not in Employees.${didYouMean(sheetRow.employee, employees.map((e) => e.fullName))}`);
        else if (active.length === 0) errors.push(`Employee "${matches[0]!.fullName}" is not active.`);
        else if (active.length === 1) employeeId = active[0]!.id;
        else {
          employeeChoices = active.map((e) => ({ id: e.id, employeeCode: e.employeeCode, fullName: e.fullName })).sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
          if (choice?.employeeId && active.some((e) => e.id === choice.employeeId)) employeeId = choice.employeeId;
        }
      }

      // Payment mode, then the card or account it was paid from.
      let paymentMode: (typeof paymentModes)[number] | undefined;
      if (sheetRow.paymentMode) {
        // NEFT, RTGS and IMPS are all a bank transfer.
        const written = key(sheetRow.paymentMode);
        const k = ['neft', 'rtgs', 'neftrtgs', 'imps', 'banktransfer'].includes(written) ? 'banktransfer' : written;
        paymentMode = paymentModes.find((m) => m.isActive && (key(m.label) === k || key(m.code) === k));
        if (!paymentMode) errors.push(`Payment Mode "${sheetRow.paymentMode}" is not one of: ${paymentModes.filter((m) => m.isActive).map((m) => m.label).join(', ')}.`);
      }
      let cardAccountId: string | undefined;
      let bankAccountId: string | undefined;
      let paymentSourceLabel: string | null = null;
      if (paymentMode && legalEntity) {
        if (!sheetRow.account) {
          errors.push(`Card/Account no is required for ${paymentMode.label}.`);
        } else if (paymentMode.requiresCardSource) {
          const digits = digitsOf(sheetRow.account);
          const kind = paymentMode.code === 'DEBIT_CARD' ? 'debit card' : 'credit card';
          if (digits.length < 4) errors.push(`Card/Account no "${sheetRow.account}" needs at least the card's last four digits.`);
          else {
            const lastFour = digits.slice(-4);
            const matches = cards.filter((c) => c.legalEntityId === legalEntity.id && c.type === paymentMode.code && c.maskedLastFour === lastFour);
            if (matches.length === 0) errors.push(`No ${kind} ending ${lastFour} for ${legalEntity.legalName} in Card Accounts.`);
            else if (matches.length > 1) errors.push(`More than one ${kind} ending ${lastFour} in Card Accounts.`);
            else if (!matches[0]!.isActive) errors.push(`The ${kind} ending ${lastFour} is inactive.`);
            else {
              cardAccountId = matches[0]!.id;
              paymentSourceLabel = `${matches[0]!.displayName.trim()} •••• ${lastFour}`;
            }
          }
        } else {
          const digits = digitsOf(sheetRow.account);
          const k = key(sheetRow.account);
          const own = bankAccounts.filter((b) => b.legalEntityId === legalEntity.id);
          const matches = own.filter(
            (b) =>
              key(b.accountName) === k ||
              (digits.length >= 4 && [b.maskedAccountNumber, b.invoiceAccountNumber].some((n) => digitsOf(n).length >= 4 && digitsOf(n).slice(-4) === digits.slice(-4))),
          );
          if (matches.length === 0) errors.push(`No bank account "${sheetRow.account}" for ${legalEntity.legalName} in Bank Accounts.`);
          else if (matches.length > 1) errors.push(`"${sheetRow.account}" matches more than one bank account. Use the full account number or the account name.`);
          else if (!matches[0]!.isActive) errors.push(`Bank account "${matches[0]!.accountName}" is inactive.`);
          else {
            bankAccountId = matches[0]!.id;
            paymentSourceLabel = matches[0]!.accountName;
          }
        }
      }

      // Expense category: the sheet's, or the default for a server or a subscription.
      let category: (typeof categories)[number] | undefined;
      if (sheetRow.category) {
        const k = key(sheetRow.category);
        category = categories.find((c) => key(c.name) === k || key(c.code) === k);
        if (!category) errors.push(`Expense Category "${sheetRow.category}" is not in Expense Categories.`);
      } else if (sheetRow.spendType) {
        category = categories.find((c) => c.code === DEFAULT_CATEGORY_CODE[sheetRow.spendType!]);
        if (!category) errors.push(`No default expense category for a ${sheetRow.spendType.toLowerCase()}: add an Expense Category column.`);
      }
      if (category && !category.isActive) errors.push(`Expense Category "${category.name}" is inactive.`);

      const amounts = this.amountsOf(sheetRow);
      const supplyType = amounts && amounts.gst.greaterThan(0) ? (choice?.supplyType ?? sheetRow.gstType ?? 'INTERSTATE') : null;

      if (amounts && legalEntity && sheetRow.expenseDate && sheetRow.title) {
        const dupKey = `${legalEntity.id}|${sheetRow.expenseDate}|${key(sheetRow.title)}|${amounts.amount.toFixed(2)}`;
        const earlierRow = seen.get(dupKey);
        if (earlierRow) errors.push(`Same bill as row ${earlierRow}.`);
        else seen.set(dupKey, sheetRow.rowNumber);
      }

      rows.push({
        rowNumber: sheetRow.rowNumber,
        employeeName: sheetRow.employee,
        employeeId,
        employeeChoices,
        title: sheetRow.title,
        spendType: sheetRow.spendType,
        expenseDate: sheetRow.expenseDate,
        legalEntityName: legalEntity?.legalName ?? (sheetRow.legalEntity || null),
        projectName: project?.name ?? (sheetRow.project || null),
        expenseCategoryName: category?.name ?? null,
        paymentModeLabel: paymentMode?.label ?? (sheetRow.paymentMode || null),
        paymentSourceLabel,
        taxableAmount: amounts ? amounts.taxable.toFixed(2) : null,
        gstAmount: amounts ? amounts.gst.toFixed(2) : null,
        amount: amounts ? amounts.amount.toFixed(2) : null,
        supplyType,
        transactionReference: sheetRow.reference || null,
        billUrl: sheetRow.billLink || null,
        errors,
      });

      if (errors.length === 0 && employeeId && amounts && legalEntity && category && paymentMode && sheetRow.spendType && sheetRow.expenseDate) {
        ready.push({
          rowNumber: sheetRow.rowNumber,
          legalEntityId: legalEntity.id,
          projectId: project?.id,
          expenseCategoryId: category.id,
          employeeId,
          title: sheetRow.title,
          spendType: sheetRow.spendType,
          expenseDate: sheetRow.expenseDate,
          paymentModeId: paymentMode.id,
          cardAccountId,
          bankAccountId,
          taxableAmount: amounts.taxable.toFixed(2),
          gstAmount: amounts.gst.toFixed(2),
          supplyType: supplyType ?? undefined,
          transactionReference: sheetRow.reference || undefined,
          billUrl: sheetRow.billLink || undefined,
        });
      }
    }

    await this.flagAlreadyRecorded(organizationId, rows, legalEntities, ownIds);

    const clear = rows.filter((r) => r.errors.length === 0);
    const clearRows = new Set(clear.map((r) => r.rowNumber));
    return {
      preview: {
        rows,
        validCount: clear.length,
        errorCount: rows.length - clear.length,
        needsChoiceCount: clear.filter((r) => !r.employeeId).length,
        totalAmount: clear.reduce((sum, r) => sum.plus(r.amount ?? 0), new Prisma.Decimal(0)).toFixed(2),
      },
      // The already-recorded check runs last, so it can still hold a row back.
      ready: ready.filter((r) => clearRows.has(r.rowNumber)),
    };
  }

  private amountsOf(row: SheetRow): { taxable: Prisma.Decimal; gst: Prisma.Decimal; amount: Prisma.Decimal } | null {
    if (!row.basic || !row.basic.greaterThan(0) || row.gst.isNegative()) return null;
    const taxable = money(row.basic);
    const gst = money(row.gst);
    return { taxable, gst, amount: taxable.plus(gst) };
  }

  /** A bill already posted (same company, date, name and rupee amount) is not posted twice. */
  private async flagAlreadyRecorded(
    organizationId: string,
    rows: ServerSubscriptionImportRow[],
    legalEntities: Array<{ id: string; legalName: string }>,
    ownIds: ReadonlySet<string>,
  ): Promise<void> {
    const dated = rows.filter((r) => r.expenseDate && r.amount && r.legalEntityName);
    if (dated.length === 0) return;
    const existing = await this.prisma.client.directExpense.findMany({
      where: {
        organizationId,
        status: 'POSTED',
        expenseDate: { in: [...new Set(dated.map((r) => new Date(`${r.expenseDate}T00:00:00.000Z`)))] },
      },
      select: { id: true, legalEntityId: true, expenseDate: true, title: true, amount: true },
    });
    const idByName = new Map(legalEntities.map((l) => [l.legalName, l.id]));
    for (const row of dated) {
      const legalEntityId = idByName.get(row.legalEntityName!);
      const match = existing.find(
        (e) =>
          !ownIds.has(e.id) &&
          e.legalEntityId === legalEntityId &&
          e.expenseDate.toISOString().slice(0, 10) === row.expenseDate &&
          key(e.title) === key(row.title) &&
          e.amount.toFixed(2) === row.amount,
      );
      if (match) row.errors.push('This bill is already recorded (same date, name and amount). Remove the row.');
    }
  }
}
