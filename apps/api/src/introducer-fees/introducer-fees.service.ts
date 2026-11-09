import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, generateId, recordAuditEvent, unscoped } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  IntroducerAccrualSummary,
  IntroducerAgreementSummary,
  IntroducerBalanceRow,
  IntroducerBalanceTotals,
  IntroducerFeePort,
  IntroducerPaymentAllocationInput,
  IntroducerPaymentDetail,
  IntroducerPaymentSummary,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';
import { isConstraintViolation } from '../organization/constraint-error.util';

const CREATE_AGREEMENT_COMMAND_TYPE = 'introducer_agreement.create';
const POST_ACCRUAL_COMMAND_TYPE = 'introducer_accrual.post';
const REVERSE_ACCRUAL_COMMAND_TYPE = 'introducer_accrual.reverse';
const POST_PAYMENT_COMMAND_TYPE = 'introducer_payment.post';
const REVERSE_PAYMENT_COMMAND_TYPE = 'introducer_payment.reverse';
const MAX_CODE_ATTEMPTS = 5;

const LEDGER_CODES = {
  commissionExpense: 'INTRODUCER_COMMISSION_EXPENSE',
  payable: 'INTRODUCER_PAYABLE',
  advanceReceivable: 'INTRODUCER_ADVANCE_RECEIVABLE',
  tdsPayable: 'TDS_PAYABLE',
} as const;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
function hashRequest(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}
const ZERO = () => new Prisma.Decimal(0);

const agreementInclude = {
  introducer: true,
  project: true,
  legalEntity: true,
  accruals: true,
} satisfies Prisma.IntroducerAgreementInclude;
type AgreementRow = Prisma.IntroducerAgreementGetPayload<{ include: typeof agreementInclude }>;

const accrualInclude = {
  agreement: { include: { introducer: true, project: true, legalEntity: true } },
  allocations: { include: { payment: { select: { status: true } } } },
} satisfies Prisma.IntroducerAccrualInclude;
type AccrualRow = Prisma.IntroducerAccrualGetPayload<{ include: typeof accrualInclude }>;

const paymentInclude = {
  introducer: true,
  legalEntity: true,
  bankAccount: true,
  paymentMode: true,
  allocations: { include: { accrual: { include: { agreement: { include: { project: true } } } } } },
} satisfies Prisma.IntroducerPaymentInclude;
type PaymentRow = Prisma.IntroducerPaymentGetPayload<{ include: typeof paymentInclude }>;

/**
 * What the agreement entitles the introducer to in total.
 *
 * Null for a percentage agreement whose project carries no value yet: the
 * entitlement is genuinely unknown, and returning zero would silently cap
 * every accrual at nothing — a validation that looks like a rule but is
 * really a missing input.
 */
function entitledAmount(row: { basisType: string; ratePercent: Prisma.Decimal | null; fixedAmount: Prisma.Decimal | null; project: { value: Prisma.Decimal | null } }): Prisma.Decimal | null {
  if (row.basisType === 'FIXED_AMOUNT') return row.fixedAmount;
  if (!row.project.value || !row.ratePercent) return null;
  return row.project.value.times(row.ratePercent).dividedBy(100).toDecimalPlaces(2);
}

/** Only POSTED accruals are liabilities; a reversed one is history. */
function accruedTotal(accruals: Array<{ status: string; amount: Prisma.Decimal }>): Prisma.Decimal {
  return accruals.filter((a) => a.status === 'POSTED').reduce((s, a) => s.plus(a.amount), ZERO());
}

