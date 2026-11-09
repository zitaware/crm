import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ClientsService } from '../clients/clients.service';
import { MilestonesService } from '../milestones/milestones.service';
import { PaymentAlertsService } from './payment-alerts.service';

const prisma = new PrismaService();
const projects = new ProjectsService(prisma);
const clients = new ClientsService(prisma);
const paymentAlerts = new PaymentAlertsService(prisma, projects);
const milestones = new MilestonesService(prisma, projects, paymentAlerts);

let organizationId: string;
let otherOrganizationId: string;
let clientId: string;
let legalEntityId: string;
let projectId: string;
let userId: string;
let employeeId: string;
let capexEventId: string;
let opexInstallmentId: string;
const actorId = generateId();

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Payment Alerts Test Org', code: `PAYALERTTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Payment Alerts Test Other Org', code: `PAYALERTTEST-OTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  const client = await clients.create({
    organizationId,
    name: 'Payment Alert Client',
    shortCode: undefined,
    clientTypeId: undefined,
    department: 'IT Department',
    stateId: undefined,
    districtId: undefined,
    cityId: undefined,
    pinCode: undefined,
    officeAddress: undefined,
    gstin: undefined,
    internalNote: undefined,
    contacts: [],
    actorId,
    correlationId: generateId(),
  });
  clientId = client.id;

  const legalEntity = await prisma.client.legalEntity.create({
    data: {
      id: generateId(),
      organizationId,
      legalName: 'Payment Alert Legal Entity',
      panNumber: 'ABCPA5678P',
      registeredAddress: 'Ahmedabad, Gujarat',
    },
  });
  legalEntityId = legalEntity.id;

  const project = await projects.create({
    organizationId,
    clientId,
    legalEntityId,
    leadId: undefined,
    tenderId: undefined,
    projectManagerId: undefined,
    introducerId: undefined,
    projectTypeId: undefined,
    name: 'Payment Alert Test Project',
    description: undefined,
    value: undefined,
    budget: undefined,
    gstApplicable: undefined,
    workOrderNumber: undefined,
    workOrderDate: undefined,
    actorId,
    correlationId: generateId(),
  });
  projectId = project.id;

  const user = await prisma.client.user.create({
    data: {
      id: generateId(),
      organizationId,
      email: 'payment-alert-actor@zitaware.test',
      passwordHash: 'test-hash',
      displayName: 'Payment Alert Actor',
      status: 'ACTIVE',
    },
  });
  userId = user.id;

  const employee = await prisma.client.employee.create({
    data: {
      id: generateId(),
      organizationId,
      userId,
      employeeCode: 'EMP-PAYALERT-1',
      fullName: 'Payment Alert Actor',
      joiningDate: new Date('2024-01-01'),
    },
  });
  employeeId = employee.id;

  const capex = await milestones.createCapex({
    organizationId,
    projectId,
    name: 'Implementation Capex',
    approvedAmount: '10000000',
    referenceNumber: undefined,
    approvalDate: undefined,
    description: undefined,
    alertRecipient: undefined,
    reminderOffsetDays: undefined,
    events: [{ name: 'On Go-Live', amount: '10000000', dueDate: '2027-04-30' }],
    idempotencyKey: generateId(),
    actorId,
    canSeeAll: true,
    correlationId: generateId(),
  });
  const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
  capexEventId = overview.capexEvents.find((e) => e.milestoneId === capex.id)!.id;

  const opex = await milestones.createOpex({
    organizationId,
    projectId,
    name: 'AMC Services',
    approvedAmount: '3600000',
    frequency: 'MONTHLY',
    installmentCount: 12,
    scheduleStartDate: '2027-01-01',
    firstInvoiceDate: '2027-01-01',
    referenceNumber: undefined,
    approvalDate: undefined,
    description: undefined,
    alertRecipient: undefined,
    reminderOffsetDays: undefined,
    idempotencyKey: generateId(),
    actorId,
    canSeeAll: true,
    correlationId: generateId(),
  });
  opexInstallmentId = opex.installments![0]!.id;
});

afterAll(async () => {
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.paymentAlert.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.milestoneCreationRequest.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.milestoneInstallment.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.milestoneEvent.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.projectMilestone.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.projectTeamMember.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.project.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.employee.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.user.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.contact.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.clientProfile.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.party.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.legalEntity.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.$disconnect();
});

describe('PaymentAlertsService', () => {
  it('lists open alerts with derived fields and server-computed totals', async () => {
    const capexAlert = await prisma.client.paymentAlert.create({
      data: { id: generateId(), organizationId, projectId, sourceType: 'CAPEX_EVENT', sourceEventId: capexEventId, status: 'OPEN' },
    });
    const opexAlert = await prisma.client.paymentAlert.create({
      data: { id: generateId(), organizationId, projectId, sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: opexInstallmentId, status: 'OPEN' },
    });

    const overview = await paymentAlerts.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    expect(overview.openAlerts).toHaveLength(2);
    expect(overview.snoozedAlerts).toHaveLength(0);
    expect(overview.pendingAmount).toBe('10300000.00');

    const capexSummary = overview.openAlerts.find((a) => a.id === capexAlert.id)!;
    expect(capexSummary.sourceType).toBe('CAPEX_EVENT');
    expect(capexSummary.amount).toBe('10000000.00');
    expect(capexSummary.dueDate).toBe('2027-04-30');
    expect(capexSummary.derivedLabel === 'OVERDUE' || capexSummary.derivedLabel === 'DUE').toBe(true);

    const opexSummary = overview.openAlerts.find((a) => a.id === opexAlert.id)!;
    expect(opexSummary.sourceType).toBe('OPEX_INSTALLMENT');
    expect(opexSummary.title).toContain('Installment 1 of 12');
  });

  it('rejects snoozing to a past or today date', async () => {
    const alert = await paymentAlerts.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const target = alert.openAlerts[0]!;
    const today = new Date().toISOString().slice(0, 10);

    await expect(
      paymentAlerts.snooze({ organizationId, id: target.id, snoozedUntil: today, note: undefined, expectedVersion: target.version, actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('must be in the future');
  });

  it('snoozes an alert to a future date and records a full audit event', async () => {
    const before = await paymentAlerts.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const target = before.openAlerts[0]!;

    const snoozed = await paymentAlerts.snooze({
      organizationId,
      id: target.id,
      snoozedUntil: '2027-01-01',
      note: 'Client requested a short delay',
      expectedVersion: target.version,
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    expect(snoozed.status).toBe('SNOOZED');
    expect(snoozed.snoozedUntil).toBe('2027-01-01');
    expect(snoozed.derivedLabel).toBe('SNOOZED');

    const after = await paymentAlerts.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    expect(after.openAlerts.find((a) => a.id === target.id)).toBeUndefined();
    expect(after.snoozedAlerts.find((a) => a.id === target.id)).toBeDefined();

    const audit = await prisma.client.auditEvent.findFirst({
      where: { entityType: 'PAYMENT_ALERT', entityId: target.id, action: 'PAYMENT_ALERT_SNOOZED' },
    });
    expect(audit?.reason).toBe('Client requested a short delay');
    expect((audit?.newValues as { snoozedUntil: string }).snoozedUntil).toBe('2027-01-01');
  });

  it('rejects a stale expectedVersion with VERSION_CONFLICT', async () => {
    const overview = await paymentAlerts.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const target = overview.openAlerts[0] ?? overview.snoozedAlerts[0]!;

    await expect(
      paymentAlerts.snooze({ organizationId, id: target.id, snoozedUntil: '2027-06-01', note: undefined, expectedVersion: target.version + 99, actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('changed by someone else');
  });

  it('never returns or acts on an alert from a different organization', async () => {
    const overview = await paymentAlerts.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const target = overview.openAlerts[0] ?? overview.snoozedAlerts[0]!;

    await expect(
      paymentAlerts.snooze({ organizationId: otherOrganizationId, id: target.id, snoozedUntil: '2027-06-01', note: undefined, expectedVersion: target.version, actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('not found');
  });

  describe('getHeaderSummary', () => {
    let headerProjectId: string;
    let headerMilestoneId: string;
    let headerEventIds: string[];
    let headerUserId: string;
    let headerEmployeeId: string;

    beforeAll(async () => {
      const project = await projects.create({
        organizationId,
        clientId,
        legalEntityId,
        leadId: undefined,
        tenderId: undefined,
        projectManagerId: undefined,
        introducerId: undefined,
        projectTypeId: undefined,
        name: 'Header Summary Test Project',
        description: undefined,
        value: undefined,
        budget: undefined,
        gstApplicable: undefined,
        workOrderNumber: undefined,
        workOrderDate: undefined,
        actorId,
        correlationId: generateId(),
      });
      headerProjectId = project.id;

      const events = Array.from({ length: 12 }, (_, i) => ({
        name: `Header Event ${i + 1}`,
        amount: '100000',
        dueDate: `2020-01-${String(i + 1).padStart(2, '0')}`, // all in the past -- deterministically OVERDUE
      }));
      const milestone = await milestones.createCapex({
        organizationId,
        projectId: headerProjectId,
        name: 'Header Summary Milestone',
        approvedAmount: '1200000',
        referenceNumber: undefined,
        approvalDate: undefined,
        description: undefined,
        alertRecipient: undefined,
        reminderOffsetDays: undefined,
        events,
        idempotencyKey: generateId(),
        actorId,
        canSeeAll: true,
        correlationId: generateId(),
      });
      headerMilestoneId = milestone.id;

      const overview = await milestones.listForProject({ organizationId, projectId: headerProjectId, actorId, canSeeAll: true });
      headerEventIds = overview.capexEvents.filter((e) => e.milestoneId === headerMilestoneId).map((e) => e.id);

      const user = await prisma.client.user.create({
        data: {
          id: generateId(),
          organizationId,
          email: 'header-summary-actor@zitaware.test',
          passwordHash: 'test-hash',
          displayName: 'Header Summary Actor',
          status: 'ACTIVE',
        },
      });
      headerUserId = user.id;
      const employee = await prisma.client.employee.create({
        data: {
          id: generateId(),
          organizationId,
          userId: headerUserId,
          employeeCode: 'EMP-HEADERSUM-1',
          fullName: 'Header Summary Actor',
          joiningDate: new Date('2024-01-01'),
        },
      });
      headerEmployeeId = employee.id;
    });

    it('excludes SNOOZED alerts, includes projectName, and computes counts correctly', async () => {
      const opened = await prisma.client.paymentAlert.findFirstOrThrow({
        where: { projectId: headerProjectId, sourceEventId: headerEventIds[0]!, status: 'OPEN' },
      });
      await paymentAlerts.snooze({
        organizationId,
        id: opened.id,
        snoozedUntil: '2099-01-01',
        note: undefined,
        expectedVersion: opened.version,
        actorId,
        canSeeAll: true,
        correlationId: generateId(),
      });

      const summary = await paymentAlerts.getHeaderSummary({ organizationId, actorId, canSeeAll: true });
      const headerItems = summary.items.filter((i) => i.projectId === headerProjectId);
      expect(headerItems.some((item) => item.id === opened.id)).toBe(false);
      expect(headerItems[0]!.projectName).toBe('Header Summary Test Project');
      expect(headerItems[0]!.derivedLabel).toBe('OVERDUE');
      expect(summary.overdueCount).toBeGreaterThanOrEqual(11);
    });

    it('sorts items by due date ascending (most overdue first)', async () => {
      const summary = await paymentAlerts.getHeaderSummary({ organizationId, actorId, canSeeAll: true });
      const dueDates = summary.items.map((i) => i.dueDate);
      const sorted = [...dueDates].sort((a, b) => a.localeCompare(b));
      expect(dueDates).toEqual(sorted);
    });

    it('caps items at 10 while overdueCount/dueCount reflect the true total', async () => {
      const summary = await paymentAlerts.getHeaderSummary({ organizationId, actorId, canSeeAll: true });
      expect(summary.items).toHaveLength(10);
      expect(summary.overdueCount).toBeGreaterThanOrEqual(11);
    });

    it('never includes alerts from a different organization', async () => {
      const summary = await paymentAlerts.getHeaderSummary({ organizationId: otherOrganizationId, actorId, canSeeAll: true });
      expect(summary.items.filter((i) => i.projectId === headerProjectId)).toHaveLength(0);
      expect(summary.overdueCount).toBe(0);
      expect(summary.dueCount).toBe(0);
    });

    it('scopes a Project Manager to only their assigned project, and returns empty for an actor with no employee record', async () => {
      await projects.addTeamMember({ organizationId, projectId: headerProjectId, employeeId: headerEmployeeId, role: 'Site Engineer', actorId, correlationId: generateId() });

      const scoped = await paymentAlerts.getHeaderSummary({ organizationId, actorId: headerUserId, canSeeAll: false });
      expect(scoped.items.every((i) => i.projectId === headerProjectId)).toBe(true);
      expect(scoped.items.some((i) => i.projectId === projectId)).toBe(false);

      const unassigned = await paymentAlerts.getHeaderSummary({ organizationId, actorId: generateId(), canSeeAll: false });
      expect(unassigned).toEqual({ overdueCount: 0, dueCount: 0, items: [] });
    });
  });

  it('scopes a Project Manager to only their assigned project', async () => {
    await projects.addTeamMember({ organizationId, projectId, employeeId, role: 'Site Engineer', actorId, correlationId: generateId() });

    const scoped = await paymentAlerts.listForProject({ organizationId, projectId, actorId: userId, canSeeAll: false });
    expect(scoped).toBeDefined();

    const otherProject = await projects.create({
      organizationId,
      clientId,
      legalEntityId,
      leadId: undefined,
      tenderId: undefined,
      projectManagerId: undefined,
      introducerId: undefined,
      projectTypeId: undefined,
      name: 'Unassigned Project For Alert Scoping',
      description: undefined,
      value: undefined,
      budget: undefined,
      gstApplicable: undefined,
      workOrderNumber: undefined,
      workOrderDate: undefined,
      actorId,
      correlationId: generateId(),
    });

    await expect(
      paymentAlerts.listForProject({ organizationId, projectId: otherProject.id, actorId: userId, canSeeAll: false }),
    ).rejects.toThrow('not found');
  });
});
