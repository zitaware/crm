import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type { CreditDebitNotePort, CreditDebitNoteSummary, CreditDebitNoteDetail, CreditDebitNoteFilters, CreditDebitNoteLineInput } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';
import { ProjectsService } from '../projects/projects.service';
import { isConstraintViolation } from '../organization/constraint-error.util';
import { LEDGER_CODES, computeLines } from '../invoices/invoices.service';

const CREATE_DRAFT_COMMAND_TYPE = 'credit_debit_note.create_draft';
const FINALIZE_COMMAND_TYPE = 'credit_debit_note.finalize';
const VOID_COMMAND_TYPE = 'credit_debit_note.void';
const MAX_NUMBER_ATTEMPTS = 5;

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Same local helper as invoices.service.ts/posting.service.ts. */
function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** Same shallow-sorted-keys sha256 shape as every prior slice's own
 * hashRequest — reimplemented locally per that established precedent. */
function hashRequest(input: unknown): string {
  const normalized = JSON.stringify(input, Object.keys(input as object).sort());
  return createHash('sha256').update(normalized).digest('hex');
}

function notePrefix(type: 'CREDIT' | 'DEBIT'): string {
  return type === 'CREDIT' ? 'CN' : 'DN';
}

const summaryInclude = {
  invoice: true,
  project: true,
  legalEntity: true,
  gstRegistration: true,
} satisfies Prisma.CreditDebitNoteInclude;

const detailInclude = {
  ...summaryInclude,
  lines: { orderBy: { sequence: 'asc' } },
} satisfies Prisma.CreditDebitNoteInclude;

type SummaryRow = Prisma.CreditDebitNoteGetPayload<{ include: typeof summaryInclude }>;
type DetailRow = Prisma.CreditDebitNoteGetPayload<{ include: typeof detailInclude }>;

function toSummary(row: SummaryRow): CreditDebitNoteSummary {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoice.invoiceNumber,
    projectId: row.projectId,
    projectName: row.project.name,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    gstRegistrationId: row.gstRegistrationId,
    gstRegistrationGstin: row.gstRegistration.gstin,
    type: row.type,
    status: row.status,
    reason: row.reason,
    noteNumber: row.noteNumber,
    noteDate: row.noteDate ? toDateStr(row.noteDate) : null,
    taxableAmount: row.taxableAmount?.toFixed(2) ?? null,
    cgstAmount: row.cgstAmount?.toFixed(2) ?? null,
    sgstAmount: row.sgstAmount?.toFixed(2) ?? null,
    igstAmount: row.igstAmount?.toFixed(2) ?? null,
    totalAmount: row.totalAmount?.toFixed(2) ?? null,
    journalEntryId: row.journalEntryId,
    voidJournalEntryId: row.voidJournalEntryId,
    voidReason: row.voidReason,
    voidedBy: row.voidedBy,
    voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    version: row.version,
  };
}

function toDetail(row: DetailRow): CreditDebitNoteDetail {
  return {
    ...toSummary(row),
    lines: row.lines.map((l) => ({
      id: l.id,
      sequence: l.sequence,
      description: l.description,
      hsnSac: l.hsnSac,
      quantity: l.quantity.toFixed(2),
      unitPrice: l.unitPrice.toFixed(2),
      taxableAmount: l.taxableAmount.toFixed(2),
      gstRatePercent: l.gstRatePercent.toFixed(2),
      cgstAmount: l.cgstAmount.toFixed(2),
      sgstAmount: l.sgstAmount.toFixed(2),
      igstAmount: l.igstAmount.toFixed(2),
      lineTotal: l.lineTotal.toFixed(2),
    })),
  };
}

