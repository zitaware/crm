import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['info', 'warn', 'error']).default('info'),

  WEB_PUBLIC_URL: z.string().url(),
  API_PUBLIC_URL: z.string().url(),

  WEB_PORT: z.coerce.number().int().positive().default(3000),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(4100),

  DATABASE_URL: z.string().min(1),

  SESSION_SECRET: z.string().min(16),

  ALLOWED_ORIGINS: z.string().min(1),

  // Optional: only needed for a non-AWS S3-compatible provider (MinIO,
  // DigitalOcean Spaces, R2, etc.) or to override AWS's default regional
  // endpoint. Real AWS S3 resolves its endpoint from S3_REGION alone.
  S3_ENDPOINT: z.string().min(1).optional(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  // Optional folder every new object key is placed under ("crm" →
  // "crm/<org>/<group>/<doc>-<file>"). Slashes at either end are ignored.
  S3_PREFIX_FOLDER: z
    .string()
    .optional()
    .transform((value) => (value ?? '').replace(/^\/+|\/+$/g, '')),

  // Outbound email over SMTP (Gmail by default, ADR-190). Gmail needs an
  // App Password, not the account password. Port 465 uses implicit TLS;
  // 587 upgrades with STARTTLS.
  SMTP_HOST: z.string().min(1).default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: z.string().email(),
  SMTP_PASS: z.string().min(1),
  // Gmail only sends as the signed-in account (or a verified alias), so
  // this defaults to SMTP_USER.
  SMTP_FROM_EMAIL: z.string().email().optional(),
  SMTP_FROM_NAME: z.string().min(1).optional(),

  PGBOSS_SCHEMA: z.string().min(1).default('pgboss'),

  // Phase 2 identity/auth defaults — proposed, recorded as ADRs
  // (docs/12-decisions-log.md), not documented anywhere prior to Phase 2.
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(1),
  // A refresh token rotated this recently may be presented again without
  // counting as theft: the browser, another tab and the web server can each
  // refresh at the same moment (ADR-158).
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(60),
  INVITATION_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(72),
  PASSWORD_RESET_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(1),
  LOGIN_LOCKOUT_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  OUTBOX_LEASE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(5),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Fail-fast env validation: on failure, only the offending key names are
 * reported — never the attempted values — so secrets never leak into
 * startup logs (docs/09, docs/14).
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const missingKeys = result.error.issues.map((issue) => issue.path.join('.'));
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'env.validation_failed',
        invalidKeys: missingKeys,
      }),
    );
    process.exit(1);
  }

  return result.data;
}
