import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  SecurityInstrumentPort,
  SecurityInstrumentSummary,
  SecurityInstrumentDetail,
  SecurityInstrumentFilters,
  SecurityInstrumentTiles,
  SecurityInstrumentDerivedLabel,
  SecurityInstrumentPurposeOption,
  SecurityInstrumentTypeOption,
  LodgeSecurityInstrumentInput,
  RecordSecurityInstrumentReturnInput,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';

const LODGE_COMMAND_TYPE = 'security_instrument.lodge';
const RETURN_COMMAND_TYPE = 'security_instrument.return';

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Prisma requires a full ISO-8601 DateTime (or a Date instance) for
 * @db.Date columns — a bare 'YYYY-MM-DD' string is rejected. Same local
 * helper as posting.service.ts. */
function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function todayDateOnly(): Date {
  return toDate(toDateStr(new Date()));
}

/** Same shallow-sorted-keys sha256 shape as hashRequest in
 * posting.service.ts / packages/contracts/src/routers/users.ts —
 * reimplemented locally per that same established precedent. */
function hashRequest(input: unknown): string {
  const normalized = JSON.stringify(input, Object.keys(input as object).sort());
  return createHash('sha256').update(normalized).digest('hex');
}

const summaryInclude = {
  legalEntity: true,
  project: true,
  tender: true,
  purpose: true,
  type: true,
  bankLedgerAccount: true,
} satisfies Prisma.SecurityInstrumentInclude;

const detailInclude = {
  ...summaryInclude,
  fundedByLegalEntity: true,
  fundedByParty: true,
  returnedToLegalEntity: true,
  returnedToParty: true,
} satisfies Prisma.SecurityInstrumentInclude;

type SummaryRow = Prisma.SecurityInstrumentGetPayload<{ include: typeof summaryInclude }>;
type DetailRow = Prisma.SecurityInstrumentGetPayload<{ include: typeof detailInclude }>;

function derivedLabel(row: { status: string; returnDueOn: Date }): SecurityInstrumentDerivedLabel {
  if (row.status === 'RETURNED') return 'RETURNED';
  return row.returnDueOn < todayDateOnly() ? 'RETURN_DUE' : 'LODGED';
}

function toSummary(row: SummaryRow): SecurityInstrumentSummary {
  return {
    id: row.id,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    projectId: row.projectId,
    projectName: row.project?.name ?? null,
    tenderId: row.tenderId,
    tenderName: row.tender?.title ?? null,
    purposeId: row.purposeId,
    purposeName: row.purpose.name,
    purposeCategory: (row.purpose.category) ?? null,
    typeId: row.typeId,
    typeName: row.type.name,
    requiresCashPosting: row.type.requiresCashPosting,
    amount: row.amount.toFixed(2),
    instrumentReferenceNo: row.instrumentReferenceNo,
    issuingBank: row.issuingBank,
    lodgedWithAuthority: row.lodgedWithAuthority,
    bankLedgerAccountId: row.bankLedgerAccountId,
    bankLedgerAccountName: row.bankLedgerAccount?.name ?? null,
    submittedOn: toDateStr(row.submittedOn),
    returnDueOn: toDateStr(row.returnDueOn),
    status: row.status,
    derivedLabel: derivedLabel(row),
    lodgeJournalEntryId: row.lodgeJournalEntryId,
    returnedAmount: row.returnedAmount?.toFixed(2) ?? null,
    returnedOn: row.returnedOn ? toDateStr(row.returnedOn) : null,
    returnJournalEntryId: row.returnJournalEntryId,
  };
}

