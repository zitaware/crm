#!/usr/bin/env node
// Refuses to proceed if SHADOW_DATABASE_URL is unset or identical to
// DATABASE_URL. Run automatically before any command that lets Prisma use
// shadow-database scratch space (migrate dev, migrate diff) — see
// docs/07-database-conventions.md "Migration development procedure" for
// the incident this prevents: a manually-passed --shadow-database-url once
// pointed at the real local dev database, which Prisma then used as
// disposable scratch space, wiping its data and migration history.
const databaseUrl = process.env.DATABASE_URL;
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;

if (!shadowDatabaseUrl) {
  console.error(
    'SHADOW_DATABASE_URL is not set. Refusing to run a migration command that needs shadow-database scratch space.',
  );
  process.exit(1);
}

if (!databaseUrl) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

if (databaseUrl === shadowDatabaseUrl) {
  console.error(
    'SHADOW_DATABASE_URL is identical to DATABASE_URL. This would let Prisma treat your real database as disposable scratch space and can silently wipe its data. Refusing to proceed.',
  );
  process.exit(1);
}

console.log('Shadow database safety check passed: SHADOW_DATABASE_URL is set and distinct from DATABASE_URL.');
