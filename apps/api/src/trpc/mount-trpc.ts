import type { Express } from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from '@zitaware/contracts';
import type { Services } from '@zitaware/contracts';
import { createContextFactory } from './create-context';

/**
 * Hand-wired tRPC mount on the underlying Express instance. No maintained
 * Nest+tRPC adapter is used (see docs/02's modular-monolith constraint:
 * this stays one process, not a separate tRPC service). `services` are
 * resolved from Nest's DI container in main.ts and closed over by the
 * context factory — this is the one place concrete NestJS services meet
 * packages/contracts' port interfaces.
 */
export function mountTrpc(app: Express, services: Services, maxBodySize?: number) {
  app.use(
    '/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext: createContextFactory(services),
      ...(maxBodySize !== undefined ? { maxBodySize } : {}),
    }),
  );
}
