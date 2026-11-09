# Runtime and Deployment

## Approved operating model

The project runs directly on Node.js.

- Development: `npm run dev`
- Production: compiled applications managed by PM2
- Package manager: npm with npm workspaces
- Database migrations: Prisma CLI
- Containers: not used
- Caddy: not used
- Pino: not used

This document covers application runtime only. The production server administrator remains responsible for DNS, TLS certificates, firewall rules, operating-system patching, reverse-proxy/load-balancer configuration where required, PostgreSQL hosting, backups and monitoring.

## Prerequisites

### Development machine

- Node.js 24 LTS
- npm version bundled with the pinned Node.js release
- Accessible PostgreSQL instance
- Access to configured object storage and email provider when testing those functions

### Production server

- Supported Linux distribution
- Node.js 24 LTS
- npm
- PM2 installed globally for the deployment user
- Accessible production PostgreSQL instance
- OS-level `logrotate`
- A dedicated non-root deployment user

Do not install Docker, Docker Compose, Caddy or Pino for this project.

## Root npm scripts

The root `package.json` must expose at least:

```json
{
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "start": "turbo run start",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "test:integration": "turbo run test:integration",
    "prisma:generate": "npm --workspace @zitaware/database run prisma:generate",
    "prisma:migrate:deploy": "npm --workspace @zitaware/database run prisma:migrate:deploy"
  }
}
```

Exact workspace names may be finalized during bootstrap, but the root developer command must remain:

```bash
npm run dev
```

## Environment files

Use environment-specific files or server environment variables:

```text
.env.example             # committed; names and safe examples only
.env                     # local development; ignored
.env.production          # production server only; ignored and permission-restricted
```

