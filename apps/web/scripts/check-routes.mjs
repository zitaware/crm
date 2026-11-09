// Requests every page of the web app as a logged-in user and fails on any
// page that comes back 404, 5xx, or bounced to /login. HTTP only — the page's
// JavaScript does not run; `npm --workspace web run test:e2e` does that in a
// real browser over the same page list.
//
//   npm --workspace web run check:routes
//   npm --workspace web run check:routes -- --web http://localhost:7400 --email you@zitaware.in --password ...
//
// It needs a running web server and API, and read access to the same
// database (DATABASE_URL) to find record ids for dynamic pages. Run it after
// starting `npm run dev`, or on a server after a release.
import { PrismaClient } from '@prisma/client';
import inventory from './route-inventory.cjs';

const { PUBLIC_ROUTES, listRoutes, login, resolveRoute, targetFromEnv } = inventory;

function parseArgs(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const defaults = targetFromEnv();
  return {
    web: value('--web') ?? defaults.web,
    api: value('--api') ?? defaults.api,
    email: value('--email') ?? defaults.email,
    password: value('--password') ?? defaults.password,
    timeoutMs: Number(value('--timeout') ?? 180) * 1000,
  };
}

async function check(options, cookie, path) {
  const isPublic = PUBLIC_ROUTES.has(path);
  try {
    const response = await fetch(`${options.web}${path}`, {
      headers: isPublic ? {} : { cookie },
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    const location = response.headers.get('location') ?? '';
    if (!isPublic && response.status >= 300 && response.status < 400 && location.includes('/login')) {
      return { ok: false, detail: `${response.status} → ${location} (session not accepted)` };
    }
    return { ok: response.status < 400, detail: String(response.status) };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findFirst({ where: { email: { equals: options.email, mode: 'insensitive' } }, select: { organizationId: true } });
    if (!user) throw new Error(`No user ${options.email} in this database (DATABASE_URL).`);
    const cookie = (await login(options.api, options.email, options.password)).map((c) => `${c.name}=${c.value}`).join('; ');

    const routes = listRoutes();
    const results = { pass: 0, fail: 0, skip: 0 };
    process.stdout.write(`Checking ${routes.length} pages on ${options.web} as ${options.email}\n`);
    for (const route of routes) {
      const resolved = await resolveRoute(prisma, route, user.organizationId);
      if (resolved.skip) {
        results.skip++;
        process.stdout.write(`SKIP  ${route}  (${resolved.skip})\n`);
        continue;
      }
      if (resolved.error) {
        results.fail++;
        process.stdout.write(`FAIL  ${route}  (${resolved.error})\n`);
        continue;
      }
      const outcome = await check(options, cookie, resolved.path);
      results[outcome.ok ? 'pass' : 'fail']++;
      process.stdout.write(`${outcome.ok ? 'PASS' : 'FAIL'}  ${outcome.detail.padEnd(4)} ${resolved.path}\n`);
    }
    process.stdout.write(`\n${results.pass} passed, ${results.fail} failed, ${results.skip} skipped\n`);
    if (results.fail > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
