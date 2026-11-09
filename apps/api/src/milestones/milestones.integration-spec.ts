import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ClientsService } from '../clients/clients.service';
import { PaymentAlertsService } from '../payment-alerts/payment-alerts.service';
import { MilestonesService } from './milestones.service';

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
const actorId = generateId();

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Milestones Test Org', code: `MILESTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Milestones Test Other Org', code: `MILESTEST-OTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  const client = await clients.create({
    organizationId,
    name: 'Milestone Client',
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
      legalName: 'Milestone Legal Entity',
      panNumber: 'ABCPM5678P',
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
    name: 'Milestone Test Project',
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
      email: 'milestone-actor@zitaware.test',
      passwordHash: 'test-hash',
      displayName: 'Milestone Actor',
      status: 'ACTIVE',
    },
  });
  userId = user.id;

  const employee = await prisma.client.employee.create({
    data: {
      id: generateId(),
      organizationId,
      userId,
      employeeCode: 'EMP-MILESTONE-1',
      fullName: 'Milestone Actor',
      joiningDate: new Date('2024-01-01'),
    },
  });
  employeeId = employee.id;
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

async function createCapex(overrides: Partial<Parameters<typeof milestones.createCapex>[0]> = {}) {
  return milestones.createCapex({
    organizationId,
    projectId,
    name: 'Implementation Capex',
    approvedAmount: '70000000',
    referenceNumber: undefined,
    approvalDate: undefined,
    description: undefined,
    alertRecipient: undefined,
    reminderOffsetDays: undefined,
    events: [
      { name: 'On Design Sign-off', amount: '14000000', dueDate: '2025-11-30' },
      { name: 'On Development Complete', amount: '21000000', dueDate: '2026-01-31' },
      { name: 'On Go-Live', amount: '35000000', dueDate: '2026-04-30' },
    ],
    idempotencyKey: generateId(),
    actorId,
    canSeeAll: true,
    correlationId: generateId(),
    ...overrides,
  });
}

async function createOpex(overrides: Partial<Parameters<typeof milestones.createOpex>[0]> = {}) {
  return milestones.createOpex({
    organizationId,
    projectId,
    name: 'Manpower & Support',
    approvedAmount: '20000000',
    frequency: 'MONTHLY',
    installmentCount: 36,
    scheduleStartDate: '2026-01-01',
    firstInvoiceDate: '2026-01-01',
    referenceNumber: undefined,
    approvalDate: undefined,
    description: undefined,
    alertRecipient: undefined,
    reminderOffsetDays: undefined,
    idempotencyKey: generateId(),
    actorId,
    canSeeAll: true,
    correlationId: generateId(),
    ...overrides,
  });
}

describe('MilestonesService — CAPEX', () => {
  it('creates a capex pool with events summing exactly to the approved amount', async () => {
    const created = await createCapex();
    expect(created.type).toBe('CAPEX');
    expect(created.code).toMatch(/^CAP-\d{3}$/);
    expect(created.approvedAmount).toBe('70000000.00');
    expect(created.billingStatus).toBe('NOT_INVOICED');

    const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const events = overview.capexEvents.filter((e) => e.milestoneId === created.id);
    expect(events).toHaveLength(3);
    expect(events[0]!.code).toBe(`${created.code}-E01`);
    expect(events[0]!.percentOfPool).toBe('20.00');

    const auditEvents = await prisma.client.auditEvent.findMany({
      where: { organizationId, entityId: created.id, action: 'MILESTONE_CREATED' },
    });
    expect(auditEvents).toHaveLength(1);
  });

  it('rejects event amounts that do not sum exactly to the approved amount', async () => {
    await expect(
      createCapex({
        approvedAmount: '1000',
        events: [
          { name: 'Event A', amount: '400', dueDate: '2026-01-01' },
          { name: 'Event B', amount: '500', dueDate: '2026-02-01' },
        ],
      }),
    ).rejects.toThrow('short by 100.00');

    await expect(
      createCapex({
        approvedAmount: '1000',
        events: [{ name: 'Event A', amount: '1500', dueDate: '2026-01-01' }],
      }),
    ).rejects.toThrow('over by 500.00');
  });

  it('rejects an empty event list and non-positive amounts', async () => {
    await expect(createCapex({ events: [] })).rejects.toThrow('At least one event is required.');
    await expect(createCapex({ approvedAmount: '0', events: [{ name: 'X', amount: '0', dueDate: '2026-01-01' }] })).rejects.toThrow(
      'Approved amount must be positive.',
    );
  });

  it('generates concurrency-safe, unique sequential codes for parallel creates', async () => {
    const results = await Promise.all([createCapex(), createCapex(), createCapex()]);
    const codes = results.map((r) => r.code);
    expect(new Set(codes).size).toBe(3);
  });

  it('walks a full event lifecycle: start -> mark achieved, and separately cancel', async () => {
    const pool = await createCapex();
    const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const event = overview.capexEvents.find((e) => e.milestoneId === pool.id)!;

    await expect(
      milestones.markEventAchieved({ organizationId, id: event.id, achievedOn: '2026-01-01', expectedVersion: event.version, actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('must be started');

    const started = await milestones.startEvent({ organizationId, id: event.id, expectedVersion: event.version, actorId, canSeeAll: true, correlationId: generateId() });
    expect(started.achievementStatus).toBe('IN_PROGRESS');

    await expect(
      milestones.startEvent({ organizationId, id: event.id, expectedVersion: started.version, actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('Only a planned event');

    const achieved = await milestones.markEventAchieved({
      organizationId,
      id: event.id,
      achievedOn: '2026-01-05',
      expectedVersion: started.version,
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    expect(achieved.achievementStatus).toBe('ACHIEVED');
    expect(achieved.achievedOn).toBe('2026-01-05');

    await expect(
      milestones.updateEvent({ organizationId, id: event.id, name: 'New name', amount: undefined, dueDate: undefined, expectedVersion: achieved.version, actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('already been achieved or cancelled');

    // separate event: cancel from PLANNED directly
    const otherEvent = overview.capexEvents.find((e) => e.milestoneId === pool.id && e.id !== event.id)!;
    const cancelled = await milestones.cancelEvent({ organizationId, id: otherEvent.id, reason: 'Scope removed', expectedVersion: otherEvent.version, actorId, canSeeAll: true, correlationId: generateId() });
    expect(cancelled.achievementStatus).toBe('CANCELLED');
    expect(cancelled.cancelReason).toBe('Scope removed');

    await expect(
      milestones.cancelEvent({ organizationId, id: otherEvent.id, reason: 'again', expectedVersion: cancelled.version, actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('already been achieved or cancelled');
  });

  it('updateEvent re-validates the pool-wide exact-sum invariant', async () => {
    const pool = await createCapex({
      approvedAmount: '1000',
      events: [
        { name: 'A', amount: '500', dueDate: '2026-01-01' },
        { name: 'B', amount: '500', dueDate: '2026-01-01' },
      ],
    });
    const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const eventA = overview.capexEvents.find((e) => e.milestoneId === pool.id && e.name === 'A')!;

    await expect(
      milestones.updateEvent({ organizationId, id: eventA.id, name: undefined, amount: '600', dueDate: undefined, expectedVersion: eventA.version, actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('over by 100.00');

    // With a sibling event fixed at 500, the pool's exact-sum invariant means
    // A's amount can only ever validly be 500 — any other value is rejected,
    // whether it overshoots or undershoots the approved total.
    await expect(
      milestones.updateEvent({ organizationId, id: eventA.id, name: undefined, amount: '499', dueDate: undefined, expectedVersion: eventA.version, actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('short by 1.00');

    const updated = await milestones.updateEvent({
      organizationId,
      id: eventA.id,
      name: 'A Renamed',
      amount: undefined,
      dueDate: undefined,
      expectedVersion: eventA.version,
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    expect(updated.name).toBe('A Renamed');
    expect(updated.amount).toBe('500.00');
    expect(updated.percentOfPool).toBe('50.00');
  });

  it('rejects an idempotent duplicate create and returns the original milestone', async () => {
    const key = generateId();
    const first = await createCapex({ idempotencyKey: key, name: 'Idempotent Pool' });
    const second = await createCapex({ idempotencyKey: key, name: 'Should Not Be Created' });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe('Idempotent Pool');

    const count = await prisma.client.projectMilestone.count({ where: { organizationId, name: 'Idempotent Pool' } });
    expect(count).toBe(1);
  });

  it('rejects creation and updates from a different organization or out-of-project-scope actor', async () => {
    await expect(
      milestones.createCapex({
        organizationId: otherOrganizationId,
        projectId,
        name: 'Cross Org',
        approvedAmount: '100',
        referenceNumber: undefined,
        approvalDate: undefined,
        description: undefined,
        alertRecipient: undefined,
        reminderOffsetDays: undefined,
        events: [{ name: 'X', amount: '100', dueDate: '2026-01-01' }],
        idempotencyKey: generateId(),
        actorId,
        canSeeAll: true,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('not found');

    const noEmployeeActorId = generateId();
    await expect(
      milestones.listForProject({ organizationId, projectId, actorId: noEmployeeActorId, canSeeAll: false }),
    ).rejects.toThrow('not found');
  });
});

describe('MilestonesService — OPEX', () => {
  it('creates an opex milestone whose installments sum exactly to the approved amount and match the preview', async () => {
    const previewRows = await milestones.previewOpexSchedule({
      approvedAmount: '20000000',
      frequency: 'MONTHLY',
      installmentCount: 36,
      scheduleStartDate: '2026-01-01',
      firstInvoiceDate: '2026-01-01',
    });

    const created = await createOpex();
    expect(created.type).toBe('OPEX');
    expect(created.code).toMatch(/^OPEX-\d{3}$/);
    expect(created.achievementStatus).toBe('PLANNED');
    expect(created.installments).toHaveLength(36);

    const total = created
      .installments!.reduce((sum, i) => sum + Number(i.scheduledAmount), 0)
      .toFixed(2);
    expect(Number(total)).toBeCloseTo(20000000, 2);

    expect(created.installments!.map((i) => i.scheduledAmount)).toEqual(previewRows.map((r) => r.scheduledAmount));
    expect(created.installments!.map((i) => i.servicePeriodStart)).toEqual(previewRows.map((r) => r.servicePeriodStart));

    const scheduleGeneratedEvents = await prisma.client.auditEvent.findMany({
      where: { organizationId, entityId: created.id, action: 'MILESTONE_SCHEDULE_GENERATED' },
    });
    expect(scheduleGeneratedEvents).toHaveLength(1);
  });

  it('walks the milestone lifecycle: start -> achieve, and rejects skipping ahead', async () => {
    const created = await createOpex({ name: 'Lifecycle Opex' });
    await expect(
      milestones.markMilestoneAchieved({ organizationId, id: created.id, achievedOn: '2026-01-01', expectedVersion: created.version, actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('must be started');

    const started = await milestones.startMilestone({ organizationId, id: created.id, expectedVersion: created.version, actorId, canSeeAll: true, correlationId: generateId() });
    expect(started.achievementStatus).toBe('IN_PROGRESS');

    const achieved = await milestones.markMilestoneAchieved({ organizationId, id: created.id, achievedOn: '2026-02-01', expectedVersion: started.version, actorId, canSeeAll: true, correlationId: generateId() });
    expect(achieved.achievementStatus).toBe('ACHIEVED');
  });

  it('rejects editing the schedule-defining fields via updateMilestone (they are not accepted at all) but allows name/details edits', async () => {
    const created = await createOpex({ name: 'Editable Opex' });
    const updated = await milestones.updateMilestone({
      organizationId,
      id: created.id,
      name: 'Renamed Opex',
      referenceNumber: 'REF-001',
      approvalDate: '2026-01-01',
      description: 'Updated description',
      alertRecipient: 'BOTH',
      reminderOffsetDays: 7,
      expectedVersion: created.version,
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    expect(updated.name).toBe('Renamed Opex');
    expect(updated.referenceNumber).toBe('REF-001');
    expect(updated.alertRecipient).toBe('BOTH');
    // approvedAmount/frequency/installmentCount/dates are simply not part of
    // the updateMilestone input type at all — structurally immutable.
    expect(updated.installmentCount).toBe(36);
  });

  it('cancelling an opex milestone transactionally cancels every remaining planned installment', async () => {
    const created = await createOpex({ name: 'Cancel Cascade Opex', installmentCount: 4 });
    // skip one installment first, to confirm it is left SKIPPED (not re-cancelled) by the cascade
    const firstInstallment = created.installments![0]!;
    await milestones.skipInstallment({ organizationId, id: firstInstallment.id, reason: 'Client requested skip', expectedVersion: firstInstallment.version, actorId, canSeeAll: true, correlationId: generateId() });

    const cancelled = await milestones.cancelMilestone({ organizationId, id: created.id, reason: 'Contract terminated', expectedVersion: created.version, actorId, canSeeAll: true, correlationId: generateId() });
    expect(cancelled.achievementStatus).toBe('CANCELLED');

    const rows = await prisma.client.milestoneInstallment.findMany({ where: { milestoneId: created.id }, orderBy: { sequenceNumber: 'asc' } });
    expect(rows[0]!.status).toBe('SKIPPED');
    expect(rows.slice(1).every((r) => r.status === 'CANCELLED')).toBe(true);
    expect(rows.slice(1).every((r) => r.cancelReason === 'Contract terminated')).toBe(true);

    const cancelEvents = await prisma.client.auditEvent.findMany({ where: { organizationId, entityId: created.id, action: 'MILESTONE_CANCELLED' } });
    expect(cancelEvents).toHaveLength(1);
    expect(cancelEvents[0]?.newValues).toMatchObject({ achievementStatus: 'CANCELLED' });
  });

  it('rejects skipping an installment that is not planned, and requires a reason', async () => {
    const created = await createOpex({ name: 'Skip Guard Opex', installmentCount: 2 });
    const installment = created.installments![0]!;
    await expect(
      milestones.skipInstallment({ organizationId, id: installment.id, reason: '', expectedVersion: installment.version, actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('A reason is required');

    const skipped = await milestones.skipInstallment({ organizationId, id: installment.id, reason: 'Not needed', expectedVersion: installment.version, actorId, canSeeAll: true, correlationId: generateId() });
    expect(skipped.status).toBe('SKIPPED');

    await expect(
      milestones.skipInstallment({ organizationId, id: installment.id, reason: 'again', expectedVersion: skipped.version, actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('Only a planned installment');
  });

  it('rejects a stale expectedVersion on every mutating path', async () => {
    const created = await createOpex({ name: 'Version Guard Opex' });
    await expect(
      milestones.updateMilestone({ organizationId, id: created.id, name: 'X', referenceNumber: undefined, approvalDate: undefined, description: undefined, alertRecipient: undefined, reminderOffsetDays: undefined, expectedVersion: created.version + 1, actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('changed by someone else');
    await expect(
      milestones.startMilestone({ organizationId, id: created.id, expectedVersion: created.version + 1, actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('changed by someone else');
  });
});

describe('MilestonesService — Project Manager scoping', () => {
  it('a scoped actor sees and can act on assigned-project milestones but not out-of-scope ones', async () => {
    await projects.addTeamMember({ organizationId, projectId, employeeId, role: 'Site Engineer', actorId, correlationId: generateId() });

    const otherProject = await projects.create({
      organizationId,
      clientId,
      legalEntityId,
      leadId: undefined,
      tenderId: undefined,
      projectManagerId: undefined,
      introducerId: undefined,
      projectTypeId: undefined,
      name: 'Unassigned Project For Milestone Scoping',
      description: undefined,
      value: undefined,
      budget: undefined,
      gstApplicable: undefined,
      workOrderNumber: undefined,
      workOrderDate: undefined,
      actorId,
      correlationId: generateId(),
    });

    const scopedList = await milestones.listForProject({ organizationId, projectId, actorId: userId, canSeeAll: false });
    expect(scopedList).toBeDefined();

    await expect(
      milestones.listForProject({ organizationId, projectId: otherProject.id, actorId: userId, canSeeAll: false }),
    ).rejects.toThrow('not found');

    const created = await createCapex({ name: 'PM Scoped Pool', actorId: userId, canSeeAll: false });
    expect(created.name).toBe('PM Scoped Pool');
  });

  it('never returns a milestone from a different organization', async () => {
    const otherClient = await clients.create({
      organizationId: otherOrganizationId,
      name: 'Other Org Client',
      shortCode: undefined,
      clientTypeId: undefined,
      department: 'Other',
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
    const otherLegalEntity = await prisma.client.legalEntity.create({
      data: { id: generateId(), organizationId: otherOrganizationId, legalName: 'Other Legal Entity', panNumber: 'ZZZPM1234P', registeredAddress: 'Other' },
    });
    const otherProject = await projects.create({
      organizationId: otherOrganizationId,
      clientId: otherClient.id,
      legalEntityId: otherLegalEntity.id,
      leadId: undefined,
      tenderId: undefined,
      projectManagerId: undefined,
      introducerId: undefined,
      projectTypeId: undefined,
      name: 'Other Org Project',
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
      milestones.listForProject({ organizationId, projectId: otherProject.id, actorId, canSeeAll: true }),
    ).rejects.toThrow('not found');
  });
});

describe('MilestonesService — database CHECK constraints', () => {
  it('rejects a negative approved amount at the database level', async () => {
    await expect(
      prisma.client.$executeRawUnsafe(
        `INSERT INTO project_milestones (id, organization_id, project_id, type, code, name, approved_amount) VALUES (gen_random_uuid(), '${organizationId}', '${projectId}', 'CAPEX', 'CHK-NEG', 'Check', -1)`,
      ),
    ).rejects.toThrow();
  });

  it('rejects a CAPEX milestone with OPEX-only fields populated', async () => {
    await expect(
      prisma.client.$executeRawUnsafe(
        `INSERT INTO project_milestones (id, organization_id, project_id, type, code, name, approved_amount, achievement_status) VALUES (gen_random_uuid(), '${organizationId}', '${projectId}', 'CAPEX', 'CHK-TYPE', 'Check', 100, 'PLANNED')`,
      ),
    ).rejects.toThrow();
  });

  it('rejects an installment count below 1', async () => {
    await expect(
      prisma.client.$executeRawUnsafe(
        `INSERT INTO project_milestones (id, organization_id, project_id, type, code, name, approved_amount, achievement_status, frequency, installment_count, schedule_start_date, first_invoice_date) VALUES (gen_random_uuid(), '${organizationId}', '${projectId}', 'OPEX', 'CHK-COUNT', 'Check', 100, 'PLANNED', 'MONTHLY', 0, '2026-01-01', '2026-01-01')`,
      ),
    ).rejects.toThrow();
  });
});

describe('MilestonesService — payment alert opens with the milestone', () => {
  it('opens a payment alert for a capex event that is already due, and leaves a future event alone', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const dueNow = await createCapex({
      name: 'Due now capex',
      approvedAmount: '100',
      events: [{ name: 'Now', amount: '100', dueDate: today }],
    });
    const later = await createCapex({
      name: 'Due later capex',
      approvedAmount: '100',
      events: [{ name: 'Later', amount: '100', dueDate: '2028-06-01' }],
    });
    const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const dueEvent = overview.capexEvents.find((event) => event.milestoneId === dueNow.id)!;
    const laterEvent = overview.capexEvents.find((event) => event.milestoneId === later.id)!;

    expect(await prisma.client.paymentAlert.findFirst({ where: { sourceEventId: dueEvent.id, status: 'OPEN' } })).not.toBeNull();
    expect(await prisma.client.paymentAlert.findFirst({ where: { sourceEventId: laterEvent.id } })).toBeNull();
  });

  it('opens a payment alert only for the opex installment that is already due', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const opex = await createOpex({
      name: 'Due now opex',
      approvedAmount: '1200',
      installmentCount: 2,
      scheduleStartDate: today,
      firstInvoiceDate: today,
    });
    const [first, second] = opex.installments!;

    expect(await prisma.client.paymentAlert.findFirst({ where: { sourceInstallmentId: first!.id, status: 'OPEN' } })).not.toBeNull();
    expect(await prisma.client.paymentAlert.findFirst({ where: { sourceInstallmentId: second!.id } })).toBeNull();
  });
});

describe('MilestonesService — PaymentAlert cross-cutting (ADR-064 decision 14)', () => {
  it('cancelling a CAPEX event deletes its live payment alert', async () => {
    const pool = await createCapex({ name: 'Alert Cleanup Pool A', events: [{ name: 'Only Event', amount: '70000000', dueDate: '2026-03-01' }] });
    const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const event = overview.capexEvents.find((e) => e.milestoneId === pool.id)!;

    const alert =
      (await prisma.client.paymentAlert.findFirst({ where: { sourceEventId: event.id } })) ??
      (await prisma.client.paymentAlert.create({
        data: { id: generateId(), organizationId, projectId, sourceType: 'CAPEX_EVENT', sourceEventId: event.id, status: 'OPEN' },
      }));

    await milestones.cancelEvent({ organizationId, id: event.id, reason: 'Scope removed', expectedVersion: event.version, actorId, canSeeAll: true, correlationId: generateId() });

    expect(await prisma.client.paymentAlert.findUnique({ where: { id: alert.id } })).toBeNull();
  });

  it('cancelling an event with no live alert is a no-op, not an error', async () => {
    const pool = await createCapex({ name: 'Alert Cleanup Pool B', events: [{ name: 'Only Event', amount: '70000000', dueDate: '2026-03-01' }] });
    const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const event = overview.capexEvents.find((e) => e.milestoneId === pool.id)!;

    await expect(
      milestones.cancelEvent({ organizationId, id: event.id, reason: 'Scope removed', expectedVersion: event.version, actorId, canSeeAll: true, correlationId: generateId() }),
    ).resolves.toBeDefined();
  });

  it('cancelling an OPEX milestone deletes live alerts for every cascaded installment', async () => {
    const opex = await createOpex({ name: 'Alert Cleanup OPEX', approvedAmount: '1200000', installmentCount: 12 });
    const withInstallments = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const milestone = withInstallments.opexMilestones.find((m) => m.id === opex.id)!;
    const installments = milestone.installments!;

    const alertOne =
      (await prisma.client.paymentAlert.findFirst({ where: { sourceInstallmentId: installments[0]!.id } })) ??
      (await prisma.client.paymentAlert.create({
        data: { id: generateId(), organizationId, projectId, sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: installments[0]!.id, status: 'OPEN' },
      }));
    const alertTwo =
      (await prisma.client.paymentAlert.findFirst({ where: { sourceInstallmentId: installments[1]!.id } })) ??
      (await prisma.client.paymentAlert.create({
        data: { id: generateId(), organizationId, projectId, sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: installments[1]!.id, status: 'OPEN' },
      }));

    await milestones.cancelMilestone({ organizationId, id: opex.id, reason: 'Contract terminated', expectedVersion: milestone.version, actorId, canSeeAll: true, correlationId: generateId() });

    expect(await prisma.client.paymentAlert.findUnique({ where: { id: alertOne.id } })).toBeNull();
    expect(await prisma.client.paymentAlert.findUnique({ where: { id: alertTwo.id } })).toBeNull();
  });

  it('skipping an installment deletes its live payment alert', async () => {
    const opex = await createOpex({ name: 'Alert Cleanup Skip OPEX', approvedAmount: '1200000', installmentCount: 12 });
    const withInstallments = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const milestone = withInstallments.opexMilestones.find((m) => m.id === opex.id)!;
    const installment = milestone.installments![0]!;

    const alert =
      (await prisma.client.paymentAlert.findFirst({ where: { sourceInstallmentId: installment.id } })) ??
      (await prisma.client.paymentAlert.create({
        data: { id: generateId(), organizationId, projectId, sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: installment.id, status: 'OPEN' },
      }));

    await milestones.skipInstallment({ organizationId, id: installment.id, reason: 'Client delayed onboarding', expectedVersion: installment.version, actorId, canSeeAll: true, correlationId: generateId() });

    expect(await prisma.client.paymentAlert.findUnique({ where: { id: alert.id } })).toBeNull();
  });
});
