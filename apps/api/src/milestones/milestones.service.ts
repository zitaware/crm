import { Injectable } from '@nestjs/common';
import { Prisma, type MilestoneAchievementStatus } from '@prisma/client';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  AlertRecipient,
  InstallmentFrequency,
  MilestoneEventSummary,
  MilestoneInstallmentSummary,
  MilestonePort,
  MilestoneSummary,
  OpexScheduleRowSummary,
  ProjectMilestoneOverview,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isConstraintViolation } from '../organization/constraint-error.util';
import { ProjectsService } from '../projects/projects.service';
import { PaymentAlertsService } from '../payment-alerts/payment-alerts.service';
import { generateOpexSchedule } from './milestone-schedule.util';
import { deriveBillingStatus, unitBillingStatus } from './milestone-billing.util';
import { loadSourceBilling } from '../invoices/source-billing';

const ACHIEVEMENT_TERMINAL = ['ACHIEVED', 'CANCELLED'];
const MAX_CODE_ATTEMPTS = 5;

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Prisma requires a full ISO-8601 DateTime (or a Date instance) for
 * @db.Date columns — a bare 'YYYY-MM-DD' string is rejected. */
function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

interface MilestoneRow {
  id: string;
  projectId: string;
  type: string;
  code: string;
  name: string;
  approvedAmount: Prisma.Decimal;
  referenceNumber: string | null;
  approvalDate: Date | null;
  description: string | null;
  achievementStatus: string | null;
  frequency: string | null;
  installmentCount: number | null;
  scheduleStartDate: Date | null;
  firstInvoiceDate: Date | null;
  alertRecipient: string;
  reminderOffsetDays: number;
  achievedOn: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  version: number;
}

interface EventRow {
  id: string;
  milestoneId: string;
  code: string;
  name: string;
  percentOfPool: Prisma.Decimal;
  amount: Prisma.Decimal;
  dueDate: Date;
  achievementStatus: string;
  achievedOn: Date | null;
  cancelReason: string | null;
  sequence: number;
  version: number;
}

interface InstallmentRow {
  id: string;
  sequenceNumber: number;
  servicePeriodStart: Date;
  servicePeriodEnd: Date;
  plannedInvoiceDate: Date;
  scheduledAmount: Prisma.Decimal;
  status: string;
  skipReason: string | null;
  cancelReason: string | null;
  version: number;
}

/** What FINALIZED invoices billed against one event or installment, and its payment alert. */
interface SourceBilling {
  invoiceNumbers: string[];
  invoiced: Prisma.Decimal;
  /** An invoice on it was marked as the full bill (ADR-167). */
  completed: boolean;
  paymentAlertId: string | null;
}
/** Keyed by event/installment id; a source with no finalized invoice and no alert is absent. */
type BillingBySource = Map<string, SourceBilling>;

function invoicedOf(billing: SourceBilling | undefined): Prisma.Decimal {
  return billing?.invoiced ?? new Prisma.Decimal(0);
}

/** What is still expected on a unit: nothing once marked as fully billed, else its amount less what was billed. */
function unitRemaining(amount: Prisma.Decimal, billing: SourceBilling | undefined): Prisma.Decimal {
  return billing?.completed ? new Prisma.Decimal(0) : Prisma.Decimal.max(amount.minus(invoicedOf(billing)), 0);
}

function invoiceNumberOf(billing: SourceBilling | undefined): string | null {
  return billing && billing.invoiceNumbers.length > 0 ? billing.invoiceNumbers.join(', ') : null;
}

function isInstallmentClosed(status: string): boolean {
  return status === 'SKIPPED' || status === 'CANCELLED';
}

