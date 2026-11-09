import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { generateId, recordAuditEvent, unscoped, type PrismaClient } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  PaymentRequestPort,
  PaymentRequestSummary,
  PaymentRequestDetail,
  PaymentRequestFilters,
  PaymentRequestLineInput,
  PaymentRequestPriority,
  PaymentRequestPreview,
  EligibleVendorBillSummary,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { isConstraintViolation } from '../organization/constraint-error.util';
import { generateSequentialNumber } from '../common/sequential-number.util';

const CREATE_DRAFT_COMMAND_TYPE = 'payment_request.create_draft';
const SUBMIT_COMMAND_TYPE = 'payment_request.submit';
const APPROVE_COMMAND_TYPE = 'payment_request.approve';
const REJECT_COMMAND_TYPE = 'payment_request.reject';
const CANCEL_COMMAND_TYPE = 'payment_request.cancel';
const REVOKE_COMMAND_TYPE = 'payment_request.revoke';
const MAX_NUMBER_ATTEMPTS = 5;
const OPEN_STATUSES = new Set(['DRAFT', 'SUBMITTED']);
const ACTIVE_RESERVATION_STATUSES = ['SUBMITTED', 'APPROVED'] as const;

/** vendorBillDate + this many days, purely for display on the eligible-bill
 * picker (docs review item 8) — never stored, never authoritative. No
 * per-vendor override beyond VendorProfile.paymentTerms exists anywhere in
 * this codebase; a vendor with no payment terms set shows no due date. */
const PAYMENT_TERMS_DUE_DAYS: Record<string, number> = {
  ADVANCE: 0,
  NET_15: 15,
  NET_30: 30,
  NET_45: 45,
};

/** Same shallow-sorted-keys sha256 shape as hashRequest in every prior
 * slice's own service — reimplemented locally per that established
 * precedent. */
