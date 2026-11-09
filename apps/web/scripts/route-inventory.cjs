// The app's page inventory, shared by scripts/check-routes.mjs (HTTP) and
// e2e/pages.e2e.ts (real browser), so both always check the same pages.
//
// CommonJS on purpose: Playwright compiles the TypeScript test to CommonJS and
// `require`s its imports, which cannot load an ES module that uses
// import.meta; check-routes.mjs can still import these named exports.
//
// Pages are discovered by walking src/app, so a new page is covered without
// touching this file. A dynamic segment ([id], [invoiceId], ...) is filled
// with a real record from the logged-in user's own organization; a page whose
// record type has none is skipped, and a dynamic page with no resolver below
// fails, so the list cannot silently fall behind the app.
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose, see above */
const { existsSync, readdirSync, statSync } = require('node:fs');
const { join, resolve } = require('node:path');

const appDir = join(resolve(__dirname, '..'), 'src/app');

const PUBLIC_ROUTES = new Set(['/login', '/forgot-password', '/reset-password', '/accept-invite']);

/** One query per dynamic page: returns the segment values, scoped to the organization ($1). */
const RESOLVERS = {
  '/audit-log/[id]': `SELECT id FROM audit_events WHERE organization_id = $1::uuid LIMIT 1`,
  '/chart-of-accounts/ledger/[accountId]': `SELECT id AS "accountId" FROM ledger_accounts WHERE organization_id = $1::uuid LIMIT 1`,
  '/clients/[id]': `SELECT party_id AS id FROM client_profiles WHERE organization_id = $1::uuid AND deleted_at IS NULL LIMIT 1`,
  '/direct-expenses/[id]': `SELECT id FROM direct_expenses WHERE organization_id = $1::uuid LIMIT 1`,
  '/employee-expenses/claims/[id]': `SELECT id FROM employee_expense_claims WHERE organization_id = $1::uuid LIMIT 1`,
  '/inventory/[itemId]': `SELECT id AS "itemId" FROM inventory_items WHERE organization_id = $1::uuid AND deleted_at IS NULL LIMIT 1`,
  '/journal-entries/[id]': `SELECT id FROM journal_entries WHERE organization_id = $1::uuid LIMIT 1`,
  '/leads/[id]': `SELECT id FROM leads WHERE organization_id = $1::uuid LIMIT 1`,
  '/masters/[type]': `SELECT 'internal_departments' AS type`,
  '/payment-requests/[id]': `SELECT id FROM payment_requests WHERE organization_id = $1::uuid LIMIT 1`,
  '/projects/[id]': `SELECT id FROM projects WHERE organization_id = $1::uuid LIMIT 1`,
  '/projects/[id]/invoices/new': `SELECT id FROM projects WHERE organization_id = $1::uuid LIMIT 1`,
  '/projects/[id]/receipts/new': `SELECT id FROM projects WHERE organization_id = $1::uuid LIMIT 1`,
  '/projects/[id]/invoices/[invoiceId]': `SELECT project_id AS id, id AS "invoiceId" FROM invoices WHERE organization_id = $1::uuid LIMIT 1`,
  '/projects/[id]/invoices/[invoiceId]/credit-debit-notes/new':
    `SELECT project_id AS id, id AS "invoiceId" FROM invoices WHERE organization_id = $1::uuid AND status = 'FINALIZED' LIMIT 1`,
  '/projects/[id]/invoices/[invoiceId]/credit-debit-notes/[noteId]':
    `SELECT project_id AS id, invoice_id AS "invoiceId", id AS "noteId" FROM credit_debit_notes WHERE organization_id = $1::uuid LIMIT 1`,
  '/projects/[id]/receipts/[receiptId]':
    `SELECT i.project_id AS id, a.receipt_id AS "receiptId" FROM receipt_allocations a JOIN invoices i ON i.id = a.invoice_id WHERE a.organization_id = $1::uuid LIMIT 1`,
  '/users/[id]': `SELECT id FROM users WHERE organization_id = $1::uuid LIMIT 1`,
  '/vendor-bills/[id]': `SELECT id FROM vendor_bills WHERE organization_id = $1::uuid LIMIT 1`,
  '/vendor-payments/[id]': `SELECT id FROM vendor_payments WHERE organization_id = $1::uuid LIMIT 1`,
};

/** Every page route under src/app — route groups dropped, `api` route handlers skipped. */
function listRoutes(dir = appDir, segments = []) {
  const routes = [];
  if (existsSync(join(dir, 'page.tsx'))) routes.push(`/${segments.join('/')}`);
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory() || name.startsWith('_') || name.startsWith('@')) continue;
    if (segments.length === 0 && name === 'api') continue;
    const isGroup = name.startsWith('(') && name.endsWith(')');
    routes.push(...listRoutes(full, isGroup ? segments : [...segments, name]));
  }
  return routes;
}

/** Turns a route pattern into a concrete path for the organization: { path } | { skip } | { error }. */
async function resolveRoute(prisma, route, organizationId) {
  if (!route.includes('[')) return { path: route };
  const sql = RESOLVERS[route];
  if (!sql) return { error: 'no resolver for this dynamic page — add one to RESOLVERS in scripts/route-inventory.cjs' };
  const rows = sql.includes('$1') ? await prisma.$queryRawUnsafe(sql, organizationId) : await prisma.$queryRawUnsafe(sql);
  if (rows.length === 0) return { skip: 'no record of this kind in the organization' };
  const params = rows[0];
  return { path: route.replace(/\[([^\]]+)\]/g, (_, key) => String(params[key])) };
}

/** Logs in through the API and returns the session cookies as name/value pairs. */
async function login(apiUrl, email, password) {
  const response = await fetch(`${apiUrl}/trpc/auth.login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`Login as ${email} failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
  return response.headers.getSetCookie().map((cookie) => {
    const [pair = ''] = cookie.split(';');
    const index = pair.indexOf('=');
    return { name: pair.slice(0, index).trim(), value: pair.slice(index + 1).trim() };
  });
}

/** Defaults shared by both checkers; each can be overridden by flag or environment. */
function targetFromEnv(env = process.env) {
  return {
    web: env.ROUTE_CHECK_WEB_URL ?? `http://localhost:${env.WEB_PORT ?? '3000'}`,
    api: env.ROUTE_CHECK_API_URL ?? `http://localhost:${env.API_PORT ?? '4000'}`,
    email: env.ROUTE_CHECK_EMAIL ?? 'maker@zitaware.test',
    password: env.ROUTE_CHECK_PASSWORD ?? 'MoneyFlow@2026',
  };
}

module.exports = { PUBLIC_ROUTES, RESOLVERS, listRoutes, resolveRoute, login, targetFromEnv };