function toAgreementSummary(row: AgreementRow): IntroducerAgreementSummary {
  const entitled = entitledAmount(row);
  const accrued = accruedTotal(row.accruals);
  return {
    id: row.id,
    introducerId: row.introducerId,
    introducerName: row.introducer.name,
    projectId: row.projectId,
    projectName: row.project.name,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    basisType: row.basisType,
    ratePercent: row.ratePercent ? row.ratePercent.toFixed(4) : null,
    fixedAmount: row.fixedAmount ? row.fixedAmount.toFixed(2) : null,
    agreementDate: toDateStr(row.agreementDate),
    remarks: row.remarks,
    isActive: row.isActive,
    entitledAmount: entitled ? entitled.toFixed(2) : null,
    accruedAmount: accrued.toFixed(2),
    remainingToAccrue: entitled ? entitled.minus(accrued).toFixed(2) : null,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

/** Settled only by payments that are themselves still POSTED — reversing a
 * payment must put its accruals back on the books. */
function allocatedTotal(allocations: Array<{ allocatedAmount: Prisma.Decimal; payment: { status: string } }>): Prisma.Decimal {
  return allocations.filter((a) => a.payment.status === 'POSTED').reduce((s, a) => s.plus(a.allocatedAmount), ZERO());
}

function toAccrualSummary(row: AccrualRow): IntroducerAccrualSummary {
  const allocated = allocatedTotal(row.allocations);
  return {
    id: row.id,
    introducerAgreementId: row.introducerAgreementId,
    accrualNumber: row.accrualNumber,
    introducerId: row.agreement.introducerId,
    introducerName: row.agreement.introducer.name,
    projectId: row.agreement.projectId,
    projectName: row.agreement.project.name,
    accrualDate: toDateStr(row.accrualDate),
    amount: row.amount.toFixed(2),
    narrative: row.narrative,
    status: row.status,
    journalEntryId: row.journalEntryId,
    reversalJournalEntryId: row.reversalJournalEntryId,
    reversalReason: row.reversalReason,
    allocatedAmount: allocated.toFixed(2),
    outstandingAmount: (row.status === 'POSTED' ? row.amount.minus(allocated) : ZERO()).toFixed(2),
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

function toPaymentSummary(row: PaymentRow): IntroducerPaymentSummary {
  return {
    id: row.id,
    paymentNumber: row.paymentNumber,
    introducerId: row.introducerId,
    introducerName: row.introducer.name,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    bankAccountId: row.bankAccountId,
    bankAccountName: row.bankAccount.accountName,
    paymentDate: toDateStr(row.paymentDate),
    paymentModeId: row.paymentModeId,
    paymentModeName: row.paymentMode?.label ?? null,
    referenceNumber: row.referenceNumber,
    grossAmount: row.grossAmount.toFixed(2),
    tdsAmount: row.tdsAmount.toFixed(2),
    netAmount: row.netAmount.toFixed(2),
    advanceAmount: row.advanceAmount.toFixed(2),
    narrative: row.narrative,
    status: row.status,
    journalEntryId: row.journalEntryId,
    reversalJournalEntryId: row.reversalJournalEntryId,
    reversalReason: row.reversalReason,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

function toPaymentDetail(row: PaymentRow): IntroducerPaymentDetail {
  return {
    ...toPaymentSummary(row),
    allocations: row.allocations.map((a) => ({
      id: a.id,
      introducerAccrualId: a.introducerAccrualId,
      allocatedAmount: a.allocatedAmount.toFixed(2),
      accrualNumber: a.accrual.accrualNumber,
      projectName: a.accrual.agreement.project.name,
    })),
  };
}

/**
 * Introducer commission (Phase 7.6, ADR-096).
 *
 * Three documents in one aggregate because they are one obligation seen at
 * three moments: what is owed (agreement), when it became a liability
 * (accrual), and how it was settled (payment). Splitting them across
 * services would put the payable balance — which needs all three — in no
 * service at all.
 */
@Injectable()
export class IntroducerFeesService implements IntroducerFeePort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  private async resolveAccounts(organizationId: string, codes: string[]) {
    const accounts = await this.prisma.client.ledgerAccount.findMany({
      where: { organizationId, code: { in: codes } },
    });
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    for (const code of codes) {
      if (!byCode.get(code)) throwAppError('VALIDATION_FAILED', `Ledger account ${code} is not configured.`);
    }
    return byCode;
  }

  // ----------------------------------------------------------- agreements

  async listAgreements(input: {
    organizationId: string;
    filters: { introducerId: string | undefined; projectId: string | undefined; includeInactive: boolean };
  }): Promise<{ rows: IntroducerAgreementSummary[] }> {
    const rows = await this.prisma.client.introducerAgreement.findMany({
      where: {
        organizationId: input.organizationId,
        ...(input.filters.introducerId ? { introducerId: input.filters.introducerId } : {}),
        ...(input.filters.projectId ? { projectId: input.filters.projectId } : {}),
        ...(input.filters.includeInactive ? {} : { isActive: true }),
      },
      include: agreementInclude,
      orderBy: [{ agreementDate: 'desc' }, { createdAt: 'desc' }],
    });
    return { rows: rows.map(toAgreementSummary) };
  }

  async createAgreement(input: {
    organizationId: string;
    introducerId: string;
    projectId: string;
    basisType: 'PERCENT_OF_PROJECT_VALUE' | 'FIXED_AMOUNT';
    ratePercent: string | undefined;
    fixedAmount: string | undefined;
    agreementDate: string;
    remarks: string | undefined;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<IntroducerAgreementSummary> {
    const requestHash = hashRequest({ ...input, idempotencyKey: undefined, actorId: undefined, correlationId: undefined });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: {
        organizationId_commandType_idempotencyKey: {
          organizationId: input.organizationId,
          commandType: CREATE_AGREEMENT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as IntroducerAgreementSummary;
    }

    // The basis and its figure must agree — checked here so the caller gets a
    // sentence, and by a DB CHECK so no other writer can bypass it.
    if (input.basisType === 'PERCENT_OF_PROJECT_VALUE') {
      if (!input.ratePercent) throwAppError('VALIDATION_FAILED', 'A percentage agreement needs a rate.');
      if (input.fixedAmount) throwAppError('VALIDATION_FAILED', 'A percentage agreement cannot also carry a fixed amount.');
      const rate = new Prisma.Decimal(input.ratePercent);
      if (!rate.greaterThan(0) || rate.greaterThan(100)) throwAppError('VALIDATION_FAILED', 'Commission rate must be between 0 and 100 percent.');
    } else {
      if (!input.fixedAmount) throwAppError('VALIDATION_FAILED', 'A fixed agreement needs an amount.');
      if (input.ratePercent) throwAppError('VALIDATION_FAILED', 'A fixed agreement cannot also carry a rate.');
      if (!new Prisma.Decimal(input.fixedAmount).greaterThan(0)) throwAppError('VALIDATION_FAILED', 'Commission amount must be greater than zero.');
    }

    const introducer = await this.prisma.client.introducer.findFirst({
      where: { id: input.introducerId, organizationId: input.organizationId },
    });
    if (!introducer) throwAppError('NOT_FOUND', 'Introducer not found.');
    if (!introducer.isActive) throwAppError('VALIDATION_FAILED', `Introducer "${introducer.name}" is inactive.`);

    const project = await this.prisma.client.project.findFirst({
      where: { id: input.projectId, organizationId: input.organizationId },
    });
    if (!project) throwAppError('NOT_FOUND', 'Project not found.');

    const id = generateId();
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        await tx.introducerAgreement.create({
          data: {
            id,
            organizationId: input.organizationId,
            introducerId: input.introducerId,
            projectId: input.projectId,
            // Always the project's own legal entity — a commission earned on
            // a project belongs in that project's books, and letting the two
            // diverge would put the expense in another entity's accounts.
            legalEntityId: project.legalEntityId,
            basisType: input.basisType,
            ratePercent: input.ratePercent ? new Prisma.Decimal(input.ratePercent) : null,
            fixedAmount: input.fixedAmount ? new Prisma.Decimal(input.fixedAmount) : null,
            agreementDate: toDate(input.agreementDate),
            remarks: input.remarks ?? null,
            createdBy: input.actorId,
          },
        });

        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          legalEntityId: project.legalEntityId,
          entityType: 'INTRODUCER_AGREEMENT',
          entityId: id,
          action: 'INTRODUCER_AGREEMENT_CREATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { introducerId: input.introducerId, projectId: input.projectId, basisType: input.basisType },
        });

        const created = await tx.introducerAgreement.findFirstOrThrow({ where: { id }, include: agreementInclude });
        const summary = toAgreementSummary(created);

        await tx.idempotencyKey.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            commandType: CREATE_AGREEMENT_COMMAND_TYPE,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            sourceRecordType: 'INTRODUCER_AGREEMENT',
            sourceRecordId: id,
            resultReference: summary as unknown as Prisma.InputJsonValue,
          },
        });
        return summary;
      });
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'This introducer already has an agreement on this project.');
      }
      throw error;
    }
  }

  // ------------------------------------------------------------- accruals

  async listAccruals(input: {
    organizationId: string;
    filters: { introducerId: string | undefined; projectId: string | undefined; status: 'POSTED' | 'REVERSED' | undefined };
  }): Promise<{ rows: IntroducerAccrualSummary[] }> {
    const rows = await this.prisma.client.introducerAccrual.findMany({
      where: {
        organizationId: input.organizationId,
        ...(input.filters.status ? { status: input.filters.status } : {}),
        ...(input.filters.introducerId || input.filters.projectId
          ? {
              agreement: {
                ...(input.filters.introducerId ? { introducerId: input.filters.introducerId } : {}),
                ...(input.filters.projectId ? { projectId: input.filters.projectId } : {}),
              },
            }
          : {}),
      },
      include: accrualInclude,
      orderBy: [{ accrualDate: 'desc' }, { createdAt: 'desc' }],
    });
    return { rows: rows.map(toAccrualSummary) };
  }

  private async generateNumber(tx: Prisma.TransactionClient, table: 'accrual' | 'payment', organizationId: string, attempt: number): Promise<string> {
    if (table === 'accrual') {
      // Counted across the organization, every legal entity's included (ADR-172).
      const count = await unscoped(() => tx.introducerAccrual.count({ where: { organizationId } }));
      return `INTA-${String(count + 1 + attempt).padStart(6, '0')}`;
    }
    const count = await unscoped(() => tx.introducerPayment.count({ where: { organizationId } }));
    return `INTP-${String(count + 1 + attempt).padStart(6, '0')}`;
  }

  /**
   * Recognises commission as a liability — docs/06: Dr Introducer Commission
   * Expense; Cr Introducer Payable.
   *
   * The expense line carries the project dimension (the commission is always
   * earned on one) and both lines carry the introducer's party-free identity
   * through the agreement, so project cost reporting can read commission
   * straight off the journal.
   */
  async postAccrual(input: {
    organizationId: string;
    introducerAgreementId: string;
    accrualDate: string;
    amount: string;
    narrative: string | undefined;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<IntroducerAccrualSummary> {
    const requestHash = hashRequest({ ...input, idempotencyKey: undefined, actorId: undefined, correlationId: undefined });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: {
        organizationId_commandType_idempotencyKey: {
          organizationId: input.organizationId,
          commandType: POST_ACCRUAL_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as IntroducerAccrualSummary;
    }

    const amount = new Prisma.Decimal(input.amount);
    if (!amount.greaterThan(0)) throwAppError('VALIDATION_FAILED', 'An accrual must be greater than zero.');

    const agreement = await this.prisma.client.introducerAgreement.findFirst({
      where: { id: input.introducerAgreementId, organizationId: input.organizationId },
      include: agreementInclude,
    });
    if (!agreement) throwAppError('NOT_FOUND', 'Introducer agreement not found.');
    if (!agreement.isActive) throwAppError('VALIDATION_FAILED', 'This agreement is inactive.');

    // Cumulative accrual may not exceed the entitlement, when the
    // entitlement is derivable at all. A percentage agreement on a project
    // with no value has no known ceiling, and refusing every accrual on that
    // basis would be a validation with no rule behind it — so it is
    // deliberately uncapped and disclosed rather than guessed.
    const entitled = entitledAmount(agreement);
    if (entitled) {
      const already = accruedTotal(agreement.accruals);
      if (already.plus(amount).greaterThan(entitled)) {
        throwAppError(
          'VALIDATION_FAILED',
          `This agreement entitles ${entitled.toFixed(2)} and ${already.toFixed(2)} is already accrued — this accrual of ${amount.toFixed(2)} would exceed it.`,
        );
      }
    }

    const accounts = await this.resolveAccounts(input.organizationId, [LEDGER_CODES.commissionExpense, LEDGER_CODES.payable]);
    const accrualId = generateId();

    const journal = await this.posting.postJournal({
      organizationId: input.organizationId,
      legalEntityId: agreement.legalEntityId,
      accountingDate: input.accrualDate,
      sourceType: 'introducer_accrual',
      sourceId: accrualId,
      postingEvent: 'introducer_accrual.posted',
      description: `Introducer commission — ${agreement.introducer.name} / ${agreement.project.name}`,
      lines: [
        {
          ledgerAccountId: accounts.get(LEDGER_CODES.commissionExpense)!.id,
          debit: amount.toFixed(2),
          credit: '0',
          projectId: agreement.projectId,
          partyId: undefined,
          employeeId: undefined,
          gstRegistrationId: undefined,
          taxCode: undefined,
          narrative: input.narrative,
        },
        {
          ledgerAccountId: accounts.get(LEDGER_CODES.payable)!.id,
          debit: '0',
          credit: amount.toFixed(2),
          projectId: agreement.projectId,
          partyId: undefined,
          employeeId: undefined,
          gstRegistrationId: undefined,
          taxCode: undefined,
          narrative: input.narrative,
        },
      ],
      idempotencyKey: `${POST_ACCRUAL_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          const accrualNumber = await this.generateNumber(tx, 'accrual', input.organizationId, attempt);
          await tx.introducerAccrual.create({
            data: {
              id: accrualId,
              organizationId: input.organizationId,
              introducerAgreementId: agreement.id,
              accrualNumber,
              accrualDate: toDate(input.accrualDate),
              amount,
              narrative: input.narrative ?? null,
              status: 'POSTED',
              journalEntryId: journal.id,
              createdBy: input.actorId,
            },
          });

          await recordAuditEvent(tx, {
            organizationId: input.organizationId,
            legalEntityId: agreement.legalEntityId,
            entityType: 'INTRODUCER_ACCRUAL',
            entityId: accrualId,
            action: 'INTRODUCER_ACCRUAL_POSTED',
            actorId: input.actorId,
            correlationId: input.correlationId,
            newValues: { accrualNumber, amount: amount.toFixed(2), journalEntryId: journal.id },
          });

          const created = await tx.introducerAccrual.findFirstOrThrow({ where: { id: accrualId }, include: accrualInclude });
          const summary = toAccrualSummary(created);

          await tx.idempotencyKey.create({
            data: {
              id: generateId(),
              organizationId: input.organizationId,
              commandType: POST_ACCRUAL_COMMAND_TYPE,
              idempotencyKey: input.idempotencyKey,
              requestHash,
              sourceRecordType: 'INTRODUCER_ACCRUAL',
              sourceRecordId: accrualId,
              resultReference: summary as unknown as Prisma.InputJsonValue,
            },
          });
          return summary;
        });
      } catch (error) {
        if (isConstraintViolation(error) && attempt < MAX_CODE_ATTEMPTS - 1) continue;
        throw error;
      }
    }
    return throwAppError('VALIDATION_FAILED', 'Could not post the accrual due to a conflict. Please try again.');
  }

  /** Reverses an accrual. Refused once any of it has been paid — the payment
   * settled a liability that would no longer exist, and unwinding it here
   * would silently rewrite a cash transaction. Reverse the payment first. */
  async reverseAccrual(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<IntroducerAccrualSummary> {
    if (!input.reason.trim()) throwAppError('VALIDATION_FAILED', 'A reason is required to reverse an accrual.');

    const requestHash = hashRequest({ id: input.id, reason: input.reason, accountingDate: input.accountingDate });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: {
        organizationId_commandType_idempotencyKey: {
          organizationId: input.organizationId,
          commandType: REVERSE_ACCRUAL_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as IntroducerAccrualSummary;
    }

    const accrual = await this.prisma.client.introducerAccrual.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: accrualInclude,
    });
    if (!accrual) throwAppError('NOT_FOUND', 'Accrual not found.');
    if (accrual.status !== 'POSTED') throwAppError('INVALID_STATE_TRANSITION', 'This accrual is already reversed.');

    const allocated = allocatedTotal(accrual.allocations);
    if (allocated.greaterThan(0)) {
      throwAppError('VALIDATION_FAILED', `${allocated.toFixed(2)} has already been paid against this accrual — reverse the payment first.`);
    }

    const reversalJournal = await this.posting.reverseJournal({
      organizationId: input.organizationId,
      id: accrual.journalEntryId,
      accountingDate: input.accountingDate,
      reason: input.reason,
      idempotencyKey: `${REVERSE_ACCRUAL_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.introducerAccrual.updateMany({
        where: { id: accrual.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'POSTED' },
        data: {
          status: 'REVERSED',
          reversalJournalEntryId: reversalJournal.id,
          reversedAt: new Date(),
          reversedBy: input.actorId,
          reversalReason: input.reason,
          updatedBy: input.actorId,
          version: { increment: 1 },
        },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This accrual was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: accrual.agreement.legalEntityId,
        entityType: 'INTRODUCER_ACCRUAL',
        entityId: accrual.id,
        action: 'INTRODUCER_ACCRUAL_REVERSED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        reason: input.reason,
        newValues: { reversalJournalEntryId: reversalJournal.id },
      });

      const updated = await tx.introducerAccrual.findFirstOrThrow({ where: { id: accrual.id }, include: accrualInclude });
      const summary = toAccrualSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: REVERSE_ACCRUAL_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'INTRODUCER_ACCRUAL',
          sourceRecordId: accrual.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });
      return summary;
    });
  }

  // ------------------------------------------------------------- payments

  async listPayments(input: {
    organizationId: string;
    filters: { introducerId: string | undefined; status: 'POSTED' | 'REVERSED' | undefined };
  }): Promise<{ rows: IntroducerPaymentSummary[] }> {
    const rows = await this.prisma.client.introducerPayment.findMany({
      where: {
        organizationId: input.organizationId,
        ...(input.filters.introducerId ? { introducerId: input.filters.introducerId } : {}),
        ...(input.filters.status ? { status: input.filters.status } : {}),
      },
      include: paymentInclude,
      orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
    });
    return { rows: rows.map(toPaymentSummary) };
  }

  async getPaymentDetail(input: { organizationId: string; id: string }): Promise<IntroducerPaymentDetail> {
    const row = await this.prisma.client.introducerPayment.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: paymentInclude,
    });
    if (!row) throwAppError('NOT_FOUND', 'Introducer payment not found.');
    return toPaymentDetail(row);
  }

  /**
   * Settles an introducer — a vendor-style payable settlement with TDS
   * (docs/06).
   *
   *   Dr Introducer Payable            (total allocated to accruals)
   *   Dr Introducer Advance Receivable (unallocated excess, if any)
   *     Cr TDS Payable                 (tax withheld, if any)
   *     Cr Bank                        (net actually paid)
   *
   * The excess is the point: paying ahead of accrual is ordinary, and
   * representing it by driving the payable negative would make "what do we
   * owe introducers" wrong for every reader (docs/04 §15 says so explicitly).
   */
  async postPayment(input: {
    organizationId: string;
    introducerId: string;
    legalEntityId: string;
    bankAccountId: string;
    paymentDate: string;
    paymentModeId: string | undefined;
    referenceNumber: string | undefined;
    grossAmount: string;
    tdsAmount: string;
    narrative: string | undefined;
    allocations: IntroducerPaymentAllocationInput[];
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<IntroducerPaymentSummary> {
    const requestHash = hashRequest({ ...input, idempotencyKey: undefined, actorId: undefined, correlationId: undefined });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: {
        organizationId_commandType_idempotencyKey: {
          organizationId: input.organizationId,
          commandType: POST_PAYMENT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as IntroducerPaymentSummary;
    }

    const grossAmount = new Prisma.Decimal(input.grossAmount).toDecimalPlaces(2);
    const tdsAmount = new Prisma.Decimal(input.tdsAmount).toDecimalPlaces(2);
    if (!grossAmount.greaterThan(0)) throwAppError('VALIDATION_FAILED', 'A payment must be greater than zero.');
    if (tdsAmount.isNegative()) throwAppError('VALIDATION_FAILED', 'TDS cannot be negative.');
    if (tdsAmount.greaterThan(grossAmount)) throwAppError('VALIDATION_FAILED', 'TDS cannot exceed the gross amount.');
    const netAmount = grossAmount.minus(tdsAmount);

    const introducer = await this.prisma.client.introducer.findFirst({
      where: { id: input.introducerId, organizationId: input.organizationId },
    });
    if (!introducer) throwAppError('NOT_FOUND', 'Introducer not found.');

    const legalEntity = await this.prisma.client.legalEntity.findFirst({
      where: { id: input.legalEntityId, organizationId: input.organizationId, deletedAt: null },
    });
    if (!legalEntity) throwAppError('NOT_FOUND', 'Legal entity not found.');

    const bankAccount = await this.prisma.client.bankAccount.findFirst({
      where: { id: input.bankAccountId, organizationId: input.organizationId },
    });
    if (!bankAccount) throwAppError('NOT_FOUND', 'Bank account not found.');
    if (!bankAccount.isActive) throwAppError('VALIDATION_FAILED', 'This bank account is inactive.');

    // Every allocated accrual must belong to THIS introducer and still be
    // outstanding. Without the ownership check a payment could quietly clear
    // somebody else's liability.
    let allocatedTotalAmount = ZERO();
    const accrualIds = input.allocations.map((a) => a.introducerAccrualId);
    if (new Set(accrualIds).size !== accrualIds.length) {
      throwAppError('VALIDATION_FAILED', 'The same accrual appears on more than one allocation line.');
    }
    if (accrualIds.length > 0) {
      const accruals = await this.prisma.client.introducerAccrual.findMany({
        where: { id: { in: accrualIds }, organizationId: input.organizationId },
        include: accrualInclude,
      });
      if (accruals.length !== accrualIds.length) throwAppError('NOT_FOUND', 'One or more accruals were not found.');
      const byId = new Map(accruals.map((a) => [a.id, a]));

      for (const allocation of input.allocations) {
        const accrual = byId.get(allocation.introducerAccrualId)!;
        if (accrual.agreement.introducerId !== input.introducerId) {
          throwAppError('VALIDATION_FAILED', `Accrual ${accrual.accrualNumber} belongs to a different introducer.`);
        }
        if (accrual.agreement.legalEntityId !== input.legalEntityId) {
          throwAppError('VALIDATION_FAILED', `Accrual ${accrual.accrualNumber} was accrued in a different legal entity.`);
        }
        if (accrual.status !== 'POSTED') throwAppError('VALIDATION_FAILED', `Accrual ${accrual.accrualNumber} has been reversed.`);

        const amount = new Prisma.Decimal(allocation.allocatedAmount).toDecimalPlaces(2);
        if (!amount.greaterThan(0)) throwAppError('VALIDATION_FAILED', 'Each allocation must be greater than zero.');
        const outstanding = accrual.amount.minus(allocatedTotal(accrual.allocations));
        if (amount.greaterThan(outstanding)) {
          throwAppError('VALIDATION_FAILED', `Accrual ${accrual.accrualNumber} has only ${outstanding.toFixed(2)} outstanding.`);
        }
        allocatedTotalAmount = allocatedTotalAmount.plus(amount);
      }
    }

    if (allocatedTotalAmount.greaterThan(grossAmount)) {
      throwAppError('VALIDATION_FAILED', `Allocations total ${allocatedTotalAmount.toFixed(2)}, which is more than the ${grossAmount.toFixed(2)} being paid.`);
    }
    const advanceAmount = grossAmount.minus(allocatedTotalAmount);

    const accounts = await this.resolveAccounts(input.organizationId, [
      LEDGER_CODES.payable,
      LEDGER_CODES.advanceReceivable,
      LEDGER_CODES.tdsPayable,
    ]);

    const paymentId = generateId();
    const lines: Array<{ ledgerAccountId: string; debit: string; credit: string; projectId: undefined; partyId: undefined; employeeId: undefined; gstRegistrationId: undefined; taxCode: undefined; narrative: string | undefined }> = [];
    const base = { projectId: undefined, partyId: undefined, employeeId: undefined, gstRegistrationId: undefined, taxCode: undefined, narrative: input.narrative };

    if (allocatedTotalAmount.greaterThan(0)) {
      lines.push({ ledgerAccountId: accounts.get(LEDGER_CODES.payable)!.id, debit: allocatedTotalAmount.toFixed(2), credit: '0', ...base });
    }
    if (advanceAmount.greaterThan(0)) {
      lines.push({ ledgerAccountId: accounts.get(LEDGER_CODES.advanceReceivable)!.id, debit: advanceAmount.toFixed(2), credit: '0', ...base });
    }
    if (tdsAmount.greaterThan(0)) {
      lines.push({ ledgerAccountId: accounts.get(LEDGER_CODES.tdsPayable)!.id, debit: '0', credit: tdsAmount.toFixed(2), ...base });
    }
    if (netAmount.greaterThan(0)) {
      lines.push({ ledgerAccountId: bankAccount.ledgerAccountId, debit: '0', credit: netAmount.toFixed(2), ...base });
    }

    const journal = await this.posting.postJournal({
      organizationId: input.organizationId,
      legalEntityId: input.legalEntityId,
      accountingDate: input.paymentDate,
      sourceType: 'introducer_payment',
      sourceId: paymentId,
      postingEvent: 'introducer_payment.posted',
      description: `Introducer payment — ${introducer.name}`,
      lines,
      idempotencyKey: `${POST_PAYMENT_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          const paymentNumber = await this.generateNumber(tx, 'payment', input.organizationId, attempt);
          await tx.introducerPayment.create({
            data: {
              id: paymentId,
              organizationId: input.organizationId,
              introducerId: input.introducerId,
              legalEntityId: input.legalEntityId,
              bankAccountId: input.bankAccountId,
              paymentNumber,
              paymentDate: toDate(input.paymentDate),
              paymentModeId: input.paymentModeId ?? null,
              referenceNumber: input.referenceNumber ?? null,
              grossAmount,
              tdsAmount,
              netAmount,
              advanceAmount,
              narrative: input.narrative ?? null,
              status: 'POSTED',
              journalEntryId: journal.id,
              createdBy: input.actorId,
            },
          });

          if (input.allocations.length > 0) {
            await tx.introducerPaymentAllocation.createMany({
              data: input.allocations.map((a) => ({
                id: generateId(),
                organizationId: input.organizationId,
                introducerPaymentId: paymentId,
                introducerAccrualId: a.introducerAccrualId,
                allocatedAmount: new Prisma.Decimal(a.allocatedAmount).toDecimalPlaces(2),
              })),
            });
          }

          await recordAuditEvent(tx, {
            organizationId: input.organizationId,
            legalEntityId: input.legalEntityId,
            entityType: 'INTRODUCER_PAYMENT',
            entityId: paymentId,
            action: 'INTRODUCER_PAYMENT_POSTED',
            actorId: input.actorId,
            correlationId: input.correlationId,
            newValues: {
              paymentNumber,
              grossAmount: grossAmount.toFixed(2),
              tdsAmount: tdsAmount.toFixed(2),
              advanceAmount: advanceAmount.toFixed(2),
              journalEntryId: journal.id,
            },
          });

          const created = await tx.introducerPayment.findFirstOrThrow({ where: { id: paymentId }, include: paymentInclude });
          const summary = toPaymentSummary(created);

          await tx.idempotencyKey.create({
            data: {
              id: generateId(),
              organizationId: input.organizationId,
              commandType: POST_PAYMENT_COMMAND_TYPE,
              idempotencyKey: input.idempotencyKey,
              requestHash,
              sourceRecordType: 'INTRODUCER_PAYMENT',
              sourceRecordId: paymentId,
              resultReference: summary as unknown as Prisma.InputJsonValue,
            },
          });
          return summary;
        });
      } catch (error) {
        if (isConstraintViolation(error) && attempt < MAX_CODE_ATTEMPTS - 1) continue;
        throw error;
      }
    }
    return throwAppError('VALIDATION_FAILED', 'Could not post the payment due to a conflict. Please try again.');
  }

  /** Reverses a payment: reverses its journal and, because allocations are
   * read through their payment's status, restores every accrual it settled
   * without touching a single allocation row. */
  async reversePayment(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<IntroducerPaymentSummary> {
    if (!input.reason.trim()) throwAppError('VALIDATION_FAILED', 'A reason is required to reverse a payment.');

    const requestHash = hashRequest({ id: input.id, reason: input.reason, accountingDate: input.accountingDate });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: {
        organizationId_commandType_idempotencyKey: {
          organizationId: input.organizationId,
          commandType: REVERSE_PAYMENT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as IntroducerPaymentSummary;
    }

    const payment = await this.prisma.client.introducerPayment.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: paymentInclude,
    });
    if (!payment) throwAppError('NOT_FOUND', 'Introducer payment not found.');
    if (payment.status !== 'POSTED') throwAppError('INVALID_STATE_TRANSITION', 'This payment is already reversed.');

    const reversalJournal = await this.posting.reverseJournal({
      organizationId: input.organizationId,
      id: payment.journalEntryId,
      accountingDate: input.accountingDate,
      reason: input.reason,
      idempotencyKey: `${REVERSE_PAYMENT_COMMAND_TYPE}:${input.idempotencyKey}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.introducerPayment.updateMany({
        where: { id: payment.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'POSTED' },
        data: {
          status: 'REVERSED',
          reversalJournalEntryId: reversalJournal.id,
          reversedAt: new Date(),
          reversedBy: input.actorId,
          reversalReason: input.reason,
          updatedBy: input.actorId,
          version: { increment: 1 },
        },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This payment was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: payment.legalEntityId,
        entityType: 'INTRODUCER_PAYMENT',
        entityId: payment.id,
        action: 'INTRODUCER_PAYMENT_REVERSED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        reason: input.reason,
        newValues: { reversalJournalEntryId: reversalJournal.id },
      });

      const updated = await tx.introducerPayment.findFirstOrThrow({ where: { id: payment.id }, include: paymentInclude });
      const summary = toPaymentSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: REVERSE_PAYMENT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'INTRODUCER_PAYMENT',
          sourceRecordId: payment.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });
      return summary;
    });
  }

  /**
   * docs/04 §15's `introducer-all.html`: "separately show accrued, paid, TDS,
   * advance/unallocated and payable balances."
   *
   * Five figures, never one blended "balance" — they answer five different
   * questions, and a single number would hide whether an introducer is owed
   * money or holding ours.
   */
  async listBalances(input: { organizationId: string }): Promise<{
    rows: IntroducerBalanceRow[];
    totals: IntroducerBalanceTotals;
  }> {
    const introducers = await this.prisma.client.introducer.findMany({
      where: { organizationId: input.organizationId },
      orderBy: { name: 'asc' },
    });

    const agreements = await this.prisma.client.introducerAgreement.findMany({
      where: { organizationId: input.organizationId },
      include: { project: { select: { value: true } }, accruals: { include: { allocations: { include: { payment: { select: { status: true } } } } } } },
    });
    const payments = await this.prisma.client.introducerPayment.findMany({
      where: { organizationId: input.organizationId, status: 'POSTED' },
    });

    const rows: IntroducerBalanceRow[] = introducers.map((introducer) => {
      const own = agreements.filter((a) => a.introducerId === introducer.id);
      const accruals = own.flatMap((a) => a.accruals);
      const accrued = accruedTotal(accruals);
      const allocated = accruals
        .filter((a) => a.status === 'POSTED')
        .reduce((s, a) => s.plus(allocatedTotal(a.allocations)), ZERO());

      const ownPayments = payments.filter((p) => p.introducerId === introducer.id);
      const tds = ownPayments.reduce((s, p) => s.plus(p.tdsAmount), ZERO());
      const netPaid = ownPayments.reduce((s, p) => s.plus(p.netAmount), ZERO());
      const advance = ownPayments.reduce((s, p) => s.plus(p.advanceAmount), ZERO());
      const entitled = own.map(entitledAmount);
      const agreed = entitled.reduce<Prisma.Decimal>((s, e) => (e ? s.plus(e) : s), ZERO());
      const paid = ownPayments.reduce((s, p) => s.plus(p.grossAmount), ZERO());
      const lastPaid = ownPayments.reduce<Date | null>((latest, p) => (!latest || p.paymentDate > latest ? p.paymentDate : latest), null);

      return {
        introducerId: introducer.id,
        introducerName: introducer.name,
        agreementCount: own.length,
        agreedAmount: agreed.toFixed(2),
        agreedComplete: entitled.every((e) => e !== null),
        paidAmount: paid.toFixed(2),
        remainingAmount: Prisma.Decimal.max(agreed.minus(paid), 0).toFixed(2),
        lastPaidOn: lastPaid ? toDateStr(lastPaid) : null,
        accruedAmount: accrued.toFixed(2),
        allocatedAmount: allocated.toFixed(2),
        tdsAmount: tds.toFixed(2),
        netPaidAmount: netPaid.toFixed(2),
        advanceAmount: advance.toFixed(2),
        payableAmount: accrued.minus(allocated).toFixed(2),
      };
    });

    const totals = {
      agreedAmount: rows.reduce((s, r) => s.plus(r.agreedAmount), ZERO()).toFixed(2),
      paidAmount: rows.reduce((s, r) => s.plus(r.paidAmount), ZERO()).toFixed(2),
      remainingAmount: rows.reduce((s, r) => s.plus(r.remainingAmount), ZERO()).toFixed(2),
      accruedAmount: rows.reduce((s, r) => s.plus(r.accruedAmount), ZERO()).toFixed(2),
      allocatedAmount: rows.reduce((s, r) => s.plus(r.allocatedAmount), ZERO()).toFixed(2),
      tdsAmount: rows.reduce((s, r) => s.plus(r.tdsAmount), ZERO()).toFixed(2),
      netPaidAmount: rows.reduce((s, r) => s.plus(r.netPaidAmount), ZERO()).toFixed(2),
      advanceAmount: rows.reduce((s, r) => s.plus(r.advanceAmount), ZERO()).toFixed(2),
      payableAmount: rows.reduce((s, r) => s.plus(r.payableAmount), ZERO()).toFixed(2),
    };

    return { rows, totals };
  }
}
