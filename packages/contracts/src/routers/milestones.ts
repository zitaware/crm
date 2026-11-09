import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const decimalStringSchema = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Must be a valid decimal amount.');
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');
const alertRecipientSchema = z.enum(['ACCOUNT_TEAM', 'PROJECT_MANAGER', 'BOTH']);
const frequencySchema = z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']);

function withCanSeeAll<T extends { permissions: Set<string> }>(auth: T): boolean {
  return auth.permissions.has('project.read_all');
}

export const milestonesRouter = router({
  listForProject: requirePermission('milestone.read')
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.milestones.listForProject({
        organizationId: ctx.auth.user!.organizationId,
        projectId: input.projectId,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),

  previewOpexSchedule: requirePermission('milestone.create')
    .input(
      z.object({
        approvedAmount: decimalStringSchema,
        frequency: frequencySchema,
        installmentCount: z.number().int().min(1).max(600),
        scheduleStartDate: dateStringSchema,
        firstInvoiceDate: dateStringSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.milestones.previewOpexSchedule(input);
    }),

  createCapex: requirePermission('milestone.create')
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1).max(300),
        approvedAmount: decimalStringSchema,
        referenceNumber: z.string().max(100).optional(),
        approvalDate: dateStringSchema.optional(),
        description: z.string().max(2000).optional(),
        alertRecipient: alertRecipientSchema.optional(),
        reminderOffsetDays: z.number().int().min(0).max(90).optional(),
        events: z
          .array(z.object({ name: z.string().min(1).max(300), amount: decimalStringSchema, dueDate: dateStringSchema }))
          .min(1),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.milestones.createCapex({
        organizationId: ctx.auth.user!.organizationId,
        projectId: input.projectId,
        name: input.name,
        approvedAmount: input.approvedAmount,
        referenceNumber: input.referenceNumber,
        approvalDate: input.approvalDate,
        description: input.description,
        alertRecipient: input.alertRecipient,
        reminderOffsetDays: input.reminderOffsetDays,
        events: input.events,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  createOpex: requirePermission('milestone.create')
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1).max(300),
        approvedAmount: decimalStringSchema,
        frequency: frequencySchema,
        installmentCount: z.number().int().min(1).max(600),
        scheduleStartDate: dateStringSchema,
        firstInvoiceDate: dateStringSchema,
        referenceNumber: z.string().max(100).optional(),
        approvalDate: dateStringSchema.optional(),
        description: z.string().max(2000).optional(),
        alertRecipient: alertRecipientSchema.optional(),
        reminderOffsetDays: z.number().int().min(0).max(90).optional(),
        idempotencyKey: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.milestones.createOpex({
        organizationId: ctx.auth.user!.organizationId,
        projectId: input.projectId,
        name: input.name,
        approvedAmount: input.approvedAmount,
        frequency: input.frequency,
        installmentCount: input.installmentCount,
        scheduleStartDate: input.scheduleStartDate,
        firstInvoiceDate: input.firstInvoiceDate,
        referenceNumber: input.referenceNumber,
        approvalDate: input.approvalDate,
        description: input.description,
        alertRecipient: input.alertRecipient,
        reminderOffsetDays: input.reminderOffsetDays,
        idempotencyKey: input.idempotencyKey,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  updateMilestone: requirePermission('milestone.update')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(300).optional(),
        referenceNumber: z.string().max(100).optional(),
        approvalDate: dateStringSchema.optional(),
        description: z.string().max(2000).optional(),
        alertRecipient: alertRecipientSchema.optional(),
        reminderOffsetDays: z.number().int().min(0).max(90).optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.milestones.updateMilestone({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        name: input.name,
        referenceNumber: input.referenceNumber,
        approvalDate: input.approvalDate,
        description: input.description,
        alertRecipient: input.alertRecipient,
        reminderOffsetDays: input.reminderOffsetDays,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  updateEvent: requirePermission('milestone.update')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(300).optional(),
        amount: decimalStringSchema.optional(),
        dueDate: dateStringSchema.optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.milestones.updateEvent({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        name: input.name,
        amount: input.amount,
        dueDate: input.dueDate,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  startEvent: requirePermission('milestone.mark_achieved')
    .input(z.object({ id: z.string().uuid(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.milestones.startEvent({
        organizationId: ctx.auth.user!.organizationId,
        ...input,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  markEventAchieved: requirePermission('milestone.mark_achieved')
    .input(z.object({ id: z.string().uuid(), achievedOn: dateStringSchema, expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.milestones.markEventAchieved({
        organizationId: ctx.auth.user!.organizationId,
        ...input,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  cancelEvent: requirePermission('milestone.cancel')
    .input(z.object({ id: z.string().uuid(), reason: z.string().min(1).max(1000), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.milestones.cancelEvent({
        organizationId: ctx.auth.user!.organizationId,
        ...input,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  startMilestone: requirePermission('milestone.mark_achieved')
    .input(z.object({ id: z.string().uuid(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.milestones.startMilestone({
        organizationId: ctx.auth.user!.organizationId,
        ...input,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  markMilestoneAchieved: requirePermission('milestone.mark_achieved')
    .input(z.object({ id: z.string().uuid(), achievedOn: dateStringSchema, expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.milestones.markMilestoneAchieved({
        organizationId: ctx.auth.user!.organizationId,
        ...input,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  cancelMilestone: requirePermission('milestone.cancel')
    .input(z.object({ id: z.string().uuid(), reason: z.string().min(1).max(1000), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.milestones.cancelMilestone({
        organizationId: ctx.auth.user!.organizationId,
        ...input,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),

  skipInstallment: requirePermission('milestone.skip_installment')
    .input(z.object({ id: z.string().uuid(), reason: z.string().min(1).max(1000), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.milestones.skipInstallment({
        organizationId: ctx.auth.user!.organizationId,
        ...input,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),
});
