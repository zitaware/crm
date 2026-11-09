import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, generateId } from '@zitaware/database';
import { openAndReopenAlerts } from './payment-alert-opener';

const prisma = createPrismaClient();

const PAST_DATE = new Date('2020-01-01T00:00:00.000Z');
const FAR_FUTURE_DATE = new Date('2099-01-01T00:00:00.000Z');

let organizationId: string;
let projectId: string;
let accountTeamUserId: string;
let pmUserId: string;
let pmEmployeeId: string;

async function createCapexEvent(overrides: {
  dueDate: Date;
  achievementStatus: 'PLANNED' | 'IN_PROGRESS' | 'ACHIEVED' | 'CANCELLED';
  alertRecipient?: 'ACCOUNT_TEAM' | 'PROJECT_MANAGER' | 'BOTH';
}) {
  const code = `CAP-${generateId()}`;
  const milestone = await prisma.projectMilestone.create({
    data: {
      id: generateId(),
      organizationId,
      projectId,
      type: 'CAPEX',
      code,
      name: 'Test Capex Pool',
      approvedAmount: '1000000',
      alertRecipient: overrides.alertRecipient ?? 'ACCOUNT_TEAM',
      reminderOffsetDays: 3,
    },
  });
  const event = await prisma.milestoneEvent.create({
    data: {
      id: generateId(),
      organizationId,
      milestoneId: milestone.id,
      milestoneType: 'CAPEX',
      code: `${code}-E01`,
      name: 'Go Live',
      percentOfPool: '100',
      amount: '1000000',
      dueDate: overrides.dueDate,
      achievementStatus: overrides.achievementStatus,
      sequence: 1,
    },
  });
  return { milestone, event };
}

