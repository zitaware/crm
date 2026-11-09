import { Injectable } from '@nestjs/common';
import type { Prisma } from '@zitaware/database';
import type { AuditPort, AuditEventFilters, AuditEventSummary } from '@zitaware/contracts';
import { throwAppError } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';

interface AuditEventRow {
  id: string;
  organizationId: string;
  legalEntityId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string | null;
  actorEmail: string | null;
  oldValues: unknown;
  newValues: unknown;
  commandPayload: unknown;
  reason: string | null;
  correlationId: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

function toSummary(row: AuditEventRow): AuditEventSummary {
  return {
    id: row.id,
    organizationId: row.organizationId,
    legalEntityId: row.legalEntityId,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    actorId: row.actorId,
    actorEmail: row.actorEmail,
    oldValues: row.oldValues,
    newValues: row.newValues,
    commandPayload: row.commandPayload,
    reason: row.reason,
    correlationId: row.correlationId,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  };
}

function buildWhere(organizationId: string, filters: AuditEventFilters): Prisma.AuditEventWhereInput {
  const where: Prisma.AuditEventWhereInput = { organizationId };
  if (filters.actorEmail) {
    where.actorEmail = { contains: filters.actorEmail, mode: 'insensitive' };
  }
  if (filters.entityType) {
    where.entityType = filters.entityType;
  }
  if (filters.action) {
    where.action = filters.action;
  }
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) } : {}),
      ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) } : {}),
    };
  }
  return where;
}

@Injectable()
export class AuditService implements AuditPort {
  constructor(private readonly prisma: PrismaService) {}

  async list(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: AuditEventFilters;
  }): Promise<{ rows: AuditEventSummary[]; total: number }> {
    const where = buildWhere(input.organizationId, input.filters);
    const [rows, total] = await Promise.all([
      this.prisma.client.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.client.auditEvent.count({ where }),
    ]);
    return { rows: rows.map(toSummary), total };
  }

  async getById(input: { organizationId: string; id: string }): Promise<AuditEventSummary> {
    const row = await this.prisma.client.auditEvent.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
    });
    if (!row) throwAppError('NOT_FOUND', 'Audit event not found.');
    return toSummary(row);
  }

  async listEntityTypes(input: { organizationId: string }): Promise<string[]> {
    const rows = await this.prisma.client.auditEvent.findMany({
      where: { organizationId: input.organizationId },
      distinct: ['entityType'],
      select: { entityType: true },
      orderBy: { entityType: 'asc' },
    });
    return rows.map((row) => row.entityType);
  }

  async listActions(input: { organizationId: string }): Promise<string[]> {
    const rows = await this.prisma.client.auditEvent.findMany({
      where: { organizationId: input.organizationId },
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    });
    return rows.map((row) => row.action);
  }
}
