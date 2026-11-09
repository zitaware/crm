// Routes reachable without a session. An UNAUTHENTICATED error on one of
// these (e.g. a wrong password on /login) is an expected outcome of the
// page's own flow, not a sign that a previously-valid session just died
// mid-page — callers use this list to tell the two cases apart.
export const PUBLIC_AUTH_PATHS = ['/login', '/forgot-password', '/reset-password', '/accept-invite'];

export function isPublicAuthPath(pathname: string): boolean {
  return PUBLIC_AUTH_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Validates a `?next=` value read back from the URL before it is used as
 * a redirect target after login. Must stay same-origin and relative — an
 * absolute or protocol-relative value here would turn a login link into
 * an open redirect (e.g. `/login?next=https://evil.example`).
 */
export function sanitizeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return '/';
  }
  const pathname = raw.split(/[?#]/)[0] ?? '';
  return isPublicAuthPath(pathname) ? '/' : raw;
}
