import { z } from 'zod';
import { requirePermission, router } from '../trpc';

export const penaltyCategoriesRouter = router({
  getCount: requirePermission('master.read').query(async ({ ctx }) => {
    return ctx.services.penaltyCategories.getCount({ organizationId: ctx.auth.user!.organizationId });
  }),

  list: requirePermission('master.read')
    .input(z.object({ includeInactive: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.penaltyCategories.list({
        organizationId: ctx.auth.user!.organizationId,
        includeInactive: input.includeInactive,
      });
    }),

  create: requirePermission('master.manage')
    .input(
      z.object({
        code: z.string().min(1).max(50),
        name: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        basisType: z.string().max(100).optional(),
        acceptedLedgerAccountId: z.string().uuid().optional(),
        disputedLedgerAccountId: z.string().uuid().optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.penaltyCategories.create({
        organizationId: ctx.auth.user!.organizationId,
        code: input.code,
        name: input.name,
        description: input.description,
        basisType: input.basisType,
        acceptedLedgerAccountId: input.acceptedLedgerAccountId,
        disputedLedgerAccountId: input.disputedLedgerAccountId,
        sortOrder: input.sortOrder,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  update: requirePermission('master.manage')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(1000).optional(),
        basisType: z.string().max(100).optional(),
        acceptedLedgerAccountId: z.string().uuid().optional(),
        disputedLedgerAccountId: z.string().uuid().optional(),
        sortOrder: z.number().int().optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.penaltyCategories.update({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        name: input.name,
        description: input.description,
        basisType: input.basisType,
        acceptedLedgerAccountId: input.acceptedLedgerAccountId,
        disputedLedgerAccountId: input.disputedLedgerAccountId,
        sortOrder: input.sortOrder,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  setActive: requirePermission('master.manage')
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.penaltyCategories.setActive({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        isActive: input.isActive,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),
});
