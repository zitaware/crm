import { generateId, recordAuditEvent, enqueueOutboxEvent, type PrismaClient } from '@zitaware/database';
import { createLogger } from '@zitaware/config';

const logger = createLogger({ service: 'worker' });

const PAYMENT_ALERT_SNOOZE_PERMISSION = 'payment_alert.snooze';

function startOfTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDaysUTC(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** "Account Team" resolution (ADR-064 decision 10): every active user in
 * the organization whose effective permissions (role grants, then
 * per-user GRANT/REVOKE overrides applied on top — the same algorithm as
 * RolesService.getEffectivePermissions, applied here across all users
 * rather than one) include `payment_alert.snooze`. Resilient to custom
 * roles granted that key later; no hardcoded role name. Reimplemented here
 * (not imported from apps/api) because the worker is a separate app with
 * no NestJS DI and intentionally no dependency on @zitaware/contracts. */
async function resolveAccountTeamEmails(prisma: PrismaClient, organizationId: string): Promise<string[]> {
  const candidates = await prisma.user.findMany({
    where: {
      organizationId,
      status: 'ACTIVE',
      OR: [
        { userRoles: { some: { role: { rolePermissions: { some: { permission: { key: PAYMENT_ALERT_SNOOZE_PERMISSION } } } } } } },
        { userPermissionOverrides: { some: { permission: { key: PAYMENT_ALERT_SNOOZE_PERMISSION }, effect: 'GRANT', scopeType: null } } },
      ],
    },
    select: {
      email: true,
      userRoles: { select: { role: { select: { rolePermissions: { select: { permission: { select: { key: true } } } } } } } },
      userPermissionOverrides: { select: { effect: true, scopeType: true, permission: { select: { key: true } } } },
    },
  });

  const emails: string[] = [];
  for (const user of candidates) {
    const hasRoleGrant = user.userRoles.some((ur) =>
      ur.role.rolePermissions.some((rp) => rp.permission.key === PAYMENT_ALERT_SNOOZE_PERMISSION),
    );
    const overrides = user.userPermissionOverrides.filter((o) => o.scopeType === null && o.permission.key === PAYMENT_ALERT_SNOOZE_PERMISSION);
    const hasUserGrant = overrides.some((o) => o.effect === 'GRANT');
    const hasUserRevoke = overrides.some((o) => o.effect === 'REVOKE');
    if ((hasRoleGrant || hasUserGrant) && !hasUserRevoke) {
      emails.push(user.email);
    }
  }
  return emails;
}

/** "Project Manager" recipient resolution — the project's assigned
 * manager's linked user email, if any. Silently returns null when
 * unassigned or the employee has no linked system-access user; never an
 * error, since a project without an assigned/linked PM is normal. */
async function resolveProjectManagerEmail(prisma: PrismaClient, organizationId: string, projectId: string): Promise<string | null> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: { projectManager: { select: { user: { select: { email: true, status: true } } } } },
  });
  const user = project?.projectManager?.user;
  if (!user || user.status !== 'ACTIVE') return null;
  return user.email;
}

async function resolveRecipients(
  prisma: PrismaClient,
  organizationId: string,
  projectId: string,
  alertRecipient: string,
): Promise<string[]> {
  const emails = new Set<string>();
  if (alertRecipient === 'ACCOUNT_TEAM' || alertRecipient === 'BOTH') {
    for (const email of await resolveAccountTeamEmails(prisma, organizationId)) emails.add(email);
  }
  if (alertRecipient === 'PROJECT_MANAGER' || alertRecipient === 'BOTH') {
    const pmEmail = await resolveProjectManagerEmail(prisma, organizationId, projectId);
    if (pmEmail) emails.add(pmEmail);
  }
  return [...emails];
}

async function notifyRecipients(
  prisma: PrismaClient,
  input: {
    alertId: string;
    organizationId: string;
    projectId: string;
    alertRecipient: string;
    title: string;
    amount: string;
    dueDate: string;
  },
): Promise<void> {
  const emails = await resolveRecipients(prisma, input.organizationId, input.projectId, input.alertRecipient);
  await prisma.$transaction(async (tx) => {
    for (const email of emails) {
      await enqueueOutboxEvent(tx, {
        organizationId: input.organizationId,
        aggregateType: 'PAYMENT_ALERT',
        aggregateId: input.alertId,
        eventType: 'PAYMENT_ALERT_OPENED',
        payload: { email, title: input.title, amount: input.amount, dueDate: input.dueDate },
      });
    }
  });
}

interface OpenResult {
  opened: number;
  reopened: number;
}

/** Opens a brand-new alert for every CAPEX event/OPEX installment that has
 * become eligible and doesn't have one yet (ADR-064 decisions 7-8), and
 * reopens every SNOOZED alert whose snooze window has passed (decision 9).
 * Naturally idempotent — an already-OPEN alert is never touched again,
 * since `PaymentAlert.sourceEventId`/`sourceInstallmentId` are hard-unique
 * (decision 3), so running this on any interval, however often, never
 * double-opens or double-notifies. */
