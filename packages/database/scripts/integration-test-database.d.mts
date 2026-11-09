/** Resolves TEST_DATABASE_URL, refusing a URL that points at DATABASE_URL or SHADOW_DATABASE_URL (ADR-105). */
export function resolveIntegrationDatabaseUrl(): string;

/** vitest globalSetup: migrates and seeds the integration test database. */
export default function setup(): Promise<void>;
