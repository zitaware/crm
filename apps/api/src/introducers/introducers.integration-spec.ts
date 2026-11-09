import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { IntroducersService } from './introducers.service';

const prisma = new PrismaService();
const introducers = new IntroducersService(prisma);

let organizationId: string;
let otherOrganizationId: string;
const actorId = generateId();

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Introducers Test Org', code: `INTROTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Introducers Test Other Org', code: `INTROTEST-OTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;
});

afterAll(async () => {
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.introducer.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.$disconnect();
});

describe('IntroducersService', () => {
  it('creates an introducer and lists it back', async () => {
    const created = await introducers.create({
      organizationId,
      name: 'Rajesh Patel',
      phone: '9876543210',
      actorId,
      correlationId: generateId(),
    });
    expect(created.name).toBe('Rajesh Patel');
    expect(created.isActive).toBe(true);

    const listed = await introducers.list({ organizationId, includeInactive: undefined });
    expect(listed.some((row) => row.id === created.id)).toBe(true);
  });

  it('updates an introducer, diffing the audit event', async () => {
    const created = await introducers.create({
      organizationId,
      name: 'Meena Shah',
      phone: undefined,
      actorId,
      correlationId: generateId(),
    });

    const updated = await introducers.update({
      organizationId,
      id: created.id,
      name: undefined,
      phone: '9998887777',
      expectedVersion: created.version,
      actorId,
      correlationId: generateId(),
    });
    expect(updated.phone).toBe('9998887777');
    expect(updated.name).toBe('Meena Shah');

    const events = await prisma.client.auditEvent.findMany({
      where: { organizationId, entityId: created.id, action: 'INTRODUCER_UPDATED' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.newValues).toMatchObject({ phone: '9998887777' });
  });

  it('rejects a stale-version update', async () => {
    const created = await introducers.create({
      organizationId,
      name: 'Vikram Desai',
      phone: undefined,
      actorId,
      correlationId: generateId(),
    });

    await expect(
      introducers.update({
        organizationId,
        id: created.id,
        name: 'New Name',
        phone: undefined,
        expectedVersion: created.version + 1,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('changed by someone else');
  });

  it('deactivates and reactivates an introducer', async () => {
    const created = await introducers.create({
      organizationId,
      name: 'Sunil Mehta',
      phone: undefined,
      actorId,
      correlationId: generateId(),
    });

    await introducers.setActive({
      organizationId,
      id: created.id,
      isActive: false,
      expectedVersion: created.version,
      actorId,
      correlationId: generateId(),
    });
    const afterDeactivate = await introducers.list({ organizationId, includeInactive: true });
    expect(afterDeactivate.find((row) => row.id === created.id)?.isActive).toBe(false);

    const defaultList = await introducers.list({ organizationId, includeInactive: undefined });
    expect(defaultList.some((row) => row.id === created.id)).toBe(false);
  });

  it('never returns an introducer from a different organization', async () => {
    const otherIntroducer = await introducers.create({
      organizationId: otherOrganizationId,
      name: 'Other Org Introducer',
      phone: undefined,
      actorId,
      correlationId: generateId(),
    });

    const listedInOrg = await introducers.list({ organizationId, includeInactive: undefined });
    expect(listedInOrg.some((row) => row.id === otherIntroducer.id)).toBe(false);
  });
});
