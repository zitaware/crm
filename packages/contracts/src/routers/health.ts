import { publicProcedure, router } from '../trpc';

// Trivial procedure proving type-safe tRPC wiring end-to-end between
// apps/api and apps/web. No domain procedures exist yet (Phase 1).
export const healthRouter = router({
  ping: publicProcedure.query(() => ({ status: 'ok' as const })),
});
