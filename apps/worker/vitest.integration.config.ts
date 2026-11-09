import { defineConfig } from 'vitest/config';
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
    // Worker jobs sweep the WHOLE database — the outbox dispatcher claims the
    // next N pending events of any organization — so a job under test in one
    // file would claim the rows another file is asserting on. One file at a time.
    fileParallelism: false,
  },
});
