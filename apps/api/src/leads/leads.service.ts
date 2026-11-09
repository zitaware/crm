import { Injectable } from '@nestjs/common';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type { LeadPort, LeadSummary, LeadUpdateEntry } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isConstraintViolation } from '../organization/constraint-error.util';

const VALID_STAGES = [
  'PROPOSAL_SENT',
  'PRESENTATION_DONE',
  'SOW_PREPARATION',
  'TENDER_LIVE',
  'TENDER_FILLED',
  'TENDER_WON',
  'TENDER_LOST',
];

const LEAD_INCLUDE = {
  client: true,
  leadType: true,
  leadSource: true,
  introducer: true,
  assignedToEmployee: true,
  updates: { orderBy: { createdAt: 'desc' as const }, take: 1 },
};

interface LeadRow {
  id: string;
  clientId: string;
  leadTypeId: string;
  leadSourceId: string;
  introducerId: string | null;
  assignedToEmployeeId: string | null;
  title: string;
  description: string | null;
  stage: string;
  estimatedValue: { toString(): string } | null;
  leadDate: Date;
  expectedCloseDate: Date | null;
  expectedTenderDate: Date | null;
  tenderNumber: string | null;
  tenderDate: Date | null;
  submissionDeadline: Date | null;
  reminderOffset: string | null;
  internalNote: string | null;
  createdAt: Date;
  version: number;
  client: { name: string };
  leadType: { name: string };
  leadSource: { name: string };
  introducer: { name: string } | null;
  assignedToEmployee: { fullName: string } | null;
  updates: Array<{ createdAt: Date }>;
}

