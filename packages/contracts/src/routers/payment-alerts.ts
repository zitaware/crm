import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');

function withCanSeeAll<T extends { permissions: Set<string> }>(auth: T): boolean {
  return auth.permissions.has('project.read_all');
}

export const paymentAlertsRouter = router({
  listForProject: requirePermission('payment_alert.read')
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.paymentAlerts.listForProject({
        organizationId: ctx.auth.user!.organizationId,
        projectId: input.projectId,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
      });
    }),

  getHeaderSummary: requirePermission('payment_alert.read').query(async ({ ctx }) => {
    return ctx.services.paymentAlerts.getHeaderSummary({
      organizationId: ctx.auth.user!.organizationId,
      actorId: ctx.auth.user!.id,
      canSeeAll: withCanSeeAll(ctx.auth),
    });
  }),

  snooze: requirePermission('payment_alert.snooze')
    .input(
      z.object({
        id: z.string().uuid(),
        snoozedUntil: dateStringSchema,
        note: z.string().max(1000).optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.paymentAlerts.snooze({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        snoozedUntil: input.snoozedUntil,
        note: input.note,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        canSeeAll: withCanSeeAll(ctx.auth),
        correlationId: ctx.correlationId,
      });
    }),
});
