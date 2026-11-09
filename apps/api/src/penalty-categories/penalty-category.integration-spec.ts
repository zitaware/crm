import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { PenaltyCategoryService } from './penalty-category.service';

const prisma = new PrismaService();
const service = new PenaltyCategoryService(prisma);

let organizationId: string;
const actorId = generateId();

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Penalty Test Org', code: `PENTEST-${generateId()}` },
  });
  organizationId = organization.id;
});

afterAll(async () => {
  await prisma.client.auditEvent.deleteMany({ where: { organizationId } });
  await prisma.client.penaltyCategory.deleteMany({ where: { organizationId } });
  await prisma.client.organization.delete({ where: { id: organizationId } });
  await prisma.client.$disconnect();
});

describe('PenaltyCategoryService', () => {
  it('round-trips basis_type through create -> list -> update (the field the generic API drops)', async () => {
    const created = await service.create({
      organizationId,
      code: 'LD',
      name: 'Liquidated Damages',
      description: 'Delay penalty',
      basisType: 'PERCENTAGE',
      acceptedLedgerAccountId: undefined,
      disputedLedgerAccountId: undefined,
      sortOrder: 1,
      actorId,
      correlationId: generateId(),
    });
    expect(created.basisType).toBe('PERCENTAGE');

    const listed = await service.list({ organizationId, includeInactive: false });
    expect(listed.find((row) => row.id === created.id)?.basisType).toBe('PERCENTAGE');

    const updated = await service.update({
      organizationId,
      id: created.id,
      name: undefined,
      description: undefined,
      basisType: 'FIXED_AMOUNT',
      acceptedLedgerAccountId: undefined,
      disputedLedgerAccountId: undefined,
      sortOrder: undefined,
      expectedVersion: created.version,
      actorId,
      correlationId: generateId(),
    });
    expect(updated.basisType).toBe('FIXED_AMOUNT');
    expect(updated.version).toBe(created.version + 1);
  });

  it('getCount reflects created rows and setActive/deactivate hides from the default list', async () => {
    const created = await service.create({
      organizationId,
      code: 'HOLD',
      name: 'Hold Penalty',
      description: undefined,
      basisType: undefined,
      acceptedLedgerAccountId: undefined,
      disputedLedgerAccountId: undefined,
      sortOrder: undefined,
      actorId,
      correlationId: generateId(),
    });

    const countBefore = await service.getCount({ organizationId });
    expect(countBefore).toBeGreaterThan(0);

    await service.setActive({
      organizationId,
      id: created.id,
      isActive: false,
      expectedVersion: created.version,
      actorId,
      correlationId: generateId(),
    });

    const activeOnly = await service.list({ organizationId, includeInactive: false });
    expect(activeOnly.some((row) => row.id === created.id)).toBe(false);

    const withInactive = await service.list({ organizationId, includeInactive: true });
    expect(withInactive.some((row) => row.id === created.id)).toBe(true);

    // Deactivation is not a delete — getCount still counts it (non-deleted).
    expect(await service.getCount({ organizationId })).toBe(countBefore);
  });

  it('rejects a duplicate code with VALIDATION_FAILED', async () => {
    await service.create({
      organizationId,
      code: 'DUP',
      name: 'First',
      description: undefined,
      basisType: undefined,
      acceptedLedgerAccountId: undefined,
      disputedLedgerAccountId: undefined,
      sortOrder: undefined,
      actorId,
      correlationId: generateId(),
    });

    await expect(
      service.create({
        organizationId,
        code: 'DUP',
        name: 'Second',
        description: undefined,
        basisType: undefined,
      acceptedLedgerAccountId: undefined,
      disputedLedgerAccountId: undefined,
        sortOrder: undefined,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow(/already exists/i);
  });
});