At startup, validate every required variable and terminate immediately if configuration is invalid (`packages/config/src/env.ts`'s `loadEnv()`, used by `apps/api` and `apps/worker`).

Minimum categories, per `.env.example`:

- application environment and public URLs (`NODE_ENV`, `LOG_LEVEL`, `WEB_PUBLIC_URL`, `API_PUBLIC_URL`);
- web, API and worker ports (`WEB_PORT`, `API_PORT`, `WORKER_HEALTH_PORT`);
- database connection (`DATABASE_URL`, `SHADOW_DATABASE_URL` — see "Migration commands" below);
- authentication/session settings (`SESSION_SECRET`, `ACCESS_TOKEN_TTL_MINUTES`, `REFRESH_TOKEN_TTL_DAYS`, `REFRESH_REUSE_GRACE_SECONDS` (optional, default 60), `INVITATION_TOKEN_TTL_HOURS`, `PASSWORD_RESET_TOKEN_TTL_HOURS`, `LOGIN_LOCKOUT_ATTEMPTS`, `LOGIN_LOCKOUT_MINUTES`);
- outbox worker tuning (`OUTBOX_LEASE_TIMEOUT_MINUTES`, `OUTBOX_MAX_ATTEMPTS`);
- allowed origins (`ALLOWED_ORIGINS`);
- object-storage credentials and bucket (`S3_*`);
- email credentials (`SMTP_*` — Gmail SMTP with an App Password, ADR-190);
- job-queue schema (`PGBOSS_SCHEMA`).

Never commit real secrets. Never print secret values during validation failures.

**Nothing in this stack auto-loads `.env`.** Next.js only auto-loads env files from an app's own directory, and neither NestJS (`apps/api`) nor the worker (`apps/worker`) nor the Prisma CLI call `dotenv` — `loadEnv()` reads directly from `process.env`. The root `.env` must be exported into the shell before running any command that needs it (`npm run dev` included), for example:

```bash
set -a
source .env
set +a
```

Do this once per shell session before the commands below. Turborepo's `envMode: "loose"` (see `turbo.json`) then forwards whatever is already in that shell to every task it runs — it does not read `.env` itself.

## Development commands

### Fresh setup, from zero

```bash
npm install
cp .env.example .env
```

Create both local Postgres databases (names must match `DATABASE_URL` and `SHADOW_DATABASE_URL` in `.env`; the shadow database is disposable scratch space used only by Prisma's migration-diffing commands, see below):

```bash
createdb zitaware_crm_dev
createdb zitaware_crm_shadow
```

Load `.env` into the shell, then generate the Prisma client, apply migrations, and seed:

```bash
set -a && source .env && set +a
npm run prisma:generate
npm run prisma:migrate:deploy
npm run --workspace @zitaware/database prisma:seed
```

Seeding creates the "Zitaware Solutions" organization (code `ZITAWARE`), a placeholder Zitaware Solutions legal entity (fake PAN `AAACZ0000A`, GSTIN `24AAACZ0000A1ZF`, FY2026-27 with 12 periods — replace the PAN, GSTIN and address under Legal Entities before issuing a real invoice, ADR-191), geography (every state, district and city from the Local Government Directory — ADR-149), master data, and the admin user `zitawaresolutions@gmail.com` whose password is taken from `SEED_ADMIN_PASSWORD` in `.env` (never written in code; if it is unset a random password is used and the admin resets it with Forgot password — ADR-192). See `packages/database/prisma/seed.ts`. Seeding is idempotent and safe to re-run.

Start the site, the API and the worker (web on `:3000`, API on `:4000`, worker health on `:4100`):

```bash
npm run dev
```

That command runs the site, the API and the worker, plus one shared-package compiler. Saving a file under `apps/` or `packages/` rebuilds that part and the running app picks it up. The package compiler is a single process, not one TypeScript watcher per package, and the API dev server does not keep a second type checker open. `npm run typecheck` is still the full type check.

### Running one service at a time

Each app can run independently from its own workspace (still requires `.env` sourced in that shell first):

```bash
npm run dev --workspace apps/web       # Next.js dev server, port WEB_PORT
npm run dev --workspace apps/api       # NestJS + tRPC, watch mode, port API_PORT
npm run dev --workspace apps/worker    # pg-boss worker + outbox dispatcher, tsx watch
```

### Even lower memory

If three watchers is still too much, run the API and worker from compiled output and keep only the site in dev mode:

```bash
npm run build:backend        # compile api + worker (rerun after backend source changes)
npm run start:api            # terminal 1 — compiled API, loads .env via node --env-file
npm run start:worker         # terminal 2 — compiled worker, loads .env via node --env-file
npm run dev:web              # terminal 3 — web dev server
```

`start:api`/`start:worker` load the root `.env` through Node's native
`--env-file` flag, so — unlike `node apps/*/dist/main.js` run by hand — they
do **not** require `.env` to be sourced in the shell first. `dev:web` needs
no env at all: `apps/web` only reads `NEXT_PUBLIC_API_URL`, which defaults to
`http://localhost:4000`. Trade-off: a change inside a shared package
(`packages/*`) is not hot-reloaded in this mode — rerun `npm run build:backend`
(for api/worker consumers) and restart the affected service. Pure `apps/web`
UI edits hot-reload normally.

### Before committing

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
```

### Integration test database

Integration specs create and delete whole organizations, so they never run against `DATABASE_URL` (ADR-105). They use `TEST_DATABASE_URL`, a separate database on the same server:

```bash
psql "$DATABASE_URL" -c "CREATE DATABASE zitaware_crm_test;"      # once
# .env
TEST_DATABASE_URL=postgresql://zitaware:zitaware@localhost:5432/zitaware_crm_test
```

`npm run test:integration` loads the root `.env` itself, migrates and seeds the test database, then runs the specs. It refuses to start if `TEST_DATABASE_URL` is missing or points at the `DATABASE_URL` or `SHADOW_DATABASE_URL` database. The test database is disposable: drop and recreate it whenever it gathers leftovers from interrupted runs.

### Checking every page loads

```bash
npm --workspace web run check:routes                      # dev server, as maker@zitaware.test
npm --workspace web run check:routes -- --web http://localhost:7400 --email you@zitaware.in --password '...'
```

Logs in, then requests every page under `apps/web/src/app` — dynamic pages filled with a real record from that user's organization — and exits non-zero if any page returns 404, a server error, or bounces to `/login`. It needs the web server, the API and `DATABASE_URL`. If nested pages (`/projects/<id>`, `/clients/<id>`, …) all return 404 on the dev server while top-level pages work, the dev server's saved state is broken: stop `npm run dev`, `rm -rf apps/web/.next/dev`, and start it again.

### Browser check of every page

```bash
npx --workspace web playwright install chromium            # once per machine (~150 MB)
npm --workspace web run test:e2e                            # against the running app, as maker@zitaware.test
ROUTE_CHECK_WEB_URL=http://localhost:7400 ROUTE_CHECK_EMAIL=you@zitaware.in ROUTE_CHECK_PASSWORD='...' npm --workspace web run test:e2e
```

Opens the same page list as `check:routes` in a real Chromium at 1440×900, lets each page's JavaScript run and its data load, and fails on the not-found page, a bounce to `/login`, a "Could not load" state, a "Loading…" that never resolves, or an uncaught exception. Console errors are attached to each result as annotations rather than failing it. Like `check:routes` it needs the app already running and `DATABASE_URL`; it does not start a server.

### Migration commands

Schema changes are developed against the disposable `zitaware_crm_shadow` database, never against `zitaware_crm_dev` directly. `packages/database/scripts/assert-shadow-database-safe.mjs` runs automatically before both commands below and refuses to proceed if `SHADOW_DATABASE_URL` is unset or equal to `DATABASE_URL` — this guards against the exact incident it was written for (a manually-typed `--shadow-database-url` once pointed at the real dev database and wiped it). Never pass `--shadow-database-url` by hand; always go through these scripts.

Create and apply a new local migration interactively:

```bash
cd packages/database
npm run prisma:migrate:dev -- --name <migration_name>
```

Generate migration SQL without applying it (used when a migration needs hand-editing before it's committed — e.g. to add a `CHECK` constraint or a functional/partial index Prisma can't express natively):

```bash
cd packages/database
npm run prisma:migrate:diff
```

Apply committed migrations (development, after pulling new ones, or production):

```bash
npm run prisma:migrate:deploy
```

Migration generation (`migrate:dev` / `migrate:diff`) must happen in development only. Production only ever runs `migrate:deploy`. See `docs/07-database-conventions.md` "Migration development procedure" for the full rationale.

### Seeding

```bash
npm run --workspace @zitaware/database prisma:seed
```

Re-runnable at any time, and **it is the only thing that adds new permissions** — no migration does — so run it after every release that adds any. It is not create-only:

- it adds missing reference data, permissions and roles, and deletes permissions (with their grants) that the code no longer declares;
- it resets the three system roles (Admin, Accountant, Project Manager) to exactly the code's permission lists — harmless in practice, since the Roles screen cannot edit system roles;
- it re-adds any removed permissions to the starter roles (CEO, Admin Staff, Employee, Hardware Manager) and re-creates them if deleted;
- it creates `zitawaresolutions@gmail.com` with the password from `SEED_ADMIN_PASSWORD` if that user does not exist — check before running it on a live database, and change that password if it prints `seed.bootstrap_admin_created`;
- it backfills a first salary revision for employees who have a salary but no revision history (ADR-098).

### Demo data for a manual money-flow check

```bash
npm --workspace api run demo:money-flow                 # load (refuses if already loaded)
npm --workspace api run demo:money-flow -- --reset      # rebuild it
npm --workspace api run demo:money-flow -- --remove     # delete it
```

Loads the money-flow test scenario into its own `DEMO-MONEY-FLOW` organization — separate users, separate data, nothing mixed into real records — and writes `money-flow-demo-sheet.md` listing the number each screen should show. Needs the seed to have run (states, payment modes, permissions). Refuses to run with `NODE_ENV=production`; never run it against the live database.

## Production build and first start

From the checked-out release directory:

```bash
npm ci
npm run prisma:generate
npm run build
npm run prisma:migrate:deploy
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 status
```

**The `/_global-error` prerender crash is solved (ADR-106).** Builds used to fail with `Error occurred prerendering page "/_global-error"` (or `/_not-found`): `TypeError: Cannot read properties of null (reading 'useContext')`, and it was long blamed on an upstream Next.js bug. The real cause was `NODE_ENV=development` reaching `next build` — sourcing a `.env` or `.env.production` copied from `.env.example` exports it. Next warns `You are using a non-standard "NODE_ENV" value`, React's *development* build loads next to the production one, and the prerender finds a null hooks dispatcher. It reproduces every time with `NODE_ENV=development next build` and never with `NODE_ENV=production`, which is also why a clean checkout "failed identically": the variable lived in the shell, not the tree.

`apps/web`'s `build` script now pins `NODE_ENV=production`, so the shell's value no longer matters and no retry loop is needed. Keep `NODE_ENV=development` out of `.env.production` anyway — `npm ci` with `NODE_ENV=production` would skip devDependencies, so that file is sourced before install and the build script sets production itself.

Packages build with TypeScript incremental mode, and each package's `tsconfig.tsbuildinfo` now lives inside its `dist/` (ADR-106). Before, it sat beside `dist/`, so turbo cached and restored `dist/` without it; a `dist/` older than its tsbuildinfo made `tsc` emit nothing, and turbo then cached that stale output — which is how a release once built `apps/web` against contracts that lacked a router it imported. Deleting a package's `dist/` now resets both.

Then verify:

```bash
pm2 logs --lines 100
```

Also test the web, API and worker health checks from the server and through the production endpoint.

Configure PM2 startup persistence once for the deployment user using the command printed by:

```bash
pm2 startup
```

Run only the exact command PM2 prints for the current operating system and deployment user, then:

```bash
pm2 save
```

## PM2 ecosystem contract

Commit `ecosystem.config.cjs` at the repository root. It must define three applications:

```javascript
module.exports = {
  apps: [
    {
      name: 'zitaware-crm-web',
      cwd: './apps/web',
      script: 'npm',
      args: 'run start',
      env_production: { NODE_ENV: 'production' },
      autorestart: true,
      max_memory_restart: '1G',
      kill_timeout: 15000,
      time: true
    },
    {
      name: 'zitaware-crm-api',
      cwd: './apps/api',
      script: 'npm',
      args: 'run start:prod',
      env_production: { NODE_ENV: 'production' },
      autorestart: true,
      max_memory_restart: '1G',
      kill_timeout: 15000,
      time: true
    },
    {
      name: 'zitaware-crm-worker',
      cwd: './apps/worker',
      script: 'npm',
      args: 'run start:prod',
      env_production: { NODE_ENV: 'production' },
      autorestart: true,
      max_memory_restart: '1G',
      kill_timeout: 30000,
      time: true
    }
  ]
};
```

This is the minimum contract, not a final sizing recommendation. Process counts, memory limits and instance modes must be load-tested before go-live.

The worker must handle `SIGINT` and `SIGTERM`, stop accepting new jobs and allow in-flight jobs to finish within the configured timeout.

## Routine production release

Recommended sequence. Steps 1-2 must run in the same shell as everything
after them — nothing in this stack auto-loads `.env`, and a shell that
never sourced it will silently pass `NODE_ENV=production` with every
other variable (`DATABASE_URL`, `WEB_PORT`, `S3_*`, etc.) missing, which
either crash-loops the process on boot or makes `zitaware-crm-web` fall back to
its default port instead of the one nginx actually proxies to:

```bash
cd /var/www/zitaware-crm/html
set -a; source .env.production; set +a

git pull --ff-only origin main
npm ci
npm run prisma:generate
cd packages/database && npx prisma migrate status && cd ../..   # see what's pending before touching anything
npm run lint
npm run typecheck
npm test
npm run build
npm run prisma:migrate:deploy
npm run --workspace @zitaware/database prisma:seed                 # adds any new permissions; read "Seeding" above first
npx tsx apps/api/scripts/move-branding-images-to-s3.ts               # once after ADR-193: moves old legal-entity images from the database to S3 (no-op afterwards)
pm2 reload ecosystem.config.cjs --env production
pm2 save
pm2 status
curl -sS -o /dev/null -w "web: %{http_code}\n" http://127.0.0.1:7400
curl -sS http://127.0.0.1:4000/healthz
npm --workspace web run check:routes -- --web http://127.0.0.1:7400 --api http://127.0.0.1:4000 --email '<an admin login>' --password '<its password>'
```

Do not reload the applications if installation, validation, tests, build or migrations fail. The last line requests every page of the released build and fails if any returns 404 or a server error.

`pm2 reload`/`restart` reuse whatever environment a process was originally
`pm2 start`-ed with — they do **not** pick up a freshly-sourced shell's
env unless you pass `--update-env`, or delete and restart the process
fresh. If `pm2 status` shows a process crash-looping (high restart count)
after a reload where nothing else explains it, don't keep reloading it —
`pm2 delete <name>` then `pm2 start ecosystem.config.cjs --env production`
in a shell where `.env.production` is freshly sourced.

Before applying a release with database changes:

- confirm the database backup is successful;
- review the generated migration SQL;
- confirm the migration is backward-compatible with the currently running release;
- record the release version and migration names;
- define the application rollback method.

## PM2 operations

```bash
pm2 status
pm2 monit
pm2 logs
pm2 logs zitaware-crm-api --lines 200
pm2 restart zitaware-crm-worker
pm2 reload ecosystem.config.cjs --env production
pm2 save
```

Use `restart` for an individual unhealthy process. Use `reload` for a routine release after a successful build and migration.

## Logging and rotation

Application output is written through the internal structured logger to stdout/stderr. PM2 captures it.

Requirements:

- use one JSON record per log event where practical;
- include service, environment, level, timestamp, correlation ID and event name;
- redact secrets and protected personal/financial data;
- use OS-level `logrotate` for PM2 log files;
- monitor disk consumption and log-rotation failures;
- keep audit events in the database audit subsystem, not only in process logs.

Pino and replacement logging packages are not project requirements.

## Health checks

Expose separate checks:

- Web readiness
- API liveness
- API readiness, including database access
- Worker heartbeat and last successful job timestamp
- Outbox backlog and failed-job count

PM2 process status alone does not prove the application is healthy.

## Backups and recovery

Before production go-live, define and test:

- PostgreSQL backup schedule and retention;
- point-in-time recovery capability where available;
- object-storage versioning/retention;
- environment and PM2 configuration recovery;
- restore test frequency;
- recovery point and recovery time objectives.

Application rollback does not replace database recovery. Posted financial data must never be manually removed to roll back a release.

## Go-live acceptance

- `npm ci` succeeds from the committed lockfile.
- Lint, typecheck, tests and production build pass.
- `prisma migrate deploy` succeeds against the production database.
- All three PM2 processes are online and survive a server restart.
- Web, API and worker health checks pass.
- TLS and public routing are verified by the server administrator.
- PM2 logs rotate and do not expose secrets.
- Backup and restore procedures are tested.
- Release and rollback runbooks are approved.