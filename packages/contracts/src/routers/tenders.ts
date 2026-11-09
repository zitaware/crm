import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const decimalStringSchema = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Must be a valid decimal amount.');
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');
const submissionStatusSchema = z.enum(['IDENTIFIED', 'IN_PREPARATION', 'SUBMITTED', 'NOT_PURSUED']);
const resultSchema = z.enum(['PENDING', 'WON', 'LOST', 'CANCELLED']);
const reminderOffsetSchema = z.enum(['NONE', 'ONE_DAY', 'THREE_DAYS', 'ONE_WEEK']);

export const tendersRouter = router({
  list: requirePermission('tender.read').query(async ({ ctx }) => {
    return ctx.services.tenders.list({ organizationId: ctx.auth.user!.organizationId });
  }),

  getDetail: requirePermission('tender.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.tenders.getDetail({ organizationId: ctx.auth.user!.organizationId, id: input.id });
    }),

  create: requirePermission('tender.create')
    .input(
      z.object({
        clientId: z.string().uuid(),
        leadId: z.string().uuid().optional(),
        tenderPortalId: z.string().uuid().optional(),
        tenderNumber: z.string().min(1).max(100),
        title: z.string().min(1).max(300),
        description: z.string().max(2000).optional(),
        submissionStatus: submissionStatusSchema.optional(),
        result: resultSchema.optional(),
        estimatedValue: decimalStringSchema.optional(),
        tenderDate: dateStringSchema,
        submissionDeadline: dateStringSchema.optional(),
        submittedDate: dateStringSchema.optional(),
        resultDate: dateStringSchema.optional(),
        reminderOffset: reminderOffsetSchema.optional(),
        internalNote: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.tenders.create({
        organizationId: ctx.auth.user!.organizationId,
        clientId: input.clientId,
        leadId: input.leadId,
        tenderPortalId: input.tenderPortalId,
        tenderNumber: input.tenderNumber,
        title: input.title,
        description: input.description,
        submissionStatus: input.submissionStatus,
        result: input.result,
        estimatedValue: input.estimatedValue,
        tenderDate: input.tenderDate,
        submissionDeadline: input.submissionDeadline,
        submittedDate: input.submittedDate,
        resultDate: input.resultDate,
        reminderOffset: input.reminderOffset,
        internalNote: input.internalNote,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  update: requirePermission('tender.update')
    .input(
      z.object({
        id: z.string().uuid(),
        leadId: z.string().uuid().optional(),
        tenderPortalId: z.string().uuid().optional(),
        assignedToEmployeeId: z.string().uuid().optional(),
        tenderNumber: z.string().min(1).max(100).optional(),
        title: z.string().min(1).max(300).optional(),
        description: z.string().max(2000).optional(),
        submissionStatus: submissionStatusSchema.optional(),
        result: resultSchema.optional(),
        estimatedValue: decimalStringSchema.optional(),
        tenderDate: dateStringSchema.optional(),
        submissionDeadline: dateStringSchema.optional(),
        submittedDate: dateStringSchema.optional(),
        resultDate: dateStringSchema.optional(),
        reminderOffset: reminderOffsetSchema.optional(),
        internalNote: z.string().max(2000).optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.tenders.update({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        leadId: input.leadId,
        tenderPortalId: input.tenderPortalId,
        assignedToEmployeeId: input.assignedToEmployeeId,
        tenderNumber: input.tenderNumber,
        title: input.title,
        description: input.description,
        submissionStatus: input.submissionStatus,
        result: input.result,
        estimatedValue: input.estimatedValue,
        tenderDate: input.tenderDate,
        submissionDeadline: input.submissionDeadline,
        submittedDate: input.submittedDate,
        resultDate: input.resultDate,
        reminderOffset: input.reminderOffset,
        internalNote: input.internalNote,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  listUpdates: requirePermission('tender.read')
    .input(z.object({ tenderId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.tenders.listUpdates({ organizationId: ctx.auth.user!.organizationId, tenderId: input.tenderId });
    }),

  createUpdate: requirePermission('tender.update')
    .input(z.object({ tenderId: z.string().uuid(), title: z.string().min(1).max(200), note: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.tenders.createUpdate({
        organizationId: ctx.auth.user!.organizationId,
        tenderId: input.tenderId,
        title: input.title,
        note: input.note,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),
});
