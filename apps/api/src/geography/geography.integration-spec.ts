import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { GeographyService } from './geography.service';

const prisma = new PrismaService();
const geography = new GeographyService(prisma);

// Audit attribution org + tags for the geography rows this spec creates, so
// afterAll can remove exactly them (geography is global, not org-scoped).
let organizationId: string;
const actorId = generateId();
const TAG = `GEOTEST-${generateId().slice(0, 8)}`;

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Geo Test Org', code: `GEOTEST-${generateId()}` },
  });
  organizationId = organization.id;
});

afterAll(async () => {
  await prisma.client.auditEvent.deleteMany({ where: { organizationId } });
  await prisma.client.city.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.client.district.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.client.state.deleteMany({ where: { code: { startsWith: 'ZZ' } } });
  await prisma.client.organization.delete({ where: { id: organizationId } });
  await prisma.client.$disconnect();
});

describe('GeographyService', () => {
  it('lists active states ordered by name', async () => {
    const states = await geography.listStates();
    expect(states.length).toBeGreaterThan(30);
    expect(states.find((state) => state.code === 'MH')).toBeTruthy();
  });

  it('lists districts scoped to the given state only', async () => {
    const maharashtra = (await geography.listStates()).find((state) => state.code === 'MH');
    expect(maharashtra).toBeTruthy();

    const districts = await geography.listDistricts({ stateId: maharashtra!.id });
    expect(districts.length).toBeGreaterThan(0);
    expect(districts.every((district) => district.stateId === maharashtra!.id)).toBe(true);
  });

  it('lists cities scoped to the given district only', async () => {
    const maharashtra = (await geography.listStates()).find((state) => state.code === 'MH');
    const pune = (await geography.listDistricts({ stateId: maharashtra!.id })).find(
      (district) => district.name === 'Pune',
    );
    expect(pune).toBeTruthy();

    const cities = await geography.listCities({ districtId: pune!.id });
    expect(cities.length).toBeGreaterThan(0);
    expect(cities.every((city) => city.districtId === pune!.id && city.stateId === maharashtra!.id)).toBe(
      true,
    );
  });

  it('rejects a city whose state_id does not match its district (composite FK)', async () => {
    const maharashtra = (await geography.listStates()).find((state) => state.code === 'MH');
    const karnataka = (await geography.listStates()).find((state) => state.code === 'KA');
    const pune = (await geography.listDistricts({ stateId: maharashtra!.id })).find(
      (district) => district.name === 'Pune',
    );

    await expect(
      prisma.client.city.create({
        data: {
          id: generateId(),
          districtId: pune!.id,
          stateId: karnataka!.id,
          name: 'Mismatched City',
        },
      }),
    ).rejects.toThrow();
  });

  it('creates a district under a state, then a city that derives the state from the district', async () => {
    const mh = (await geography.listStates()).find((state) => state.code === 'MH')!;

    const district = await geography.createDistrict({
      stateId: mh.id,
      name: `${TAG}-District`,
      actorId,
      organizationId,
      correlationId: generateId(),
    });
    expect(district.stateId).toBe(mh.id);
    expect(district.isActive).toBe(true);
    expect(district.version).toBe(1);

    const city = await geography.createCity({
      districtId: district.id,
      name: `${TAG}-City`,
      actorId,
      organizationId,
      correlationId: generateId(),
    });
    // state_id derived from the district, never supplied by the caller.
    expect(city.districtId).toBe(district.id);
    expect(city.stateId).toBe(mh.id);

    // Audit events were written under the acting admin's organization.
    const audits = await prisma.client.auditEvent.findMany({
      where: { organizationId, action: 'MASTER_CREATED', entityType: { in: ['DISTRICT', 'CITY'] } },
    });
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a district under an inactive/nonexistent state', async () => {
    await expect(
      geography.createDistrict({
        stateId: generateId(),
        name: `${TAG}-Orphan`,
        actorId,
        organizationId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow(/does not exist or is inactive/i);
  });

  it('rejects a duplicate district name within the same state', async () => {
    const mh = (await geography.listStates()).find((state) => state.code === 'MH')!;
    const name = `${TAG}-Dup`;
    await geography.createDistrict({ stateId: mh.id, name, actorId, organizationId, correlationId: generateId() });

    await expect(
      geography.createDistrict({ stateId: mh.id, name, actorId, organizationId, correlationId: generateId() }),
    ).rejects.toThrow(/already exists/i);
  });

  it('updates a district name and rejects a stale expectedVersion', async () => {
    const mh = (await geography.listStates()).find((state) => state.code === 'MH')!;
    const district = await geography.createDistrict({
      stateId: mh.id,
      name: `${TAG}-ToUpdate`,
      actorId,
      organizationId,
      correlationId: generateId(),
    });

    const updated = await geography.updateDistrict({
      id: district.id,
      name: `${TAG}-Updated`,
      expectedVersion: district.version,
      actorId,
      organizationId,
      correlationId: generateId(),
    });
    expect(updated.name).toBe(`${TAG}-Updated`);
    expect(updated.version).toBe(district.version + 1);

    // Reusing the now-stale original version must conflict.
    await expect(
      geography.updateDistrict({
        id: district.id,
        name: `${TAG}-Again`,
        expectedVersion: district.version,
        actorId,
        organizationId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow(/changed by someone else/i);
  });

  it('deactivates a district (setActive) and hides it from the default active list', async () => {
    const mh = (await geography.listStates()).find((state) => state.code === 'MH')!;
    const district = await geography.createDistrict({
      stateId: mh.id,
      name: `${TAG}-ToDeactivate`,
      actorId,
      organizationId,
      correlationId: generateId(),
    });

    await geography.setDistrictActive({
      id: district.id,
      isActive: false,
      expectedVersion: district.version,
      actorId,
      organizationId,
      correlationId: generateId(),
    });

    const activeOnly = await geography.listDistricts({ stateId: mh.id });
    expect(activeOnly.some((d) => d.id === district.id)).toBe(false);

    const withInactive = await geography.listDistricts({ stateId: mh.id, includeInactive: true });
    expect(withInactive.some((d) => d.id === district.id)).toBe(true);
  });
});