async function createOpexInstallment(overrides: {
  plannedInvoiceDate: Date;
  status?: 'PLANNED' | 'SKIPPED' | 'CANCELLED';
  alertRecipient?: 'ACCOUNT_TEAM' | 'PROJECT_MANAGER' | 'BOTH';
}) {
  const code = `OPEX-${generateId()}`;
  const milestone = await prisma.projectMilestone.create({
    data: {
      id: generateId(),
      organizationId,
      projectId,
      type: 'OPEX',
      code,
      name: 'Test Opex Milestone',
      approvedAmount: '1200000',
      achievementStatus: 'PLANNED',
      frequency: 'MONTHLY',
      installmentCount: 12,
      scheduleStartDate: PAST_DATE,
      firstInvoiceDate: PAST_DATE,
      alertRecipient: overrides.alertRecipient ?? 'ACCOUNT_TEAM',
      reminderOffsetDays: 3,
    },
  });
  const installment = await prisma.milestoneInstallment.create({
    data: {
      id: generateId(),
      organizationId,
      milestoneId: milestone.id,
      milestoneType: 'OPEX',
      sequenceNumber: 1,
      servicePeriodStart: PAST_DATE,
      servicePeriodEnd: PAST_DATE,
      plannedInvoiceDate: overrides.plannedInvoiceDate,
      scheduledAmount: '100000',
      status: overrides.status ?? 'PLANNED',
    },
  });
  return { milestone, installment };
}

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { id: generateId(), name: 'Payment Alert Opener Test Org', code: `PAOPENERTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const party = await prisma.party.create({
    data: { id: generateId(), organizationId, name: 'Opener Test Client' },
  });
  const legalEntity = await prisma.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'Opener Test Legal Entity', panNumber: 'ABCPO5678P', registeredAddress: 'Ahmedabad' },
  });

  accountTeamUserId = generateId();
  await prisma.user.create({
    data: { id: accountTeamUserId, organizationId, email: 'account-team@zitaware.test', passwordHash: 'test-hash', displayName: 'Account Team Member', status: 'ACTIVE' },
  });
  const role = await prisma.role.create({
    data: { id: generateId(), organizationId, name: 'Test Accountant', isSystem: false },
  });
  const snoozePermission = await prisma.permission.findUniqueOrThrow({ where: { key: 'payment_alert.snooze' } });
  await prisma.rolePermission.create({
    data: { id: generateId(), roleId: role.id, permissionId: snoozePermission.id },
  });
  await prisma.userRole.create({
    data: { id: generateId(), organizationId, userId: accountTeamUserId, roleId: role.id },
  });

  pmUserId = generateId();
  await prisma.user.create({
    data: { id: pmUserId, organizationId, email: 'pm@zitaware.test', passwordHash: 'test-hash', displayName: 'Project Manager', status: 'ACTIVE' },
  });
  const pmEmployee = await prisma.employee.create({
    data: { id: generateId(), organizationId, userId: pmUserId, employeeCode: 'EMP-PAOPENER-1', fullName: 'Project Manager', joiningDate: new Date('2024-01-01') },
  });
  pmEmployeeId = pmEmployee.id;

  const project = await prisma.project.create({
    data: {
      id: generateId(),
      organizationId,
      clientId: party.id,
      legalEntityId: legalEntity.id,
      projectManagerId: pmEmployeeId,
      name: 'Payment Alert Opener Test Project',
      stage: 'WON',
      operationalStatus: 'ACTIVE',
    },
  });
  projectId = project.id;
});

afterAll(async () => {
  // The outbox dispatcher spec runs in parallel and may already have turned
  // this spec's outbox events into notifications, which reference them.
  await prisma.notification.deleteMany({ where: { organizationId } });
  await prisma.outboxEvent.deleteMany({ where: { organizationId } });
  await prisma.auditEvent.deleteMany({ where: { organizationId } });
  await prisma.paymentAlert.deleteMany({ where: { organizationId } });
  await prisma.milestoneInstallment.deleteMany({ where: { organizationId } });
  await prisma.milestoneEvent.deleteMany({ where: { organizationId } });
  await prisma.projectMilestone.deleteMany({ where: { organizationId } });
  await prisma.project.deleteMany({ where: { organizationId } });
  await prisma.userRole.deleteMany({ where: { organizationId } });
  await prisma.rolePermission.deleteMany({ where: { role: { organizationId } } });
  await prisma.role.deleteMany({ where: { organizationId } });
  await prisma.employee.deleteMany({ where: { organizationId } });
  await prisma.user.deleteMany({ where: { organizationId } });
  await prisma.party.deleteMany({ where: { organizationId } });
  await prisma.legalEntity.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
  await prisma.$disconnect();
});

describe('openAndReopenAlerts', () => {
  it('opens an alert for an OPEX installment past its reminder-offset window and enqueues exactly one outbox event', async () => {
    const { installment } = await createOpexInstallment({ plannedInvoiceDate: PAST_DATE });

    await openAndReopenAlerts(prisma);

    const alert = await prisma.paymentAlert.findUnique({ where: { sourceInstallmentId: installment.id } });
    expect(alert).not.toBeNull();
    expect(alert!.status).toBe('OPEN');

    const outboxEvents = await prisma.outboxEvent.findMany({ where: { aggregateId: alert!.id, eventType: 'PAYMENT_ALERT_OPENED' } });
    expect(outboxEvents).toHaveLength(1);
  });

  it('opens a CAPEX event immediately once marked ACHIEVED, even with a due date far in the future', async () => {
    const { event } = await createCapexEvent({ dueDate: FAR_FUTURE_DATE, achievementStatus: 'ACHIEVED' });

    await openAndReopenAlerts(prisma);

    const alert = await prisma.paymentAlert.findUnique({ where: { sourceEventId: event.id } });
    expect(alert).not.toBeNull();
  });

  it('opens a CAPEX event once past its due date even if never achieved', async () => {
    const { event } = await createCapexEvent({ dueDate: PAST_DATE, achievementStatus: 'PLANNED' });

    await openAndReopenAlerts(prisma);

    const alert = await prisma.paymentAlert.findUnique({ where: { sourceEventId: event.id } });
    expect(alert).not.toBeNull();
  });

  it('never opens an alert for a CANCELLED CAPEX event', async () => {
    const { event } = await createCapexEvent({ dueDate: PAST_DATE, achievementStatus: 'CANCELLED' });

    await openAndReopenAlerts(prisma);

    const alert = await prisma.paymentAlert.findUnique({ where: { sourceEventId: event.id } });
    expect(alert).toBeNull();
  });

  it('never opens an alert for a SKIPPED OPEX installment', async () => {
    const { installment } = await createOpexInstallment({ plannedInvoiceDate: PAST_DATE, status: 'SKIPPED' });

    await openAndReopenAlerts(prisma);

    const alert = await prisma.paymentAlert.findUnique({ where: { sourceInstallmentId: installment.id } });
    expect(alert).toBeNull();
  });

  it('is idempotent — running twice never double-opens or double-notifies the same source', async () => {
    const { installment } = await createOpexInstallment({ plannedInvoiceDate: PAST_DATE });

    await openAndReopenAlerts(prisma);
    const firstAlert = await prisma.paymentAlert.findUniqueOrThrow({ where: { sourceInstallmentId: installment.id } });

    await openAndReopenAlerts(prisma);
    const secondAlert = await prisma.paymentAlert.findUniqueOrThrow({ where: { sourceInstallmentId: installment.id } });
    expect(secondAlert.id).toBe(firstAlert.id);
    expect(secondAlert.version).toBe(firstAlert.version);

    const outboxEvents = await prisma.outboxEvent.findMany({ where: { aggregateId: firstAlert.id, eventType: 'PAYMENT_ALERT_OPENED' } });
    expect(outboxEvents).toHaveLength(1);
  });

  it('reopens a SNOOZED alert once its snooze window has passed and sends exactly one fresh notification', async () => {
    const { installment } = await createOpexInstallment({ plannedInvoiceDate: PAST_DATE });

    await openAndReopenAlerts(prisma);
    const alert = await prisma.paymentAlert.findUniqueOrThrow({ where: { sourceInstallmentId: installment.id } });
    const firstBatchCount = (await prisma.outboxEvent.findMany({ where: { aggregateId: alert.id } })).length;

    await prisma.paymentAlert.update({
      where: { id: alert.id },
      data: { status: 'SNOOZED', snoozedUntil: PAST_DATE, snoozedAt: new Date(), snoozedBy: accountTeamUserId },
    });

    await openAndReopenAlerts(prisma);

    const reopened = await prisma.paymentAlert.findUniqueOrThrow({ where: { id: alert.id } });
    expect(reopened.status).toBe('OPEN');
    expect(reopened.snoozedUntil).toBeNull();

    const secondBatchCount = (await prisma.outboxEvent.findMany({ where: { aggregateId: alert.id } })).length;
    expect(secondBatchCount).toBe(firstBatchCount + 1);
  });

  it('resolves ACCOUNT_TEAM to every user whose role grants payment_alert.snooze', async () => {
    const { event } = await createCapexEvent({ dueDate: PAST_DATE, achievementStatus: 'PLANNED', alertRecipient: 'ACCOUNT_TEAM' });

    await openAndReopenAlerts(prisma);

    const alert = await prisma.paymentAlert.findUniqueOrThrow({ where: { sourceEventId: event.id } });
    const outboxEvents = await prisma.outboxEvent.findMany({ where: { aggregateId: alert.id } });
    const emails = outboxEvents.map((e) => (e.payload as { email: string }).email);
    expect(emails).toContain('account-team@zitaware.test');
    expect(emails).not.toContain('pm@zitaware.test');
  });

  it('resolves PROJECT_MANAGER to the assigned employee\'s linked user email', async () => {
    const { event } = await createCapexEvent({ dueDate: PAST_DATE, achievementStatus: 'PLANNED', alertRecipient: 'PROJECT_MANAGER' });

    await openAndReopenAlerts(prisma);

    const alert = await prisma.paymentAlert.findUniqueOrThrow({ where: { sourceEventId: event.id } });
    const outboxEvents = await prisma.outboxEvent.findMany({ where: { aggregateId: alert.id } });
    const emails = outboxEvents.map((e) => (e.payload as { email: string }).email);
    expect(emails).toEqual(['pm@zitaware.test']);
  });

  it('resolves BOTH to the union of the account team and the project manager', async () => {
    const { event } = await createCapexEvent({ dueDate: PAST_DATE, achievementStatus: 'PLANNED', alertRecipient: 'BOTH' });

    await openAndReopenAlerts(prisma);

    const alert = await prisma.paymentAlert.findUniqueOrThrow({ where: { sourceEventId: event.id } });
    const outboxEvents = await prisma.outboxEvent.findMany({ where: { aggregateId: alert.id } });
    const emails = outboxEvents.map((e) => (e.payload as { email: string }).email).sort();
    expect(emails).toEqual(['account-team@zitaware.test', 'pm@zitaware.test']);
  });

  it('silently skips PROJECT_MANAGER recipient resolution when the project has no assigned manager', async () => {
    const unassignedProject = await prisma.project.create({
      data: {
        id: generateId(),
        organizationId,
        clientId: (await prisma.project.findFirstOrThrow({ where: { id: projectId } })).clientId,
        legalEntityId: (await prisma.project.findFirstOrThrow({ where: { id: projectId } })).legalEntityId,
        name: 'Unassigned PM Project',
        stage: 'WON',
        operationalStatus: 'ACTIVE',
      },
    });
    const code = `CAP-${generateId()}`;
    const milestone = await prisma.projectMilestone.create({
      data: {
        id: generateId(),
        organizationId,
        projectId: unassignedProject.id,
        type: 'CAPEX',
        code,
        name: 'Unassigned PM Pool',
        approvedAmount: '1000000',
        alertRecipient: 'PROJECT_MANAGER',
        reminderOffsetDays: 3,
      },
    });
    const event = await prisma.milestoneEvent.create({
      data: {
        id: generateId(),
        organizationId,
        milestoneId: milestone.id,
        milestoneType: 'CAPEX',
        code: `${code}-E01`,
        name: 'Go Live',
        percentOfPool: '100',
        amount: '1000000',
        dueDate: PAST_DATE,
        achievementStatus: 'PLANNED',
        sequence: 1,
      },
    });

    await openAndReopenAlerts(prisma);

    const alert = await prisma.paymentAlert.findUniqueOrThrow({ where: { sourceEventId: event.id } });
    const outboxEvents = await prisma.outboxEvent.findMany({ where: { aggregateId: alert.id } });
    expect(outboxEvents).toHaveLength(0);
  });
});
