import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsService } from './leads.service';
import { ClientsService } from '../clients/clients.service';
import { IntroducersService } from '../introducers/introducers.service';

const prisma = new PrismaService();
const leads = new LeadsService(prisma);
const clients = new ClientsService(prisma);
const introducers = new IntroducersService(prisma);

let organizationId: string;
let otherOrganizationId: string;
let clientId: string;
let leadTypeId: string;
let leadSourceId: string;
let introducerId: string;
let employeeId: string;
let userId: string;
const actorId = generateId();

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Leads Test Org', code: `LEADTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Leads Test Other Org', code: `LEADTEST-OTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  const client = await clients.create({
    organizationId,
    name: 'GSDMA',
    shortCode: undefined,
    clientTypeId: undefined,
    department: 'Revenue Department',
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

  const leadType = await prisma.client.leadType.create({
    data: { id: generateId(), organizationId, code: 'government_tender', name: 'Government Tender' },
  });
  leadTypeId = leadType.id;

  const leadSource = await prisma.client.leadSource.create({
    data: { id: generateId(), organizationId, code: 'referral', name: 'Referral' },
  });
  leadSourceId = leadSource.id;

  const introducer = await introducers.create({
    organizationId,
    name: 'Rajesh Patel',
    phone: undefined,
    actorId,
    correlationId: generateId(),
  });
  introducerId = introducer.id;

  const user = await prisma.client.user.create({
    data: {
      id: generateId(),
      organizationId,
      email: 'lead-actor@zitaware.test',
      passwordHash: 'test-hash',
      displayName: 'Lead Actor',
      status: 'ACTIVE',
    },
  });
  userId = user.id;

  const employee = await prisma.client.employee.create({
    data: {
      id: generateId(),
      organizationId,
      userId,
      employeeCode: 'EMP-LEAD-1',
      fullName: 'Lead Actor',
      joiningDate: new Date('2024-01-01'),
    },
  });
  employeeId = employee.id;
});

afterAll(async () => {
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.leadUpdate.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.lead.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.employee.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.user.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.introducer.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.contact.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.clientProfile.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.party.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.leadType.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.leadSource.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.$disconnect();
});

describe('LeadsService', () => {
  it('creates a lead, defaulting assignedToEmployeeId from the actor’s linked employee', async () => {
    const created = await leads.create({
      organizationId,
      clientId,
      leadTypeId,
      leadSourceId,
      introducerId,
      title: 'SEOC Platform — Phase 3 AMC',
      description: 'Annual maintenance contract plus three new modules.',
      stage: undefined,
      estimatedValue: '18000000.00',
      leadDate: '2025-09-12',
      expectedCloseDate: '2025-12-31',
      expectedTenderDate: undefined,
      tenderNumber: 'GIL/2026/1',
      tenderDate: '2026-01-15',
      submissionDeadline: '2026-02-01',
      reminderOffset: 'THREE_DAYS',
      internalNote: undefined,
      actorId: userId,
      correlationId: generateId(),
    });

    expect(created.title).toBe('SEOC Platform — Phase 3 AMC');
    expect(created.stage).toBe('PROPOSAL_SENT');
    expect(created.clientName).toBe('GSDMA');
    expect(created.leadTypeName).toBe('Government Tender');
    expect(created.introducerName).toBe('Rajesh Patel');
    expect(created.assignedToEmployeeId).toBe(employeeId);
    expect(created.assignedToEmployeeName).toBe('Lead Actor');
    expect(created.tenderNumber).toBe('GIL/2026/1');
    expect(created.tenderDate).toBe('2026-01-15');
    expect(created.submissionDeadline).toBe('2026-02-01');

    const listed = await leads.list({ organizationId });
    expect(listed.some((row) => row.id === created.id)).toBe(true);
  });

  it('leaves assignedToEmployeeId null when the actor has no linked employee', async () => {
    const created = await leads.create({
      organizationId,
      clientId,
      leadTypeId,
      leadSourceId,
      introducerId: undefined,
      title: 'Unlinked Actor Lead',
      description: undefined,
      stage: undefined,
      estimatedValue: undefined,
      leadDate: '2025-09-12',
      expectedCloseDate: undefined,
      expectedTenderDate: undefined,
      tenderNumber: undefined,
      tenderDate: undefined,
      submissionDeadline: undefined,
      reminderOffset: undefined,
      internalNote: undefined,
      actorId, // not linked to any Employee
      correlationId: generateId(),
    });
    expect(created.assignedToEmployeeId).toBeNull();
  });

  it('rejects a client that does not resolve to a real client (no clientProfile)', async () => {
    const bareParty = await prisma.client.party.create({
      data: { id: generateId(), organizationId, name: 'Bare Party, No Client Profile' },
    });

    await expect(
      leads.create({
        organizationId,
        clientId: bareParty.id,
        leadTypeId,
        leadSourceId,
        introducerId: undefined,
        title: 'Invalid Client Lead',
        description: undefined,
        stage: undefined,
        estimatedValue: undefined,
        leadDate: '2025-09-12',
        expectedCloseDate: undefined,
        expectedTenderDate: undefined,
        tenderNumber: undefined,
        tenderDate: undefined,
        submissionDeadline: undefined,
        reminderOffset: undefined,
        internalNote: undefined,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('client does not exist');
  });

  it('rejects an invalid stage value', async () => {
    await expect(
      leads.create({
        organizationId,
        clientId,
        leadTypeId,
        leadSourceId,
        introducerId: undefined,
        title: 'Bad Stage Lead',
        description: undefined,
        stage: 'NOT_A_REAL_STAGE',
        estimatedValue: undefined,
        leadDate: '2025-09-12',
        expectedCloseDate: undefined,
        expectedTenderDate: undefined,
        tenderNumber: undefined,
        tenderDate: undefined,
        submissionDeadline: undefined,
        reminderOffset: undefined,
        internalNote: undefined,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('Invalid stage');
  });

  it('updates a lead, diffing the audit event, and rejects a stale-version update', async () => {
    const created = await leads.create({
      organizationId,
      clientId,
      leadTypeId,
      leadSourceId,
      introducerId: undefined,
      title: 'Land Records GIS Integration',
      description: undefined,
      stage: undefined,
      estimatedValue: undefined,
      leadDate: '2025-09-12',
      expectedCloseDate: undefined,
      expectedTenderDate: undefined,
      tenderNumber: undefined,
      tenderDate: undefined,
      submissionDeadline: undefined,
      reminderOffset: undefined,
      internalNote: undefined,
      actorId,
      correlationId: generateId(),
    });

    const updated = await leads.update({
      organizationId,
      id: created.id,
      leadTypeId: undefined,
      leadSourceId: undefined,
      introducerId: undefined,
      assignedToEmployeeId: employeeId,
      title: undefined,
      description: undefined,
      stage: 'PRESENTATION_DONE',
      estimatedValue: undefined,
      leadDate: undefined,
      expectedCloseDate: undefined,
      expectedTenderDate: undefined,
      tenderNumber: undefined,
      tenderDate: undefined,
      submissionDeadline: undefined,
      reminderOffset: undefined,
      internalNote: undefined,
      expectedVersion: created.version,
      actorId,
      correlationId: generateId(),
    });
    expect(updated.stage).toBe('PRESENTATION_DONE');
    expect(updated.assignedToEmployeeId).toBe(employeeId);

    const events = await prisma.client.auditEvent.findMany({
      where: { organizationId, entityId: created.id, action: 'LEAD_UPDATED' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.oldValues).toMatchObject({ stage: 'PROPOSAL_SENT' });
    expect(events[0]?.newValues).toMatchObject({ stage: 'PRESENTATION_DONE' });

    await expect(
      leads.update({
        organizationId,
        id: created.id,
        leadTypeId: undefined,
        leadSourceId: undefined,
        introducerId: undefined,
        assignedToEmployeeId: undefined,
        title: 'New Title',
        description: undefined,
        stage: undefined,
        estimatedValue: undefined,
        leadDate: undefined,
        expectedCloseDate: undefined,
        expectedTenderDate: undefined,
        tenderNumber: undefined,
        tenderDate: undefined,
        submissionDeadline: undefined,
        reminderOffset: undefined,
        internalNote: undefined,
        expectedVersion: created.version, // stale — already incremented above
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('changed by someone else');
  });

  it('adds Lead updates and lists them newest first', async () => {
    const created = await leads.create({
      organizationId,
      clientId,
      leadTypeId,
      leadSourceId,
      introducerId: undefined,
      title: '108 EMRI Dashboard Revamp',
      description: undefined,
      stage: undefined,
      estimatedValue: undefined,
      leadDate: '2025-09-12',
      expectedCloseDate: undefined,
      expectedTenderDate: undefined,
      tenderNumber: undefined,
      tenderDate: undefined,
      submissionDeadline: undefined,
      reminderOffset: undefined,
      internalNote: undefined,
      actorId: userId,
      correlationId: generateId(),
    });

    const first = await leads.createUpdate({
      organizationId,
      leadId: created.id,
      title: 'Requirement gathering call',
      note: 'Understood AMC expectations.',
      actorId: userId,
      correlationId: generateId(),
    });
    expect(first.createdByEmail).toBe('lead-actor@zitaware.test');

    const second = await leads.createUpdate({
      organizationId,
      leadId: created.id,
      title: 'Proposal submitted',
      note: 'Submitted to Joint Secretary.',
      actorId: userId,
      correlationId: generateId(),
    });

    const listed = await leads.listUpdates({ organizationId, leadId: created.id });
    expect(listed.map((u) => u.id)).toEqual([second.id, first.id]);
  });

  it('never returns a lead from a different organization', async () => {
    const otherClient = await clients.create({
      organizationId: otherOrganizationId,
      name: 'Other Org Client',
      shortCode: undefined,
      clientTypeId: undefined,
      department: 'Other Department',
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
    const otherLeadType = await prisma.client.leadType.create({
      data: { id: generateId(), organizationId: otherOrganizationId, code: 'government_tender', name: 'Government Tender' },
    });
    const otherLeadSource = await prisma.client.leadSource.create({
      data: { id: generateId(), organizationId: otherOrganizationId, code: 'referral', name: 'Referral' },
    });

    const otherLead = await leads.create({
      organizationId: otherOrganizationId,
      clientId: otherClient.id,
      leadTypeId: otherLeadType.id,
      leadSourceId: otherLeadSource.id,
      introducerId: undefined,
      title: 'Other Org Lead',
      description: undefined,
      stage: undefined,
      estimatedValue: undefined,
      leadDate: '2025-09-12',
      expectedCloseDate: undefined,
      expectedTenderDate: undefined,
      tenderNumber: undefined,
      tenderDate: undefined,
      submissionDeadline: undefined,
      reminderOffset: undefined,
      internalNote: undefined,
      actorId,
      correlationId: generateId(),
    });

    const listedInOrg = await leads.list({ organizationId });
    expect(listedInOrg.some((row) => row.id === otherLead.id)).toBe(false);
    await expect(leads.getDetail({ organizationId, id: otherLead.id })).rejects.toThrow();
  });
});
