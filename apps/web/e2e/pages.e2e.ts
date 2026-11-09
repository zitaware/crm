import { PrismaClient } from '@prisma/client';
import { expect, test, type BrowserContext } from '@playwright/test';
import inventory from '../scripts/route-inventory.cjs';

const { PUBLIC_ROUTES, listRoutes, login, resolveRoute, targetFromEnv } = inventory;

/**
 * Opens every page of the app in a real browser, as a logged-in user, and
 * fails on anything a person would see go wrong: the not-found page, a bounce
 * to /login, a "Could not load" state, a "Loading…" that never resolves, or an
 * uncaught exception in the page's JavaScript.
 *
 * The page list is the same inventory scripts/check-routes.mjs uses, so a new
 * page is covered automatically. Run with a started app:
 *
 *   npm --workspace web run test:e2e
 */

const target = targetFromEnv();
const routes = listRoutes();
const resolvedPaths = new Map<string, Awaited<ReturnType<typeof resolveRoute>>>();
let cookies: Array<{ name: string; value: string }> = [];

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findFirst({ where: { email: { equals: target.email, mode: 'insensitive' } }, select: { organizationId: true } });
    if (!user) throw new Error(`No user ${target.email} in this database (DATABASE_URL).`);
    for (const route of routes) resolvedPaths.set(route, await resolveRoute(prisma, route, user.organizationId));
  } finally {
    await prisma.$disconnect();
  }
  cookies = await login(target.api, target.email, target.password);
});

async function signIn(context: BrowserContext): Promise<void> {
  const { hostname } = new URL(target.web);
  await context.addCookies(cookies.map((c) => ({ ...c, domain: hostname, path: '/', httpOnly: true, sameSite: 'Lax' as const })));
}

for (const route of routes) {
  test(`page ${route}`, async ({ page, context }) => {
    const resolved = resolvedPaths.get(route);
    expect(resolved, 'route was not resolved').toBeDefined();
    if (resolved!.error) throw new Error(resolved!.error);
    test.skip(Boolean(resolved!.skip), resolved!.skip ?? '');
    const path = resolved!.path!;

    const isPublic = PUBLIC_ROUTES.has(path);
    if (!isPublic) await signIn(context);

    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(response?.status() ?? 0, `HTTP status of ${path}`).toBeLessThan(400);
    if (!isPublic) expect(new URL(page.url()).pathname, 'bounced to the login page').not.toBe('/login');

    await page.waitForLoadState('networkidle', { timeout: 120_000 });
    await expect(page.getByText('Page not found'), 'rendered the not-found page').toHaveCount(0);
    await expect(page.getByText(/^Could not load/), 'the page reported a load error').toHaveCount(0);
    // A render error is caught by the error boundary, so it never reaches `pageerror`.
    await expect(page.getByText('Something went wrong'), 'the page crashed into the error boundary').toHaveCount(0);
    await expect(page.getByText('Loading…', { exact: true }), 'a loading state never resolved').toHaveCount(0, { timeout: 30_000 });

    expect(pageErrors, 'uncaught exceptions in the page').toEqual([]);
    test.info().annotations.push(...consoleErrors.map((text) => ({ type: 'console error', description: text.slice(0, 300) })));
  });
}
