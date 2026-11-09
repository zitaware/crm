import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import { resolveIntegrationDatabaseUrl } from '../../packages/database/scripts/integration-test-database.mjs';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration-spec.ts'],
    passWithNoTests: true,
    root: './',
    // Specs run against their own database, migrated and seeded first — never
    // DATABASE_URL (ADR-105).
    env: { DATABASE_URL: resolveIntegrationDatabaseUrl() },
    globalSetup: ['../../packages/database/scripts/integration-test-database.mjs'],
    // Each spec file opens its own PrismaClient connection pool (Prisma's
    // default pool size is num_cpus*2+1 per client, unconstrained by
    // DATABASE_URL here). With 29+ spec files and vitest's default
    // per-CPU-core worker count, unbounded file parallelism can open
    // enough simultaneous connections to exhaust Postgres and produce
    // spurious 5000ms test timeouts under full-suite runs (see
    // docs/12-decisions-log.md ADR-077 and docs/13-progress.md's own
    // corrected acceptance standard — a rerun passing is not a substitute
    // for bounding this). Capping worker threads bounds total concurrent
    // connection pools to a safe multiple regardless of spec-file count.
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 4,
      },
    },
  },
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2023',
      },
      module: { type: 'es6' },
      swcrc: false,
    }),
  ],
});
