import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const decimalStringSchema = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Must be a valid decimal amount.');
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');
const stageSchema = z.enum([
  'PROPOSAL_SENT',
  'PRESENTATION_DONE',
  'SOW_PREPARATION',
  'TENDER_LIVE',
  'TENDER_FILLED',
  'TENDER_WON',
  'TENDER_LOST',
]);
const reminderOffsetSchema = z.enum(['NONE', 'ONE_DAY', 'THREE_DAYS', 'ONE_WEEK']);

export const leadsRouter = router({
  list: requirePermission('lead.read').query(async ({ ctx }) => {
    return ctx.services.leads.list({ organizationId: ctx.auth.user!.organizationId });
  }),

  getDetail: requirePermission('lead.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.leads.getDetail({ organizationId: ctx.auth.user!.organizationId, id: input.id });
    }),

  create: requirePermission('lead.create')
    .input(
      z.object({
        clientId: z.string().uuid(),
        leadTypeId: z.string().uuid(),
        leadSourceId: z.string().uuid(),
        introducerId: z.string().uuid().optional(),
        title: z.string().min(1).max(300),
        description: z.string().max(2000).optional(),
        stage: stageSchema.optional(),
        estimatedValue: decimalStringSchema.optional(),
        leadDate: dateStringSchema,
        expectedCloseDate: dateStringSchema.optional(),
        expectedTenderDate: dateStringSchema.optional(),
        tenderNumber: z.string().max(100).optional(),
        tenderDate: z.union([dateStringSchema, z.literal('')]).optional(),
        submissionDeadline: z.union([dateStringSchema, z.literal('')]).optional(),
        reminderOffset: reminderOffsetSchema.optional(),
        internalNote: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.leads.create({
        organizationId: ctx.auth.user!.organizationId,
        clientId: input.clientId,
        leadTypeId: input.leadTypeId,
        leadSourceId: input.leadSourceId,
        introducerId: input.introducerId,
        title: input.title,
        description: input.description,
        stage: input.stage,
        estimatedValue: input.estimatedValue,
        leadDate: input.leadDate,
        expectedCloseDate: input.expectedCloseDate,
        expectedTenderDate: input.expectedTenderDate,
        tenderNumber: input.tenderNumber,
        tenderDate: input.tenderDate,
        submissionDeadline: input.submissionDeadline,
        reminderOffset: input.reminderOffset,
        internalNote: input.internalNote,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  update: requirePermission('lead.update')
    .input(
      z.object({
        id: z.string().uuid(),
        leadTypeId: z.string().uuid().optional(),
        leadSourceId: z.string().uuid().optional(),
        introducerId: z.string().uuid().optional(),
        assignedToEmployeeId: z.string().uuid().optional(),
        title: z.string().min(1).max(300).optional(),
        description: z.string().max(2000).optional(),
        stage: stageSchema.optional(),
        estimatedValue: decimalStringSchema.optional(),
        leadDate: dateStringSchema.optional(),
        expectedCloseDate: dateStringSchema.optional(),
        expectedTenderDate: dateStringSchema.optional(),
        tenderNumber: z.string().max(100).optional(),
        tenderDate: z.union([dateStringSchema, z.literal('')]).optional(),
        submissionDeadline: z.union([dateStringSchema, z.literal('')]).optional(),
        reminderOffset: reminderOffsetSchema.optional(),
        internalNote: z.string().max(2000).optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.leads.update({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        leadTypeId: input.leadTypeId,
        leadSourceId: input.leadSourceId,
        introducerId: input.introducerId,
        assignedToEmployeeId: input.assignedToEmployeeId,
        title: input.title,
        description: input.description,
        stage: input.stage,
        estimatedValue: input.estimatedValue,
        leadDate: input.leadDate,
        expectedCloseDate: input.expectedCloseDate,
        expectedTenderDate: input.expectedTenderDate,
        tenderNumber: input.tenderNumber,
        tenderDate: input.tenderDate,
        submissionDeadline: input.submissionDeadline,
        reminderOffset: input.reminderOffset,
        internalNote: input.internalNote,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  listUpdates: requirePermission('lead.read')
    .input(z.object({ leadId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.leads.listUpdates({ organizationId: ctx.auth.user!.organizationId, leadId: input.leadId });
    }),

  createUpdate: requirePermission('lead.update')
    .input(z.object({ leadId: z.string().uuid(), title: z.string().min(1).max(200), note: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.leads.createUpdate({
        organizationId: ctx.auth.user!.organizationId,
        leadId: input.leadId,
        title: input.title,
        note: input.note,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),
});
