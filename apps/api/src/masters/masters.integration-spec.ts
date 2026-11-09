import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { MastersService } from './masters.service';

const prisma = new PrismaService();
const masters = new MastersService(prisma);

let organizationId: string;
const actorId = generateId();

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Masters Test Org', code: `MASTERSTEST-${generateId()}` },
  });
  organizationId = organization.id;
});

afterAll(async () => {
  await prisma.client.auditEvent.deleteMany({ where: { organizationId } });
  await prisma.client.internalDepartment.deleteMany({ where: { organizationId } });
  await prisma.client.leadType.deleteMany({ where: { organizationId } });
  await prisma.client.organization.delete({ where: { id: organizationId } });
  await prisma.client.$disconnect();
});

describe('MastersService', () => {
  it('creates a record and lists only active records by default', async () => {
    const created = await masters.create({
      organizationId,
      type: 'internal_departments',
      code: 'FIN',
      name: 'Finance',
      description: undefined,
      sortOrder: undefined,
      actorId,
      correlationId: generateId(),
    });

    expect(created.code).toBe('FIN');
    expect(created.isActive).toBe(true);
    expect(created.version).toBe(1);

    const list = await masters.list({ organizationId, type: 'internal_departments', includeInactive: false });
    expect(list.some((row) => row.id === created.id)).toBe(true);
  });

  it('rejects a normalized-duplicate name with VALIDATION_FAILED', async () => {
    await masters.create({
      organizationId,
      type: 'internal_departments',
      code: 'HR1',
      name: 'Human Resources',
      description: undefined,
      sortOrder: undefined,
      actorId,
      correlationId: generateId(),
    });

    await expect(
      masters.create({
        organizationId,
        type: 'internal_departments',
        code: 'HR2',
        name: '  human resources  ',
        description: undefined,
        sortOrder: undefined,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('already exists');
  });

  it('rejects an update with a stale expectedVersion (optimistic concurrency)', async () => {
    const created = await masters.create({
      organizationId,
      type: 'internal_departments',
      code: 'OPS',
      name: 'Operations',
      description: undefined,
      sortOrder: undefined,
      actorId,
      correlationId: generateId(),
    });

    await masters.update({
      organizationId,
      type: 'internal_departments',
      id: created.id,
      name: 'Operations Renamed',
      description: undefined,
      sortOrder: undefined,
      expectedVersion: created.version,
      actorId,
      correlationId: generateId(),
    });

    await expect(
      masters.update({
        organizationId,
        type: 'internal_departments',
        id: created.id,
        name: 'Operations Renamed Again',
        description: undefined,
        sortOrder: undefined,
        expectedVersion: created.version,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow();
  });

  it('deactivates a record via setActive and excludes it from the default list', async () => {
    const created = await masters.create({
      organizationId,
      type: 'internal_departments',
      code: 'TEMP',
      name: 'Temporary Dept',
      description: undefined,
      sortOrder: undefined,
      actorId,
      correlationId: generateId(),
    });

    await masters.setActive({
      organizationId,
      type: 'internal_departments',
      id: created.id,
      isActive: false,
      expectedVersion: created.version,
      actorId,
      correlationId: generateId(),
    });

    const activeList = await masters.list({ organizationId, type: 'internal_departments', includeInactive: false });
    expect(activeList.some((row) => row.id === created.id)).toBe(false);

    const fullList = await masters.list({ organizationId, type: 'internal_departments', includeInactive: true });
    const found = fullList.find((row) => row.id === created.id);
    expect(found?.isActive).toBe(false);
  });

  it('dispatches correctly for a different master type (lead_types) via the same registry', async () => {
    const created = await masters.create({
      organizationId,
      type: 'lead_types',
      code: 'REFERRAL',
      name: 'Referral',
      description: undefined,
      sortOrder: undefined,
      actorId,
      correlationId: generateId(),
    });

    expect(created.code).toBe('REFERRAL');

    const leadTypes = await masters.list({ organizationId, type: 'lead_types', includeInactive: false });
    expect(leadTypes.some((row) => row.id === created.id)).toBe(true);

    // Confirm it did NOT leak into a different type's table.
    const internalDepartments = await masters.list({
      organizationId,
      type: 'internal_departments',
      includeInactive: false,
    });
    expect(internalDepartments.some((row) => row.id === created.id)).toBe(false);
  });

  it('getCatalog returns a per-type record count reflecting created rows', async () => {
    // This org has created internal_departments (FIN, HR1) and lead_types
    // (REFERRAL) in the tests above; getCatalog must count them per type and
    // report zero for a type with no rows in this org.
    const catalog = await masters.getCatalog({ organizationId });

    // One entry per master type, no duplicates.
    expect(catalog).toHaveLength(16);
    const types = catalog.map((entry) => entry.type);
    expect(new Set(types).size).toBe(16);

    const departmentsCount = await masters.list({
      organizationId,
      type: 'internal_departments',
      includeInactive: true,
    });
    const catalogDepartments = catalog.find((entry) => entry.type === 'internal_departments');
    expect(catalogDepartments?.count).toBe(departmentsCount.length);
    expect(catalogDepartments!.count).toBeGreaterThan(0);

    // A type nothing was created for in this org counts zero (org-scoped).
    expect(catalog.find((entry) => entry.type === 'tender_portals')?.count).toBe(0);
  });
});
