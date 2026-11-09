import { Injectable } from '@nestjs/common';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  DocumentSupportPort,
  EntityTypeSummary,
  PenaltyCategorySummary,
  PaymentModeSummary,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isConstraintViolation } from '../organization/constraint-error.util';

interface PenaltyCategoryRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  basisType: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
}

interface PaymentModeRow {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  requiresReferenceNumber: boolean;
  requiresBankSource: boolean;
  requiresCardSource: boolean;
  isCashLike: boolean;
  isElectronic: boolean;
  version: number;
}

function toPenaltyCategorySummary(row: PenaltyCategoryRow): PenaltyCategorySummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    basisType: row.basisType,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    version: row.version,
  };
}

function toPaymentModeSummary(row: PaymentModeRow): PaymentModeSummary {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    requiresReferenceNumber: row.requiresReferenceNumber,
    requiresBankSource: row.requiresBankSource,
    requiresCardSource: row.requiresCardSource,
    isCashLike: row.isCashLike,
    isElectronic: row.isElectronic,
    version: row.version,
  };
}

@Injectable()
export class DocumentSupportService implements DocumentSupportPort {
  constructor(private readonly prisma: PrismaService) {}

  async listEntityTypes(): Promise<EntityTypeSummary[]> {
    const rows = await this.prisma.client.entityType.findMany({ orderBy: { code: 'asc' } });
    return rows.map((row) => ({ code: row.code, description: row.description }));
  }

  async listDocumentCategoryEntityTypes(input: { documentCategoryId: string }): Promise<string[]> {
    const rows = await this.prisma.client.documentCategoryEntityType.findMany({
      where: { documentCategoryId: input.documentCategoryId },
    });
    return rows.map((row) => row.entityTypeCode);
  }

  async setDocumentCategoryEntityTypes(input: {
    organizationId: string;
    documentCategoryId: string;
    entityTypeCodes: string[];
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.documentCategoryEntityType.deleteMany({
        where: { documentCategoryId: input.documentCategoryId },
      });
      for (const entityTypeCode of input.entityTypeCodes) {
        await tx.documentCategoryEntityType.create({
          data: { documentCategoryId: input.documentCategoryId, entityTypeCode },
        });
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'DOCUMENT_CATEGORY',
        entityId: input.documentCategoryId,
        action: 'DOCUMENT_CATEGORY_ENTITY_TYPES_SET',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { entityTypeCodes: input.entityTypeCodes },
      });
    });
  }

  async listPenaltyCategories(input: {
    organizationId: string;
    includeInactive: boolean | undefined;
  }): Promise<PenaltyCategorySummary[]> {
    const rows = await this.prisma.client.penaltyCategory.findMany({
      where: {
        organizationId: input.organizationId,
        deletedAt: null,
        ...(input.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toPenaltyCategorySummary);
  }

  async createPenaltyCategory(input: {
    organizationId: string;
    code: string;
    name: string;
    description: string | undefined;
    basisType: string | undefined;
    sortOrder: number | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<PenaltyCategorySummary> {
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
          newValues: { code: input.code, name: input.name },
        });
        return row;
      });
      return toPenaltyCategorySummary(created);
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'A penalty category with this code or name already exists.');
      }
      throw error;
    }
  }

  async updatePenaltyCategory(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    description: string | undefined;
    basisType: string | undefined;
    sortOrder: number | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<PenaltyCategorySummary> {
    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.basisType !== undefined) data.basisType = input.basisType;
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
          newValues: { name: input.name, description: input.description, basisType: input.basisType },
        });
        return row;
      });
      return toPenaltyCategorySummary(updated);
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'A penalty category with this name already exists.');
      }
      throw error;
    }
  }

  async setPenaltyCategoryActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.penaltyCategory.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: { isActive: input.isActive, updatedBy: input.actorId, version: { increment: 1 } },
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

  async listPaymentModes(input: { includeInactive: boolean | undefined }): Promise<PaymentModeSummary[]> {
    const rows = await this.prisma.client.paymentMode.findMany({
      where: input.includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
    return rows.map(toPaymentModeSummary);
  }

  async updatePaymentMode(input: {
    organizationId: string;
    id: string;
    label: string | undefined;
    sortOrder: number | undefined;
    isActive: boolean | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<PaymentModeSummary> {
    const data: Record<string, unknown> = { version: { increment: 1 } };
    if (input.label !== undefined) data.label = input.label;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.paymentMode.updateMany({
        where: { id: input.id, version: input.expectedVersion },
        data,
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      const row = await tx.paymentMode.findFirstOrThrow({ where: { id: input.id } });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'PAYMENT_MODE',
        entityId: row.id,
        action: 'MASTER_UPDATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { label: input.label, sortOrder: input.sortOrder, isActive: input.isActive },
      });
      return row;
    });
    return toPaymentModeSummary(updated);
  }
}
