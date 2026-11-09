import { z } from 'zod';
import { requirePermission, router } from '../trpc';
import { DASHBOARD_READ_PERMISSION } from '../ports/dashboard.port';

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');

export const dashboardRouter = router({
  getOverview: requirePermission(DASHBOARD_READ_PERMISSION)
    .input(z.object({ legalEntityId: z.string().uuid().optional(), dateFrom: dateStringSchema, asOfDate: dateStringSchema }))
    .query(async ({ ctx, input }) =>
      ctx.services.dashboard.getOverview({
        organizationId: ctx.auth.user!.organizationId,
        actorId: ctx.auth.user!.id,
        canSeeAllProjects: ctx.auth.permissions.has('project.read_all'),
        permissions: [...ctx.auth.permissions],
        filters: { legalEntityId: input.legalEntityId, dateFrom: input.dateFrom, asOfDate: input.asOfDate },
      }),
    ),
});
