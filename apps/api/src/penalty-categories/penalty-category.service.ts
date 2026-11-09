import { Injectable } from '@nestjs/common';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type { PenaltyCategoryPort, PenaltyCategoryRecord } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';

interface PenaltyCategoryRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  basisType: string | null;
  acceptedLedgerAccountId: string | null;
  disputedLedgerAccountId: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
}

function toRecord(row: PenaltyCategoryRow): PenaltyCategoryRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    basisType: row.basisType,
    acceptedLedgerAccountId: row.acceptedLedgerAccountId,
    disputedLedgerAccountId: row.disputedLedgerAccountId,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    version: row.version,
  };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

/**
 * Dedicated CRUD for penalty categories — kept out of the generic
 * MastersService because the table carries an extra `basis_type` column the
 * identical-shape FlatMasterDelegate cannot represent (ADR-037/044). Same
 * lifecycle mechanics as MastersService: create/update/deactivate, audit
 * events, normalized-name uniqueness, optimistic concurrency.
 */
@Injectable()
export class PenaltyCategoryService implements PenaltyCategoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async getCount(input: { organizationId: string }): Promise<number> {
    return this.prisma.client.penaltyCategory.count({
      where: { organizationId: input.organizationId, deletedAt: null },
    });
  }

  async list(input: { organizationId: string; includeInactive: boolean | undefined }): Promise<PenaltyCategoryRecord[]> {
    const rows = await this.prisma.client.penaltyCategory.findMany({
      where: {
        organizationId: input.organizationId,
        deletedAt: null,
        ...(input.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async create(input: {
    organizationId: string;
    code: string;
    name: string;
    description: string | undefined;
    basisType: string | undefined;
    acceptedLedgerAccountId: string | undefined;
    disputedLedgerAccountId: string | undefined;
    sortOrder: number | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<PenaltyCategoryRecord> {
    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.penaltyCategory.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            code: input.code,
            name: input.name,
            description: input.description ?? null,
            basisType: input.basisType ?? null,
            acceptedLedgerAccountId: input.acceptedLedgerAccountId ?? null,
            disputedLedgerAccountId: input.disputedLedgerAccountId ?? null,
            sortOrder: input.sortOrder ?? 0,
            createdBy: input.actorId,
          },
        });
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'PENALTY_CATEGORY',
          entityId: row.id,
          action: 'MASTER_CREATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { code: input.code, name: input.name, basisType: input.basisType },
        });
        return row;
      });
      return toRecord(created);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'A penalty category with this code or name already exists.');
      }
      throw error;
    }
  }

  async update(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    description: string | undefined;
    basisType: string | undefined;
    acceptedLedgerAccountId: string | undefined;
    disputedLedgerAccountId: string | undefined;
    sortOrder: number | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<PenaltyCategoryRecord> {
    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.basisType !== undefined) data.basisType = input.basisType;
    if (input.acceptedLedgerAccountId !== undefined) data.acceptedLedgerAccountId = input.acceptedLedgerAccountId;
    if (input.disputedLedgerAccountId !== undefined) data.disputedLedgerAccountId = input.disputedLedgerAccountId;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

    try {
      const updated = await this.prisma.client.$transaction(async (tx) => {
        const { count } = await tx.penaltyCategory.updateMany({
          where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
          data,
        });
        if (count === 0) {
          throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
        }
        const row = await tx.penaltyCategory.findFirstOrThrow({
          where: { id: input.id, organizationId: input.organizationId },
        });
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'PENALTY_CATEGORY',
          entityId: row.id,
          action: 'MASTER_UPDATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: {
            name: input.name,
            description: input.description,
            basisType: input.basisType,
            sortOrder: input.sortOrder,
          },
        });
        return row;
      });
      return toRecord(updated);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'A penalty category with this name already exists.');
      }
      throw error;
    }
  }

  async setActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    const data = { isActive: input.isActive, updatedBy: input.actorId, version: { increment: 1 } };
    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.penaltyCategory.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data,
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'PENALTY_CATEGORY',
        entityId: input.id,
        action: input.isActive ? 'MASTER_ACTIVATED' : 'MASTER_DEACTIVATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }
}
