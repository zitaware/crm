import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { ClientsService } from '../clients/clients.service';
import { VendorsService } from './vendors.service';

const prisma = new PrismaService();
const clients = new ClientsService(prisma);
const vendors = new VendorsService(prisma);

let organizationId: string;
let otherOrganizationId: string;
let gjStateId: string;
const actorId = generateId();

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Vendors Test Org', code: `VENDORTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Vendors Test Other Org', code: `VENDORTEST-OTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  const gjState = await prisma.client.state.findFirstOrThrow({ where: { code: 'GJ' } });
  gjStateId = gjState.id;
});

afterAll(async () => {
  const orgIds = [organizationId, otherOrganizationId];
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.vendorProfile.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.clientProfile.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.contact.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.party.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.client.$disconnect();
});

describe('VendorsService', () => {
  it('creates a new vendor (new Party + VendorProfile), normalizing GSTIN/PAN', async () => {
    const created = await vendors.create({
      organizationId,
      existingPartyId: undefined,
      name: 'Dell India',
      shortCode: undefined,
      gstin: ' 24aabcd1234e1z5 ',
      panNumber: ' aabcd1234e ',
      paymentTerms: 'NET_30',
      stateId: gjStateId,
      districtId: undefined,
      cityId: undefined,
      pinCode: undefined,
      officeAddress: undefined,
      internalNote: undefined,
      actorId,
      correlationId: generateId(),
    });
    expect(created.name).toBe('Dell India');
    expect(created.gstin).toBe('24AABCD1234E1Z5');
    expect(created.panNumber).toBe('AABCD1234E');
    expect(created.paymentTerms).toBe('NET_30');
    expect(created.isActive).toBe(true);

    const detail = await vendors.getDetail({ organizationId, id: created.id });
    expect(detail.id).toBe(created.id);
  });

  it('rejects an invalid GSTIN and an invalid PAN independently, without touching the other', async () => {
    await expect(
      vendors.create({
        organizationId,
        existingPartyId: undefined,
        name: 'Bad GSTIN Vendor',
        shortCode: undefined,
        gstin: 'NOT-A-GSTIN',
        panNumber: undefined,
        paymentTerms: undefined,
        stateId: undefined,
        districtId: undefined,
        cityId: undefined,
        pinCode: undefined,
        officeAddress: undefined,
        internalNote: undefined,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('GSTIN format is invalid.');

    await expect(
      vendors.create({
        organizationId,
        existingPartyId: undefined,
        name: 'Bad PAN Vendor',
        shortCode: undefined,
        gstin: undefined,
        panNumber: 'NOT-A-PAN',
        paymentTerms: undefined,
        stateId: undefined,
        districtId: undefined,
        cityId: undefined,
        pinCode: undefined,
        officeAddress: undefined,
        internalNote: undefined,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('PAN format is invalid.');
  });

  it('rejects an exact-duplicate GSTIN within the same organization (service-level, before the DB constraint)', async () => {
    const first = await vendors.create({
      organizationId,
      existingPartyId: undefined,
      name: 'Rackspace Solutions',
      shortCode: undefined,
      gstin: '29AAFCR5678G1Z8',
      panNumber: undefined,
      paymentTerms: 'ADVANCE',
      stateId: undefined,
      districtId: undefined,
      cityId: undefined,
      pinCode: undefined,
      officeAddress: undefined,
      internalNote: undefined,
      actorId,
      correlationId: generateId(),
    });
    expect(first.gstin).toBe('29AAFCR5678G1Z8');

    await expect(
      vendors.create({
        organizationId,
        existingPartyId: undefined,
        name: 'A Different Name, Same GSTIN',
        shortCode: undefined,
        gstin: '29aafcr5678g1z8',
        panNumber: undefined,
        paymentTerms: undefined,
        stateId: undefined,
        districtId: undefined,
        cityId: undefined,
        pinCode: undefined,
        officeAddress: undefined,
        internalNote: undefined,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('already registered to another vendor');
  });

  it('checkForDuplicates finds an existing Client by GSTIN and lets create() attach a VendorProfile to that same Party instead of making a new one', async () => {
    const client = await clients.create({
      organizationId,
      name: 'Also A Vendor Someday Pvt Ltd',
      shortCode: undefined,
      clientTypeId: undefined,
      department: 'Engineering',
      stateId: undefined,
      districtId: undefined,
      cityId: undefined,
      pinCode: undefined,
      officeAddress: undefined,
      gstin: '24ABCDE0001A1Z1',
      internalNote: undefined,
      contacts: [],
      actorId,
      correlationId: generateId(),
    });

    const duplicates = await vendors.checkForDuplicates({
      organizationId,
      name: 'Some New Vendor Name',
      gstin: '24abcde0001a1z1',
      panNumber: undefined,
      cityId: undefined,
    });
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.partyId).toBe(client.id);
    expect(duplicates[0]?.matchType).toBe('EXACT_GSTIN');
    expect(duplicates[0]?.hasVendorProfile).toBe(false);

    const attached = await vendors.create({
      organizationId,
      existingPartyId: client.id,
      name: client.name,
      shortCode: undefined,
      gstin: '24ABCDE0001A1Z1',
      panNumber: undefined,
      paymentTerms: 'NET_15',
      stateId: undefined,
      districtId: undefined,
      cityId: undefined,
      pinCode: undefined,
      officeAddress: undefined,
      internalNote: undefined,
      actorId,
      correlationId: generateId(),
    });
    expect(attached.id).toBe(client.id);

    // Now checkForDuplicates on the same GSTIN reports hasVendorProfile true.
    const afterAttach = await vendors.checkForDuplicates({
      organizationId,
      name: 'Irrelevant',
      gstin: '24abcde0001a1z1',
      panNumber: undefined,
      cityId: undefined,
    });
    expect(afterAttach.some((m) => m.partyId === client.id && m.hasVendorProfile)).toBe(true);

    // Attaching a second VendorProfile to the same Party is rejected.
    await expect(
      vendors.create({
        organizationId,
        existingPartyId: client.id,
        name: client.name,
        shortCode: undefined,
        gstin: undefined,
        panNumber: undefined,
        paymentTerms: undefined,
        stateId: undefined,
        districtId: undefined,
        cityId: undefined,
        pinCode: undefined,
        officeAddress: undefined,
        internalNote: undefined,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('already has a vendor profile');
  });

  it('checkForDuplicates returns a soft NAME_CITY warning that never blocks create()', async () => {
    const created = await vendors.create({
      organizationId,
      existingPartyId: undefined,
      name: 'Soft Match Vendor',
      shortCode: undefined,
      gstin: undefined,
      panNumber: undefined,
      paymentTerms: undefined,
      stateId: undefined,
      districtId: undefined,
      cityId: undefined,
      pinCode: undefined,
      officeAddress: undefined,
      internalNote: undefined,
      actorId,
      correlationId: generateId(),
    });

    const duplicates = await vendors.checkForDuplicates({
      organizationId,
      name: 'soft match vendor',
      gstin: undefined,
      panNumber: undefined,
      cityId: undefined,
    });
    expect(duplicates.some((m) => m.partyId === created.id && m.matchType === 'NAME_CITY')).toBe(true);

    // A second vendor with the exact same name is NOT blocked by this warning.
    const secondCreated = await vendors.create({
      organizationId,
      existingPartyId: undefined,
      name: 'Soft Match Vendor',
      shortCode: undefined,
      gstin: undefined,
      panNumber: undefined,
      paymentTerms: undefined,
      stateId: undefined,
      districtId: undefined,
      cityId: undefined,
      pinCode: undefined,
      officeAddress: undefined,
      internalNote: undefined,
      actorId,
      correlationId: generateId(),
    });
    expect(secondCreated.id).not.toBe(created.id);
  });

  it('setActive on a vendor role never touches an independently active Client role on the same Party, and vice versa', async () => {
    const client = await clients.create({
      organizationId,
      name: 'Dual Role Party',
      shortCode: undefined,
      clientTypeId: undefined,
      department: 'Ops',
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
    const vendor = await vendors.create({
      organizationId,
      existingPartyId: client.id,
      name: client.name,
      shortCode: undefined,
      gstin: undefined,
      panNumber: undefined,
      paymentTerms: undefined,
      stateId: undefined,
      districtId: undefined,
      cityId: undefined,
      pinCode: undefined,
      officeAddress: undefined,
      internalNote: undefined,
      actorId,
      correlationId: generateId(),
    });
    expect(vendor.id).toBe(client.id);

    // Deactivate the vendor role only.
    await vendors.setActive({ organizationId, id: vendor.id, isActive: false, expectedVersion: vendor.version, actorId, correlationId: generateId() });

    const vendorAfter = await vendors.getDetail({ organizationId, id: vendor.id });
    expect(vendorAfter.isActive).toBe(false);

    const clientAfter = await clients.getDetail({ organizationId, id: client.id });
    expect(clientAfter.isActive).toBe(true);

    // The Party-level row itself must still be active (never touched).
    const partyRow = await prisma.client.party.findUniqueOrThrow({ where: { id: client.id } });
    expect(partyRow.isActive).toBe(true);

    // Now deactivate the client role — the vendor role (already inactive)
    // stays exactly as it was, still independently controlled.
    const clientDetailForVersion = await clients.getDetail({ organizationId, id: client.id });
    await clients.setActive({ organizationId, id: client.id, isActive: false, expectedVersion: clientDetailForVersion.version, actorId, correlationId: generateId() });

    const vendorStillInactive = await vendors.getDetail({ organizationId, id: vendor.id });
    expect(vendorStillInactive.isActive).toBe(false);
    const partyRowAfter = await prisma.client.party.findUniqueOrThrow({ where: { id: client.id } });
    expect(partyRowAfter.isActive).toBe(true);
  });

  it('list() excludes an inactive vendor unless includeInactive is set, and never returns a vendor from a different organization', async () => {
    const otherOrgVendor = await vendors.create({
      organizationId: otherOrganizationId,
      existingPartyId: undefined,
      name: 'Other Org Vendor',
      shortCode: undefined,
      gstin: undefined,
      panNumber: undefined,
      paymentTerms: undefined,
      stateId: undefined,
      districtId: undefined,
      cityId: undefined,
      pinCode: undefined,
      officeAddress: undefined,
      internalNote: undefined,
      actorId,
      correlationId: generateId(),
    });

    const listedInOrg = await vendors.list({ organizationId, includeInactive: undefined });
    expect(listedInOrg.some((v) => v.id === otherOrgVendor.id)).toBe(false);
    await expect(vendors.getDetail({ organizationId, id: otherOrgVendor.id })).rejects.toThrow();

    const deactivated = await vendors.create({
      organizationId,
      existingPartyId: undefined,
      name: 'Deactivated List Vendor',
      shortCode: undefined,
      gstin: undefined,
      panNumber: undefined,
      paymentTerms: undefined,
      stateId: undefined,
      districtId: undefined,
      cityId: undefined,
      pinCode: undefined,
      officeAddress: undefined,
      internalNote: undefined,
      actorId,
      correlationId: generateId(),
    });
    await vendors.setActive({ organizationId, id: deactivated.id, isActive: false, expectedVersion: deactivated.version, actorId, correlationId: generateId() });

    const activeOnly = await vendors.list({ organizationId, includeInactive: undefined });
    expect(activeOnly.some((v) => v.id === deactivated.id)).toBe(false);
    const withInactive = await vendors.list({ organizationId, includeInactive: true });
    expect(withInactive.some((v) => v.id === deactivated.id)).toBe(true);
  });
});