function toDateOnly(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

function toLeadSummary(row: LeadRow): LeadSummary {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client.name,
    leadTypeId: row.leadTypeId,
    leadTypeName: row.leadType.name,
    leadSourceId: row.leadSourceId,
    leadSourceName: row.leadSource.name,
    introducerId: row.introducerId,
    introducerName: row.introducer?.name ?? null,
    assignedToEmployeeId: row.assignedToEmployeeId,
    assignedToEmployeeName: row.assignedToEmployee?.fullName ?? null,
    title: row.title,
    description: row.description,
    stage: row.stage,
    estimatedValue: row.estimatedValue?.toString() ?? null,
    leadDate: toDateOnly(row.leadDate)!,
    expectedCloseDate: toDateOnly(row.expectedCloseDate),
    expectedTenderDate: toDateOnly(row.expectedTenderDate),
    tenderNumber: row.tenderNumber,
    tenderDate: toDateOnly(row.tenderDate),
    submissionDeadline: toDateOnly(row.submissionDeadline),
    reminderOffset: row.reminderOffset,
    internalNote: row.internalNote,
    lastActivityAt: (row.updates[0]?.createdAt ?? row.createdAt).toISOString(),
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

@Injectable()
export class LeadsService implements LeadPort {
  constructor(private readonly prisma: PrismaService) {}

  private assertValidStage(stage: string | undefined): void {
    if (stage !== undefined && !VALID_STAGES.includes(stage)) {
      throwAppError('VALIDATION_FAILED', `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}.`);
    }
  }

  private async assertReferencesExist(input: {
    organizationId: string;
    leadTypeId: string | undefined;
    leadSourceId: string | undefined;
    introducerId: string | undefined;
    assignedToEmployeeId: string | undefined;
  }): Promise<void> {
    if (input.leadTypeId !== undefined) {
      const row = await this.prisma.client.leadType.findFirst({
        where: { id: input.leadTypeId, organizationId: input.organizationId },
      });
      if (!row) throwAppError('VALIDATION_FAILED', 'The selected lead type does not exist.');
    }
    if (input.leadSourceId !== undefined) {
      const row = await this.prisma.client.leadSource.findFirst({
        where: { id: input.leadSourceId, organizationId: input.organizationId },
      });
      if (!row) throwAppError('VALIDATION_FAILED', 'The selected lead source does not exist.');
    }
    if (input.introducerId) {
      const row = await this.prisma.client.introducer.findFirst({
        where: { id: input.introducerId, organizationId: input.organizationId },
      });
      if (!row) throwAppError('VALIDATION_FAILED', 'The selected introducer does not exist.');
    }
    if (input.assignedToEmployeeId) {
      const row = await this.prisma.client.employee.findFirst({
        where: { id: input.assignedToEmployeeId, organizationId: input.organizationId },
      });
      if (!row) throwAppError('VALIDATION_FAILED', 'The selected employee does not exist.');
    }
  }

  async list(input: { organizationId: string }): Promise<LeadSummary[]> {
    const rows = await this.prisma.client.lead.findMany({
      where: { organizationId: input.organizationId },
      include: LEAD_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => toLeadSummary(row as LeadRow));
  }

  async getDetail(input: { organizationId: string; id: string }): Promise<LeadSummary> {
    const row = await this.prisma.client.lead.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: LEAD_INCLUDE,
    });
    if (!row) throwAppError('NOT_FOUND', 'Lead not found.');
    return toLeadSummary(row);
  }

  async create(input: {
    organizationId: string;
    clientId: string;
    leadTypeId: string;
    leadSourceId: string;
    introducerId: string | undefined;
    title: string;
    description: string | undefined;
    stage: string | undefined;
    estimatedValue: string | undefined;
    leadDate: string;
    expectedCloseDate: string | undefined;
    expectedTenderDate: string | undefined;
    tenderNumber: string | undefined;
    tenderDate: string | undefined;
    submissionDeadline: string | undefined;
    reminderOffset: string | undefined;
    internalNote: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<LeadSummary> {
    this.assertValidStage(input.stage);
    await this.assertReferencesExist({ ...input, assignedToEmployeeId: undefined });

    const client = await this.prisma.client.party.findFirst({
      where: { id: input.clientId, organizationId: input.organizationId, deletedAt: null, clientProfile: { isNot: null } },
    });
    if (!client) throwAppError('VALIDATION_FAILED', 'The selected client does not exist.');

    const assignedEmployee = await this.prisma.client.employee.findFirst({
      where: { organizationId: input.organizationId, userId: input.actorId },
    });

    try {
      const leadId = await this.prisma.client.$transaction(async (tx) => {
        const lead = await tx.lead.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            clientId: input.clientId,
            leadTypeId: input.leadTypeId,
            leadSourceId: input.leadSourceId,
            introducerId: input.introducerId ?? null,
            assignedToEmployeeId: assignedEmployee?.id ?? null,
            title: input.title,
            description: input.description ?? null,
            stage: input.stage ?? 'PROPOSAL_SENT',
            estimatedValue: input.estimatedValue ?? null,
            leadDate: new Date(`${input.leadDate}T00:00:00.000Z`),
            expectedCloseDate: input.expectedCloseDate ? new Date(`${input.expectedCloseDate}T00:00:00.000Z`) : null,
            expectedTenderDate: input.expectedTenderDate ? new Date(`${input.expectedTenderDate}T00:00:00.000Z`) : null,
            tenderNumber: input.tenderNumber?.trim() ? input.tenderNumber.trim() : null,
            tenderDate: input.tenderDate ? new Date(`${input.tenderDate}T00:00:00.000Z`) : null,
            submissionDeadline: input.submissionDeadline ? new Date(`${input.submissionDeadline}T00:00:00.000Z`) : null,
            reminderOffset: input.reminderOffset ?? null,
            internalNote: input.internalNote ?? null,
            createdBy: input.actorId,
          },
        });
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'LEAD',
          entityId: lead.id,
          action: 'LEAD_CREATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { title: input.title, clientId: input.clientId, stage: lead.stage },
        });
        return lead.id;
      });
      return this.getDetail({ organizationId: input.organizationId, id: leadId });
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'Invalid lead data.');
      }
      throw error;
    }
  }

  async update(input: {
    organizationId: string;
    id: string;
    leadTypeId: string | undefined;
    leadSourceId: string | undefined;
    introducerId: string | undefined;
    assignedToEmployeeId: string | undefined;
    title: string | undefined;
    description: string | undefined;
    stage: string | undefined;
    estimatedValue: string | undefined;
    leadDate: string | undefined;
    expectedCloseDate: string | undefined;
    expectedTenderDate: string | undefined;
    tenderNumber: string | undefined;
    tenderDate: string | undefined;
    submissionDeadline: string | undefined;
    reminderOffset: string | undefined;
    internalNote: string | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<LeadSummary> {
    this.assertValidStage(input.stage);
    await this.assertReferencesExist(input);

    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.leadTypeId !== undefined) data.leadTypeId = input.leadTypeId;
    if (input.leadSourceId !== undefined) data.leadSourceId = input.leadSourceId;
    if (input.introducerId !== undefined) data.introducerId = input.introducerId;
    if (input.assignedToEmployeeId !== undefined) data.assignedToEmployeeId = input.assignedToEmployeeId;
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.stage !== undefined) data.stage = input.stage;
    if (input.estimatedValue !== undefined) data.estimatedValue = input.estimatedValue;
    if (input.leadDate !== undefined) data.leadDate = new Date(`${input.leadDate}T00:00:00.000Z`);
    if (input.expectedCloseDate !== undefined) {
      data.expectedCloseDate = input.expectedCloseDate ? new Date(`${input.expectedCloseDate}T00:00:00.000Z`) : null;
    }
    if (input.expectedTenderDate !== undefined) {
      data.expectedTenderDate = input.expectedTenderDate ? new Date(`${input.expectedTenderDate}T00:00:00.000Z`) : null;
    }
    if (input.tenderNumber !== undefined) data.tenderNumber = input.tenderNumber.trim() ? input.tenderNumber.trim() : null;
    if (input.tenderDate !== undefined) {
      data.tenderDate = input.tenderDate ? new Date(`${input.tenderDate}T00:00:00.000Z`) : null;
    }
    if (input.submissionDeadline !== undefined) {
      data.submissionDeadline = input.submissionDeadline ? new Date(`${input.submissionDeadline}T00:00:00.000Z`) : null;
    }
    if (input.reminderOffset !== undefined) data.reminderOffset = input.reminderOffset;
    if (input.internalNote !== undefined) data.internalNote = input.internalNote;

    try {
      await this.prisma.client.$transaction(async (tx) => {
        const before = await tx.lead.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
        if (!before) throwAppError('NOT_FOUND', 'Lead not found.');

        const { count } = await tx.lead.updateMany({
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
        track('title', before.title, input.title, input.title !== undefined);
        track('stage', before.stage, input.stage, input.stage !== undefined);
        track('leadTypeId', before.leadTypeId, input.leadTypeId, input.leadTypeId !== undefined);
        track('leadSourceId', before.leadSourceId, input.leadSourceId, input.leadSourceId !== undefined);
        track('introducerId', before.introducerId, input.introducerId, input.introducerId !== undefined);
        track(
          'assignedToEmployeeId',
          before.assignedToEmployeeId,
          input.assignedToEmployeeId,
          input.assignedToEmployeeId !== undefined,
        );
        track('estimatedValue', before.estimatedValue?.toString(), input.estimatedValue, input.estimatedValue !== undefined);

        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'LEAD',
          entityId: input.id,
          action: 'LEAD_UPDATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          oldValues,
          newValues,
        });
      });
      return this.getDetail({ organizationId: input.organizationId, id: input.id });
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'Invalid lead data.');
      }
      throw error;
    }
  }

  async listUpdates(input: { organizationId: string; leadId: string }): Promise<LeadUpdateEntry[]> {
    const rows = await this.prisma.client.leadUpdate.findMany({
      where: { organizationId: input.organizationId, leadId: input.leadId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      createdByEmail: row.createdByEmail,
    }));
  }

  async createUpdate(input: {
    organizationId: string;
    leadId: string;
    title: string;
    note: string;
    actorId: string;
    correlationId: string;
  }): Promise<LeadUpdateEntry> {
    const lead = await this.prisma.client.lead.findFirst({
      where: { id: input.leadId, organizationId: input.organizationId },
    });
    if (!lead) throwAppError('NOT_FOUND', 'Lead not found.');

    return this.prisma.client.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: input.actorId }, select: { email: true } });
      const row = await tx.leadUpdate.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          leadId: input.leadId,
          title: input.title,
          note: input.note,
          createdBy: input.actorId,
          createdByEmail: actor?.email ?? null,
        },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'LEAD',
        entityId: input.leadId,
        action: 'LEAD_UPDATE_ADDED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { title: input.title },
      });
      return {
        id: row.id,
        title: row.title,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
        createdByEmail: row.createdByEmail,
      };
    });
  }
}
