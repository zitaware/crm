import { PrismaClient as BasePrismaClient, Prisma } from '@prisma/client';
import { createLogger } from '@zitaware/config';
import { SCOPED_OPERATIONS, currentEntityScope, entityFilter, withEntityFilter } from './entity-scope';

const logger = createLogger({ service: 'api' });

/**
 * Singleton Prisma client. Query/error events are piped through the shared
 * structured logger so Prisma's own console output never bypasses
 * redaction (docs/02, docs/14).
 */
export function createPrismaClient(): BasePrismaClient {
  const client = new BasePrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

  client.$on('query' as never, (event: unknown) => logger.info('prisma.query', event));
  client.$on('warn' as never, (event: unknown) => logger.warn('prisma.warn', event));
  client.$on('error' as never, (event: unknown) => logger.error('prisma.error', event));

  // Entity-wise data (ADR-172): inside a scoped request, every read and
  // update is narrowed to the user's legal entities. The extended client is
  // still the same client to every caller; interactive transactions carry the
  // extension too.
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scope = currentEntityScope();
          if (!scope || !SCOPED_OPERATIONS.has(operation)) return query(args);
          const filter = entityFilter(model, scope.legalEntityIds);
          if (!filter) return query(args);
          const scoped = { ...(args as { where?: Record<string, unknown> }) };
          scoped.where = withEntityFilter(scoped.where, filter);
          return query(scoped as typeof args);
        },
      },
    },
  }) as unknown as BasePrismaClient;
}

export { BasePrismaClient as PrismaClient, Prisma };
