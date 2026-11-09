import { Injectable } from '@nestjs/common';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type { TenderPort, TenderSummary, TenderUpdateEntry } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isConstraintViolation } from '../organization/constraint-error.util';

const VALID_SUBMISSION_STATUSES = ['IDENTIFIED', 'IN_PREPARATION', 'SUBMITTED', 'NOT_PURSUED'];
const VALID_RESULTS = ['PENDING', 'WON', 'LOST', 'CANCELLED'];

const TENDER_INCLUDE = {
  client: true,
  tenderPortal: true,
  assignedToEmployee: true,
  updates: { orderBy: { createdAt: 'desc' as const }, take: 1 },
};

interface TenderRow {
  id: string;
  clientId: string;
  leadId: string | null;
  tenderPortalId: string | null;
  assignedToEmployeeId: string | null;
  tenderNumber: string;
  title: string;
  description: string | null;
  submissionStatus: string;
  result: string;
  estimatedValue: { toString(): string } | null;
  tenderDate: Date;
  submissionDeadline: Date | null;
  submittedDate: Date | null;
  resultDate: Date | null;
  reminderOffset: string | null;
  internalNote: string | null;
  createdAt: Date;
  version: number;
  client: { name: string };
  tenderPortal: { name: string } | null;
  assignedToEmployee: { fullName: string } | null;
  updates: Array<{ createdAt: Date }>;
}

