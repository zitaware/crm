import { Injectable } from '@nestjs/common';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type { IntroducerPort, IntroducerSummary } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';

interface IntroducerRow {
  id: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  version: number;
}

function toIntroducerSummary(row: IntroducerRow): IntroducerSummary {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

@Injectable()
export class IntroducersService implements IntroducerPort {
  constructor(private readonly prisma: PrismaService) {}

  async list(input: { organizationId: string; includeInactive: boolean | undefined }): Promise<IntroducerSummary[]> {
    const rows = await this.prisma.client.introducer.findMany({
      where: { organizationId: input.organizationId, ...(input.includeInactive ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
    });
    return rows.map(toIntroducerSummary);
  }

  async create(input: {
    organizationId: string;
    name: string;
    phone: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<IntroducerSummary> {
    return this.prisma.client.$transaction(async (tx) => {
      const row = await tx.introducer.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          name: input.name,
          phone: input.phone ?? null,
          createdBy: input.actorId,
        },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'INTRODUCER',
        entityId: row.id,
        action: 'INTRODUCER_CREATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { name: input.name, phone: input.phone ?? null },
      });
      return toIntroducerSummary(row);
    });
  }

  async update(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    phone: string | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<IntroducerSummary> {
    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.name !== undefined) data.name = input.name;
    if (input.phone !== undefined) data.phone = input.phone;

    return this.prisma.client.$transaction(async (tx) => {
      const before = await tx.introducer.findFirstOrThrow({
        where: { id: input.id, organizationId: input.organizationId },
      });

      const { count } = await tx.introducer.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data,
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }

      const oldValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};
      const track = (key: string, beforeValue: unknown, afterValue: unknown, touched: boolean) => {
        if (touched && beforeValue !== afterValue) {
          oldValues[key] = beforeValue;
          newValues[key] = afterValue;
        }
      };
      track('name', before.name, input.name, input.name !== undefined);
      track('phone', before.phone, input.phone, input.phone !== undefined);

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'INTRODUCER',
        entityId: input.id,
        action: 'INTRODUCER_UPDATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues,
        newValues,
      });

      const row = await tx.introducer.findFirstOrThrow({ where: { id: input.id } });
      return toIntroducerSummary(row);
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
      const { count } = await tx.introducer.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: { isActive: input.isActive, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'INTRODUCER',
        entityId: input.id,
        action: input.isActive ? 'INTRODUCER_ACTIVATED' : 'INTRODUCER_DEACTIVATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }
}
