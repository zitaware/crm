import { z } from 'zod';
import { requirePermission, router } from '../trpc';

export const introducersRouter = router({
  list: requirePermission('introducer.read')
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.services.introducers.list({
        organizationId: ctx.auth.user!.organizationId,
        includeInactive: input?.includeInactive,
      });
    }),

  create: requirePermission('introducer.create')
    .input(z.object({ name: z.string().min(1).max(200), phone: z.string().max(30).optional() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.introducers.create({
        organizationId: ctx.auth.user!.organizationId,
        name: input.name,
        phone: input.phone,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  update: requirePermission('introducer.update')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        phone: z.string().max(30).optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.introducers.update({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        name: input.name,
        phone: input.phone,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  setActive: requirePermission('introducer.update')
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.introducers.setActive({
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
