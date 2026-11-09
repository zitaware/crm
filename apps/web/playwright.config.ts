import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// The browser pass runs against an app that is ALREADY running — `npm run dev`
// locally, or the released build on a server — rather than starting one, so it
// checks exactly what a user would get. The repo-root .env supplies ports and
// DATABASE_URL (used to find real record ids for dynamic pages).
const envFile = resolve(__dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  testDir: 'e2e',
  // *.e2e.ts, never *.spec.ts / *.test.ts, so vitest never tries to run these.
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  // The dev server compiles a page on its first visit, which can take a while.
  timeout: 180_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.ROUTE_CHECK_WEB_URL ?? `http://localhost:${process.env.WEB_PORT ?? '3000'}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