export async function openAndReopenAlerts(prisma: PrismaClient): Promise<OpenResult> {
  const today = startOfTodayUTC();
  let opened = 0;
  let reopened = 0;

  const capexEvents = await prisma.milestoneEvent.findMany({
    where: { achievementStatus: { not: 'CANCELLED' }, paymentAlert: null },
    include: { milestone: true },
  });
  for (const event of capexEvents) {
    const threshold = addDaysUTC(event.dueDate, -event.milestone.reminderOffsetDays);
    const eligible = event.achievementStatus === 'ACHIEVED' || today >= threshold;
    if (!eligible) continue;

    const alertId = generateId();
    await prisma.$transaction(async (tx) => {
      await tx.paymentAlert.create({
        data: {
          id: alertId,
          organizationId: event.organizationId,
          projectId: event.milestone.projectId,
          sourceType: 'CAPEX_EVENT',
          sourceEventId: event.id,
          status: 'OPEN',
        },
      });
      await recordAuditEvent(tx, {
        organizationId: event.organizationId,
        entityType: 'PAYMENT_ALERT',
        entityId: alertId,
        action: 'PAYMENT_ALERT_OPENED',
        correlationId: generateId(),
        newValues: { sourceType: 'CAPEX_EVENT', sourceEventId: event.id, dueDate: event.dueDate.toISOString().slice(0, 10) },
      });
    });
    await notifyRecipients(prisma, {
      alertId,
      organizationId: event.organizationId,
      projectId: event.milestone.projectId,
      alertRecipient: event.milestone.alertRecipient,
      title: `${event.code} — ${event.name}`,
      amount: event.amount.toFixed(2),
      dueDate: event.dueDate.toISOString().slice(0, 10),
    });
    opened++;
  }

  const opexInstallments = await prisma.milestoneInstallment.findMany({
    where: { status: 'PLANNED', paymentAlert: null },
    include: { milestone: true },
  });
  for (const installment of opexInstallments) {
    const threshold = addDaysUTC(installment.plannedInvoiceDate, -installment.milestone.reminderOffsetDays);
    if (today < threshold) continue;

    const alertId = generateId();
    await prisma.$transaction(async (tx) => {
      await tx.paymentAlert.create({
        data: {
          id: alertId,
          organizationId: installment.organizationId,
          projectId: installment.milestone.projectId,
          sourceType: 'OPEX_INSTALLMENT',
          sourceInstallmentId: installment.id,
          status: 'OPEN',
        },
      });
      await recordAuditEvent(tx, {
        organizationId: installment.organizationId,
        entityType: 'PAYMENT_ALERT',
        entityId: alertId,
        action: 'PAYMENT_ALERT_OPENED',
        correlationId: generateId(),
        newValues: {
          sourceType: 'OPEX_INSTALLMENT',
          sourceInstallmentId: installment.id,
          dueDate: installment.plannedInvoiceDate.toISOString().slice(0, 10),
        },
      });
    });
    await notifyRecipients(prisma, {
      alertId,
      organizationId: installment.organizationId,
      projectId: installment.milestone.projectId,
      alertRecipient: installment.milestone.alertRecipient,
      title: `${installment.milestone.name} — Installment ${installment.sequenceNumber} of ${installment.milestone.installmentCount}`,
      amount: installment.scheduledAmount.toFixed(2),
      dueDate: installment.plannedInvoiceDate.toISOString().slice(0, 10),
    });
    opened++;
  }

  const toReopen = await prisma.paymentAlert.findMany({
    where: { status: 'SNOOZED', snoozedUntil: { lte: today } },
    include: {
      sourceEvent: { include: { milestone: true } },
      sourceInstallment: { include: { milestone: true } },
    },
  });
  for (const alert of toReopen) {
    await prisma.$transaction(async (tx) => {
      await tx.paymentAlert.update({
        where: { id: alert.id },
        data: { status: 'OPEN', snoozedUntil: null, snoozedAt: null, snoozedBy: null, snoozeNote: null, version: { increment: 1 } },
      });
      await recordAuditEvent(tx, {
        organizationId: alert.organizationId,
        entityType: 'PAYMENT_ALERT',
        entityId: alert.id,
        action: 'PAYMENT_ALERT_OPENED',
        correlationId: generateId(),
        oldValues: { status: 'SNOOZED' },
        newValues: { status: 'OPEN' },
      });
    });

    const event = alert.sourceEvent;
    const installment = alert.sourceInstallment;
    const title = event
      ? `${event.code} — ${event.name}`
      : `${installment!.milestone.name} — Installment ${installment!.sequenceNumber} of ${installment!.milestone.installmentCount}`;
    const amount = event ? event.amount.toFixed(2) : installment!.scheduledAmount.toFixed(2);
    const dueDate = event ? event.dueDate.toISOString().slice(0, 10) : installment!.plannedInvoiceDate.toISOString().slice(0, 10);
    const alertRecipient = event ? event.milestone.alertRecipient : installment!.milestone.alertRecipient;

    await notifyRecipients(prisma, {
      alertId: alert.id,
      organizationId: alert.organizationId,
      projectId: alert.projectId,
      alertRecipient,
      title,
      amount,
      dueDate,
    });
    reopened++;
  }

  return { opened, reopened };
}

/** Wraps openAndReopenAlerts with job_runs bookkeeping (RUNNING ->
 * SUCCEEDED/FAILED, items_processed), mirroring runOutboxDispatchJob's
 * exact shape so operators see this job's tick history the same way. */
export async function runPaymentAlertOpenerJob(prisma: PrismaClient): Promise<void> {
  const jobRun = await prisma.jobRun.create({
    data: { id: generateId(), jobName: 'payment-alert-opener', status: 'RUNNING' },
  });

  try {
    const result = await openAndReopenAlerts(prisma);
    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: { status: 'SUCCEEDED', itemsProcessed: result.opened + result.reopened, finishedAt: new Date() },
    });
    if (result.opened > 0 || result.reopened > 0) {
      logger.info('payment_alert_opener.tick', result);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: { status: 'FAILED', error: message, finishedAt: new Date() },
    });
    logger.error('payment_alert_opener.tick_failed', { error: message });
  }
}
