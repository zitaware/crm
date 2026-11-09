import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type { InventoryItemFilters, InventoryItemPort, InventoryItemRecord } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isConstraintViolation } from '../organization/constraint-error.util';

const CREATE_COMMAND_TYPE = 'inventory_item.create';
const MAX_CODE_ATTEMPTS = 5;

/**
 * Stable, deep serialization for idempotency request hashing.
 *
 * NOT `JSON.stringify(input, Object.keys(input).sort())` — that form passes
 * the key list as JSON.stringify's *replacer allowlist*, which drops every
 * property of a nested object whose name is not in the top-level key list.
 * A payload carrying `lines: [{ quantity, unitCostAmount }]` therefore
 * serializes as `lines: [{}]`, and two requests differing only in their line
 * content hash identically — silently defeating docs/07's "same key +
 * different request hash is rejected" guard. Found by a Phase 7.2 test.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function hashRequest(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

const itemInclude = {
  unitOfMeasure: { select: { name: true } },
  productCategory: { select: { name: true } },
} as const;

type ItemRow = Prisma.InventoryItemGetPayload<{ include: typeof itemInclude }>;

function toRecord(row: ItemRow): InventoryItemRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    unitOfMeasureId: row.unitOfMeasureId,
    unitOfMeasureName: row.unitOfMeasure.name,
    productCategoryId: row.productCategoryId,
    productCategoryName: row.productCategory?.name ?? null,
    hsnSac: row.hsnSac,
    defaultRateAmount: row.defaultRateAmount === null ? null : row.defaultRateAmount.toFixed(2),
    isStockTracked: row.isStockTracked,
    isActive: row.isActive,
    version: row.version,
  };
}

/**
 * Product / item master (Phase 7.1, ADR-091).
 *
 * Dedicated CRUD, kept out of the generic MastersService because the table
 * carries five columns beyond the flat FlatMasterDelegate shape (unit of
 * measure, category, HSN/SAC, default rate, isStockTracked) — the same
 * reason ExpenseCategory and PenaltyCategory each got their own service
 * (ADR-037/044/062).
 *
 * `code` is server-generated and retry-safe under concurrency, matching the
 * Milestone/Invoice/VendorBill numbering precedent: the loop re-derives the
 * next number on each attempt and retries only on a real unique violation.
 */
@Injectable()
export class InventoryItemsService implements InventoryItemPort {
  constructor(private readonly prisma: PrismaService) {}

  async getCount(input: { organizationId: string }): Promise<number> {
    return this.prisma.client.inventoryItem.count({
      where: { organizationId: input.organizationId, deletedAt: null },
    });
  }

