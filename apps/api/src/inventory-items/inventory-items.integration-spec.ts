import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryItemsService } from './inventory-items.service';

const prisma = new PrismaService();
const service = new InventoryItemsService(prisma);

let organizationId: string;
let otherOrganizationId: string;
let unitId: string;
let inactiveUnitId: string;
let otherOrgUnitId: string;
let categoryId: string;
let inactiveCategoryId: string;
const actorId = generateId();

async function seedOrg(code: string): Promise<string> {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: `Item Test Org ${code}`, code: `ITEMTEST-${generateId()}` },
  });
  return organization.id;
}

function baseInput(overrides: Partial<Parameters<InventoryItemsService['create']>[0]> = {}) {
  return {
    organizationId,
    name: 'HP LaserJet Toner 26A',
    description: undefined,
    unitOfMeasureId: unitId,
    productCategoryId: categoryId,
    hsnSac: '84439959',
    defaultRateAmount: '4500.00',
    isStockTracked: true,
    idempotencyKey: generateId(),
    actorId,
    correlationId: generateId(),
    ...overrides,
  };
}

beforeAll(async () => {
  organizationId = await seedOrg('A');
  otherOrganizationId = await seedOrg('B');

  const unit = await prisma.client.unitOfMeasure.create({
    data: { id: generateId(), organizationId, code: 'qty', name: 'Qty' },
  });
  unitId = unit.id;
  const inactiveUnit = await prisma.client.unitOfMeasure.create({
    data: { id: generateId(), organizationId, code: 'box', name: 'Box', isActive: false },
  });
  inactiveUnitId = inactiveUnit.id;
  const otherOrgUnit = await prisma.client.unitOfMeasure.create({
    data: { id: generateId(), organizationId: otherOrganizationId, code: 'qty', name: 'Qty' },
  });
  otherOrgUnitId = otherOrgUnit.id;

  const category = await prisma.client.productCategory.create({
    data: { id: generateId(), organizationId, code: 'consumables', name: 'Consumables' },
  });
  categoryId = category.id;
  const inactiveCategory = await prisma.client.productCategory.create({
    data: { id: generateId(), organizationId, code: 'retired', name: 'Retired', isActive: false },
  });
  inactiveCategoryId = inactiveCategory.id;
});

afterAll(async () => {
  const orgIds = [organizationId, otherOrganizationId];
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.idempotencyKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.inventoryItem.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.productCategory.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.unitOfMeasure.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.client.$disconnect();
});

