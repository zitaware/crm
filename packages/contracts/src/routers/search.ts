import { z } from 'zod';
import { protectedProcedure, router } from '../trpc';
import { GLOBAL_SEARCH_PERMISSIONS, type GlobalSearchKind } from '../ports/search.port';

export const searchRouter = router({
  /** The top-bar search. Only the kinds the user may read are searched; none at all returns nothing. */
  global: protectedProcedure
    .input(z.object({ query: z.string().trim().min(2).max(100) }))
    .query(async ({ ctx, input }) => {
      const kinds = (Object.keys(GLOBAL_SEARCH_PERMISSIONS) as GlobalSearchKind[]).filter((kind) => ctx.auth.permissions.has(GLOBAL_SEARCH_PERMISSIONS[kind]));
      if (kinds.length === 0) return [];
      return ctx.services.search.search({
        organizationId: ctx.auth.user!.organizationId,
        actorId: ctx.auth.user!.id,
        query: input.query,
        kinds,
        canSeeAllProjects: ctx.auth.permissions.has('project.read_all'),
      });
    }),
});