function toMilestoneSummary(
  row: MilestoneRow,
  units: { events?: EventRow[]; installments?: InstallmentRow[]; billingBySource: BillingBySource },
): MilestoneSummary {
  const { events = [], installments, billingBySource } = units;
  // A CAPEX pool bills through its events, an OPEX schedule through its installments.
  const billing = deriveBillingStatus(
    row.type === 'CAPEX'
      ? events.map((e) => ({ closed: e.achievementStatus === 'CANCELLED', status: unitBillingStatus(invoicedOf(billingBySource.get(e.id)), e.amount, billingBySource.get(e.id)?.completed) }))
      : (installments ?? []).map((i) => ({ closed: isInstallmentClosed(i.status), status: unitBillingStatus(invoicedOf(billingBySource.get(i.id)), i.scheduledAmount, billingBySource.get(i.id)?.completed) })),
  );
  const unitIds = row.type === 'CAPEX' ? events.map((e) => e.id) : (installments ?? []).map((i) => i.id);
  const invoiced = unitIds.reduce((sum, id) => sum.plus(invoicedOf(billingBySource.get(id))), new Prisma.Decimal(0));
  // What each unit still expects, summed; a unit marked as fully billed expects nothing (ADR-167).
  const unitAmounts = row.type === 'CAPEX' ? events.map((e) => [e.id, e.amount] as const) : (installments ?? []).map((i) => [i.id, i.scheduledAmount] as const);
  const remaining = unitAmounts.reduce((sum, [id, amount]) => sum.plus(unitRemaining(amount, billingBySource.get(id))), new Prisma.Decimal(0));
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type as MilestoneSummary['type'],
    code: row.code,
    name: row.name,
    approvedAmount: row.approvedAmount.toFixed(2),
    referenceNumber: row.referenceNumber,
    approvalDate: row.approvalDate ? toDateStr(row.approvalDate) : null,
    description: row.description,
    achievementStatus: row.achievementStatus as MilestoneSummary['achievementStatus'],
    billingStatus: billing.billingStatus,
    invoicedCount: billing.invoicedCount,
    billableCount: billing.billableCount,
    invoicedAmount: invoiced.toFixed(2),
    remainingAmount: (unitAmounts.length > 0 ? remaining : Prisma.Decimal.max(row.approvedAmount.minus(invoiced), 0)).toFixed(2),
    frequency: row.frequency as MilestoneSummary['frequency'],
    installmentCount: row.installmentCount,
    scheduleStartDate: row.scheduleStartDate ? toDateStr(row.scheduleStartDate) : null,
    firstInvoiceDate: row.firstInvoiceDate ? toDateStr(row.firstInvoiceDate) : null,
    alertRecipient: row.alertRecipient as AlertRecipient,
    reminderOffsetDays: row.reminderOffsetDays,
    achievedOn: row.achievedOn ? toDateStr(row.achievedOn) : null,
    cancelReason: row.cancelReason,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    installments: installments?.map((i) => toInstallmentSummary(i, billingBySource.get(i.id))),
  };
}

function toEventSummary(row: EventRow, milestone: { code: string; name: string }, billing: SourceBilling | undefined): MilestoneEventSummary {
  const invoiced = invoicedOf(billing);
  return {
    id: row.id,
    milestoneId: row.milestoneId,
    milestoneCode: milestone.code,
    milestoneName: milestone.name,
    code: row.code,
    name: row.name,
    percentOfPool: row.percentOfPool.toFixed(2),
    amount: row.amount.toFixed(2),
    dueDate: toDateStr(row.dueDate),
    achievementStatus: row.achievementStatus as MilestoneEventSummary['achievementStatus'],
    achievedOn: row.achievedOn ? toDateStr(row.achievedOn) : null,
    cancelReason: row.cancelReason,
    sequence: row.sequence,
    version: row.version,
    // By amount: an event may be billed across several invoices (ADR-156).
    billingStatus: unitBillingStatus(invoiced, row.amount, billing?.completed),
    invoiceNumber: invoiceNumberOf(billing),
    paymentAlertId: billing?.paymentAlertId ?? null,
    invoicedAmount: invoiced.toFixed(2),
    remainingAmount: unitRemaining(row.amount, billing).toFixed(2),
  };
}

function toInstallmentSummary(row: InstallmentRow, billing: SourceBilling | undefined): MilestoneInstallmentSummary {
  const invoiced = invoicedOf(billing);
  return {
    id: row.id,
    sequenceNumber: row.sequenceNumber,
    servicePeriodStart: toDateStr(row.servicePeriodStart),
    servicePeriodEnd: toDateStr(row.servicePeriodEnd),
    plannedInvoiceDate: toDateStr(row.plannedInvoiceDate),
    scheduledAmount: row.scheduledAmount.toFixed(2),
    status: row.status as InstallmentStatusLiteral,
    skipReason: row.skipReason,
    cancelReason: row.cancelReason,
    version: row.version,
    billingStatus: unitBillingStatus(invoiced, row.scheduledAmount, billing?.completed),
    invoiceNumber: invoiceNumberOf(billing),
    paymentAlertId: billing?.paymentAlertId ?? null,
    invoicedAmount: invoiced.toFixed(2),
    remainingAmount: unitRemaining(row.scheduledAmount, billing).toFixed(2),
  };
}

type InstallmentStatusLiteral = MilestoneInstallmentSummary['status'];

