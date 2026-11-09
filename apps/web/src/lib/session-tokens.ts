export const ACCESS_TOKEN_COOKIE = 'zitaware_crm_access_token';
export const REFRESH_TOKEN_COOKIE = 'zitaware_crm_refresh_token';

const API_PUBLIC_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Procedures whose own UNAUTHENTICATED result must not start a refresh. */
const NO_REFRESH_PROCEDURES = [
  'auth.login',
  'auth.refresh',
  'auth.logout',
  'auth.acceptInvite',
  'auth.requestPasswordReset',
  'auth.completePasswordReset',
];

/**
 * True only when the access token is a JWT whose `exp` is already past.
 * A missing payload is not treated as expired: the API remains the
 * authority for tokens this decoder cannot read.
 */
export function isAccessTokenExpired(token: string, now = Date.now()): boolean {
  const payload = decodeJwtPayload(token);
  return typeof payload?.exp === 'number' && payload.exp * 1000 <= now;
}

export function shouldRefreshProcedures(url: string): boolean {
  return !NO_REFRESH_PROCEDURES.some((procedure) => url.includes(procedure));
}

export function responseDeclaresUnauthenticated(body: string): boolean {
  return /"appErrorCode"\s*:\s*"UNAUTHENTICATED"/.test(body);
}

/** Replace or append session cookies inside a Cookie header. */
export function mergeCookieHeader(existing: string | null, updates: Array<[string, string]>): string {
  const cookies = new Map<string, string>();
  if (existing) {
    for (const part of existing.split(';')) {
      const pair = splitCookiePair(part);
      if (pair) cookies.set(pair[0], pair[1]);
    }
  }
  for (const [name, value] of updates) cookies.set(name, value);
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

/** First `name=value` of each Set-Cookie line. Later attributes are ignored. */
export function readSetCookiePairs(setCookies: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const line of setCookies) {
    const pair = splitCookiePair(line.split(';')[0] ?? '');
    if (pair) pairs.push(pair);
  }
  return pairs;
}

export interface SessionRefreshResult {
  ok: boolean;
  setCookies: string[];
}

const refreshInFlight = new Map<string, Promise<SessionRefreshResult>>();

/**
 * Ask the API to rotate the refresh token and issue a new access token.
 * Concurrent callers with the same refresh token share one request so a
 * burst of expired calls does not rotate it twice. On the web server this
 * module serves every user at once, so the shared request is keyed by the
 * refresh token: one user's refresh, and its cookies, never answer another
 * user's request. The returned Set-Cookie lines are what a server-side
 * caller must copy onto its own response; a browser caller stores them
 * automatically and usually cannot read them.
 */
export function refreshSession(cookieHeader?: string): Promise<SessionRefreshResult> {
  const key = cookieHeader === undefined ? '' : (refreshTokenIn(cookieHeader) ?? cookieHeader);
  let pending = refreshInFlight.get(key);
  if (!pending) {
    pending = postRefresh(cookieHeader).finally(() => {
      refreshInFlight.delete(key);
    });
    refreshInFlight.set(key, pending);
  }
  return pending;
}

function refreshTokenIn(cookieHeader: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const pair = splitCookiePair(part);
    if (pair && pair[0] === REFRESH_TOKEN_COOKIE) return pair[1];
  }
  return undefined;
}

/**
 * tRPC's fetch callback passes either DOM `RequestInit` or its own
 * `RequestInitEsque`. With exactOptionalPropertyTypes those differ on
 * `signal`: the DOM type uses `null`, tRPC uses `undefined`.
 */
type SessionFetchInit = {
  body?: RequestInit['body'];
  headers?: RequestInit['headers'];
  method?: RequestInit['method'];
  signal?: AbortSignal | null | undefined;
  credentials?: RequestCredentials;
  cache?: RequestCache;
};

/**
 * Browser tRPC fetch. On UNAUTHENTICATED, rotate the session once and
 * retry. A failed refresh still retries once: a parallel tab may have
 * won the rotation and stored the new cookies.
 */
export async function fetchWithSessionRefresh(
  url: RequestInfo | URL,
  options?: SessionFetchInit,
  retried = false,
): Promise<Response> {
  const init: RequestInit = { credentials: 'include' };
  if (options?.method !== undefined) init.method = options.method;
  if (options?.headers !== undefined) init.headers = options.headers;
  if (options?.body !== undefined) init.body = options.body;
  if (options?.cache !== undefined) init.cache = options.cache;
  if (options?.signal != null) init.signal = options.signal;
  const response = await fetch(url, init);
  if (retried || !shouldRefreshProcedures(String(url))) return response;
  const body = await response.clone().text();
  if (!responseDeclaresUnauthenticated(body)) return response;
  await refreshSession();
  return fetchWithSessionRefresh(url, options, true);
}

async function postRefresh(cookieHeader?: string): Promise<SessionRefreshResult> {
  try {
    const response = await fetch(`${API_PUBLIC_URL}/trpc/auth.refresh`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      // An empty object, not `null`: the API's JSON body parser is strict
      // (objects and arrays only) and answered `null` with a 400 that
      // carried no CORS headers, so no session was ever renewed and every
      // user was sent to /login when the access token expired (ADR-158).
      body: '{}',
      cache: 'no-store',
      credentials: cookieHeader ? 'omit' : 'include',
    });
    const setCookies = response.headers.getSetCookie?.() ?? [];
    return { ok: response.ok, setCookies };
  } catch {
    return { ok: false, setCookies: [] };
  }
}

function decodeJwtPayload(token: string): { exp?: unknown } | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as { exp?: unknown };
  } catch {
    return null;
  }
}

function splitCookiePair(part: string): [string, string] | null {
  const eq = part.indexOf('=');
  if (eq <= 0) return null;
  const name = part.slice(0, eq).trim();
  if (!name) return null;
  return [name, part.slice(eq + 1).trim()];
}
