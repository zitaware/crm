import { Injectable } from '@nestjs/common';
import { generateId, recordAuditEvent, Prisma, type PrismaClient } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type { MasterCatalogEntry, MasterPort, MasterRecord, MasterTypeKey } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';

interface FlatMasterRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
}

/**
 * Every table behind MasterTypeKey shares an identical column shape (see
 * schema.prisma's InternalDepartment doc comment), so one structural
 * delegate interface covers all of them. Prisma's generated delegate types
 * differ per model (distinct Where/Data input types) even though the
 * underlying columns are the same, so DELEGATES below carries a single,
 * contained `as unknown as` cast rather than scattering `any` — or a
 * switch-case per operation — across every method as the registry grows
 * (2.8 adds four more tables to this same list).
 */
interface FlatMasterDelegate {
  findMany(args: {
    where: Record<string, unknown>;
    orderBy: Array<Record<string, 'asc' | 'desc'>>;
  }): Promise<FlatMasterRow[]>;
  findFirstOrThrow(args: { where: Record<string, unknown> }): Promise<FlatMasterRow>;
  create(args: { data: Record<string, unknown> }): Promise<FlatMasterRow>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

const MASTER_TYPES: MasterTypeKey[] = [
  'internal_departments',
  'designations',
  'employment_types',
  'government_body_types',
  'client_types',
  'lead_types',
  'lead_sources',
  'tender_portals',
  'project_types',
  'security_instrument_purposes',
  'security_instrument_types',
  'document_categories',
  'expense_categories',
  'units_of_measure',
  'product_categories',
  'allocation_targets',
];

type MastersDbClient = PrismaClient | Prisma.TransactionClient;

function getDelegate(client: MastersDbClient, type: MasterTypeKey): FlatMasterDelegate {
  const delegatesByType: Record<MasterTypeKey, unknown> = {
    internal_departments: client.internalDepartment,
    designations: client.designation,
    employment_types: client.employmentType,
    government_body_types: client.governmentBodyType,
    client_types: client.clientType,
    lead_types: client.leadType,
    lead_sources: client.leadSource,
    tender_portals: client.tenderPortal,
    project_types: client.projectType,
    security_instrument_purposes: client.securityInstrumentPurpose,
    security_instrument_types: client.securityInstrumentType,
    document_categories: client.documentCategory,
    expense_categories: client.expenseCategory,
    units_of_measure: client.unitOfMeasure,
    product_categories: client.productCategory,
    allocation_targets: client.allocationTarget,
  };
  return delegatesByType[type] as FlatMasterDelegate;
}

function toMasterRecord(row: FlatMasterRow): MasterRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    version: row.version,
  };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

@Injectable()
export class MastersService implements MasterPort {
  constructor(private readonly prisma: PrismaService) {}

  async getCatalog(input: { organizationId: string }): Promise<MasterCatalogEntry[]> {
    // Count non-deleted rows per master type for the catalogue tiles. Runs
    // one count per delegate; the set is fixed (12) and small, and these are
    // lookup tables, so a parallel fan-out is well within budget.
    const counts = await Promise.all(
      MASTER_TYPES.map(async (type) => ({
        type,
        count: await getDelegate(this.prisma.client, type).count({
          where: { organizationId: input.organizationId, deletedAt: null },
        }),
      })),
    );
    return counts;
  }

  async list(input: {
    organizationId: string;
    type: MasterTypeKey;
    includeInactive: boolean | undefined;
  }): Promise<MasterRecord[]> {
    const where = {
      organizationId: input.organizationId,
      deletedAt: null,
      ...(input.includeInactive ? {} : { isActive: true }),
    };
    const rows = await getDelegate(this.prisma.client, input.type).findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toMasterRecord);
  }

  async create(input: {
    organizationId: string;
    type: MasterTypeKey;
    code: string;
    name: string;
    description: string | undefined;
    sortOrder: number | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<MasterRecord> {
    const id = generateId();
    const data = {
      id,
      organizationId: input.organizationId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? 0,
      createdBy: input.actorId,
    };

    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const row = await getDelegate(tx, input.type).create({ data });
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: input.type.toUpperCase(),
          entityId: row.id,
          action: 'MASTER_CREATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { code: input.code, name: input.name },
        });
        return row;
      });
      return toMasterRecord(created);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'A record with this code or name already exists.');
      }
      throw error;
    }
  }

  async update(input: {
    organizationId: string;
    type: MasterTypeKey;
    id: string;
    name: string | undefined;
    description: string | undefined;
    sortOrder: number | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<MasterRecord> {
    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

    try {
      const updated = await this.prisma.client.$transaction(async (tx) => {
        const delegate = getDelegate(tx, input.type);
        const where = { id: input.id, organizationId: input.organizationId, version: input.expectedVersion };
        const { count } = await delegate.updateMany({ where, data });
        if (count === 0) {
          throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
        }

        const row = await delegate.findFirstOrThrow({
          where: { id: input.id, organizationId: input.organizationId },
        });
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: input.type.toUpperCase(),
          entityId: row.id,
          action: 'MASTER_UPDATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { name: input.name, description: input.description, sortOrder: input.sortOrder },
        });
        return row;
      });
      return toMasterRecord(updated);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'A record with this name already exists.');
      }
      throw error;
    }
  }

  async setActive(input: {
    organizationId: string;
    type: MasterTypeKey;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    const data = { isActive: input.isActive, updatedBy: input.actorId, version: { increment: 1 } };

    await this.prisma.client.$transaction(async (tx) => {
      const where = { id: input.id, organizationId: input.organizationId, version: input.expectedVersion };
      const { count } = await getDelegate(tx, input.type).updateMany({ where, data });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: input.type.toUpperCase(),
        entityId: input.id,
        action: input.isActive ? 'MASTER_ACTIVATED' : 'MASTER_DEACTIVATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }
}
