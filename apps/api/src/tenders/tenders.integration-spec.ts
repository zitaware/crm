import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { TendersService } from './tenders.service';
import { ClientsService } from '../clients/clients.service';
import { LeadsService } from '../leads/leads.service';

const prisma = new PrismaService();
const tenders = new TendersService(prisma);
const clients = new ClientsService(prisma);
const leads = new LeadsService(prisma);

let organizationId: string;
let otherOrganizationId: string;
let clientId: string;
let tenderPortalId: string;
let leadId: string;
let employeeId: string;
let userId: string;
const actorId = generateId();

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Tenders Test Org', code: `TENDERTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Tenders Test Other Org', code: `TENDERTEST-OTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  const client = await clients.create({
    organizationId,
    name: 'District Collectorate',
    shortCode: undefined,
    clientTypeId: undefined,
    department: 'General Administration',
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

  const tenderPortal = await prisma.client.tenderPortal.create({
    data: { id: generateId(), organizationId, code: 'government_e_marketplace', name: 'Government e-Marketplace' },
  });
  tenderPortalId = tenderPortal.id;

  const leadType = await prisma.client.leadType.create({
    data: { id: generateId(), organizationId, code: 'government_tender', name: 'Government Tender' },
  });
  const leadSource = await prisma.client.leadSource.create({
    data: { id: generateId(), organizationId, code: 'referral', name: 'Referral' },
  });
  const lead = await leads.create({
    organizationId,
    clientId,
    leadTypeId: leadType.id,
    leadSourceId: leadSource.id,
    introducerId: undefined,
    title: 'Original Lead For Tender Origin',
    description: undefined,
    stage: undefined,
    estimatedValue: undefined,
    leadDate: '2025-09-01',
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
  leadId = lead.id;

  const user = await prisma.client.user.create({
    data: {
      id: generateId(),
      organizationId,
      email: 'tender-actor@zitaware.test',
      passwordHash: 'test-hash',
      displayName: 'Tender Actor',
      status: 'ACTIVE',
    },
  });
  userId = user.id;

  const employee = await prisma.client.employee.create({
    data: {
      id: generateId(),
      organizationId,
      userId,
      employeeCode: 'EMP-TENDER-1',
      fullName: 'Tender Actor',
      joiningDate: new Date('2024-01-01'),
    },
  });
  employeeId = employee.id;
});

afterAll(async () => {
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.tenderUpdate.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.tender.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.leadUpdate.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.lead.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.employee.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.user.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.contact.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.clientProfile.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.party.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.tenderPortal.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.leadType.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.leadSource.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.$disconnect();
});

describe('TendersService', () => {
  it('creates a tender, defaulting assignedToEmployeeId from the actor’s linked employee', async () => {
    const created = await tenders.create({
      organizationId,
      clientId,
      leadId: undefined,
      tenderPortalId,
      tenderNumber: 'GJ/COLL/2026/0142',
      title: 'Supply of IT Infrastructure',
      description: 'Desktops, servers and networking for the Collectorate.',
      submissionStatus: undefined,
      result: undefined,
      estimatedValue: '18000000.00',
      tenderDate: '2025-09-12',
      submissionDeadline: '2025-10-15',
      submittedDate: undefined,
      resultDate: undefined,
      reminderOffset: 'THREE_DAYS',
      internalNote: undefined,
      actorId: userId,
      correlationId: generateId(),
    });

    expect(created.title).toBe('Supply of IT Infrastructure');
    expect(created.submissionStatus).toBe('IDENTIFIED');
    expect(created.result).toBe('PENDING');
    expect(created.clientName).toBe('District Collectorate');
    expect(created.tenderPortalName).toBe('Government e-Marketplace');
    expect(created.assignedToEmployeeId).toBe(employeeId);
    expect(created.assignedToEmployeeName).toBe('Tender Actor');

    const listed = await tenders.list({ organizationId });
    expect(listed.some((row) => row.id === created.id)).toBe(true);
  });

  it('creates a tender with an optional Lead origin', async () => {
    const created = await tenders.create({
      organizationId,
      clientId,
      leadId,
      tenderPortalId: undefined,
      tenderNumber: 'GJ/COLL/2026/0143',
      title: 'Tender Originating From A Lead',
      description: undefined,
      submissionStatus: undefined,
      result: undefined,
      estimatedValue: undefined,
      tenderDate: '2025-09-12',
      submissionDeadline: undefined,
      submittedDate: undefined,
      resultDate: undefined,
      reminderOffset: undefined,
      internalNote: undefined,
      actorId,
      correlationId: generateId(),
    });
    expect(created.leadId).toBe(leadId);
    expect(created.tenderPortalId).toBeNull();
  });

  it('rejects a client that does not resolve to a real client (no clientProfile)', async () => {
    const bareParty = await prisma.client.party.create({
      data: { id: generateId(), organizationId, name: 'Bare Party, No Client Profile' },
    });

    await expect(
      tenders.create({
        organizationId,
        clientId: bareParty.id,
        leadId: undefined,
        tenderPortalId: undefined,
        tenderNumber: 'GJ/COLL/2026/0144',
        title: 'Invalid Client Tender',
        description: undefined,
        submissionStatus: undefined,
        result: undefined,
        estimatedValue: undefined,
        tenderDate: '2025-09-12',
        submissionDeadline: undefined,
        submittedDate: undefined,
        resultDate: undefined,
        reminderOffset: undefined,
        internalNote: undefined,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('client does not exist');
  });

  it('rejects an invalid submissionStatus value', async () => {
    await expect(
      tenders.create({
        organizationId,
        clientId,
        leadId: undefined,
        tenderPortalId: undefined,
        tenderNumber: 'GJ/COLL/2026/0145',
        title: 'Bad Submission Status Tender',
        description: undefined,
        submissionStatus: 'NOT_A_REAL_STATUS',
        result: undefined,
        estimatedValue: undefined,
        tenderDate: '2025-09-12',
        submissionDeadline: undefined,
        submittedDate: undefined,
        resultDate: undefined,
        reminderOffset: undefined,
        internalNote: undefined,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('Invalid submission status');
  });

  it('rejects an invalid result value', async () => {
    await expect(
      tenders.create({
        organizationId,
        clientId,
        leadId: undefined,
        tenderPortalId: undefined,
        tenderNumber: 'GJ/COLL/2026/0146',
        title: 'Bad Result Tender',
        description: undefined,
        submissionStatus: undefined,
        result: 'NOT_A_REAL_RESULT',
        estimatedValue: undefined,
        tenderDate: '2025-09-12',
        submissionDeadline: undefined,
        submittedDate: undefined,
        resultDate: undefined,
        reminderOffset: undefined,
        internalNote: undefined,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('Invalid result');
  });

  it('updates a tender, diffing the audit event, and rejects a stale-version update', async () => {
    const created = await tenders.create({
      organizationId,
      clientId,
      leadId: undefined,
      tenderPortalId: undefined,
      tenderNumber: 'GJ/COLL/2026/0147',
      title: 'Land Records Digitization Tender',
      description: undefined,
      submissionStatus: undefined,
      result: undefined,
      estimatedValue: undefined,
      tenderDate: '2025-09-12',
      submissionDeadline: undefined,
      submittedDate: undefined,
      resultDate: undefined,
      reminderOffset: undefined,
      internalNote: undefined,
      actorId,
      correlationId: generateId(),
    });

    const updated = await tenders.update({
      organizationId,
      id: created.id,
      leadId: undefined,
      tenderPortalId: undefined,
      assignedToEmployeeId: employeeId,
      tenderNumber: undefined,
      title: undefined,
      description: undefined,
      submissionStatus: 'SUBMITTED',
      result: undefined,
      estimatedValue: undefined,
      tenderDate: undefined,
      submissionDeadline: undefined,
      submittedDate: '2025-10-01',
      resultDate: undefined,
      reminderOffset: undefined,
      internalNote: undefined,
      expectedVersion: created.version,
      actorId,
      correlationId: generateId(),
    });
    expect(updated.submissionStatus).toBe('SUBMITTED');
    expect(updated.assignedToEmployeeId).toBe(employeeId);

    const events = await prisma.client.auditEvent.findMany({
      where: { organizationId, entityId: created.id, action: 'TENDER_UPDATED' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.oldValues).toMatchObject({ submissionStatus: 'IDENTIFIED' });
    expect(events[0]?.newValues).toMatchObject({ submissionStatus: 'SUBMITTED' });

    await expect(
      tenders.update({
        organizationId,
        id: created.id,
        leadId: undefined,
        tenderPortalId: undefined,
        assignedToEmployeeId: undefined,
        tenderNumber: undefined,
        title: 'New Title',
        description: undefined,
        submissionStatus: undefined,
        result: undefined,
        estimatedValue: undefined,
        tenderDate: undefined,
        submissionDeadline: undefined,
        submittedDate: undefined,
        resultDate: undefined,
        reminderOffset: undefined,
        internalNote: undefined,
        expectedVersion: created.version, // stale — already incremented above
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('changed by someone else');
  });

  it('adds Tender updates and lists them newest first', async () => {
    const created = await tenders.create({
      organizationId,
      clientId,
      leadId: undefined,
      tenderPortalId: undefined,
      tenderNumber: 'GJ/COLL/2026/0148',
      title: '108 EMRI Fleet Tender',
      description: undefined,
      submissionStatus: undefined,
      result: undefined,
      estimatedValue: undefined,
      tenderDate: '2025-09-12',
      submissionDeadline: undefined,
      submittedDate: undefined,
      resultDate: undefined,
      reminderOffset: undefined,
      internalNote: undefined,
      actorId: userId,
      correlationId: generateId(),
    });

    const first = await tenders.createUpdate({
      organizationId,
      tenderId: created.id,
      title: 'Pre-bid meeting attended',
      note: 'Clarified eligibility criteria.',
      actorId: userId,
      correlationId: generateId(),
    });
    expect(first.createdByEmail).toBe('tender-actor@zitaware.test');

    const second = await tenders.createUpdate({
      organizationId,
      tenderId: created.id,
      title: 'Bid submitted',
      note: 'Submitted via the portal.',
      actorId: userId,
      correlationId: generateId(),
    });

    const listed = await tenders.listUpdates({ organizationId, tenderId: created.id });
    expect(listed.map((u) => u.id)).toEqual([second.id, first.id]);
  });

  it('never returns a tender from a different organization', async () => {
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

    const otherTender = await tenders.create({
      organizationId: otherOrganizationId,
      clientId: otherClient.id,
      leadId: undefined,
      tenderPortalId: undefined,
      tenderNumber: 'OTHER/2026/0001',
      title: 'Other Org Tender',
      description: undefined,
      submissionStatus: undefined,
      result: undefined,
      estimatedValue: undefined,
      tenderDate: '2025-09-12',
      submissionDeadline: undefined,
      submittedDate: undefined,
      resultDate: undefined,
      reminderOffset: undefined,
      internalNote: undefined,
      actorId,
      correlationId: generateId(),
    });

    const listedInOrg = await tenders.list({ organizationId });
    expect(listedInOrg.some((row) => row.id === otherTender.id)).toBe(false);
    await expect(tenders.getDetail({ organizationId, id: otherTender.id })).rejects.toThrow();
  });
});