function hashRequest(input: unknown): string {
  const normalized = JSON.stringify(input, Object.keys(input as object).sort());
  return createHash('sha256').update(normalized).digest('hex');
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

type PaymentRequestDbClient = PrismaClient | Prisma.TransactionClient;

const summaryInclude = {
  vendor: true,
  legalEntity: true,
} satisfies Prisma.PaymentRequestInclude;

const detailInclude = {
  ...summaryInclude,
  lines: { include: { vendorBill: { include: { project: true } } } },
  decisions: { orderBy: { decidedAt: 'desc' } },
} satisfies Prisma.PaymentRequestInclude;

type SummaryRow = Prisma.PaymentRequestGetPayload<{ include: typeof summaryInclude }>;
type DetailRow = Prisma.PaymentRequestGetPayload<{ include: typeof detailInclude }>;

function toSummary(row: SummaryRow): PaymentRequestSummary {
  return {
    id: row.id,
    requestNumber: row.requestNumber,
    vendorId: row.vendorId,
    vendorName: row.vendor.name,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntity.legalName,
    requestedPaymentDate: toDateOnly(row.requestedPaymentDate),
    priority: row.priority,
    remarks: row.remarks,
    totalRequestedAmount: row.totalRequestedAmount?.toFixed(2) ?? null,
    status: row.status,
    createdBy: row.createdBy,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelledBy: row.cancelledBy,
    cancelledReason: row.cancelledReason,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

function toDetail(row: DetailRow): PaymentRequestDetail {
  return {
    ...toSummary(row),
    lines: row.lines.map((l) => ({
      id: l.id,
      vendorBillId: l.vendorBillId,
      vendorBillNumber: l.vendorBill.vendorBillNumber,
      projectId: l.vendorBill.projectId,
      projectName: l.vendorBill.project?.name ?? null,
      vendorBillDate: toDateOnly(l.vendorBill.vendorBillDate),
      vendorBillTotalAmount: l.vendorBill.totalAmount?.toFixed(2) ?? '0.00',
      requestedAmount: l.requestedAmount.toFixed(2),
    })),
    decisions: row.decisions.map((d) => ({
      id: d.id,
      decision: d.decision,
      actorId: d.actorId,
      decidedAt: d.decidedAt.toISOString(),
      note: d.note,
      isSelfApproval: d.isSelfApproval,
    })),
  };
}

@Injectable()
export class PaymentRequestsService implements PaymentRequestPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  private async assertVendorActive(organizationId: string, vendorId: string): Promise<void> {
    const vendor = await this.prisma.client.party.findFirst({
      where: { id: vendorId, organizationId, deletedAt: null },
      include: { vendorProfile: true },
    });
    if (!vendor || !vendor.vendorProfile) throwAppError('NOT_FOUND', 'Vendor not found.');
    if (!vendor.isActive || !vendor.vendorProfile.isActive) {
      throwAppError('VALIDATION_FAILED', 'This vendor is inactive.');
    }
  }

  private async assertLegalEntityActive(organizationId: string, legalEntityId: string): Promise<void> {
    const legalEntity = await this.prisma.client.legalEntity.findFirst({ where: { id: legalEntityId, organizationId, deletedAt: null } });
    if (!legalEntity) throwAppError('NOT_FOUND', 'Legal entity not found.');
    if (!legalEntity.isActive) throwAppError('VALIDATION_FAILED', 'This legal entity is inactive.');
  }

  /** "No inaccessible line exists" — a scoped actor may touch/see a
   * request only if EVERY referenced vendor bill's project is one of
   * their assigned projects. Throws NOT_FOUND (never exposes which lines
   * were inaccessible, and never exposes a partial view) rather than
   * FORBIDDEN, matching the existing "access-scoping errors masquerade as
   * not-found" convention. */
  private async assertBillsProjectAccessible(
    client: PaymentRequestDbClient,
    organizationId: string,
    vendorBillIds: string[],
    actorId: string,
    canSeeAll: boolean,
  ): Promise<void> {
    if (canSeeAll || vendorBillIds.length === 0) return;
    const assignedProjects = await this.projects.list({ organizationId, actorId, canSeeAll: false });
    const assignedProjectIds = new Set(assignedProjects.map((p) => p.id));
    const bills = await client.vendorBill.findMany({ where: { id: { in: vendorBillIds }, organizationId }, select: { id: true, projectId: true, createdBy: true } });
    // A company-overhead bill (ADR-177) is open to whoever entered it.
    if (bills.length !== new Set(vendorBillIds).size || bills.some((b) => (b.projectId ? !assignedProjectIds.has(b.projectId) : b.createdBy !== actorId))) {
      throwAppError('NOT_FOUND', 'One or more referenced vendor bills are not accessible.');
    }
  }

  private async buildProjectScopeWhereForBills(organizationId: string, actorId: string): Promise<Prisma.VendorBillWhereInput> {
    const assignedProjects = await this.projects.list({ organizationId, actorId, canSeeAll: false });
    const assignedProjectIds = assignedProjects.map((p) => p.id);
    return { projectId: { in: assignedProjectIds.length > 0 ? assignedProjectIds : ['__none__'] } };
  }

  /** The single shared "available for request" calculation — reused by
   * createDraft/updateDraft (soft, advisory), submit (hard, after the
   * caller has locked the referenced bill rows), calculatePreview,
   * getEligibleBills and getBillAvailability. Never duplicated. */
  private async getAvailableForRequest(
    client: PaymentRequestDbClient,
    organizationId: string,
    vendorBillIds: string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    if (vendorBillIds.length === 0) return new Map();
    const uniqueIds = Array.from(new Set(vendorBillIds));
    const [bills, reserved] = await Promise.all([
      client.vendorBill.findMany({ where: { id: { in: uniqueIds }, organizationId }, select: { id: true, totalAmount: true } }),
      client.paymentRequestLine.groupBy({
        by: ['vendorBillId'],
        where: {
          vendorBillId: { in: uniqueIds },
          paymentRequest: { organizationId, status: { in: [...ACTIVE_RESERVATION_STATUSES] } },
        },
        _sum: { requestedAmount: true },
      }),
    ]);
    const reservedMap = new Map(reserved.map((r) => [r.vendorBillId, r._sum?.requestedAmount ?? new Prisma.Decimal(0)]));
    return new Map(
      bills.map((b) => [b.id, (b.totalAmount ?? new Prisma.Decimal(0)).minus(reservedMap.get(b.id) ?? new Prisma.Decimal(0))]),
    );
  }

  private generateRequestNumber(tx: Prisma.TransactionClient, organizationId: string, attempt: number): Promise<string> {
    return generateSequentialNumber({
      // Counted across the organization, every legal entity's included (ADR-172).
      count: () => unscoped(() => tx.paymentRequest.count({ where: { organizationId, requestNumber: { not: null } } })),
      prefix: 'PMR-',
      padLength: 6,
      attempt,
    });
  }

  async getEligibleBills(input: {
    organizationId: string;
    vendorId: string | undefined;
    legalEntityId: string | undefined;
    seedVendorBillId: string | undefined;
    actorId: string;
    canSeeAll: boolean;
  }) {
    let vendorId = input.vendorId;
    let legalEntityId = input.legalEntityId;

    if (input.seedVendorBillId) {
      const seedBill = await this.prisma.client.vendorBill.findFirst({
        where: { id: input.seedVendorBillId, organizationId: input.organizationId },
      });
      if (!seedBill) throwAppError('NOT_FOUND', 'Vendor bill not found.');
      if (seedBill.status !== 'FINALIZED') throwAppError('VALIDATION_FAILED', 'Only a finalized vendor bill can seed a payment request.');
      vendorId = seedBill.vendorId;
      legalEntityId = seedBill.legalEntityId;
    }

    if (!vendorId || !legalEntityId) throwAppError('VALIDATION_FAILED', 'Vendor and Legal Entity are required.');

    const [vendor, legalEntity] = await Promise.all([
      this.prisma.client.party.findFirst({ where: { id: vendorId, organizationId: input.organizationId } }),
      this.prisma.client.legalEntity.findFirst({ where: { id: legalEntityId, organizationId: input.organizationId } }),
    ]);
    if (!vendor) throwAppError('NOT_FOUND', 'Vendor not found.');
    if (!legalEntity) throwAppError('NOT_FOUND', 'Legal entity not found.');

    const scopeWhere = input.canSeeAll ? {} : await this.buildProjectScopeWhereForBills(input.organizationId, input.actorId);

    const bills = await this.prisma.client.vendorBill.findMany({
      where: { organizationId: input.organizationId, vendorId, legalEntityId, status: 'FINALIZED', ...scopeWhere },
      include: { project: true },
      orderBy: { vendorBillDate: 'asc' },
    });

    const availability = await this.getAvailableForRequest(this.prisma.client, input.organizationId, bills.map((b) => b.id));
    const vendorProfile = await this.prisma.client.vendorProfile.findFirst({ where: { organizationId: input.organizationId, partyId: vendorId } });
    const dueDays = vendorProfile?.paymentTerms ? (PAYMENT_TERMS_DUE_DAYS[vendorProfile.paymentTerms] ?? null) : null;

    const eligible: EligibleVendorBillSummary[] = bills
      .map((bill) => {
        const total = bill.totalAmount ?? new Prisma.Decimal(0);
        const available = availability.get(bill.id) ?? new Prisma.Decimal(0);
        return {
          vendorBillId: bill.id,
          vendorBillNumber: bill.vendorBillNumber,
          projectId: bill.projectId,
          projectName: bill.project?.name ?? null,
          vendorBillDate: toDateOnly(bill.vendorBillDate),
          dueDate: dueDays !== null ? toDateOnly(addDays(bill.vendorBillDate, dueDays)) : null,
          totalAmount: total.toFixed(2),
          alreadyReserved: total.minus(available).toFixed(2),
          availableForRequest: available.toFixed(2),
        };
      })
      .filter((b) => Number(b.availableForRequest) > 0);

    return { vendorId, vendorName: vendor.name, legalEntityId, legalEntityName: legalEntity.legalName, bills: eligible };
  }

  async getBillAvailability(input: { organizationId: string; vendorBillId: string }): Promise<{ available: string }> {
    const availability = await this.getAvailableForRequest(this.prisma.client, input.organizationId, [input.vendorBillId]);
    const available = availability.get(input.vendorBillId) ?? new Prisma.Decimal(0);
    return { available: available.toFixed(2) };
  }

  async calculatePreview(input: {
    organizationId: string;
    vendorId: string;
    legalEntityId: string;
    lines: PaymentRequestLineInput[];
    actorId: string;
    canSeeAll: boolean;
  }): Promise<PaymentRequestPreview> {
    if (input.lines.length === 0) return { lines: [], totalRequestedAmount: '0.00', valid: false };

    const vendorBillIds = input.lines.map((l) => l.vendorBillId);
    await this.assertBillsProjectAccessible(this.prisma.client, input.organizationId, vendorBillIds, input.actorId, input.canSeeAll);

    const [bills, availability] = await Promise.all([
      this.prisma.client.vendorBill.findMany({ where: { id: { in: vendorBillIds }, organizationId: input.organizationId } }),
      this.getAvailableForRequest(this.prisma.client, input.organizationId, vendorBillIds),
    ]);
    const billMap = new Map(bills.map((b) => [b.id, b]));

    let total = new Prisma.Decimal(0);
    let valid = true;
    const lines = input.lines.map((line) => {
      const bill = billMap.get(line.vendorBillId);
      const requested = new Prisma.Decimal(line.requestedAmount);
      const available = availability.get(line.vendorBillId) ?? new Prisma.Decimal(0);
      let lineValid = true;
      if (!bill || bill.status !== 'FINALIZED' || bill.vendorId !== input.vendorId || bill.legalEntityId !== input.legalEntityId) lineValid = false;
      if (requested.lessThanOrEqualTo(0) || requested.greaterThan(available)) lineValid = false;
      if (!lineValid) valid = false;
      total = total.plus(requested);
      return {
        vendorBillId: line.vendorBillId,
        vendorBillNumber: bill?.vendorBillNumber ?? '—',
        available: available.toFixed(2),
        requestedAmount: requested.toFixed(2),
        valid: lineValid,
      };
    });

    return { lines, totalRequestedAmount: total.toFixed(2), valid };
  }

  async createDraft(input: {
    organizationId: string;
    vendorId: string;
    legalEntityId: string;
    requestedPaymentDate: string;
    priority: PaymentRequestPriority | undefined;
    remarks: string | undefined;
    lines: PaymentRequestLineInput[];
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<PaymentRequestSummary> {
    const requestHash = hashRequest({
      vendorId: input.vendorId,
      legalEntityId: input.legalEntityId,
      requestedPaymentDate: input.requestedPaymentDate,
      priority: input.priority,
      remarks: input.remarks,
      lines: input.lines,
    });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: CREATE_DRAFT_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as PaymentRequestSummary;
    }

    if (input.lines.length === 0) throwAppError('VALIDATION_FAILED', 'At least one bill line is required.');

    await this.assertVendorActive(input.organizationId, input.vendorId);
    await this.assertLegalEntityActive(input.organizationId, input.legalEntityId);

    const vendorBillIds = input.lines.map((l) => l.vendorBillId);
    if (new Set(vendorBillIds).size !== vendorBillIds.length) {
      throwAppError('VALIDATION_FAILED', 'The same vendor bill cannot appear twice in one payment request.');
    }
    await this.assertBillsProjectAccessible(this.prisma.client, input.organizationId, vendorBillIds, input.actorId, input.canSeeAll);

    const bills = await this.prisma.client.vendorBill.findMany({ where: { id: { in: vendorBillIds }, organizationId: input.organizationId } });
    if (bills.length !== vendorBillIds.length) throwAppError('NOT_FOUND', 'One or more vendor bills were not found.');

    const availability = await this.getAvailableForRequest(this.prisma.client, input.organizationId, vendorBillIds);

    for (const line of input.lines) {
      const bill = bills.find((b) => b.id === line.vendorBillId)!;
      if (bill.status !== 'FINALIZED') throwAppError('VALIDATION_FAILED', `Vendor bill ${bill.vendorBillNumber} is not finalized.`);
      if (bill.vendorId !== input.vendorId) throwAppError('VALIDATION_FAILED', `Vendor bill ${bill.vendorBillNumber} does not belong to the selected vendor.`);
      if (bill.legalEntityId !== input.legalEntityId) throwAppError('VALIDATION_FAILED', `Vendor bill ${bill.vendorBillNumber} does not belong to the selected legal entity.`);
      const amount = new Prisma.Decimal(line.requestedAmount);
      if (amount.lessThanOrEqualTo(0)) throwAppError('VALIDATION_FAILED', 'Requested amount must be greater than zero.');
      const available = availability.get(line.vendorBillId) ?? new Prisma.Decimal(0);
      if (amount.greaterThan(available)) {
        throwAppError('VALIDATION_FAILED', `Requested amount for ${bill.vendorBillNumber} exceeds its available balance (₹${available.toFixed(2)}).`);
      }
    }

    const totalRequestedAmount = input.lines.reduce((sum, l) => sum.plus(new Prisma.Decimal(l.requestedAmount)), new Prisma.Decimal(0));
    const requestId = generateId();

    for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          const requestNumber = await this.generateRequestNumber(tx, input.organizationId, attempt);

          await tx.paymentRequest.create({
            data: {
              id: requestId,
              organizationId: input.organizationId,
              requestNumber,
              vendorId: input.vendorId,
              legalEntityId: input.legalEntityId,
              requestedPaymentDate: new Date(`${input.requestedPaymentDate}T00:00:00.000Z`),
              priority: input.priority ?? 'NORMAL',
              remarks: input.remarks ?? null,
              totalRequestedAmount,
              status: 'DRAFT',
              createdBy: input.actorId,
            },
          });

          await tx.paymentRequestLine.createMany({
            data: input.lines.map((line) => ({
              id: generateId(),
              organizationId: input.organizationId,
              paymentRequestId: requestId,
              vendorBillId: line.vendorBillId,
              requestedAmount: new Prisma.Decimal(line.requestedAmount),
            })),
          });

          await recordAuditEvent(tx, {
            organizationId: input.organizationId,
            entityType: 'PAYMENT_REQUEST',
            entityId: requestId,
            action: 'PAYMENT_REQUEST_DRAFT_CREATED',
            actorId: input.actorId,
            correlationId: input.correlationId,
            newValues: {
              requestNumber,
              vendorId: input.vendorId,
              legalEntityId: input.legalEntityId,
              lineCount: input.lines.length,
              totalRequestedAmount: totalRequestedAmount.toFixed(2),
            },
          });

          const created = await tx.paymentRequest.findFirstOrThrow({ where: { id: requestId }, include: summaryInclude });
          const summary = toSummary(created);

          await tx.idempotencyKey.create({
            data: {
              id: generateId(),
              organizationId: input.organizationId,
              commandType: CREATE_DRAFT_COMMAND_TYPE,
              idempotencyKey: input.idempotencyKey,
              requestHash,
              sourceRecordType: 'PAYMENT_REQUEST',
              sourceRecordId: requestId,
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

  async updateDraft(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    requestedPaymentDate: string | undefined;
    priority: PaymentRequestPriority | undefined;
    remarks: string | undefined;
    lines: PaymentRequestLineInput[] | undefined;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<PaymentRequestSummary> {
    const existing = await this.prisma.client.paymentRequest.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: { lines: true },
    });
    if (!existing) throwAppError('NOT_FOUND', 'Payment request not found.');
    if (existing.status !== 'DRAFT') throwAppError('INVALID_STATE_TRANSITION', 'Only a draft payment request can be updated.');

    await this.assertBillsProjectAccessible(this.prisma.client, input.organizationId, existing.lines.map((l) => l.vendorBillId), input.actorId, input.canSeeAll);

    const lines = input.lines ?? existing.lines.map((l) => ({ vendorBillId: l.vendorBillId, requestedAmount: l.requestedAmount.toFixed(2) }));
    if (lines.length === 0) throwAppError('VALIDATION_FAILED', 'At least one bill line is required.');

    const vendorBillIds = lines.map((l) => l.vendorBillId);
    if (new Set(vendorBillIds).size !== vendorBillIds.length) {
      throwAppError('VALIDATION_FAILED', 'The same vendor bill cannot appear twice in one payment request.');
    }

    if (input.lines !== undefined) {
      await this.assertBillsProjectAccessible(this.prisma.client, input.organizationId, vendorBillIds, input.actorId, input.canSeeAll);
      const bills = await this.prisma.client.vendorBill.findMany({ where: { id: { in: vendorBillIds }, organizationId: input.organizationId } });
      if (bills.length !== vendorBillIds.length) throwAppError('NOT_FOUND', 'One or more vendor bills were not found.');
      const availability = await this.getAvailableForRequest(this.prisma.client, input.organizationId, vendorBillIds);
      for (const line of lines) {
        const bill = bills.find((b) => b.id === line.vendorBillId)!;
        if (bill.status !== 'FINALIZED') throwAppError('VALIDATION_FAILED', `Vendor bill ${bill.vendorBillNumber} is not finalized.`);
        if (bill.vendorId !== existing.vendorId) throwAppError('VALIDATION_FAILED', `Vendor bill ${bill.vendorBillNumber} does not belong to this request's vendor.`);
        if (bill.legalEntityId !== existing.legalEntityId) throwAppError('VALIDATION_FAILED', `Vendor bill ${bill.vendorBillNumber} does not belong to this request's legal entity.`);
        const amount = new Prisma.Decimal(line.requestedAmount);
        if (amount.lessThanOrEqualTo(0)) throwAppError('VALIDATION_FAILED', 'Requested amount must be greater than zero.');
        const available = availability.get(line.vendorBillId) ?? new Prisma.Decimal(0);
        if (amount.greaterThan(available)) {
          throwAppError('VALIDATION_FAILED', `Requested amount for ${bill.vendorBillNumber} exceeds its available balance (₹${available.toFixed(2)}).`);
        }
      }
    }

    const totalRequestedAmount = lines.reduce((sum, l) => sum.plus(new Prisma.Decimal(l.requestedAmount)), new Prisma.Decimal(0));

    await this.prisma.client.$transaction(async (tx) => {
      if (input.lines !== undefined) {
        await tx.paymentRequestLine.deleteMany({ where: { paymentRequestId: input.id } });
        await tx.paymentRequestLine.createMany({
          data: lines.map((line) => ({
            id: generateId(),
            organizationId: input.organizationId,
            paymentRequestId: input.id,
            vendorBillId: line.vendorBillId,
            requestedAmount: new Prisma.Decimal(line.requestedAmount),
          })),
        });
      }

      const { count } = await tx.paymentRequest.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'DRAFT' },
        data: {
          requestedPaymentDate: input.requestedPaymentDate ? new Date(`${input.requestedPaymentDate}T00:00:00.000Z`) : existing.requestedPaymentDate,
          priority: input.priority ?? existing.priority,
          remarks: input.remarks !== undefined ? input.remarks : existing.remarks,
          totalRequestedAmount,
          updatedBy: input.actorId,
          version: { increment: 1 },
        },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This payment request was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'PAYMENT_REQUEST',
        entityId: input.id,
        action: 'PAYMENT_REQUEST_UPDATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { lineCount: lines.length, totalRequestedAmount: totalRequestedAmount.toFixed(2) },
      });
    });

    const updated = await this.prisma.client.paymentRequest.findFirstOrThrow({ where: { id: input.id }, include: summaryInclude });
    return toSummary(updated);
  }

  async submit(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<PaymentRequestSummary> {
    const requestHash = hashRequest({ id: input.id });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: SUBMIT_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as PaymentRequestSummary;
    }

    return await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.paymentRequest.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: { lines: true } });
      if (!existing) throwAppError('NOT_FOUND', 'Payment request not found.');
      if (existing.status !== 'DRAFT') throwAppError('INVALID_STATE_TRANSITION', 'Only a draft payment request can be submitted.');
      if (existing.lines.length === 0) throwAppError('VALIDATION_FAILED', 'At least one bill line is required.');

      await this.assertBillsProjectAccessible(tx, input.organizationId, existing.lines.map((l) => l.vendorBillId), input.actorId, input.canSeeAll);

      // Concurrency-safe reservation: lock every referenced Vendor Bill row
      // in deterministic ascending-id order (so two concurrent submits
      // touching an overlapping-but-not-identical bill set always attempt
      // locks in the same order and can never deadlock), then revalidate
      // live availability -- draft-time checks are advisory only, this is
      // the sole authoritative gate.
      const billIds = Array.from(new Set(existing.lines.map((l) => l.vendorBillId))).sort();
      // id::text avoids a `uuid = text` operator-not-found error — Prisma
      // binds each interpolated string as a text-typed parameter, and
      // Postgres won't implicitly cast text to uuid for an IN comparison.
      await tx.$queryRaw`SELECT id FROM vendor_bills WHERE id::text IN (${Prisma.join(billIds)}) ORDER BY id FOR UPDATE`;

      const availability = await this.getAvailableForRequest(tx, input.organizationId, billIds);
      for (const line of existing.lines) {
        const available = availability.get(line.vendorBillId) ?? new Prisma.Decimal(0);
        if (line.requestedAmount.greaterThan(available)) {
          throwAppError('VALIDATION_FAILED', `A referenced vendor bill's available balance has changed and is now less than the requested amount (₹${available.toFixed(2)}). Reload and adjust before submitting.`);
        }
      }

      const { count } = await tx.paymentRequest.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'DRAFT' },
        data: { status: 'SUBMITTED', submittedAt: new Date(), updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This payment request was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'PAYMENT_REQUEST',
        entityId: input.id,
        action: 'PAYMENT_REQUEST_SUBMITTED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { status: 'DRAFT' },
        newValues: { status: 'SUBMITTED', requestNumber: existing.requestNumber, totalRequestedAmount: existing.totalRequestedAmount?.toFixed(2) ?? null },
      });

      const updated = await tx.paymentRequest.findFirstOrThrow({ where: { id: input.id }, include: summaryInclude });
      const summary = toSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: SUBMIT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'PAYMENT_REQUEST',
          sourceRecordId: input.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async approve(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    note: string | undefined;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    hasSelfApprovePermission: boolean;
    correlationId: string;
  }): Promise<PaymentRequestSummary> {
    const requestHash = hashRequest({ id: input.id, note: input.note });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: APPROVE_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as PaymentRequestSummary;
    }

    const existing = await this.prisma.client.paymentRequest.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: { lines: true } });
    if (!existing) throwAppError('NOT_FOUND', 'Payment request not found.');
    if (existing.status !== 'SUBMITTED') throwAppError('INVALID_STATE_TRANSITION', 'Only a submitted payment request can be approved.');

    await this.assertBillsProjectAccessible(this.prisma.client, input.organizationId, existing.lines.map((l) => l.vendorBillId), input.actorId, input.canSeeAll);

    // Maker-checker: the creator can never approve their own request unless
    // they hold payment_request.self_approve AND supply a mandatory
    // justification note — checked unconditionally, before any other
    // branching.
    const isSelfApproval = existing.createdBy === input.actorId;
    if (isSelfApproval) {
      if (!input.hasSelfApprovePermission) throwAppError('FORBIDDEN', 'You cannot approve your own payment request.');
      if (!input.note?.trim()) throwAppError('VALIDATION_FAILED', 'A justification note is required to approve your own payment request.');
    }

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.paymentRequest.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'SUBMITTED' },
        data: { status: 'APPROVED', updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This payment request was changed by someone else. Reload and try again.');

      await tx.paymentRequestDecision.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          paymentRequestId: input.id,
          decision: 'APPROVED',
          actorId: input.actorId,
          note: input.note?.trim() || null,
          isSelfApproval,
        },
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'PAYMENT_REQUEST',
        entityId: input.id,
        action: 'PAYMENT_REQUEST_APPROVED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { status: 'SUBMITTED' },
        newValues: { status: 'APPROVED', isSelfApproval, note: input.note ?? null },
      });

      const updated = await tx.paymentRequest.findFirstOrThrow({ where: { id: input.id }, include: summaryInclude });
      const summary = toSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: APPROVE_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'PAYMENT_REQUEST',
          sourceRecordId: input.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async reject(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<PaymentRequestSummary> {
    const reason = input.reason.trim();
    if (!reason) throwAppError('VALIDATION_FAILED', 'A reason is required to reject a payment request.');

    const requestHash = hashRequest({ id: input.id, reason });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: REJECT_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as PaymentRequestSummary;
    }

    const existing = await this.prisma.client.paymentRequest.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: { lines: true } });
    if (!existing) throwAppError('NOT_FOUND', 'Payment request not found.');
    if (existing.status !== 'SUBMITTED') throwAppError('INVALID_STATE_TRANSITION', 'Only a submitted payment request can be rejected.');

    await this.assertBillsProjectAccessible(this.prisma.client, input.organizationId, existing.lines.map((l) => l.vendorBillId), input.actorId, input.canSeeAll);

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.paymentRequest.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'SUBMITTED' },
        data: { status: 'REJECTED', updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This payment request was changed by someone else. Reload and try again.');

      await tx.paymentRequestDecision.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          paymentRequestId: input.id,
          decision: 'REJECTED',
          actorId: input.actorId,
          note: reason,
          isSelfApproval: false,
        },
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'PAYMENT_REQUEST',
        entityId: input.id,
        action: 'PAYMENT_REQUEST_REJECTED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { status: 'SUBMITTED' },
        newValues: { status: 'REJECTED', reason },
      });

      const updated = await tx.paymentRequest.findFirstOrThrow({ where: { id: input.id }, include: summaryInclude });
      const summary = toSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: REJECT_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'PAYMENT_REQUEST',
          sourceRecordId: input.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  async cancel(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<PaymentRequestSummary> {
    const reason = input.reason.trim();
    if (!reason) throwAppError('VALIDATION_FAILED', 'A reason is required to cancel a payment request.');

    const requestHash = hashRequest({ id: input.id, reason });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: CANCEL_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as PaymentRequestSummary;
    }

    const existing = await this.prisma.client.paymentRequest.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!existing) throwAppError('NOT_FOUND', 'Payment request not found.');
    if (existing.createdBy !== input.actorId) throwAppError('FORBIDDEN', 'Only the creator can cancel this payment request.');
    if (!OPEN_STATUSES.has(existing.status)) {
      throwAppError('INVALID_STATE_TRANSITION', 'Only a draft or submitted payment request can be cancelled.');
    }

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.paymentRequest.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: input.actorId, cancelledReason: reason, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This payment request was changed by someone else. Reload and try again.');

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'PAYMENT_REQUEST',
        entityId: input.id,
        action: 'PAYMENT_REQUEST_CANCELLED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { status: existing.status },
        newValues: { status: 'CANCELLED', reason },
      });

      const updated = await tx.paymentRequest.findFirstOrThrow({ where: { id: input.id }, include: summaryInclude });
      const summary = toSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: CANCEL_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'PAYMENT_REQUEST',
          sourceRecordId: input.id,
          resultReference: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    });
  }

  /** Releases an APPROVED request's reservation without anything ever
   * having posted. Rejects if any VendorPaymentAllocation already
   * references one of this request's lines (Phase 6.5, ADR-080) — once a
   * real payment has been recorded against a line, its reservation can no
   * longer simply be released. */
  async revoke(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<PaymentRequestSummary> {
    const reason = input.reason.trim();
    if (!reason) throwAppError('VALIDATION_FAILED', 'A reason is required to revoke a payment request.');

    const requestHash = hashRequest({ id: input.id, reason });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: { organizationId_commandType_idempotencyKey: { organizationId: input.organizationId, commandType: REVOKE_COMMAND_TYPE, idempotencyKey: input.idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      return existingKey.resultReference as unknown as PaymentRequestSummary;
    }

    const existing = await this.prisma.client.paymentRequest.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: { lines: true } });
    if (!existing) throwAppError('NOT_FOUND', 'Payment request not found.');
    if (existing.status !== 'APPROVED') throwAppError('INVALID_STATE_TRANSITION', 'Only an approved payment request can be revoked.');

    await this.assertBillsProjectAccessible(this.prisma.client, input.organizationId, existing.lines.map((l) => l.vendorBillId), input.actorId, input.canSeeAll);

    const paidLine = await this.prisma.client.vendorPaymentAllocation.findFirst({
      where: { organizationId: input.organizationId, paymentRequestLineId: { in: existing.lines.map((l) => l.id) } },
    });
    if (paidLine) throwAppError('INVALID_STATE_TRANSITION', 'This payment request cannot be revoked — a vendor payment has already been recorded against it.');

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.paymentRequest.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion, status: 'APPROVED' },
        data: { status: 'REVOKED', updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This payment request was changed by someone else. Reload and try again.');

      await tx.paymentRequestDecision.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          paymentRequestId: input.id,
          decision: 'REVOKED',
          actorId: input.actorId,
          note: reason,
          isSelfApproval: false,
        },
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'PAYMENT_REQUEST',
        entityId: input.id,
        action: 'PAYMENT_REQUEST_REVOKED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { status: 'APPROVED' },
        newValues: { status: 'REVOKED', reason },
      });

      const updated = await tx.paymentRequest.findFirstOrThrow({ where: { id: input.id }, include: summaryInclude });
      const summary = toSummary(updated);

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: REVOKE_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          sourceRecordType: 'PAYMENT_REQUEST',
          sourceRecordId: input.id,
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
    filters: PaymentRequestFilters;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<{ rows: PaymentRequestSummary[]; total: number }> {
    const where: Prisma.PaymentRequestWhereInput = { organizationId: input.organizationId };
    if (input.filters.vendorId) where.vendorId = input.filters.vendorId;
    if (input.filters.legalEntityId) where.legalEntityId = input.filters.legalEntityId;
    if (input.filters.status) where.status = input.filters.status;
    if (input.filters.vendorBillId) where.lines = { some: { vendorBillId: input.filters.vendorBillId } };

    if (!input.canSeeAll) {
      const assignedProjects = await this.projects.list({ organizationId: input.organizationId, actorId: input.actorId, canSeeAll: false });
      const assignedProjectIds = assignedProjects.map((p) => p.id);
      // "No inaccessible line exists" — a request is visible only when
      // there is NOT a line whose bill's project falls outside the
      // actor's assigned set. Never "at least one accessible line", and
      // never filtered after the fact.
      where.NOT = {
        lines: { some: { vendorBill: { projectId: { notIn: assignedProjectIds.length > 0 ? assignedProjectIds : ['__none__'] } } } },
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.paymentRequest.findMany({
        where,
        include: summaryInclude,
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.client.paymentRequest.count({ where }),
    ]);

    return { rows: rows.map(toSummary), total };
  }

  async getDetail(input: { organizationId: string; id: string; actorId: string; canSeeAll: boolean }): Promise<PaymentRequestDetail> {
    const row = await this.prisma.client.paymentRequest.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: detailInclude });
    if (!row) throwAppError('NOT_FOUND', 'Payment request not found.');
    await this.assertBillsProjectAccessible(this.prisma.client, input.organizationId, row.lines.map((l) => l.vendorBillId), input.actorId, input.canSeeAll);
    return toDetail(row);
  }
}