function toDetail(row: DetailRow): SecurityInstrumentDetail {
  return {
    ...toSummary(row),
    narrative: row.narrative,
    fundedByLegalEntityId: row.fundedByLegalEntityId,
    fundedByLegalEntityName: row.fundedByLegalEntity?.legalName ?? null,
    fundedByPartyId: row.fundedByPartyId,
    fundedByPartyName: row.fundedByParty?.name ?? null,
    fundedByBankAccountDetails: row.fundedByBankAccountDetails,
    fundedByTransferAmount: row.fundedByTransferAmount?.toFixed(2) ?? null,
    fundedByTransferMode: row.fundedByTransferMode,
    fundedByNote: row.fundedByNote,
    returnedToLegalEntityId: row.returnedToLegalEntityId,
    returnedToLegalEntityName: row.returnedToLegalEntity?.legalName ?? null,
    returnedToPartyId: row.returnedToPartyId,
    returnedToPartyName: row.returnedToParty?.name ?? null,
    returnedToBankAccountDetails: row.returnedToBankAccountDetails,
  };
}

@Injectable()
export class SecurityInstrumentsService implements SecurityInstrumentPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  async listPurposes(input: { organizationId: string }): Promise<SecurityInstrumentPurposeOption[]> {
    const rows = await this.prisma.client.securityInstrumentPurpose.findMany({
      where: { organizationId: input.organizationId, isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      category: (row.category) ?? null,
      hasDefaultLedgerAccount: row.defaultRecoverableLedgerAccountId !== null,
    }));
  }

  async listTypes(input: { organizationId: string }): Promise<SecurityInstrumentTypeOption[]> {
    const rows = await this.prisma.client.securityInstrumentType.findMany({
      where: { organizationId: input.organizationId, isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, requiresCashPosting: row.requiresCashPosting }));
  }

  async lodge(input: LodgeSecurityInstrumentInput): Promise<SecurityInstrumentSummary> {
    if (!input.projectId && !input.tenderId) {
      throwAppError('VALIDATION_FAILED', 'A security instrument must reference a project.');
    }
    if (input.fundedByLegalEntityId && input.fundedByPartyId) {
      throwAppError('VALIDATION_FAILED', 'Funding entity must be a Legal Entity or a Party, not both.');
    }

    const requestHash = hashRequest({
      legalEntityId: input.legalEntityId,
      projectId: input.projectId,
      tenderId: input.tenderId,
      purposeId: input.purposeId,
      typeId: input.typeId,
      amount: input.amount,
      instrumentReferenceNo: input.instrumentReferenceNo,
      issuingBank: input.issuingBank,
      lodgedWithAuthority: input.lodgedWithAuthority,
      bankLedgerAccountId: input.bankLedgerAccountId,
      submittedOn: input.submittedOn,
      returnDueOn: input.returnDueOn,
      narrative: input.narrative,
      fundedByLegalEntityId: input.fundedByLegalEntityId,
      fundedByPartyId: input.fundedByPartyId,
      fundedByBankAccountDetails: input.fundedByBankAccountDetails,
      fundedByTransferAmount: input.fundedByTransferAmount,
      fundedByTransferMode: input.fundedByTransferMode,
      fundedByNote: input.fundedByNote,
    });

    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: {
        organizationId_commandType_idempotencyKey: {
          organizationId: input.organizationId,
          commandType: LODGE_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) {
        throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      }
      return existingKey.resultReference as unknown as SecurityInstrumentSummary;
    }

    const [legalEntity, purpose, type] = await Promise.all([
      this.prisma.client.legalEntity.findFirst({ where: { id: input.legalEntityId, organizationId: input.organizationId } }),
      this.prisma.client.securityInstrumentPurpose.findFirst({ where: { id: input.purposeId, organizationId: input.organizationId } }),
      this.prisma.client.securityInstrumentType.findFirst({ where: { id: input.typeId, organizationId: input.organizationId } }),
    ]);
    if (!legalEntity) throwAppError('NOT_FOUND', 'Legal entity not found.');
    if (!purpose) throwAppError('NOT_FOUND', 'Security instrument purpose not found.');
    if (!type) throwAppError('NOT_FOUND', 'Security instrument type not found.');

    const amount = new Prisma.Decimal(input.amount);
    if (!amount.greaterThan(0)) {
      throwAppError('VALIDATION_FAILED', 'Amount must be greater than zero.');
    }

    let bankLedgerAccountId: string | null = null;
    let lodgeJournalEntryId: string | null = null;
    const instrumentId = generateId();

    if (type.requiresCashPosting) {
      if (!input.bankLedgerAccountId) {
        throwAppError('VALIDATION_FAILED', 'A bank/source ledger account is required for this instrument type.');
      }
      if (!purpose.defaultRecoverableLedgerAccountId) {
        throwAppError('VALIDATION_FAILED', `No recoverable ledger account is configured for purpose "${purpose.name}".`);
      }
      const bankAccount = await this.prisma.client.ledgerAccount.findFirst({
        where: { id: input.bankLedgerAccountId, organizationId: input.organizationId },
      });
      if (!bankAccount) throwAppError('NOT_FOUND', 'Bank/source ledger account not found.');
      bankLedgerAccountId = bankAccount.id;

      // Deterministically derived from this lodge attempt's own idempotency
      // key (not a fresh random value) — even without a shared database
      // transaction spanning both postJournal's own commit and this
      // service's instrument-row commit below, a retried lodge() call
      // (same idempotencyKey) converges on exactly one journal entry
      // instead of creating an orphaned duplicate.
      const journal = await this.posting.postJournal({
        organizationId: input.organizationId,
        legalEntityId: input.legalEntityId,
        accountingDate: input.submittedOn,
        sourceType: 'security_instrument_lodge',
        sourceId: instrumentId,
        postingEvent: 'security_instrument.lodged',
        description: `${purpose.name} lodged — ${type.name}`,
        lines: [
          {
            ledgerAccountId: purpose.defaultRecoverableLedgerAccountId,
            debit: amount.toFixed(2),
            credit: '0',
            projectId: input.projectId,
            partyId: undefined,
            employeeId: undefined,
            gstRegistrationId: undefined,
            taxCode: undefined,
            narrative: input.narrative,
          },
          {
            ledgerAccountId: bankAccount.id,
            debit: '0',
            credit: amount.toFixed(2),
            projectId: input.projectId,
            partyId: undefined,
            employeeId: undefined,
            gstRegistrationId: undefined,
            taxCode: undefined,
            narrative: input.narrative,
          },
        ],
        idempotencyKey: `${LODGE_COMMAND_TYPE}:${input.idempotencyKey}`,
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
      lodgeJournalEntryId = journal.id;
    }

    const created = await this.prisma.client.$transaction(async (tx) => {
      await tx.securityInstrument.create({
        data: {
          id: instrumentId,
          organizationId: input.organizationId,
          legalEntityId: input.legalEntityId,
          projectId: input.projectId ?? null,
          tenderId: input.tenderId ?? null,
          purposeId: input.purposeId,
          typeId: input.typeId,
          amount,
          instrumentReferenceNo: input.instrumentReferenceNo ?? null,
          issuingBank: input.issuingBank ?? null,
          lodgedWithAuthority: input.lodgedWithAuthority ?? null,
          bankLedgerAccountId,
          submittedOn: toDate(input.submittedOn),
          returnDueOn: toDate(input.returnDueOn),
          status: 'LODGED',
          lodgeJournalEntryId,
          fundedByLegalEntityId: input.fundedByLegalEntityId ?? null,
          fundedByPartyId: input.fundedByPartyId ?? null,
          fundedByBankAccountDetails: input.fundedByBankAccountDetails ?? null,
          fundedByTransferAmount: input.fundedByTransferAmount ? new Prisma.Decimal(input.fundedByTransferAmount) : null,
          fundedByTransferMode: input.fundedByTransferMode ?? null,
          fundedByNote: input.fundedByNote ?? null,
          narrative: input.narrative ?? null,
          createdBy: input.actorId,
        },
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'SECURITY_INSTRUMENT',
        entityId: instrumentId,
        action: 'SECURITY_INSTRUMENT_LODGED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: {
          purposeId: input.purposeId,
          typeId: input.typeId,
          amount: amount.toFixed(2),
          projectId: input.projectId ?? null,
          tenderId: input.tenderId ?? null,
          lodgeJournalEntryId,
        },
      });

      const row = await tx.securityInstrument.findFirstOrThrow({ where: { id: instrumentId }, include: summaryInclude });
      const summary = toSummary(row);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: LODGE_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'SECURITY_INSTRUMENT',
          sourceRecordId: instrumentId,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });

    return created;
  }

  async recordReturn(input: RecordSecurityInstrumentReturnInput): Promise<SecurityInstrumentSummary> {
    if (input.returnedToLegalEntityId && input.returnedToPartyId) {
      throwAppError('VALIDATION_FAILED', 'Returned-to entity must be a Legal Entity or a Party, not both.');
    }

    const requestHash = hashRequest({
      id: input.id,
      returnedAmount: input.returnedAmount,
      returnedOn: input.returnedOn,
      returnedToLegalEntityId: input.returnedToLegalEntityId,
      returnedToPartyId: input.returnedToPartyId,
      returnedToBankAccountDetails: input.returnedToBankAccountDetails,
    });

    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: {
        organizationId_commandType_idempotencyKey: {
          organizationId: input.organizationId,
          commandType: RETURN_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) {
        throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      }
      return existingKey.resultReference as unknown as SecurityInstrumentSummary;
    }

    const instrument = await this.prisma.client.securityInstrument.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: { purpose: true },
    });
    if (!instrument) throwAppError('NOT_FOUND', 'Security instrument not found.');
    if (instrument.status !== 'LODGED') {
      throwAppError('INVALID_STATE_TRANSITION', 'This security instrument has already been returned.');
    }

    const returnedAmount = new Prisma.Decimal(input.returnedAmount);
    if (!returnedAmount.equals(instrument.amount)) {
      throwAppError(
        'VALIDATION_FAILED',
        `Returned amount must equal the lodged amount (${instrument.amount.toFixed(2)}) exactly — penalty-deducted returns are not yet supported.`,
      );
    }

    let returnJournalEntryId: string | null = null;
    if (instrument.lodgeJournalEntryId && instrument.purpose.defaultRecoverableLedgerAccountId && instrument.bankLedgerAccountId) {
      const journal = await this.posting.postJournal({
        organizationId: input.organizationId,
        legalEntityId: instrument.legalEntityId,
        accountingDate: input.returnedOn,
        sourceType: 'security_instrument_return',
        sourceId: instrument.id,
        postingEvent: 'security_instrument.returned',
        description: `${instrument.purpose.name} returned`,
        lines: [
          {
            ledgerAccountId: instrument.bankLedgerAccountId,
            debit: returnedAmount.toFixed(2),
            credit: '0',
            projectId: instrument.projectId ?? undefined,
            partyId: undefined,
            employeeId: undefined,
            gstRegistrationId: undefined,
            taxCode: undefined,
            narrative: instrument.narrative ?? undefined,
          },
          {
            ledgerAccountId: instrument.purpose.defaultRecoverableLedgerAccountId,
            debit: '0',
            credit: returnedAmount.toFixed(2),
            projectId: instrument.projectId ?? undefined,
            partyId: undefined,
            employeeId: undefined,
            gstRegistrationId: undefined,
            taxCode: undefined,
            narrative: instrument.narrative ?? undefined,
          },
        ],
        idempotencyKey: `${RETURN_COMMAND_TYPE}:${input.idempotencyKey}`,
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
      returnJournalEntryId = journal.id;
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      await tx.securityInstrument.update({
        where: { id: instrument.id },
        data: {
          status: 'RETURNED',
          returnedAmount,
          returnedOn: toDate(input.returnedOn),
          returnedToLegalEntityId: input.returnedToLegalEntityId ?? null,
          returnedToPartyId: input.returnedToPartyId ?? null,
          returnedToBankAccountDetails: input.returnedToBankAccountDetails ?? null,
          returnJournalEntryId,
          updatedBy: input.actorId,
          version: { increment: 1 },
        },
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'SECURITY_INSTRUMENT',
        entityId: instrument.id,
        action: 'SECURITY_INSTRUMENT_RETURNED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { returnedAmount: returnedAmount.toFixed(2), returnedOn: input.returnedOn, returnJournalEntryId },
      });

      const row = await tx.securityInstrument.findFirstOrThrow({ where: { id: instrument.id }, include: summaryInclude });
      const summary = toSummary(row);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: RETURN_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'SECURITY_INSTRUMENT',
          sourceRecordId: instrument.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });

    return updated;
  }

  async list(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: SecurityInstrumentFilters;
  }): Promise<{ rows: SecurityInstrumentSummary[]; total: number }> {
    const where: Prisma.SecurityInstrumentWhereInput = { organizationId: input.organizationId };
    if (input.filters.category) where.purpose = { category: input.filters.category };
    if (input.filters.projectId) where.projectId = input.filters.projectId;
    if (input.filters.tenderId) where.tenderId = input.filters.tenderId;
    if (input.filters.status) where.status = input.filters.status;
    if (input.filters.returnDueFrom || input.filters.returnDueTo) {
      where.returnDueOn = {
        ...(input.filters.returnDueFrom ? { gte: toDate(input.filters.returnDueFrom) } : {}),
        ...(input.filters.returnDueTo ? { lte: toDate(input.filters.returnDueTo) } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.securityInstrument.findMany({
        where,
        include: summaryInclude,
        orderBy: { submittedOn: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.client.securityInstrument.count({ where }),
    ]);

    return { rows: rows.map(toSummary), total };
  }

  async getDetail(input: { organizationId: string; id: string }): Promise<SecurityInstrumentDetail> {
    const row = await this.prisma.client.securityInstrument.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: detailInclude,
    });
    if (!row) throwAppError('NOT_FOUND', 'Security instrument not found.');
    return toDetail(row);
  }

  async getTiles(input: { organizationId: string; projectId: string | undefined }): Promise<SecurityInstrumentTiles> {
    const where: Prisma.SecurityInstrumentWhereInput = { organizationId: input.organizationId };
    if (input.projectId) where.projectId = input.projectId;

    const rows = await this.prisma.client.securityInstrument.findMany({
      where,
      select: { amount: true, status: true, returnDueOn: true, returnedAmount: true, purpose: { select: { category: true } } },
    });

    const today = todayDateOnly();
    let emdLodgedAmount = new Prisma.Decimal(0);
    let emdLodgedCount = 0;
    let sdLodgedAmount = new Prisma.Decimal(0);
    let sdLodgedCount = 0;
    let returnedAmount = new Prisma.Decimal(0);
    let returnedCount = 0;
    let returnOverdueAmount = new Prisma.Decimal(0);
    let returnOverdueCount = 0;
    let toRecoverAmount = new Prisma.Decimal(0);

    for (const row of rows) {
      if (row.status === 'LODGED') {
        toRecoverAmount = toRecoverAmount.plus(row.amount);
        if (row.purpose.category === 'EMD') {
          emdLodgedAmount = emdLodgedAmount.plus(row.amount);
          emdLodgedCount += 1;
        } else if (row.purpose.category === 'SD') {
          sdLodgedAmount = sdLodgedAmount.plus(row.amount);
          sdLodgedCount += 1;
        }
        if (row.returnDueOn < today) {
          returnOverdueAmount = returnOverdueAmount.plus(row.amount);
          returnOverdueCount += 1;
        }
      } else {
        returnedAmount = returnedAmount.plus(row.returnedAmount ?? row.amount);
        returnedCount += 1;
      }
    }

    return {
      emdLodgedAmount: emdLodgedAmount.toFixed(2),
      emdLodgedCount,
      sdLodgedAmount: sdLodgedAmount.toFixed(2),
      sdLodgedCount,
      returnedAmount: returnedAmount.toFixed(2),
      returnedCount,
      returnOverdueAmount: returnOverdueAmount.toFixed(2),
      returnOverdueCount,
      toRecoverAmount: toRecoverAmount.toFixed(2),
    };
  }
}