describe('InventoryItemsService — create', () => {
  it('server-generates a sequential ITEM-000001 code and never accepts one from the caller', async () => {
    const first = await service.create(baseInput({ name: 'Item One' }));
    const second = await service.create(baseInput({ name: 'Item Two' }));

    expect(first.code).toMatch(/^ITEM-\d{6}$/);
    expect(second.code).toMatch(/^ITEM-\d{6}$/);
    expect(second.code).not.toBe(first.code);
    expect(Number(second.code.slice(5))).toBe(Number(first.code.slice(5)) + 1);
  });

  it('resolves the unit-of-measure and category display names, and formats the default rate as a decimal string', async () => {
    const created = await service.create(baseInput({ name: 'Named Item' }));
    expect(created.unitOfMeasureName).toBe('Qty');
    expect(created.productCategoryName).toBe('Consumables');
    expect(created.defaultRateAmount).toBe('4500.00');
    expect(created.isStockTracked).toBe(true);
    expect(created.isActive).toBe(true);
    expect(created.version).toBe(1);
  });

  it('accepts a non-stock-tracked item (docs/01: non-stock goods/services use Expense, not Inventory)', async () => {
    const created = await service.create(baseInput({ name: 'AMC Service', isStockTracked: false }));
    expect(created.isStockTracked).toBe(false);
  });

  it('leaves an omitted category and default rate null rather than inventing a value', async () => {
    const created = await service.create(
      baseInput({ name: 'Bare Item', productCategoryId: undefined, defaultRateAmount: undefined, hsnSac: undefined }),
    );
    expect(created.productCategoryId).toBeNull();
    expect(created.productCategoryName).toBeNull();
    expect(created.defaultRateAmount).toBeNull();
    expect(created.hsnSac).toBeNull();
  });

  it('rejects a negative default rate', async () => {
    await expect(service.create(baseInput({ name: 'Negative', defaultRateAmount: '-1.00' }))).rejects.toThrow(
      /cannot be negative/i,
    );
  });

  it('rejects a deactivated unit of measure and a deactivated category on create', async () => {
    await expect(service.create(baseInput({ name: 'Bad Unit', unitOfMeasureId: inactiveUnitId }))).rejects.toThrow(
      /deactivated/i,
    );
    await expect(
      service.create(baseInput({ name: 'Bad Category', productCategoryId: inactiveCategoryId })),
    ).rejects.toThrow(/deactivated/i);
  });

  it("rejects another organization's unit of measure", async () => {
    await expect(service.create(baseInput({ name: 'Cross Org', unitOfMeasureId: otherOrgUnitId }))).rejects.toThrow(
      /not found/i,
    );
  });

  it('replays an identical request under the same idempotency key, and rejects a reused key carrying a different request', async () => {
    const key = generateId();
    const first = await service.create(baseInput({ name: 'Idempotent Item', idempotencyKey: key }));
    const replay = await service.create(baseInput({ name: 'Idempotent Item', idempotencyKey: key }));
    expect(replay.id).toBe(first.id);
    expect(replay.code).toBe(first.code);

    await expect(service.create(baseInput({ name: 'Different Name', idempotencyKey: key }))).rejects.toThrow(
      /different request/i,
    );
  });

  it('writes an INVENTORY_ITEM_CREATED audit event', async () => {
    const created = await service.create(baseInput({ name: 'Audited Item' }));
    const events = await prisma.client.auditEvent.findMany({
      where: { organizationId, entityType: 'INVENTORY_ITEM', entityId: created.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.action).toBe('INVENTORY_ITEM_CREATED');
  });
});

describe('InventoryItemsService — update and setActive', () => {
  it('updates fields, bumps the version, and enforces optimistic concurrency', async () => {
    const created = await service.create(baseInput({ name: 'Editable Item' }));

    const updated = await service.update({
      organizationId,
      id: created.id,
      name: 'Editable Item (renamed)',
      description: 'Now described',
      unitOfMeasureId: undefined,
      productCategoryId: undefined,
      hsnSac: '99999999',
      defaultRateAmount: '5000.5000',
      isStockTracked: undefined,
      expectedVersion: created.version,
      actorId,
      correlationId: generateId(),
    });
    expect(updated.name).toBe('Editable Item (renamed)');
    expect(updated.hsnSac).toBe('99999999');
    expect(updated.defaultRateAmount).toBe('5000.50');
    expect(updated.code).toBe(created.code);
    expect(updated.version).toBe(created.version + 1);

    await expect(
      service.update({
        organizationId,
        id: created.id,
        name: 'Stale write',
        description: undefined,
        unitOfMeasureId: undefined,
        productCategoryId: undefined,
        hsnSac: undefined,
        defaultRateAmount: undefined,
        isStockTracked: undefined,
        expectedVersion: created.version,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow(/changed by someone else/i);
  });

  it('rejects re-pointing an item at a deactivated master on update', async () => {
    const created = await service.create(baseInput({ name: 'Repoint Item' }));
    await expect(
      service.update({
        organizationId,
        id: created.id,
        name: undefined,
        description: undefined,
        unitOfMeasureId: inactiveUnitId,
        productCategoryId: undefined,
        hsnSac: undefined,
        defaultRateAmount: undefined,
        isStockTracked: undefined,
        expectedVersion: created.version,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow(/deactivated/i);
  });

  it('deactivates without deleting: the row disappears from the default list but returns with includeInactive', async () => {
    const created = await service.create(baseInput({ name: 'Deactivatable Item' }));

    await service.setActive({
      organizationId,
      id: created.id,
      isActive: false,
      expectedVersion: created.version,
      actorId,
      correlationId: generateId(),
    });

    const defaultList = await service.list({
      organizationId,
      page: 1,
      pageSize: 100,
      filters: { search: 'Deactivatable Item', productCategoryId: undefined, isStockTracked: undefined, includeInactive: undefined },
    });
    expect(defaultList.rows.find((row) => row.id === created.id)).toBeUndefined();

    const inclusiveList = await service.list({
      organizationId,
      page: 1,
      pageSize: 100,
      filters: { search: 'Deactivatable Item', productCategoryId: undefined, isStockTracked: undefined, includeInactive: true },
    });
    const found = inclusiveList.rows.find((row) => row.id === created.id);
    expect(found?.isActive).toBe(false);

    // Still readable by id — deactivation must never hide history.
    const detail = await service.getDetail({ organizationId, id: created.id });
    expect(detail.isActive).toBe(false);
  });
});

describe('InventoryItemsService — list, getDetail and cross-org isolation', () => {
  it('filters by search, category and stock-tracked flag, and paginates', async () => {
    const marker = `Filter-${generateId().slice(0, 8)}`;
    await service.create(baseInput({ name: `${marker} stocked` }));
    await service.create(baseInput({ name: `${marker} service`, isStockTracked: false, productCategoryId: undefined }));

    const bySearch = await service.list({
      organizationId,
      page: 1,
      pageSize: 100,
      filters: { search: marker, productCategoryId: undefined, isStockTracked: undefined, includeInactive: undefined },
    });
    expect(bySearch.total).toBe(2);

    const stockedOnly = await service.list({
      organizationId,
      page: 1,
      pageSize: 100,
      filters: { search: marker, productCategoryId: undefined, isStockTracked: true, includeInactive: undefined },
    });
    expect(stockedOnly.total).toBe(1);
    expect(stockedOnly.rows[0]!.name).toBe(`${marker} stocked`);

    const byCategory = await service.list({
      organizationId,
      page: 1,
      pageSize: 100,
      filters: { search: marker, productCategoryId: categoryId, isStockTracked: undefined, includeInactive: undefined },
    });
    expect(byCategory.total).toBe(1);

    const firstPage = await service.list({
      organizationId,
      page: 1,
      pageSize: 1,
      filters: { search: marker, productCategoryId: undefined, isStockTracked: undefined, includeInactive: undefined },
    });
    expect(firstPage.rows).toHaveLength(1);
    expect(firstPage.total).toBe(2);
  });

  it("never returns another organization's item, from list, getDetail or getCount", async () => {
    const mine = await service.create(baseInput({ name: 'Org A Only' }));

    const theirs = await service.create({
      organizationId: otherOrganizationId,
      name: 'Org B Only',
      description: undefined,
      unitOfMeasureId: otherOrgUnitId,
      productCategoryId: undefined,
      hsnSac: undefined,
      defaultRateAmount: undefined,
      isStockTracked: true,
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    await expect(service.getDetail({ organizationId, id: theirs.id })).rejects.toThrow(/not found/i);
    await expect(service.getDetail({ organizationId: otherOrganizationId, id: mine.id })).rejects.toThrow(/not found/i);

    const theirList = await service.list({
      organizationId: otherOrganizationId,
      page: 1,
      pageSize: 100,
      filters: { search: undefined, productCategoryId: undefined, isStockTracked: undefined, includeInactive: true },
    });
    expect(theirList.rows.every((row) => row.id !== mine.id)).toBe(true);
    expect(await service.getCount({ organizationId: otherOrganizationId })).toBe(theirList.total);

    // Code sequences are per-organization, so org B's first item is also ITEM-000001.
    expect(theirs.code).toBe('ITEM-000001');
  });
});
