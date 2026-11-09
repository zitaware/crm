// The database integration tests run against (ADR-105).
//
// Integration specs create and delete whole organizations. Pointed at the
// development database they mix with real work, and an interrupted run leaves
// its rows behind for good — so they get a database of their own,
// TEST_DATABASE_URL, which must never be DATABASE_URL or SHADOW_DATABASE_URL.
//
// Imported by each app's vitest.integration.config.ts, which calls
// resolveIntegrationDatabaseUrl() and points DATABASE_URL at the result; the
// default export is a vitest globalSetup that migrates and seeds that
// database before any spec runs.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const databasePackageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(databasePackageDir, '../..');

/** Arbitrary but fixed: serialises migrate+seed between apps run in parallel by turbo. */
const SETUP_LOCK_KEY = 815_105;

function withoutQuery(url) {
  return url.split('?')[0];
}

export function resolveIntegrationDatabaseUrl() {
  // Loads the repo-root .env so `npm run test:integration` works without
  // sourcing it first. Variables already set in the environment win.
  const envFile = resolve(repoRoot, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Integration tests create and delete data, so they run against their own database — see docs/14 "Integration test database".',
    );
  }
  for (const other of ['DATABASE_URL', 'SHADOW_DATABASE_URL']) {
    const value = process.env[other];
    if (value && withoutQuery(value) === withoutQuery(testUrl)) {
      throw new Error(`TEST_DATABASE_URL must not point at the same database as ${other}.`);
    }
  }
  return testUrl;
}

function run(command, env) {
  try {
    execSync(command, { cwd: databasePackageDir, env, stdio: 'pipe' });
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    throw new Error(`Preparing the integration test database failed: ${command}\n${output}`);
  }
}

export default async function setup() {
  const url = resolveIntegrationDatabaseUrl();
  const env = { ...process.env, DATABASE_URL: url };
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    // A transaction-scoped advisory lock: a second app's setup waits here,
    // then finds the migrations applied and re-runs the idempotent seed.
    await prisma.$transaction(
      async (tx) => {
        // $executeRaw, not $queryRaw: the lock function returns void, which
        // Prisma cannot deserialize as a result column.
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`);
        run('npx prisma migrate deploy', env);
        run('npx tsx prisma/seed.ts', env);
      },
      { maxWait: 600_000, timeout: 600_000 },
    );
  } finally {
    await prisma.$disconnect();
  }
}
