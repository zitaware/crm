import { NAV_ITEMS } from '@zitaware/ui';

/**
 * Creating a record is a different permission from opening the list.
 * These paths are checked before the menu rule, so a role that can read
 * projects still cannot open Add Project.
 */
const WRITE_ROUTES: ReadonlyArray<{ pattern: RegExp; permission: string }> = [
  { pattern: /^\/projects\/new\/?$/, permission: 'project.create' },
  { pattern: /^\/clients\/new\/?$/, permission: 'client.create' },
  { pattern: /^\/leads\/new\/?$/, permission: 'lead.create' },
  { pattern: /^\/vendor-bills\/new\/?$/, permission: 'vendor_bill.create' },
  { pattern: /^\/payment-requests\/new\/?$/, permission: 'payment_request.create' },
  { pattern: /^\/direct-expenses\/new\/?$/, permission: 'direct_expense.create' },
  { pattern: /^\/purchases\/new\/?$/, permission: 'vendor_bill.approve' },
  { pattern: /^\/servers-subscriptions\/new\/?$/, permission: 'direct_expense.post' },
  { pattern: /^\/servers-subscriptions\/[^/]+\/correct\/?$/, permission: 'direct_expense.reverse' },
  { pattern: /^\/inventory\/receipts\/new\/?$/, permission: 'inventory.receive' },
  { pattern: /^\/inventory\/consumptions\/new\/?$/, permission: 'inventory.consume' },
  { pattern: /^\/employee-expenses\/my\/new\/?$/, permission: 'employee_claim.create' },
  { pattern: /^\/employee-expenses\/give-advance\/?$/, permission: 'employee_advance.create' },
  { pattern: /^\/employee-expenses\/new\/?$/, permission: 'employee_claim.approve' },
  { pattern: /^\/projects\/[^/]+\/invoices\/new\/?$/, permission: 'invoice.create' },
  { pattern: /^\/projects\/[^/]+\/receipts\/new\/?$/, permission: 'receipt.post' },
  { pattern: /^\/projects\/[^/]+\/invoices\/[^/]+\/credit-debit-notes\/new\/?$/, permission: 'credit_debit_note.create' },
  { pattern: /^\/introducer-fees\/payments\/new\/?$/, permission: 'introducer_fee.pay' },
  { pattern: /^\/vendor-payments\/new\/?$/, permission: 'vendor_payment.post' },
  { pattern: /^\/employee-costing\/new\/?$/, permission: 'salary_import.create' },
  { pattern: /^\/salary-imports\/new\/?$/, permission: 'salary_import.create' },
];

export function holdsPermission(permissions: readonly string[], required: string | readonly string[] | null): boolean {
  if (required === null) return true;
  if (typeof required === 'string') return permissions.includes(required);
  return required.some((key) => permissions.includes(key));
}

/** The permission that must be held to open this address. `null` means any signed-in user. */
export function permissionForPath(pathname: string): string | readonly string[] | null {
  const write = WRITE_ROUTES.find((route) => route.pattern.test(pathname));
  if (write) return write.permission;

  // An employee opens their own claim here. The API shows only that person's
  // claim unless they also hold employee_claim.read.
  if (/^\/employee-expenses\/claims\/[^/]+/.test(pathname)) {
    return ['employee_claim.read', 'employee_claim.create'];
  }

  const matches = NAV_ITEMS.filter((item) => (item.path === '/' ? pathname === '/' : pathname === item.path || pathname.startsWith(`${item.path}/`)));
  matches.sort((a, b) => b.path.length - a.path.length);
  return matches[0]?.permission ?? null;
}

/** First menu destination this session is allowed to open, other than the dashboard. */
export function firstAllowedPath(permissions: readonly string[]): string | null {
  const item = NAV_ITEMS.find((entry) => entry.path !== '/' && !entry.hidden && holdsPermission(permissions, entry.permission));
  return item?.path ?? null;
}