function toDateOnly(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

function toTenderSummary(row: TenderRow): TenderSummary {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client.name,
    leadId: row.leadId,
    tenderPortalId: row.tenderPortalId,
    tenderPortalName: row.tenderPortal?.name ?? null,
    assignedToEmployeeId: row.assignedToEmployeeId,
    assignedToEmployeeName: row.assignedToEmployee?.fullName ?? null,
    tenderNumber: row.tenderNumber,
    title: row.title,
    description: row.description,
    submissionStatus: row.submissionStatus,
    result: row.result,
    estimatedValue: row.estimatedValue?.toString() ?? null,
    tenderDate: toDateOnly(row.tenderDate)!,
    submissionDeadline: toDateOnly(row.submissionDeadline),
    submittedDate: toDateOnly(row.submittedDate),
    resultDate: toDateOnly(row.resultDate),
    reminderOffset: row.reminderOffset,
    internalNote: row.internalNote,
    lastActivityAt: (row.updates[0]?.createdAt ?? row.createdAt).toISOString(),
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

@Injectable()
export class TendersService implements TenderPort {
  constructor(private readonly prisma: PrismaService) {}

  private assertValidSubmissionStatus(submissionStatus: string | undefined): void {
    if (submissionStatus !== undefined && !VALID_SUBMISSION_STATUSES.includes(submissionStatus)) {
      throwAppError(
        'VALIDATION_FAILED',
        `Invalid submission status. Must be one of: ${VALID_SUBMISSION_STATUSES.join(', ')}.`,
      );
    }
  }

  private assertValidResult(result: string | undefined): void {
    if (result !== undefined && !VALID_RESULTS.includes(result)) {
      throwAppError('VALIDATION_FAILED', `Invalid result. Must be one of: ${VALID_RESULTS.join(', ')}.`);
    }
  }

  private async assertReferencesExist(input: {
    organizationId: string;
    leadId: string | undefined;
    tenderPortalId: string | undefined;
    assignedToEmployeeId: string | undefined;
  }): Promise<void> {
    if (input.leadId) {
      const row = await this.prisma.client.lead.findFirst({
        where: { id: input.leadId, organizationId: input.organizationId },
      });
      if (!row) throwAppError('VALIDATION_FAILED', 'The selected lead does not exist.');
    }
    if (input.tenderPortalId) {
      const row = await this.prisma.client.tenderPortal.findFirst({
        where: { id: input.tenderPortalId, organizationId: input.organizationId },
      });
      if (!row) throwAppError('VALIDATION_FAILED', 'The selected tender portal does not exist.');
    }
    if (input.assignedToEmployeeId) {
      const row = await this.prisma.client.employee.findFirst({
        where: { id: input.assignedToEmployeeId, organizationId: input.organizationId },
      });
      if (!row) throwAppError('VALIDATION_FAILED', 'The selected employee does not exist.');
    }
  }

  async list(input: { organizationId: string }): Promise<TenderSummary[]> {
    const rows = await this.prisma.client.tender.findMany({
      where: { organizationId: input.organizationId },
      include: TENDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => toTenderSummary(row as TenderRow));
  }

  async getDetail(input: { organizationId: string; id: string }): Promise<TenderSummary> {
    const row = await this.prisma.client.tender.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: TENDER_INCLUDE,
    });
    if (!row) throwAppError('NOT_FOUND', 'Tender not found.');
    return toTenderSummary(row);
  }

  async create(input: {
    organizationId: string;
    clientId: string;
    leadId: string | undefined;
    tenderPortalId: string | undefined;
    tenderNumber: string;
    title: string;
    description: string | undefined;
    submissionStatus: string | undefined;
    result: string | undefined;
    estimatedValue: string | undefined;
    tenderDate: string;
    submissionDeadline: string | undefined;
    submittedDate: string | undefined;
    resultDate: string | undefined;
    reminderOffset: string | undefined;
    internalNote: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<TenderSummary> {
    this.assertValidSubmissionStatus(input.submissionStatus);
    this.assertValidResult(input.result);
    await this.assertReferencesExist({ ...input, assignedToEmployeeId: undefined });

    const client = await this.prisma.client.party.findFirst({
      where: { id: input.clientId, organizationId: input.organizationId, deletedAt: null, clientProfile: { isNot: null } },
    });
    if (!client) throwAppError('VALIDATION_FAILED', 'The selected client does not exist.');

    const assignedEmployee = await this.prisma.client.employee.findFirst({
      where: { organizationId: input.organizationId, userId: input.actorId },
    });

    try {
      const tenderId = await this.prisma.client.$transaction(async (tx) => {
        const tender = await tx.tender.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            clientId: input.clientId,
            leadId: input.leadId ?? null,
            tenderPortalId: input.tenderPortalId ?? null,
            assignedToEmployeeId: assignedEmployee?.id ?? null,
            tenderNumber: input.tenderNumber,
            title: input.title,
            description: input.description ?? null,
            submissionStatus: input.submissionStatus ?? 'IDENTIFIED',
            result: input.result ?? 'PENDING',
            estimatedValue: input.estimatedValue ?? null,
            tenderDate: new Date(`${input.tenderDate}T00:00:00.000Z`),
            submissionDeadline: input.submissionDeadline ? new Date(`${input.submissionDeadline}T00:00:00.000Z`) : null,
            submittedDate: input.submittedDate ? new Date(`${input.submittedDate}T00:00:00.000Z`) : null,
            resultDate: input.resultDate ? new Date(`${input.resultDate}T00:00:00.000Z`) : null,
            reminderOffset: input.reminderOffset ?? null,
            internalNote: input.internalNote ?? null,
            createdBy: input.actorId,
          },
        });
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'TENDER',
          entityId: tender.id,
          action: 'TENDER_CREATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { tenderNumber: input.tenderNumber, title: input.title, clientId: input.clientId },
        });
        return tender.id;
      });
      return this.getDetail({ organizationId: input.organizationId, id: tenderId });
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'Invalid tender data.');
      }
      throw error;
    }
  }

  async update(input: {
    organizationId: string;
    id: string;
    leadId: string | undefined;
    tenderPortalId: string | undefined;
    assignedToEmployeeId: string | undefined;
    tenderNumber: string | undefined;
    title: string | undefined;
    description: string | undefined;
    submissionStatus: string | undefined;
    result: string | undefined;
    estimatedValue: string | undefined;
    tenderDate: string | undefined;
    submissionDeadline: string | undefined;
    submittedDate: string | undefined;
    resultDate: string | undefined;
    reminderOffset: string | undefined;
    internalNote: string | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<TenderSummary> {
    this.assertValidSubmissionStatus(input.submissionStatus);
    this.assertValidResult(input.result);
    await this.assertReferencesExist(input);

    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.leadId !== undefined) data.leadId = input.leadId;
    if (input.tenderPortalId !== undefined) data.tenderPortalId = input.tenderPortalId;
    if (input.assignedToEmployeeId !== undefined) data.assignedToEmployeeId = input.assignedToEmployeeId;
    if (input.tenderNumber !== undefined) data.tenderNumber = input.tenderNumber;
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.submissionStatus !== undefined) data.submissionStatus = input.submissionStatus;
    if (input.result !== undefined) data.result = input.result;
    if (input.estimatedValue !== undefined) data.estimatedValue = input.estimatedValue;
    if (input.tenderDate !== undefined) data.tenderDate = new Date(`${input.tenderDate}T00:00:00.000Z`);
    if (input.submissionDeadline !== undefined) {
      data.submissionDeadline = input.submissionDeadline ? new Date(`${input.submissionDeadline}T00:00:00.000Z`) : null;
    }
    if (input.submittedDate !== undefined) {
      data.submittedDate = input.submittedDate ? new Date(`${input.submittedDate}T00:00:00.000Z`) : null;
    }
    if (input.resultDate !== undefined) {
      data.resultDate = input.resultDate ? new Date(`${input.resultDate}T00:00:00.000Z`) : null;
    }
    if (input.reminderOffset !== undefined) data.reminderOffset = input.reminderOffset;
    if (input.internalNote !== undefined) data.internalNote = input.internalNote;

    try {
      await this.prisma.client.$transaction(async (tx) => {
        const before = await tx.tender.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
        if (!before) throwAppError('NOT_FOUND', 'Tender not found.');

        const { count } = await tx.tender.updateMany({
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
        track('submissionStatus', before.submissionStatus, input.submissionStatus, input.submissionStatus !== undefined);
        track('result', before.result, input.result, input.result !== undefined);
        track('tenderPortalId', before.tenderPortalId, input.tenderPortalId, input.tenderPortalId !== undefined);
        track(
          'assignedToEmployeeId',
          before.assignedToEmployeeId,
          input.assignedToEmployeeId,
          input.assignedToEmployeeId !== undefined,
        );
        track('estimatedValue', before.estimatedValue?.toString(), input.estimatedValue, input.estimatedValue !== undefined);

        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'TENDER',
          entityId: input.id,
          action: 'TENDER_UPDATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          oldValues,
          newValues,
        });
      });
      return this.getDetail({ organizationId: input.organizationId, id: input.id });
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'Invalid tender data.');
      }
      throw error;
    }
  }

  async listUpdates(input: { organizationId: string; tenderId: string }): Promise<TenderUpdateEntry[]> {
    const rows = await this.prisma.client.tenderUpdate.findMany({
      where: { organizationId: input.organizationId, tenderId: input.tenderId },
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
    tenderId: string;
    title: string;
    note: string;
    actorId: string;
    correlationId: string;
  }): Promise<TenderUpdateEntry> {
    const tender = await this.prisma.client.tender.findFirst({
      where: { id: input.tenderId, organizationId: input.organizationId },
    });
    if (!tender) throwAppError('NOT_FOUND', 'Tender not found.');

    return this.prisma.client.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: input.actorId }, select: { email: true } });
      const row = await tx.tenderUpdate.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          tenderId: input.tenderId,
          title: input.title,
          note: input.note,
          createdBy: input.actorId,
          createdByEmail: actor?.email ?? null,
        },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'TENDER',
        entityId: input.tenderId,
        action: 'TENDER_UPDATE_ADDED',
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
