import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { ClientsService } from './clients.service';

const prisma = new PrismaService();
const clients = new ClientsService(prisma);

let organizationId: string;
let otherOrganizationId: string;
let mhStateId: string;
let mhDistrictId: string;
let mhOtherDistrictCityId: string;
let gjStateId: string;
let gjDistrictId: string;
const actorId = generateId();

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Clients Test Org', code: `CLIENTTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Clients Test Other Org', code: `CLIENTTEST-OTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  const mhState = await prisma.client.state.findFirstOrThrow({ where: { code: 'MH' } });
  mhStateId = mhState.id;
  const mhDistrict = await prisma.client.district.findFirstOrThrow({ where: { stateId: mhStateId, name: 'Pune' } });
  mhDistrictId = mhDistrict.id;
  const mhOtherDistrict = await prisma.client.district.findFirstOrThrow({
    where: { stateId: mhStateId, name: { not: 'Pune' }, cities: { some: {} } },
  });
  const mhOtherDistrictCity = await prisma.client.city.findFirstOrThrow({
    where: { districtId: mhOtherDistrict.id },
  });
  mhOtherDistrictCityId = mhOtherDistrictCity.id;

  const gjState = await prisma.client.state.findFirstOrThrow({ where: { code: 'GJ' } });
  gjStateId = gjState.id;
  const gjDistrict = await prisma.client.district.findFirstOrThrow({ where: { stateId: gjStateId } });
  gjDistrictId = gjDistrict.id;
});

afterAll(async () => {
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.contact.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.clientProfile.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.party.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.$disconnect();
});

describe('ClientsService', () => {
  it('creates a client with contacts atomically, and lists/gets it back', async () => {
    const created = await clients.create({
      organizationId,
      name: 'GSDMA',
      shortCode: 'GSDMA',
      clientTypeId: undefined,
      department: 'Revenue Department',
      stateId: gjStateId,
      districtId: gjDistrictId,
      cityId: undefined,
      pinCode: '382010',
      officeAddress: 'Block 1, Sachivalaya',
      gstin: '24ABCDE1234F1Z5',
      internalNote: 'Key relationship',
      contacts: [
        { id: undefined, name: 'Rajesh Patel', designation: 'Director', phone: '9876543210', email: 'rajesh@zitaware.test' },
        { id: undefined, name: 'Meena Shah', designation: undefined, phone: undefined, email: undefined },
      ],
      actorId,
      correlationId: generateId(),
    });

    expect(created.name).toBe('GSDMA');
    expect(created.contacts).toHaveLength(2);
    expect(created.gstin).toBe('24ABCDE1234F1Z5');

    const listed = await clients.list({ organizationId, includeInactive: undefined });
    expect(listed.find((c) => c.id === created.id)?.contactCount).toBe(2);

    const detail = await clients.getDetail({ organizationId, id: created.id });
    expect(detail.contacts.map((c) => c.name).sort()).toEqual(['Meena Shah', 'Rajesh Patel']);
  });

  it('creates a client with no department', async () => {
    const created = await clients.create({
      organizationId,
      name: 'Department Optional Client',
      shortCode: undefined,
      clientTypeId: undefined,
      department: undefined,
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

    expect(created.department).toBeNull();

    const named = await clients.update({
      organizationId,
      id: created.id,
      name: undefined,
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
      contacts: undefined,
      expectedVersion: created.version,
      actorId,
      correlationId: generateId(),
    });
    expect(named.department).toBe('Revenue Department');

    const cleared = await clients.update({
      organizationId,
      id: created.id,
      name: undefined,
      shortCode: undefined,
      clientTypeId: undefined,
      department: '   ',
      stateId: undefined,
      districtId: undefined,
      cityId: undefined,
      pinCode: undefined,
      officeAddress: undefined,
      gstin: undefined,
      internalNote: undefined,
      contacts: undefined,
      expectedVersion: named.version,
      actorId,
      correlationId: generateId(),
    });
    expect(cleared.department).toBeNull();
  });

  it('stores a GSTIN without checking the 15-character pattern', async () => {
    const created = await clients.create({
      organizationId,
      name: 'Free GSTIN Client',
      shortCode: undefined,
      clientTypeId: undefined,
      department: 'Health Department',
      stateId: undefined,
      districtId: undefined,
      cityId: undefined,
      pinCode: undefined,
      officeAddress: undefined,
      gstin: 'NOT-A-VALID-GSTIN',
      internalNote: undefined,
      contacts: [],
      actorId,
      correlationId: generateId(),
    });
    expect(created.gstin).toBe('NOT-A-VALID-GSTIN');
  });

  it('rejects a district that does not belong to the selected state', async () => {
    await expect(
      clients.create({
        organizationId,
        name: 'Mismatched Hierarchy Client',
        shortCode: undefined,
        clientTypeId: undefined,
        department: 'Home Department',
        stateId: gjStateId,
        districtId: mhDistrictId,
        cityId: undefined,
        pinCode: undefined,
        officeAddress: undefined,
        gstin: undefined,
        internalNote: undefined,
        contacts: [],
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('does not belong to the selected state');
  });

  it('rejects a city that does not belong to the selected district', async () => {
    await expect(
      clients.create({
        organizationId,
        name: 'Mismatched City Client',
        shortCode: undefined,
        clientTypeId: undefined,
        department: 'Home Department',
        stateId: mhStateId,
        districtId: mhDistrictId,
        cityId: mhOtherDistrictCityId,
        pinCode: undefined,
        officeAddress: undefined,
        gstin: undefined,
        internalNote: undefined,
        contacts: [],
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('does not belong to the selected district');
  });

  it('updates a client, diffs the audit event, and replaces contacts wholesale', async () => {
    const created = await clients.create({
      organizationId,
      name: 'Surat Municipal Corporation',
      shortCode: undefined,
      clientTypeId: undefined,
      department: 'Health Department',
      stateId: undefined,
      districtId: undefined,
      cityId: undefined,
      pinCode: undefined,
      officeAddress: undefined,
      gstin: undefined,
      internalNote: undefined,
      contacts: [{ id: undefined, name: 'Vikram Desai', designation: undefined, phone: undefined, email: undefined }],
      actorId,
      correlationId: generateId(),
    });

    const updated = await clients.update({
      organizationId,
      id: created.id,
      name: undefined,
      shortCode: undefined,
      clientTypeId: undefined,
      department: 'Public Health Department',
      stateId: undefined,
      districtId: undefined,
      cityId: undefined,
      pinCode: undefined,
      officeAddress: undefined,
      gstin: undefined,
      internalNote: undefined,
      contacts: [{ id: undefined, name: 'Sunil Mehta', designation: 'Commissioner', phone: undefined, email: undefined }],
      expectedVersion: created.version,
      actorId,
      correlationId: generateId(),
    });

    expect(updated.department).toBe('Public Health Department');
    expect(updated.contacts.map((c) => c.name)).toEqual(['Sunil Mehta']);

    const events = await prisma.client.auditEvent.findMany({
      where: { organizationId, entityId: created.id, action: 'CLIENT_UPDATED' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.oldValues).toMatchObject({ department: 'Health Department' });
    expect(events[0]?.newValues).toMatchObject({ department: 'Public Health Department' });
  });

  it('rejects a stale-version update', async () => {
    const created = await clients.create({
      organizationId,
      name: 'Stale Version Client',
      shortCode: undefined,
      clientTypeId: undefined,
      department: 'Forest Department',
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

    await expect(
      clients.update({
        organizationId,
        id: created.id,
        name: 'New Name',
        shortCode: undefined,
        clientTypeId: undefined,
        department: undefined,
        stateId: undefined,
        districtId: undefined,
        cityId: undefined,
        pinCode: undefined,
        officeAddress: undefined,
        gstin: undefined,
        internalNote: undefined,
        contacts: undefined,
        expectedVersion: created.version + 1,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('changed by someone else');
  });

  it('deactivates and reactivates a client', async () => {
    const created = await clients.create({
      organizationId,
      name: 'Police Department Client',
      shortCode: undefined,
      clientTypeId: undefined,
      department: 'Police Department',
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

    await clients.setActive({
      organizationId,
      id: created.id,
      isActive: false,
      expectedVersion: created.version,
      actorId,
      correlationId: generateId(),
    });
    const afterDeactivate = await clients.getDetail({ organizationId, id: created.id });
    expect(afterDeactivate.isActive).toBe(false);

    const defaultList = await clients.list({ organizationId, includeInactive: undefined });
    expect(defaultList.some((c) => c.id === created.id)).toBe(false);

    const allList = await clients.list({ organizationId, includeInactive: true });
    expect(allList.find((c) => c.id === created.id)?.isActive).toBe(false);

    await clients.setActive({
      organizationId,
      id: created.id,
      isActive: true,
      expectedVersion: afterDeactivate.version,
      actorId,
      correlationId: generateId(),
    });
    const afterReactivate = await clients.getDetail({ organizationId, id: created.id });
    expect(afterReactivate.isActive).toBe(true);
  });

  it('never returns a client from a different organization', async () => {
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

    const listedInOtherOrg = await clients.list({ organizationId, includeInactive: undefined });
    expect(listedInOtherOrg.some((c) => c.id === otherClient.id)).toBe(false);

    await expect(clients.getDetail({ organizationId, id: otherClient.id })).rejects.toThrow();
  });
});
