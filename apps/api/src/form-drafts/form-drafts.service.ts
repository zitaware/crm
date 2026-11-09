import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateId } from '@zitaware/database';
import { throwAppError, type FormDraftPort } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';

const MAX_PAYLOAD_CHARS = 1_500_000;

@Injectable()
export class FormDraftsService implements FormDraftPort {
  constructor(private readonly prisma: PrismaService) {}

  async get(input: { organizationId: string; userId: string; formKey: string }): Promise<{ payload: Record<string, unknown> | null }> {
    const row = await this.prisma.client.formDraft.findUnique({
      where: { organizationId_userId_formKey: { organizationId: input.organizationId, userId: input.userId, formKey: input.formKey } },
    });
    const payload = row?.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { payload: null };
    return { payload: payload };
  }

  async save(input: { organizationId: string; userId: string; formKey: string; payload: Record<string, unknown> }): Promise<void> {
    const encoded = JSON.stringify(input.payload);
    if (encoded.length > MAX_PAYLOAD_CHARS) throwAppError('VALIDATION_FAILED', 'This draft is too large to store.');
    await this.prisma.client.formDraft.upsert({
      where: { organizationId_userId_formKey: { organizationId: input.organizationId, userId: input.userId, formKey: input.formKey } },
      create: {
        id: generateId(),
        organizationId: input.organizationId,
        userId: input.userId,
        formKey: input.formKey,
        payload: input.payload as Prisma.InputJsonValue,
      },
      update: { payload: input.payload as Prisma.InputJsonValue },
    });
  }

  async clear(input: { organizationId: string; userId: string; formKey: string }): Promise<void> {
    await this.prisma.client.formDraft.deleteMany({
      where: { organizationId: input.organizationId, userId: input.userId, formKey: input.formKey },
    });
  }
}
