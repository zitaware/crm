import { z } from 'zod';
import { requirePermission, router } from '../trpc';

const filtersSchema = z.object({
  actorEmail: z.string().max(320).optional(),
  entityType: z.string().max(100).optional(),
  action: z.string().max(100).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});

export const auditRouter = router({
  list: requirePermission('audit.read')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        filters: filtersSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.audit.list({
        organizationId: ctx.auth.user!.organizationId,
        page: input.page,
        pageSize: input.pageSize,
        filters: input.filters,
      });
    }),

  getById: requirePermission('audit.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.audit.getById({ organizationId: ctx.auth.user!.organizationId, id: input.id });
    }),

  listEntityTypes: requirePermission('audit.read').query(async ({ ctx }) => {
    return ctx.services.audit.listEntityTypes({ organizationId: ctx.auth.user!.organizationId });
  }),

  listActions: requirePermission('audit.read').query(async ({ ctx }) => {
    return ctx.services.audit.listActions({ organizationId: ctx.auth.user!.organizationId });
  }),
});