@Injectable()
export class CreditDebitNotesService implements CreditDebitNotePort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
    private readonly projects: ProjectsService,
  ) {}

  private async generateNoteNumber(
    tx: Prisma.TransactionClient,
    organizationId: string,
    gstRegistrationId: string,
    financialYearId: string,
    type: 'CREDIT' | 'DEBIT',
    attempt: number,
  ): Promise<string> {
    const count = await tx.creditDebitNote.count({
      where: { organizationId, gstRegistrationId, financialYearId, type, noteNumber: { not: null } },
    });
    return `${notePrefix(type)}-${String(count + 1 + attempt).padStart(4, '0')}`;
  }

  async createDraft(input: {
    organizationId: string;
    invoiceId: string;
    type: 'CREDIT' | 'DEBIT';
    reason: string;
    lines: CreditDebitNoteLineInput[];
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<CreditDebitNoteSummary> {
    const requestHash = hashRequest({ invoiceId: input.invoiceId, type: input.type, reason: input.reason, lines: input.lines });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: CREATE_DRAFT_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as CreditDebitNoteSummary;
    }

    if (input.lines.length === 0) throwAppError('VALIDATION_FAILED', 'At least one line item is required.');
    const reason = input.reason.trim();
    if (!reason) throwAppError('VALIDATION_FAILED', 'A reason is required.');

    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: input.invoiceId, organizationId: input.organizationId },
      include: { project: { include: { client: true } }, gstRegistration: true },
    });
    if (!invoice) throwAppError('NOT_FOUND', 'Invoice not found.');
    if (invoice.status !== 'FINALIZED') throwAppError('INVALID_STATE_TRANSITION', 'A credit/debit note can only be raised against a finalized invoice.');

    const sameState = invoice.project.client.stateId === invoice.gstRegistration.stateId;
    const computedLines = computeLines(input.lines, sameState);

    const noteId = generateId();
    return await this.prisma.client.$transaction(async (tx) => {
      await tx.creditDebitNote.create({
        data: {
          id: noteId,
          organizationId: input.organizationId,
          invoiceId: invoice.id,
          projectId: invoice.projectId,
          legalEntityId: invoice.legalEntityId,
          gstRegistrationId: invoice.gstRegistrationId,
          type: input.type,
          status: 'DRAFT',
          reason,
          createdBy: input.actorId,
        },
      });

      await tx.creditDebitNoteLine.createMany({
        data: computedLines.map((l) => ({
          id: generateId(),
          organizationId: input.organizationId,
          creditDebitNoteId: noteId,
          sequence: l.sequence,
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
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'CREDIT_DEBIT_NOTE',
        entityId: noteId,
        action: 'CREDIT_DEBIT_NOTE_DRAFT_CREATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { invoiceId: invoice.id, type: input.type, lineCount: input.lines.length },
      });

      const created = await tx.creditDebitNote.findFirstOrThrow({ where: { id: noteId }, include: summaryInclude });
      const summary = toSummary(created);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: CREATE_DRAFT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'CREDIT_DEBIT_NOTE',
          sourceRecordId: noteId,
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
    reason: string | undefined;
    lines: CreditDebitNoteLineInput[] | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<CreditDebitNoteSummary> {
    const note = await this.prisma.client.creditDebitNote.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: { invoice: { include: { project: { include: { client: true } }, gstRegistration: true } } },
    });
    if (!note) throwAppError('NOT_FOUND', 'Credit/debit note not found.');
    if (note.status !== 'DRAFT') throwAppError('INVALID_STATE_TRANSITION', 'Only a draft note can be updated.');

    const data: Prisma.CreditDebitNoteUpdateInput = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.reason !== undefined) {
      const reason = input.reason.trim();
      if (!reason) throwAppError('VALIDATION_FAILED', 'A reason is required.');
      data.reason = reason;
    }

    return await this.prisma.client.$transaction(async (tx) => {
      if (input.lines !== undefined) {
        if (input.lines.length === 0) throwAppError('VALIDATION_FAILED', 'At least one line item is required.');
        const sameState = note.invoice.project.client.stateId === note.invoice.gstRegistration.stateId;
        const computedLines = computeLines(input.lines, sameState);
        await tx.creditDebitNoteLine.deleteMany({ where: { creditDebitNoteId: note.id } });
        await tx.creditDebitNoteLine.createMany({
          data: computedLines.map((l) => ({
            id: generateId(),
            organizationId: input.organizationId,
            creditDebitNoteId: note.id,
            sequence: l.sequence,
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
        });
      }

      const { count } = await tx.creditDebitNote.updateMany({ where: { id: note.id, version: input.expectedVersion }, data });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This note was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'CREDIT_DEBIT_NOTE',
        entityId: note.id,
        action: 'CREDIT_DEBIT_NOTE_UPDATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { reason: input.reason },
      });

      const updated = await tx.creditDebitNote.findFirstOrThrow({ where: { id: note.id }, include: summaryInclude });
      return toSummary(updated);
    });
  }

  async finalize(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<CreditDebitNoteSummary> {
    const requestHash = hashRequest({ id: input.id });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: FINALIZE_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as CreditDebitNoteSummary;
    }

    const note = await this.prisma.client.creditDebitNote.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: { lines: true, invoice: true, project: true },
    });
    if (!note) throwAppError('NOT_FOUND', 'Credit/debit note not found.');
    if (note.status !== 'DRAFT') throwAppError('INVALID_STATE_TRANSITION', 'Only a draft note can be finalized.');
    if (note.lines.length === 0) throwAppError('VALIDATION_FAILED', 'At least one line item is required.');
    // The source invoice could have been voided after this draft was
    // created — re-validate against current state, not the draft-time
    // assumption (same defensive re-check Invoice.finalize's own CAPEX-cap
    // logic already applies to live milestone data).
    if (note.invoice.status !== 'FINALIZED') throwAppError('INVALID_STATE_TRANSITION', 'The source invoice is no longer finalized.');

    const taxableAmount = note.lines.reduce((sum, l) => sum.plus(l.taxableAmount), new Prisma.Decimal(0));
    const cgstAmount = note.lines.reduce((sum, l) => sum.plus(l.cgstAmount), new Prisma.Decimal(0));
    const sgstAmount = note.lines.reduce((sum, l) => sum.plus(l.sgstAmount), new Prisma.Decimal(0));
    const igstAmount = note.lines.reduce((sum, l) => sum.plus(l.igstAmount), new Prisma.Decimal(0));
    const totalAmount = taxableAmount.plus(cgstAmount).plus(sgstAmount).plus(igstAmount);

    if (note.type === 'CREDIT') {
      const otherCredited = await this.prisma.client.creditDebitNote.aggregate({
        where: { organizationId: input.organizationId, invoiceId: note.invoiceId, type: 'CREDIT', status: 'FINALIZED', id: { not: note.id } },
        _sum: { taxableAmount: true },
      });
      const totalCredited = (otherCredited._sum.taxableAmount ?? new Prisma.Decimal(0)).plus(taxableAmount);
      const invoiceTaxable = note.invoice.taxableAmount ?? new Prisma.Decimal(0);
      if (totalCredited.greaterThan(invoiceTaxable)) {
        throwAppError('VALIDATION_FAILED', `Total credited value (${totalCredited.toFixed(2)}) would exceed the invoice's taxable amount (${invoiceTaxable.toFixed(2)}).`);
      }
    }

    // Always posts into whatever accounting period is open today — never
    // forced into the original invoice's own period, matching the
    // Reversal Mechanism precedent (ADR-067).
    const accountingDateStr = toDateStr(new Date());
    const accountingDate = toDate(accountingDateStr);
    const financialYear = await this.prisma.client.financialYear.findFirst({
      where: { organizationId: input.organizationId, legalEntityId: note.legalEntityId, startDate: { lte: accountingDate }, endDate: { gte: accountingDate } },
    });
    if (!financialYear) throwAppError('VALIDATION_FAILED', "No financial year covers today's date for the selected legal entity.");

    const ledgerAccounts = await this.prisma.client.ledgerAccount.findMany({
      where: { organizationId: input.organizationId, code: { in: Object.values(LEDGER_CODES) } },
    });
    const byCode = new Map(ledgerAccounts.map((a) => [a.code, a]));
    const arAccount = byCode.get(LEDGER_CODES.ar);
    const revenueAccount = byCode.get(LEDGER_CODES.revenue);
    if (!arAccount || !revenueAccount) throwAppError('VALIDATION_FAILED', 'Required ledger accounts (Accounts Receivable / Project Revenue) are not configured.');
    if (cgstAmount.greaterThan(0) && !byCode.get(LEDGER_CODES.cgst)) throwAppError('VALIDATION_FAILED', 'Output CGST Payable ledger account is not configured.');
    if (sgstAmount.greaterThan(0) && !byCode.get(LEDGER_CODES.sgst)) throwAppError('VALIDATION_FAILED', 'Output SGST Payable ledger account is not configured.');
    if (igstAmount.greaterThan(0) && !byCode.get(LEDGER_CODES.igst)) throwAppError('VALIDATION_FAILED', 'Output IGST Payable ledger account is not configured.');

    const countSoFar = await this.prisma.client.creditDebitNote.count({
      where: { organizationId: input.organizationId, gstRegistrationId: note.gstRegistrationId, financialYearId: financialYear.id, type: note.type, noteNumber: { not: null } },
    });
    const previewNumber = `${notePrefix(note.type)}-${String(countSoFar + 1).padStart(4, '0')}`;

    const isCredit = note.type === 'CREDIT';
    const gstLines = [
      ...(cgstAmount.greaterThan(0) ? [{ ledgerAccountId: byCode.get(LEDGER_CODES.cgst)!.id, amount: cgstAmount, taxCode: 'CGST' }] : []),
      ...(sgstAmount.greaterThan(0) ? [{ ledgerAccountId: byCode.get(LEDGER_CODES.sgst)!.id, amount: sgstAmount, taxCode: 'SGST' }] : []),
      ...(igstAmount.greaterThan(0) ? [{ ledgerAccountId: byCode.get(LEDGER_CODES.igst)!.id, amount: igstAmount, taxCode: 'IGST' }] : []),
    ].map((g) => ({
      ledgerAccountId: g.ledgerAccountId,
      debit: isCredit ? g.amount.toFixed(2) : '0',
      credit: isCredit ? '0' : g.amount.toFixed(2),
      projectId: note.projectId,
      partyId: undefined,
      employeeId: undefined,
      gstRegistrationId: note.gstRegistrationId,
      taxCode: g.taxCode,
      narrative: undefined,
    }));

    // Credit Note (docs/06): "Reverse revenue/output tax/receivable
    // according to the credited values" -- the literal mirror of
    // Invoice.finalize's own journal, debit/credit swapped. Debit Note has
    // no frozen docs/06 rule -- confirmed with the user to post the same
    // direction as Invoice.finalize's own journal.
    const journalLines = isCredit
      ? [
          { ledgerAccountId: revenueAccount.id, debit: taxableAmount.toFixed(2), credit: '0', projectId: note.projectId, partyId: undefined, employeeId: undefined, gstRegistrationId: note.gstRegistrationId, taxCode: undefined, narrative: note.reason },
          ...gstLines,
          { ledgerAccountId: arAccount.id, debit: '0', credit: totalAmount.toFixed(2), projectId: note.projectId, partyId: note.project.clientId, employeeId: undefined, gstRegistrationId: note.gstRegistrationId, taxCode: undefined, narrative: undefined },
        ]
      : [
          { ledgerAccountId: arAccount.id, debit: totalAmount.toFixed(2), credit: '0', projectId: note.projectId, partyId: note.project.clientId, employeeId: undefined, gstRegistrationId: note.gstRegistrationId, taxCode: undefined, narrative: note.reason },
          { ledgerAccountId: revenueAccount.id, debit: '0', credit: taxableAmount.toFixed(2), projectId: note.projectId, partyId: undefined, employeeId: undefined, gstRegistrationId: note.gstRegistrationId, taxCode: undefined, narrative: undefined },
          ...gstLines,
        ];

    // Journal-first, then the note update -- same sequential pattern every
    // finalize-style command in this codebase already established
    // (Invoice.finalize, SecurityInstrumentsService.lodge, ADR-066).
    const journal = await this.posting.postJournal({
      organizationId: input.organizationId,
      legalEntityId: note.legalEntityId,
      accountingDate: accountingDateStr,
      sourceType: isCredit ? 'credit_note_issue' : 'debit_note_issue',
      sourceId: note.id,
      postingEvent: isCredit ? 'credit_note.finalized' : 'debit_note.finalized',
      description: `${previewNumber} finalized against invoice ${note.invoice.invoiceNumber ?? ''}`,
      lines: journalLines,
      idempotencyKey: `${FINALIZE_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          const noteNumber = await this.generateNoteNumber(tx, input.organizationId, note.gstRegistrationId, financialYear.id, note.type, attempt);

          const { count } = await tx.creditDebitNote.updateMany({
            where: { id: note.id, status: 'DRAFT' },
            data: {
              status: 'FINALIZED',
              noteNumber,
              noteDate: accountingDate,
              financialYearId: financialYear.id,
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
          if (count === 0) throwAppError('INVALID_STATE_TRANSITION', 'Only a draft note can be finalized.');

          await recordAuditEvent(tx, {
            organizationId: input.organizationId,
            entityType: 'CREDIT_DEBIT_NOTE',
            entityId: note.id,
            action: 'CREDIT_DEBIT_NOTE_FINALIZED',
            actorId: input.actorId,
            correlationId: input.correlationId,
            newValues: { noteNumber, totalAmount: totalAmount.toFixed(2), journalEntryId: journal.id },
          });

          const updated = await tx.creditDebitNote.findFirstOrThrow({ where: { id: note.id }, include: summaryInclude });
          const summary = toSummary(updated);

          await tx.idempotencyKey.create({
            data: {
              id: generateId(),
              organizationId: input.organizationId,
              commandType: FINALIZE_COMMAND_TYPE,
              idempotencyKey: input.idempotencyKey,
              requestHash,
              sourceRecordType: 'CREDIT_DEBIT_NOTE',
              sourceRecordId: note.id,
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

  async void(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string | undefined;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<CreditDebitNoteSummary> {
    const requestHash = hashRequest({ id: input.id, reason: input.reason, accountingDate: input.accountingDate });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: VOID_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as CreditDebitNoteSummary;
    }

    const reason = input.reason.trim();
    if (!reason) throwAppError('VALIDATION_FAILED', 'A reason is required to void a note.');

    const note = await this.prisma.client.creditDebitNote.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!note) throwAppError('NOT_FOUND', 'Credit/debit note not found.');
    if (note.status === 'VOID') throwAppError('INVALID_STATE_TRANSITION', 'This note has already been voided.');

    let voidJournalEntryId: string | null = null;
    if (note.status === 'FINALIZED') {
      if (!note.journalEntryId) throwAppError('VALIDATION_FAILED', 'This finalized note has no journal entry to reverse.');
      if (!input.accountingDate) throwAppError('VALIDATION_FAILED', 'An accounting date is required to void a finalized note.');
      const reversal = await this.posting.reverseJournal({
        organizationId: input.organizationId,
        id: note.journalEntryId,
        accountingDate: input.accountingDate,
        reason,
        idempotencyKey: `${VOID_COMMAND_TYPE}:${input.idempotencyKey}`,
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
      voidJournalEntryId = reversal.id;
    }

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.creditDebitNote.updateMany({
        where: { id: note.id, version: input.expectedVersion, status: { not: 'VOID' } },
        data: { status: 'VOID', voidReason: reason, voidedBy: input.actorId, voidedAt: new Date(), voidJournalEntryId, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This note was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'CREDIT_DEBIT_NOTE',
        entityId: note.id,
        action: 'CREDIT_DEBIT_NOTE_VOIDED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { voidReason: reason, voidJournalEntryId },
      });

      const updated = await tx.creditDebitNote.findFirstOrThrow({ where: { id: note.id }, include: summaryInclude });
      const summary = toSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: VOID_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'CREDIT_DEBIT_NOTE',
          sourceRecordId: note.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async list(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: CreditDebitNoteFilters;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<{ rows: CreditDebitNoteSummary[]; total: number }> {
    const where: Prisma.CreditDebitNoteWhereInput = { organizationId: input.organizationId };
    if (input.filters.invoiceId) where.invoiceId = input.filters.invoiceId;
    if (input.filters.projectId) where.projectId = input.filters.projectId;
    if (input.filters.type) where.type = input.filters.type;
    if (input.filters.status) where.status = input.filters.status;

    if (!input.canSeeAll) {
      const assignedProjects = await this.projects.list({ organizationId: input.organizationId, actorId: input.actorId, canSeeAll: false });
      const assignedProjectIds = assignedProjects.map((p) => p.id);
      where.projectId = input.filters.projectId ? (assignedProjectIds.includes(input.filters.projectId) ? input.filters.projectId : '__none__') : { in: assignedProjectIds };
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.creditDebitNote.findMany({
        where,
        include: summaryInclude,
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.client.creditDebitNote.count({ where }),
    ]);

    return { rows: rows.map(toSummary), total };
  }

  async getDetail(input: { organizationId: string; id: string; actorId: string; canSeeAll: boolean }): Promise<CreditDebitNoteDetail> {
    const row = await this.prisma.client.creditDebitNote.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: detailInclude });
    if (!row) throwAppError('NOT_FOUND', 'Credit/debit note not found.');
    await this.projects.getDetail({ organizationId: input.organizationId, id: row.projectId, actorId: input.actorId, canSeeAll: input.canSeeAll });
    return toDetail(row);
  }
}