  private buildWhere(organizationId: string, filters: InventoryItemFilters): Prisma.InventoryItemWhereInput {
    return {
      organizationId,
      deletedAt: null,
      ...(filters.includeInactive ? {} : { isActive: true }),
      ...(filters.productCategoryId ? { productCategoryId: filters.productCategoryId } : {}),
      ...(filters.isStockTracked === undefined ? {} : { isStockTracked: filters.isStockTracked }),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: 'insensitive' as const } },
              { code: { contains: filters.search, mode: 'insensitive' as const } },
              { hsnSac: { contains: filters.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
  }

  async list(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: InventoryItemFilters;
  }): Promise<{ rows: InventoryItemRecord[]; total: number }> {
    const where = this.buildWhere(input.organizationId, input.filters);
    const [rows, total] = await Promise.all([
      this.prisma.client.inventoryItem.findMany({
        where,
        include: itemInclude,
        orderBy: [{ name: 'asc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.client.inventoryItem.count({ where }),
    ]);
    return { rows: rows.map(toRecord), total };
  }

  async getDetail(input: { organizationId: string; id: string }): Promise<InventoryItemRecord> {
    const row = await this.prisma.client.inventoryItem.findFirst({
      where: { id: input.id, organizationId: input.organizationId, deletedAt: null },
      include: itemInclude,
    });
    if (!row) throwAppError('NOT_FOUND', 'Item not found.');
    return toRecord(row);
  }

  /** Validates that every referenced master exists in this organization and
   * is still active. An inactive master stays visible in historical views
   * but must never be selectable on create or edit. */
  private async assertReferencesSelectable(
    organizationId: string,
    unitOfMeasureId: string | undefined,
    productCategoryId: string | undefined,
  ): Promise<void> {
    if (unitOfMeasureId !== undefined) {
      const uom = await this.prisma.client.unitOfMeasure.findFirst({
        where: { id: unitOfMeasureId, organizationId, deletedAt: null },
      });
      if (!uom) throwAppError('VALIDATION_FAILED', 'Unit of measure not found.');
      if (!uom.isActive) throwAppError('VALIDATION_FAILED', 'That unit of measure is deactivated and cannot be selected.');
    }
    if (productCategoryId !== undefined) {
      const category = await this.prisma.client.productCategory.findFirst({
        where: { id: productCategoryId, organizationId, deletedAt: null },
      });
      if (!category) throwAppError('VALIDATION_FAILED', 'Product category not found.');
      if (!category.isActive) throwAppError('VALIDATION_FAILED', 'That product category is deactivated and cannot be selected.');
    }
  }

  private parseDefaultRate(value: string | undefined): Prisma.Decimal | null {
    if (value === undefined || value === '') return null;
    const parsed = new Prisma.Decimal(value);
    if (parsed.isNegative()) throwAppError('VALIDATION_FAILED', 'Default rate cannot be negative.');
    return parsed;
  }

  private async generateCode(tx: Prisma.TransactionClient, organizationId: string, attempt: number): Promise<string> {
    const count = await tx.inventoryItem.count({ where: { organizationId } });
    return `ITEM-${String(count + 1 + attempt).padStart(6, '0')}`;
  }

  async create(input: {
    organizationId: string;
    name: string;
    description: string | undefined;
    unitOfMeasureId: string;
    productCategoryId: string | undefined;
    hsnSac: string | undefined;
    defaultRateAmount: string | undefined;
    isStockTracked: boolean;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<InventoryItemRecord> {
    const requestHash = hashRequest({ ...input, idempotencyKey: undefined, actorId: undefined, correlationId: undefined });
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: {
        organizationId_commandType_idempotencyKey: {
          organizationId: input.organizationId,
          commandType: CREATE_COMMAND_TYPE,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash) {
        throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      }
      return existingKey.resultReference as unknown as InventoryItemRecord;
    }

    await this.assertReferencesSelectable(input.organizationId, input.unitOfMeasureId, input.productCategoryId);
    const defaultRateAmount = this.parseDefaultRate(input.defaultRateAmount);

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          const id = generateId();
          const code = await this.generateCode(tx, input.organizationId, attempt);
          await tx.inventoryItem.create({
            data: {
              id,
              organizationId: input.organizationId,
              code,
              name: input.name,
              description: input.description ?? null,
              unitOfMeasureId: input.unitOfMeasureId,
              productCategoryId: input.productCategoryId ?? null,
              hsnSac: input.hsnSac ?? null,
              defaultRateAmount,
              isStockTracked: input.isStockTracked,
              createdBy: input.actorId,
            },
          });

          await recordAuditEvent(tx, {
            organizationId: input.organizationId,
            entityType: 'INVENTORY_ITEM',
            entityId: id,
            action: 'INVENTORY_ITEM_CREATED',
            actorId: input.actorId,
            correlationId: input.correlationId,
            newValues: { code, name: input.name, isStockTracked: input.isStockTracked },
          });

          const created = await tx.inventoryItem.findFirstOrThrow({ where: { id }, include: itemInclude });
          const record = toRecord(created);

          await tx.idempotencyKey.create({
            data: {
              id: generateId(),
              organizationId: input.organizationId,
              commandType: CREATE_COMMAND_TYPE,
              idempotencyKey: input.idempotencyKey,
              requestHash,
              sourceRecordType: 'INVENTORY_ITEM',
              sourceRecordId: id,
              resultReference: record as unknown as Prisma.InputJsonValue,
            },
          });

          return record;
        });
      } catch (error) {
        if (isConstraintViolation(error) && attempt < MAX_CODE_ATTEMPTS - 1) continue;
        throw error;
      }
    }
    return throwAppError('VALIDATION_FAILED', 'Could not create the item due to a conflict. Please try again.');
  }

  async update(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    description: string | undefined;
    unitOfMeasureId: string | undefined;
    productCategoryId: string | undefined;
    hsnSac: string | undefined;
    defaultRateAmount: string | undefined;
    isStockTracked: boolean | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<InventoryItemRecord> {
    await this.assertReferencesSelectable(input.organizationId, input.unitOfMeasureId, input.productCategoryId);

    const data: Prisma.InventoryItemUncheckedUpdateManyInput = {
      updatedBy: input.actorId,
      version: { increment: 1 },
    };
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.unitOfMeasureId !== undefined) data.unitOfMeasureId = input.unitOfMeasureId;
    if (input.productCategoryId !== undefined) data.productCategoryId = input.productCategoryId;
    if (input.hsnSac !== undefined) data.hsnSac = input.hsnSac;
    if (input.defaultRateAmount !== undefined) data.defaultRateAmount = this.parseDefaultRate(input.defaultRateAmount);
    if (input.isStockTracked !== undefined) data.isStockTracked = input.isStockTracked;

    return await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.inventoryItem.updateMany({
        where: { id: input.id, organizationId: input.organizationId, deletedAt: null, version: input.expectedVersion },
        data,
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'INVENTORY_ITEM',
        entityId: input.id,
        action: 'INVENTORY_ITEM_UPDATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: {
          name: input.name,
          unitOfMeasureId: input.unitOfMeasureId,
          productCategoryId: input.productCategoryId,
          hsnSac: input.hsnSac,
          defaultRateAmount: input.defaultRateAmount,
          isStockTracked: input.isStockTracked,
        },
      });

      const updated = await tx.inventoryItem.findFirstOrThrow({ where: { id: input.id }, include: itemInclude });
      return toRecord(updated);
    });
  }

  async setActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.inventoryItem.updateMany({
        where: { id: input.id, organizationId: input.organizationId, deletedAt: null, version: input.expectedVersion },
        data: { isActive: input.isActive, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'INVENTORY_ITEM',
        entityId: input.id,
        action: input.isActive ? 'INVENTORY_ITEM_ACTIVATED' : 'INVENTORY_ITEM_DEACTIVATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }
}
