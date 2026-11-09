import PgBoss from 'pg-boss';

export function createBoss(databaseUrl: string, schema: string): PgBoss {
  return new PgBoss({ connectionString: databaseUrl, schema });
}