@Injectable()
export class MilestonesService implements MilestonePort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly paymentAlerts: PaymentAlertsService,
  ) {}

  private async assertProjectAccess(input: { organizationId: string; projectId: string; actorId: string; canSeeAll: boolean }): Promise<void> {
    await this.projects.getDetail({
      organizationId: input.organizationId,
      id: input.projectId,
      actorId: input.actorId,
      canSeeAll: input.canSeeAll,
    });
  }

  /** Resolves the project a milestone/event/installment belongs to and
   * scope-checks it, throwing NOT_FOUND for an out-of-scope actor before
   * any milestone data is touched or returned. */
  private async assertMilestoneAccess(organizationId: string, milestoneId: string, actorId: string, canSeeAll: boolean): Promise<MilestoneRow> {
    const milestone = await this.prisma.client.projectMilestone.findFirst({ where: { id: milestoneId, organizationId } });
    if (!milestone) throwAppError('NOT_FOUND', 'Milestone not found.');
    await this.assertProjectAccess({ organizationId, projectId: milestone.projectId, actorId, canSeeAll });
    return milestone;
  }

  private async generateMilestoneCode(tx: Prisma.TransactionClient, projectId: string, type: 'CAPEX' | 'OPEX', attempt: number): Promise<string> {
    const prefix = type === 'CAPEX' ? 'CAP' : 'OPEX';
    const count = await tx.projectMilestone.count({ where: { projectId, type } });
    return `${prefix}-${String(count + 1 + attempt).padStart(3, '0')}`;
  }

  /**
   * What FINALIZED invoices billed against each of these events or
   * installments — the one fact billing status is derived from (ADR-104),
   * now with the taxable amount (ADR-155) and several invoices per source
   * (ADR-156), plus the source's payment alert. A DRAFT has billed nothing yet
   * and a VOID was undone, so neither counts. An event billed on another
   * event's multi-event invoice (ADR-126) counts through invoice_capex_sources.
   */
  private async billingBySource(organizationId: string, sourceIds: string[]): Promise<BillingBySource> {
    if (sourceIds.length === 0) return new Map();
    const [billed, alerts] = await Promise.all([
      loadSourceBilling(this.prisma.client, organizationId, sourceIds),
      this.prisma.client.paymentAlert.findMany({
        where: { organizationId, OR: [{ sourceEventId: { in: sourceIds } }, { sourceInstallmentId: { in: sourceIds } }] },
        select: { id: true, sourceEventId: true, sourceInstallmentId: true },
      }),
    ]);
    const alertBySource = new Map(alerts.map((a) => [(a.sourceEventId ?? a.sourceInstallmentId)!, a.id]));
    const bySource: BillingBySource = new Map();
    for (const id of sourceIds) {
      const billing = billed.get(id);
      const paymentAlertId = alertBySource.get(id) ?? null;
      if (!billing && !paymentAlertId) continue;
      bySource.set(id, {
        invoiced: billing?.invoiced ?? new Prisma.Decimal(0),
        completed: billing?.completed ?? false,
        invoiceNumbers: (billing?.invoices ?? []).map((invoice) => invoice.invoiceNumber ?? ''),
        paymentAlertId,
      });
    }
    return bySource;
  }

  private async billingFor(organizationId: string, sourceId: string): Promise<SourceBilling | undefined> {
    return (await this.billingBySource(organizationId, [sourceId])).get(sourceId);
  }

  async listForProject(input: { organizationId: string; projectId: string; actorId: string; canSeeAll: boolean }): Promise<ProjectMilestoneOverview> {
    await this.assertProjectAccess(input);

    const milestones = await this.prisma.client.projectMilestone.findMany({
      where: { organizationId: input.organizationId, projectId: input.projectId },
      include: { events: { orderBy: { sequence: 'asc' } }, installments: { orderBy: { sequenceNumber: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });

    const capexMilestones = milestones.filter((m) => m.type === 'CAPEX');
    const opexMilestones = milestones.filter((m) => m.type === 'OPEX');
    const billingBySource = await this.billingBySource(
      input.organizationId,
      milestones.flatMap((m) => [...m.events.map((e) => e.id), ...m.installments.map((i) => i.id)]),
    );

    const capexEvents: MilestoneEventSummary[] = capexMilestones.flatMap((m) =>
      m.events.map((e) => toEventSummary(e as unknown as EventRow, { code: m.code, name: m.name }, billingBySource.get(e.id))),
    );
    const capexTotalAmount = capexMilestones
      .reduce((sum, m) => sum.plus(m.approvedAmount), new Prisma.Decimal(0))
      .toFixed(2);
    const opexTotalAmount = opexMilestones
      .reduce((sum, m) => sum.plus(m.approvedAmount), new Prisma.Decimal(0))
      .toFixed(2);
    const invoicedOver = (ids: string[]) =>
      ids.reduce((sum, id) => sum.plus(invoicedOf(billingBySource.get(id))), new Prisma.Decimal(0)).toFixed(2);

    return {
      capexEvents,
      opexMilestones: opexMilestones.map((m) =>
        toMilestoneSummary(m as unknown as MilestoneRow, { installments: m.installments, billingBySource }),
      ),
      capexTotalAmount,
      opexTotalAmount,
      capexInvoicedAmount: invoicedOver(capexMilestones.flatMap((m) => m.events.map((e) => e.id))),
      opexInvoicedAmount: invoicedOver(opexMilestones.flatMap((m) => m.installments.map((i) => i.id))),
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- pure computation; async to satisfy MilestonePort's Promise-returning interface
  async previewOpexSchedule(input: {
    approvedAmount: string;
    frequency: InstallmentFrequency;
    installmentCount: number;
    scheduleStartDate: string;
    firstInvoiceDate: string;
  }): Promise<OpexScheduleRowSummary[]> {
    if (!Number.isInteger(input.installmentCount) || input.installmentCount < 1) {
      throwAppError('VALIDATION_FAILED', 'Installment count must be a whole number of at least 1.');
    }
    const approvedAmount = new Prisma.Decimal(input.approvedAmount);
    if (approvedAmount.lessThanOrEqualTo(0)) {
      throwAppError('VALIDATION_FAILED', 'Approved amount must be positive.');
    }
    const rows = generateOpexSchedule({
      approvedAmount,
      frequency: input.frequency,
      installmentCount: input.installmentCount,
      scheduleStartDate: new Date(`${input.scheduleStartDate}T00:00:00.000Z`),
      firstInvoiceDate: new Date(`${input.firstInvoiceDate}T00:00:00.000Z`),
    });
    return rows.map((r) => ({
      sequenceNumber: r.sequenceNumber,
      servicePeriodStart: toDateStr(r.servicePeriodStart),
      servicePeriodEnd: toDateStr(r.servicePeriodEnd),
      plannedInvoiceDate: toDateStr(r.plannedInvoiceDate),
      scheduledAmount: r.scheduledAmount.toFixed(2),
    }));
  }

  async createCapex(input: {
    organizationId: string;
    projectId: string;
    name: string;
    approvedAmount: string;
    referenceNumber: string | undefined;
    approvalDate: string | undefined;
    description: string | undefined;
    alertRecipient: AlertRecipient | undefined;
    reminderOffsetDays: number | undefined;
    events: Array<{ name: string; amount: string; dueDate: string }>;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<MilestoneSummary> {
    await this.assertProjectAccess(input);

    if (input.events.length === 0) {
      throwAppError('VALIDATION_FAILED', 'At least one event is required.');
    }
    const approvedAmount = new Prisma.Decimal(input.approvedAmount);
    if (approvedAmount.lessThanOrEqualTo(0)) throwAppError('VALIDATION_FAILED', 'Approved amount must be positive.');

    const eventTotal = input.events.reduce((sum, e) => sum.plus(new Prisma.Decimal(e.amount)), new Prisma.Decimal(0));
    if (!eventTotal.equals(approvedAmount)) {
      const diff = approvedAmount.minus(eventTotal);
      const verb = diff.isPositive() ? 'short by' : 'over by';
      throwAppError(
        'VALIDATION_FAILED',
        `Event amounts must sum to the approved pool amount exactly — currently ${verb} ${diff.abs().toFixed(2)}.`,
      );
    }

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const existing = await this.prisma.client.milestoneCreationRequest.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey } },
      });
      if (existing) return this.getMilestoneSummaryById(input.organizationId, existing.resultMilestoneId);

      try {
        const createdId = await this.prisma.client.$transaction(async (tx) => {
          const code = await this.generateMilestoneCode(tx, input.projectId, 'CAPEX', attempt);
          const milestoneId = generateId();
          await tx.projectMilestone.create({
            data: {
              id: milestoneId,
              organizationId: input.organizationId,
              projectId: input.projectId,
              type: 'CAPEX',
              code,
              name: input.name,
              approvedAmount,
              referenceNumber: input.referenceNumber ?? null,
              approvalDate: input.approvalDate ? toDate(input.approvalDate) : null,
              description: input.description ?? null,
              alertRecipient: input.alertRecipient ?? 'ACCOUNT_TEAM',
              reminderOffsetDays: input.reminderOffsetDays ?? 3,
              createdBy: input.actorId,
            },
          });

          const eventRows = await Promise.all(
            input.events.map((e, index) => {
              const amount = new Prisma.Decimal(e.amount);
              const percentOfPool = amount.dividedBy(approvedAmount).times(100).toDecimalPlaces(2);
              return tx.milestoneEvent.create({
                data: {
                  id: generateId(),
                  organizationId: input.organizationId,
                  milestoneId,
                  code: `${code}-E${String(index + 1).padStart(2, '0')}`,
                  name: e.name,
                  percentOfPool,
                  amount,
                  dueDate: toDate(e.dueDate),
                  sequence: index + 1,
                  createdBy: input.actorId,
                },
              });
            }),
          );

          await tx.milestoneCreationRequest.create({
            data: {
              id: generateId(),
              organizationId: input.organizationId,
              projectId: input.projectId,
              idempotencyKey: input.idempotencyKey,
              resultMilestoneId: milestoneId,
            },
          });

          await recordAuditEvent(tx, {
            organizationId: input.organizationId,
            entityType: 'PROJECT_MILESTONE',
            entityId: milestoneId,
            action: 'MILESTONE_CREATED',
            actorId: input.actorId,
            correlationId: input.correlationId,
            newValues: {
              type: 'CAPEX',
              code,
              name: input.name,
              approvedAmount: approvedAmount.toFixed(2),
              events: eventRows.map((e) => ({ code: e.code, name: e.name, amount: e.amount.toFixed(2), dueDate: toDateStr(e.dueDate) })),
            },
          });

          await this.paymentAlerts.openEligibleForMilestone(tx, milestoneId);
          return milestoneId;
        });
        return this.getMilestoneSummaryById(input.organizationId, createdId);
      } catch (error) {
        if (isConstraintViolation(error) && attempt < MAX_CODE_ATTEMPTS - 1) continue;
        throw error;
      }
    }
    return throwAppError('VALIDATION_FAILED', 'Could not create the milestone due to a conflict. Please try again.');
  }

  async createOpex(input: {
    organizationId: string;
    projectId: string;
    name: string;
    approvedAmount: string;
    frequency: InstallmentFrequency;
    installmentCount: number;
    scheduleStartDate: string;
    firstInvoiceDate: string;
    referenceNumber: string | undefined;
    approvalDate: string | undefined;
    description: string | undefined;
    alertRecipient: AlertRecipient | undefined;
    reminderOffsetDays: number | undefined;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<MilestoneSummary> {
    await this.assertProjectAccess(input);

    if (!Number.isInteger(input.installmentCount) || input.installmentCount < 1) {
      throwAppError('VALIDATION_FAILED', 'Installment count must be a whole number of at least 1.');
    }
    const approvedAmount = new Prisma.Decimal(input.approvedAmount);
    if (approvedAmount.lessThanOrEqualTo(0)) throwAppError('VALIDATION_FAILED', 'Approved amount must be positive.');

    const scheduleStartDate = new Date(`${input.scheduleStartDate}T00:00:00.000Z`);
    const firstInvoiceDate = new Date(`${input.firstInvoiceDate}T00:00:00.000Z`);
    const scheduleRows = generateOpexSchedule({
      approvedAmount,
      frequency: input.frequency,
      installmentCount: input.installmentCount,
      scheduleStartDate,
      firstInvoiceDate,
    });

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const existing = await this.prisma.client.milestoneCreationRequest.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey } },
      });
      if (existing) return this.getMilestoneSummaryById(input.organizationId, existing.resultMilestoneId);

      try {
        const createdId = await this.prisma.client.$transaction(async (tx) => {
          const code = await this.generateMilestoneCode(tx, input.projectId, 'OPEX', attempt);
          const milestoneId = generateId();
          await tx.projectMilestone.create({
            data: {
              id: milestoneId,
              organizationId: input.organizationId,
              projectId: input.projectId,
              type: 'OPEX',
              code,
              name: input.name,
              approvedAmount,
              referenceNumber: input.referenceNumber ?? null,
              approvalDate: input.approvalDate ? toDate(input.approvalDate) : null,
              description: input.description ?? null,
              achievementStatus: 'PLANNED',
              frequency: input.frequency,
              installmentCount: input.installmentCount,
              scheduleStartDate,
              firstInvoiceDate,
              alertRecipient: input.alertRecipient ?? 'ACCOUNT_TEAM',
              reminderOffsetDays: input.reminderOffsetDays ?? 3,
              createdBy: input.actorId,
            },
          });

          await tx.milestoneInstallment.createMany({
            data: scheduleRows.map((r) => ({
              id: generateId(),
              organizationId: input.organizationId,
              milestoneId,
              sequenceNumber: r.sequenceNumber,
              servicePeriodStart: r.servicePeriodStart,
              servicePeriodEnd: r.servicePeriodEnd,
              plannedInvoiceDate: r.plannedInvoiceDate,
              scheduledAmount: r.scheduledAmount,
              createdBy: input.actorId,
            })),
          });

          await tx.milestoneCreationRequest.create({
            data: {
              id: generateId(),
              organizationId: input.organizationId,
              projectId: input.projectId,
              idempotencyKey: input.idempotencyKey,
              resultMilestoneId: milestoneId,
            },
          });

          await recordAuditEvent(tx, {
            organizationId: input.organizationId,
            entityType: 'PROJECT_MILESTONE',
            entityId: milestoneId,
            action: 'MILESTONE_CREATED',
            actorId: input.actorId,
            correlationId: input.correlationId,
            newValues: { type: 'OPEX', code, name: input.name, approvedAmount: approvedAmount.toFixed(2) },
          });
          await recordAuditEvent(tx, {
            organizationId: input.organizationId,
            entityType: 'PROJECT_MILESTONE',
            entityId: milestoneId,
            action: 'MILESTONE_SCHEDULE_GENERATED',
            actorId: input.actorId,
            correlationId: input.correlationId,
            newValues: {
              installmentCount: input.installmentCount,
              frequency: input.frequency,
              installments: scheduleRows.map((r) => ({ sequenceNumber: r.sequenceNumber, amount: r.scheduledAmount.toFixed(2) })),
            },
          });

          await this.paymentAlerts.openEligibleForMilestone(tx, milestoneId);
          return milestoneId;
        });
        return this.getMilestoneSummaryById(input.organizationId, createdId);
      } catch (error) {
        if (isConstraintViolation(error) && attempt < MAX_CODE_ATTEMPTS - 1) continue;
        throw error;
      }
    }
    return throwAppError('VALIDATION_FAILED', 'Could not create the milestone due to a conflict. Please try again.');
  }

  async updateMilestone(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    referenceNumber: string | undefined;
    approvalDate: string | undefined;
    description: string | undefined;
    alertRecipient: AlertRecipient | undefined;
    reminderOffsetDays: number | undefined;
    expectedVersion: number;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<MilestoneSummary> {
    const before = await this.assertMilestoneAccess(input.organizationId, input.id, input.actorId, input.canSeeAll);

    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.name !== undefined) data.name = input.name;
    if (input.referenceNumber !== undefined) data.referenceNumber = input.referenceNumber;
    if (input.approvalDate !== undefined) data.approvalDate = input.approvalDate ? toDate(input.approvalDate) : null;
    if (input.description !== undefined) data.description = input.description;
    if (input.alertRecipient !== undefined) data.alertRecipient = input.alertRecipient;
    if (input.reminderOffsetDays !== undefined) data.reminderOffsetDays = input.reminderOffsetDays;

    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    for (const key of ['name', 'referenceNumber', 'approvalDate', 'description', 'alertRecipient', 'reminderOffsetDays']) {
      if (data[key] !== undefined && data[key] !== (before as unknown as Record<string, unknown>)[key]) {
        oldValues[key] = (before as unknown as Record<string, unknown>)[key];
        newValues[key] = data[key];
      }
    }

    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.projectMilestone.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data,
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'PROJECT_MILESTONE',
        entityId: input.id,
        action: 'MILESTONE_UPDATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues,
        newValues,
      });
    });

    return this.getMilestoneSummaryById(input.organizationId, input.id);
  }

  async updateEvent(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    amount: string | undefined;
    dueDate: string | undefined;
    expectedVersion: number;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<MilestoneEventSummary> {
    const before = await this.prisma.client.milestoneEvent.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!before) throwAppError('NOT_FOUND', 'Milestone event not found.');
    const milestone = await this.assertMilestoneAccess(input.organizationId, before.milestoneId, input.actorId, input.canSeeAll);

    if (ACHIEVEMENT_TERMINAL.includes(before.achievementStatus)) {
      throwAppError('VALIDATION_FAILED', 'This event has already been achieved or cancelled and can no longer be edited.');
    }

    const newAmount = input.amount !== undefined ? new Prisma.Decimal(input.amount) : before.amount;
    if (newAmount.lessThanOrEqualTo(0)) throwAppError('VALIDATION_FAILED', 'Amount must be positive.');

    if (input.amount !== undefined) {
      const siblings = await this.prisma.client.milestoneEvent.findMany({
        where: { milestoneId: before.milestoneId, id: { not: before.id } },
      });
      const total = siblings.reduce((sum, e) => sum.plus(e.amount), new Prisma.Decimal(0)).plus(newAmount);
      if (!total.equals(milestone.approvedAmount)) {
        const diff = milestone.approvedAmount.minus(total);
        const verb = diff.isPositive() ? 'short by' : 'over by';
        throwAppError(
          'VALIDATION_FAILED',
          `Event amounts must sum to the approved pool amount exactly — currently ${verb} ${diff.abs().toFixed(2)}.`,
        );
      }
    }

    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.name !== undefined) data.name = input.name;
    if (input.dueDate !== undefined) data.dueDate = toDate(input.dueDate);
    if (input.amount !== undefined) {
      data.amount = newAmount;
      data.percentOfPool = newAmount.dividedBy(milestone.approvedAmount).times(100).toDecimalPlaces(2);
    }

    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    if (input.name !== undefined && input.name !== before.name) {
      oldValues.name = before.name;
      newValues.name = input.name;
    }
    if (input.amount !== undefined && !newAmount.equals(before.amount)) {
      oldValues.amount = before.amount.toFixed(2);
      newValues.amount = newAmount.toFixed(2);
    }
    if (input.dueDate !== undefined && input.dueDate !== toDateStr(before.dueDate)) {
      oldValues.dueDate = toDateStr(before.dueDate);
      newValues.dueDate = input.dueDate;
    }

    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.milestoneEvent.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data,
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'MILESTONE_EVENT',
        entityId: input.id,
        action: 'MILESTONE_EVENT_UPDATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues,
        newValues,
      });
    });

    const row = await this.prisma.client.milestoneEvent.findFirstOrThrow({ where: { id: input.id } });
    return toEventSummary(row, milestone, await this.billingFor(input.organizationId, row.id));
  }

  async startEvent(input: { organizationId: string; id: string; expectedVersion: number; actorId: string; canSeeAll: boolean; correlationId: string }): Promise<MilestoneEventSummary> {
    const before = await this.prisma.client.milestoneEvent.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!before) throwAppError('NOT_FOUND', 'Milestone event not found.');
    const milestone = await this.assertMilestoneAccess(input.organizationId, before.milestoneId, input.actorId, input.canSeeAll);
    if (before.achievementStatus !== 'PLANNED') {
      throwAppError('INVALID_STATE_TRANSITION', 'Only a planned event can be started.');
    }
    await this.transitionEvent(input, before.id, 'IN_PROGRESS', {}, 'MILESTONE_EVENT_STARTED');
    const row = await this.prisma.client.milestoneEvent.findFirstOrThrow({ where: { id: input.id } });
    return toEventSummary(row, milestone, await this.billingFor(input.organizationId, row.id));
  }

  async markEventAchieved(input: { organizationId: string; id: string; achievedOn: string; expectedVersion: number; actorId: string; canSeeAll: boolean; correlationId: string }): Promise<MilestoneEventSummary> {
    const before = await this.prisma.client.milestoneEvent.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!before) throwAppError('NOT_FOUND', 'Milestone event not found.');
    const milestone = await this.assertMilestoneAccess(input.organizationId, before.milestoneId, input.actorId, input.canSeeAll);
    if (before.achievementStatus !== 'IN_PROGRESS') {
      throwAppError('INVALID_STATE_TRANSITION', 'An event must be started before it can be marked achieved.');
    }
    await this.transitionEvent(
      input,
      before.id,
      'ACHIEVED',
      { achievedOn: toDate(input.achievedOn), achievedBy: input.actorId },
      'MILESTONE_EVENT_ACHIEVEMENT_CHANGED',
    );
    await this.prisma.client.$transaction((tx) => this.paymentAlerts.openEligibleForMilestone(tx, before.milestoneId));
    const row = await this.prisma.client.milestoneEvent.findFirstOrThrow({ where: { id: input.id } });
    return toEventSummary(row, milestone, await this.billingFor(input.organizationId, row.id));
  }

  async cancelEvent(input: { organizationId: string; id: string; reason: string; expectedVersion: number; actorId: string; canSeeAll: boolean; correlationId: string }): Promise<MilestoneEventSummary> {
    const before = await this.prisma.client.milestoneEvent.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!before) throwAppError('NOT_FOUND', 'Milestone event not found.');
    const milestone = await this.assertMilestoneAccess(input.organizationId, before.milestoneId, input.actorId, input.canSeeAll);
    if (ACHIEVEMENT_TERMINAL.includes(before.achievementStatus)) {
      throwAppError('INVALID_STATE_TRANSITION', 'This event has already been achieved or cancelled.');
    }
    if (!input.reason.trim()) throwAppError('VALIDATION_FAILED', 'A reason is required to cancel an event.');
    await this.transitionEvent(
      input,
      before.id,
      'CANCELLED',
      { cancelledAt: new Date(), cancelledBy: input.actorId, cancelReason: input.reason },
      'MILESTONE_EVENT_CANCELLED',
    );
    const row = await this.prisma.client.milestoneEvent.findFirstOrThrow({ where: { id: input.id } });
    return toEventSummary(row, milestone, await this.billingFor(input.organizationId, row.id));
  }

  private async transitionEvent(
    input: { organizationId: string; expectedVersion: number; actorId: string; correlationId: string },
    eventId: string,
    achievementStatus: MilestoneAchievementStatus,
    extra: Record<string, unknown>,
    action: string,
  ): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const before = await tx.milestoneEvent.findFirstOrThrow({ where: { id: eventId } });
      const { count } = await tx.milestoneEvent.updateMany({
        where: { id: eventId, organizationId: input.organizationId, version: input.expectedVersion },
        data: { achievementStatus, updatedBy: input.actorId, version: { increment: 1 }, ...extra },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'MILESTONE_EVENT',
        entityId: eventId,
        action,
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { achievementStatus: before.achievementStatus },
        newValues: { achievementStatus, ...extra },
      });
      if (achievementStatus === 'CANCELLED') {
        await this.paymentAlerts.closeAlertsForSource(tx, { sourceEventId: eventId });
      }
    });
  }

  async startMilestone(input: { organizationId: string; id: string; expectedVersion: number; actorId: string; canSeeAll: boolean; correlationId: string }): Promise<MilestoneSummary> {
    const before = await this.assertMilestoneAccess(input.organizationId, input.id, input.actorId, input.canSeeAll);
    if (before.type !== 'OPEX') throwAppError('VALIDATION_FAILED', 'Only an OPEX milestone has its own achievement status.');
    if (before.achievementStatus !== 'PLANNED') throwAppError('INVALID_STATE_TRANSITION', 'Only a planned milestone can be started.');
    await this.transitionMilestone(input, 'IN_PROGRESS', {}, 'MILESTONE_ACHIEVEMENT_CHANGED');
    return this.getMilestoneSummaryById(input.organizationId, input.id);
  }

  async markMilestoneAchieved(input: { organizationId: string; id: string; achievedOn: string; expectedVersion: number; actorId: string; canSeeAll: boolean; correlationId: string }): Promise<MilestoneSummary> {
    const before = await this.assertMilestoneAccess(input.organizationId, input.id, input.actorId, input.canSeeAll);
    if (before.type !== 'OPEX') throwAppError('VALIDATION_FAILED', 'Only an OPEX milestone has its own achievement status.');
    if (before.achievementStatus !== 'IN_PROGRESS') throwAppError('INVALID_STATE_TRANSITION', 'A milestone must be started before it can be marked achieved.');
    await this.transitionMilestone(input, 'ACHIEVED', { achievedOn: toDate(input.achievedOn), achievedBy: input.actorId }, 'MILESTONE_ACHIEVEMENT_CHANGED');
    return this.getMilestoneSummaryById(input.organizationId, input.id);
  }

  async cancelMilestone(input: { organizationId: string; id: string; reason: string; expectedVersion: number; actorId: string; canSeeAll: boolean; correlationId: string }): Promise<MilestoneSummary> {
    const before = await this.assertMilestoneAccess(input.organizationId, input.id, input.actorId, input.canSeeAll);
    if (before.type !== 'OPEX') throwAppError('VALIDATION_FAILED', 'Only an OPEX milestone has its own achievement status.');
    if (ACHIEVEMENT_TERMINAL.includes(before.achievementStatus ?? '')) {
      throwAppError('INVALID_STATE_TRANSITION', 'This milestone has already been achieved or cancelled.');
    }
    if (!input.reason.trim()) throwAppError('VALIDATION_FAILED', 'A reason is required to cancel a milestone.');

    await this.prisma.client.$transaction(async (tx) => {
      const beforeRow = await tx.projectMilestone.findFirstOrThrow({ where: { id: input.id } });
      const { count } = await tx.projectMilestone.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: {
          achievementStatus: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledBy: input.actorId,
          cancelReason: input.reason,
          updatedBy: input.actorId,
          version: { increment: 1 },
        },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');

      const cascaded = await tx.milestoneInstallment.findMany({
        where: { milestoneId: input.id, status: 'PLANNED' },
        select: { id: true, sequenceNumber: true },
      });
      if (cascaded.length > 0) {
        await tx.milestoneInstallment.updateMany({
          where: { id: { in: cascaded.map((c) => c.id) } },
          data: {
            status: 'CANCELLED',
            cancelReason: input.reason,
            closedAt: new Date(),
            closedBy: input.actorId,
            updatedBy: input.actorId,
            version: { increment: 1 },
          },
        });
        for (const c of cascaded) {
          await this.paymentAlerts.closeAlertsForSource(tx, { sourceInstallmentId: c.id });
        }
      }

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'PROJECT_MILESTONE',
        entityId: input.id,
        action: 'MILESTONE_CANCELLED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        reason: input.reason,
        oldValues: { achievementStatus: beforeRow.achievementStatus },
        newValues: { achievementStatus: 'CANCELLED', cascadedInstallments: cascaded.map((c) => c.sequenceNumber) },
      });
    });

    return this.getMilestoneSummaryById(input.organizationId, input.id);
  }

  private async transitionMilestone(
    input: { organizationId: string; id: string; expectedVersion: number; actorId: string; correlationId: string },
    achievementStatus: MilestoneAchievementStatus,
    extra: Record<string, unknown>,
    action: string,
  ): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const before = await tx.projectMilestone.findFirstOrThrow({ where: { id: input.id } });
      const { count } = await tx.projectMilestone.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: { achievementStatus, updatedBy: input.actorId, version: { increment: 1 }, ...extra },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'PROJECT_MILESTONE',
        entityId: input.id,
        action,
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { achievementStatus: before.achievementStatus },
        newValues: { achievementStatus, ...extra },
      });
    });
  }

  async skipInstallment(input: { organizationId: string; id: string; reason: string; expectedVersion: number; actorId: string; canSeeAll: boolean; correlationId: string }): Promise<MilestoneInstallmentSummary> {
    const before = await this.prisma.client.milestoneInstallment.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!before) throwAppError('NOT_FOUND', 'Milestone installment not found.');
    await this.assertMilestoneAccess(input.organizationId, before.milestoneId, input.actorId, input.canSeeAll);
    if (before.status !== 'PLANNED') throwAppError('INVALID_STATE_TRANSITION', 'Only a planned installment can be skipped.');
    if (!input.reason.trim()) throwAppError('VALIDATION_FAILED', 'A reason is required to skip an installment.');
    // PLANNED again after a partial invoice (ADR-156): skipping would drop
    // what is left without a decision on what was already billed.
    if (invoicedOf(await this.billingFor(input.organizationId, before.id)).greaterThan(0)) {
      throwAppError('INVALID_STATE_TRANSITION', 'This installment is partly invoiced. Void its invoices before skipping it.');
    }

    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.milestoneInstallment.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: {
          status: 'SKIPPED',
          skipReason: input.reason,
          closedAt: new Date(),
          closedBy: input.actorId,
          updatedBy: input.actorId,
          version: { increment: 1 },
        },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'MILESTONE_INSTALLMENT',
        entityId: input.id,
        action: 'MILESTONE_INSTALLMENT_SKIPPED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        reason: input.reason,
        oldValues: { status: 'PLANNED' },
        newValues: { status: 'SKIPPED' },
      });
      await this.paymentAlerts.closeAlertsForSource(tx, { sourceInstallmentId: input.id });
    });

    const row = await this.prisma.client.milestoneInstallment.findFirstOrThrow({ where: { id: input.id } });
    return toInstallmentSummary(row, await this.billingFor(input.organizationId, row.id));
  }

  private async getMilestoneSummaryById(organizationId: string, id: string): Promise<MilestoneSummary> {
    const row = await this.prisma.client.projectMilestone.findFirstOrThrow({
      where: { id, organizationId },
      include: { events: { orderBy: { sequence: 'asc' } }, installments: { orderBy: { sequenceNumber: 'asc' } } },
    });
    const billingBySource = await this.billingBySource(organizationId, [
      ...row.events.map((e) => e.id),
      ...row.installments.map((i) => i.id),
    ]);
    return toMilestoneSummary(row, { events: row.events, installments: row.installments, billingBySource });
  }
}
