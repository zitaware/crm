import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { enqueueOutboxEvent, generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import { isConstraintViolation } from '../organization/constraint-error.util';
import type { PaymentAlertHeaderSummary, PaymentAlertPort, PaymentAlertSummary, ProjectPaymentAlertOverview } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { loadSourceBilling, remainingOf, type SourceBilling } from '../invoices/source-billing';

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Prisma requires a full ISO-8601 DateTime (or a Date instance) for
 * @db.Date columns — a bare 'YYYY-MM-DD' string is rejected. */
function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function startOfTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDaysUTC(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

type AlertRow = Prisma.PaymentAlertGetPayload<{
  include: {
    sourceEvent: { include: { milestone: true } };
    sourceInstallment: { include: { milestone: true } };
  };
}>;

function sourceIdOf(row: { sourceEventId: string | null; sourceInstallmentId: string | null }): string {
  return (row.sourceEventId ?? row.sourceInstallmentId)!;
}

function toSummary(row: AlertRow, today: Date, billing: SourceBilling | undefined): PaymentAlertSummary {
  let title: string;
  let milestoneCode: string;
  let dueDate: Date;
  let amount: Prisma.Decimal;
  let period: { start: Date; end: Date } | null = null;

  if (row.sourceType === 'CAPEX_EVENT') {
    const event = row.sourceEvent!;
    title = `${event.code} — ${event.name}`;
    milestoneCode = event.milestone.code;
    dueDate = event.dueDate;
    amount = event.amount;
  } else {
    const installment = row.sourceInstallment!;
    title = `${installment.milestone.name} — Installment ${installment.sequenceNumber} of ${installment.milestone.installmentCount}`;
    milestoneCode = installment.milestone.code;
    dueDate = installment.plannedInvoiceDate;
    amount = installment.scheduledAmount;
    period = { start: installment.servicePeriodStart, end: installment.servicePeriodEnd };
  }

  const derivedLabel = row.status === 'SNOOZED' ? 'SNOOZED' : dueDate < today ? 'OVERDUE' : 'DUE';

  return {
    id: row.id,
    projectId: row.projectId,
    sourceType: row.sourceType,
    title,
    milestoneCode,
    dueDate: toDateStr(dueDate),
    servicePeriodStart: period ? toDateStr(period.start) : null,
    servicePeriodEnd: period ? toDateStr(period.end) : null,
    amount: amount.toFixed(2),
    invoicedAmount: (billing?.invoiced ?? new Prisma.Decimal(0)).toFixed(2),
    remainingAmount: remainingOf(amount, billing).toFixed(2),
    latestInvoice: billing?.invoices.at(-1) ?? null,
    status: row.status,
    derivedLabel,
    snoozedUntil: row.snoozedUntil ? toDateStr(row.snoozedUntil) : null,
    snoozeNote: row.snoozeNote,
    openedAt: row.openedAt.toISOString(),
    version: row.version,
  };
}

const alertInclude = {
  sourceEvent: { include: { milestone: true } },
  sourceInstallment: { include: { milestone: true } },
} satisfies Prisma.PaymentAlertInclude;

const alertIncludeWithProject = {
  ...alertInclude,
  project: { select: { name: true } },
} satisfies Prisma.PaymentAlertInclude;

type AlertRowWithProject = Prisma.PaymentAlertGetPayload<{ include: typeof alertIncludeWithProject }>;

const HEADER_SUMMARY_ITEM_LIMIT = 10;

@Injectable()
export class PaymentAlertsService implements PaymentAlertPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  private async assertProjectAccess(input: { organizationId: string; projectId: string; actorId: string; canSeeAll: boolean }): Promise<void> {
    await this.projects.getDetail({
      organizationId: input.organizationId,
      id: input.projectId,
      actorId: input.actorId,
      canSeeAll: input.canSeeAll,
    });
  }

  private async assertAlertAccess(organizationId: string, alertId: string, actorId: string, canSeeAll: boolean): Promise<AlertRow> {
    const alert = await this.prisma.client.paymentAlert.findFirst({
      where: { id: alertId, organizationId },
      include: alertInclude,
    });
    if (!alert) throwAppError('NOT_FOUND', 'Payment alert not found.');
    await this.assertProjectAccess({ organizationId, projectId: alert.projectId, actorId, canSeeAll });
    return alert;
  }

  async listForProject(input: { organizationId: string; projectId: string; actorId: string; canSeeAll: boolean }): Promise<ProjectPaymentAlertOverview> {
    await this.assertProjectAccess(input);

    const today = startOfTodayUTC();
    const rows = await this.prisma.client.paymentAlert.findMany({
      where: { organizationId: input.organizationId, projectId: input.projectId },
      include: alertInclude,
      orderBy: { openedAt: 'asc' },
    });

    const billed = await loadSourceBilling(this.prisma.client, input.organizationId, rows.map(sourceIdOf));
    // Earliest due first; an OPEX schedule's alerts all open at once, so
    // opening time alone leaves them in no useful order.
    const summaries = rows
      .map((row) => toSummary(row, today, billed.get(sourceIdOf(row))))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title, undefined, { numeric: true }));
    const openAlerts = summaries.filter((s) => s.status === 'OPEN');
    const snoozedAlerts = summaries.filter((s) => s.status === 'SNOOZED');
    const overdueCount = openAlerts.filter((s) => s.derivedLabel === 'OVERDUE').length;
    const dueCount = openAlerts.filter((s) => s.derivedLabel === 'DUE').length;
    const pendingAmount = openAlerts
      .reduce((sum, s) => sum.plus(new Prisma.Decimal(s.remainingAmount)), new Prisma.Decimal(0))
      .toFixed(2);

    return {
      openAlerts,
      snoozedAlerts,
      overdueCount,
      dueCount,
      snoozedCount: snoozedAlerts.length,
      pendingAmount,
    };
  }

  /** Org-wide OPEN-alert summary for the app header's notification bell —
   * SNOOZED/CLOSED excluded (a human already deferred or resolved those).
   * PM-scoping mirrors ProjectsService.list/InvoicesService.list exactly:
   * only resolve the actor's assigned projects when they lack
   * project.read_all, skip that extra query otherwise. */
  async getHeaderSummary(input: { organizationId: string; actorId: string; canSeeAll: boolean }): Promise<PaymentAlertHeaderSummary> {
    let scopeWhere: Prisma.PaymentAlertWhereInput | undefined;
    if (!input.canSeeAll) {
      const assigned = await this.projects.list({ organizationId: input.organizationId, actorId: input.actorId, canSeeAll: false });
      scopeWhere = { projectId: { in: assigned.map((p) => p.id) } };
    }

    const today = startOfTodayUTC();
    const rows = await this.prisma.client.paymentAlert.findMany({
      where: { organizationId: input.organizationId, status: 'OPEN', ...scopeWhere },
      include: alertIncludeWithProject,
    });

    const billed = await loadSourceBilling(this.prisma.client, input.organizationId, rows.map(sourceIdOf));
    const items = (rows as AlertRowWithProject[])
      .map((row) => ({ ...toSummary(row, today, billed.get(sourceIdOf(row))), projectName: row.project.name }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    return {
      overdueCount: items.filter((i) => i.derivedLabel === 'OVERDUE').length,
      dueCount: items.filter((i) => i.derivedLabel === 'DUE').length,
      items: items.slice(0, HEADER_SUMMARY_ITEM_LIMIT),
    };
  }

  async snooze(input: {
    organizationId: string;
    id: string;
    snoozedUntil: string;
    note: string | undefined;
    expectedVersion: number;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<PaymentAlertSummary> {
    const before = await this.assertAlertAccess(input.organizationId, input.id, input.actorId, input.canSeeAll);

    const snoozedUntil = toDate(input.snoozedUntil);
    const today = startOfTodayUTC();
    if (snoozedUntil <= today) {
      throwAppError('VALIDATION_FAILED', 'Snooze date must be in the future.');
    }

    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.paymentAlert.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: {
          status: 'SNOOZED',
          snoozedUntil,
          snoozedAt: new Date(),
          snoozedBy: input.actorId,
          snoozeNote: input.note ?? null,
          version: { increment: 1 },
        },
      });
      if (count === 0) throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'PAYMENT_ALERT',
        entityId: input.id,
        action: 'PAYMENT_ALERT_SNOOZED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        reason: input.note,
        oldValues: { status: before.status, snoozedUntil: before.snoozedUntil ? toDateStr(before.snoozedUntil) : null },
        newValues: { status: 'SNOOZED', snoozedUntil: input.snoozedUntil },
      });
    });

    const row = await this.prisma.client.paymentAlert.findFirstOrThrow({ where: { id: input.id }, include: alertInclude });
    const billed = await loadSourceBilling(this.prisma.client, input.organizationId, [sourceIdOf(row)]);
    return toSummary(row, startOfTodayUTC(), billed.get(sourceIdOf(row)));
  }

  /** Deletes any live (OPEN/SNOOZED) alert for a source that has just been
   * cancelled/skipped — the row represents a reminder for a billing event
   * that provably will never happen, not a financial record, so physical
   * deletion is the one deliberate exception to this codebase's
   * no-physical-deletion rule (ADR-064 decision 14). No-op if no alert
   * exists yet for the source. Must be called inside the caller's own
   * transaction (same `tx` as the cancel/skip mutation). */
  /**
   * Opens an alert for every CAPEX event or OPEX installment on this milestone
   * that is already billable. The scheduled job still opens the ones that
   * become due later, and skips any source that already has an alert.
   */
  async openEligibleForMilestone(tx: Prisma.TransactionClient, milestoneId: string): Promise<void> {
    const today = startOfTodayUTC();
    const milestone = await tx.projectMilestone.findFirstOrThrow({
      where: { id: milestoneId },
      include: {
        events: { where: { achievementStatus: { not: 'CANCELLED' }, paymentAlert: null } },
        installments: { where: { status: 'PLANNED', paymentAlert: null } },
      },
    });

    for (const event of milestone.events) {
      const threshold = addDaysUTC(event.dueDate, -milestone.reminderOffsetDays);
      const eligible = event.achievementStatus === 'ACHIEVED' || today >= threshold;
      if (!eligible) continue;
      await this.openAlert(tx, {
        organizationId: milestone.organizationId,
        projectId: milestone.projectId,
        alertRecipient: milestone.alertRecipient,
        sourceType: 'CAPEX_EVENT',
        sourceEventId: event.id,
        title: `${event.code} — ${event.name}`,
        amount: event.amount.toFixed(2),
        dueDate: toDateStr(event.dueDate),
      });
    }

    for (const installment of milestone.installments) {
      const threshold = addDaysUTC(installment.plannedInvoiceDate, -milestone.reminderOffsetDays);
      if (today < threshold) continue;
      await this.openAlert(tx, {
        organizationId: milestone.organizationId,
        projectId: milestone.projectId,
        alertRecipient: milestone.alertRecipient,
        sourceType: 'OPEX_INSTALLMENT',
        sourceInstallmentId: installment.id,
        title: `${milestone.name} — Installment ${installment.sequenceNumber} of ${milestone.installmentCount}`,
        amount: installment.scheduledAmount.toFixed(2),
        dueDate: toDateStr(installment.plannedInvoiceDate),
      });
    }
  }

  private async openAlert(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      projectId: string;
      alertRecipient: string;
      sourceType: 'CAPEX_EVENT' | 'OPEX_INSTALLMENT';
      sourceEventId?: string;
      sourceInstallmentId?: string;
      title: string;
      amount: string;
      dueDate: string;
    },
  ): Promise<void> {
    const alertId = generateId();
    try {
      await tx.paymentAlert.create({
        data: {
          id: alertId,
          organizationId: input.organizationId,
          projectId: input.projectId,
          sourceType: input.sourceType,
          sourceEventId: input.sourceEventId ?? null,
          sourceInstallmentId: input.sourceInstallmentId ?? null,
          status: 'OPEN',
        },
      });
    } catch (error) {
      if (isConstraintViolation(error)) return;
      throw error;
    }
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      entityType: 'PAYMENT_ALERT',
      entityId: alertId,
      action: 'PAYMENT_ALERT_OPENED',
      correlationId: generateId(),
      newValues: {
        sourceType: input.sourceType,
        sourceEventId: input.sourceEventId ?? null,
        sourceInstallmentId: input.sourceInstallmentId ?? null,
        dueDate: input.dueDate,
      },
    });
    const emails = await this.resolveAlertRecipients(tx, input.organizationId, input.projectId, input.alertRecipient);
    for (const email of emails) {
      await enqueueOutboxEvent(tx, {
        organizationId: input.organizationId,
        aggregateType: 'PAYMENT_ALERT',
        aggregateId: alertId,
        eventType: 'PAYMENT_ALERT_OPENED',
        payload: { email, title: input.title, amount: input.amount, dueDate: input.dueDate },
      });
    }
  }

  private async resolveAlertRecipients(
    tx: Prisma.TransactionClient,
    organizationId: string,
    projectId: string,
    alertRecipient: string,
  ): Promise<string[]> {
    const emails = new Set<string>();
    if (alertRecipient === 'ACCOUNT_TEAM' || alertRecipient === 'BOTH') {
      const candidates = await tx.user.findMany({
        where: {
          organizationId,
          status: 'ACTIVE',
          OR: [
            { userRoles: { some: { role: { rolePermissions: { some: { permission: { key: 'payment_alert.snooze' } } } } } } },
            { userPermissionOverrides: { some: { permission: { key: 'payment_alert.snooze' }, effect: 'GRANT', scopeType: null } } },
          ],
        },
        select: {
          email: true,
          userRoles: { select: { role: { select: { rolePermissions: { select: { permission: { select: { key: true } } } } } } } },
          userPermissionOverrides: { select: { effect: true, scopeType: true, permission: { select: { key: true } } } },
        },
      });
      for (const user of candidates) {
        const hasRoleGrant = user.userRoles.some((ur) => ur.role.rolePermissions.some((rp) => rp.permission.key === 'payment_alert.snooze'));
        const overrides = user.userPermissionOverrides.filter((o) => o.scopeType === null && o.permission.key === 'payment_alert.snooze');
        const hasUserGrant = overrides.some((o) => o.effect === 'GRANT');
        const hasUserRevoke = overrides.some((o) => o.effect === 'REVOKE');
        if ((hasRoleGrant || hasUserGrant) && !hasUserRevoke) emails.add(user.email);
      }
    }
    if (alertRecipient === 'PROJECT_MANAGER' || alertRecipient === 'BOTH') {
      const project = await tx.project.findFirst({
        where: { id: projectId, organizationId },
        select: { projectManager: { select: { user: { select: { email: true, status: true } } } } },
      });
      const user = project?.projectManager?.user;
      if (user && user.status === 'ACTIVE') emails.add(user.email);
    }
    return [...emails];
  }

  async closeAlertsForSource(tx: Prisma.TransactionClient, input: { sourceEventId?: string; sourceInstallmentId?: string }): Promise<void> {
    if (input.sourceEventId) {
      await tx.paymentAlert.deleteMany({ where: { sourceEventId: input.sourceEventId } });
    }
    if (input.sourceInstallmentId) {
      await tx.paymentAlert.deleteMany({ where: { sourceInstallmentId: input.sourceInstallmentId } });
    }
  }
}
