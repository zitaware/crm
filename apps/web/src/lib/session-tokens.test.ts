import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isAccessTokenExpired,
  mergeCookieHeader,
  readSetCookiePairs,
  refreshSession,
  responseDeclaresUnauthenticated,
  shouldRefreshProcedures,
} from './session-tokens';

function tokenExpiringAt(expSeconds: number): string {
  const payload = btoa(JSON.stringify({ exp: expSeconds }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

describe('session tokens', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('treats a JWT as expired only once its exp is in the past', () => {
    const now = Date.parse('2026-09-29T04:00:00Z');
    expect(isAccessTokenExpired(tokenExpiringAt(now / 1000 - 1), now)).toBe(true);
    expect(isAccessTokenExpired(tokenExpiringAt(now / 1000 + 60), now)).toBe(false);
    expect(isAccessTokenExpired('not-a-jwt', now)).toBe(false);
  });

  it('does not refresh credential procedures', () => {
    expect(shouldRefreshProcedures('http://localhost:4000/trpc/auth.login?batch=1')).toBe(false);
    expect(shouldRefreshProcedures('http://localhost:4000/trpc/projects.list?batch=1')).toBe(true);
  });

  it('recognises the unauthenticated business code in a tRPC body', () => {
    expect(responseDeclaresUnauthenticated('{"error":{"data":{"appErrorCode":"UNAUTHENTICATED"}}}')).toBe(true);
    expect(responseDeclaresUnauthenticated('{"error":{"data":{"appErrorCode":"FORBIDDEN"}}}')).toBe(false);
  });

  it('merges rotated cookies into the request cookie header', () => {
    const merged = mergeCookieHeader('zitaware_crm_access_token=old; other=1', [
      ['zitaware_crm_access_token', 'new'],
      ['zitaware_crm_refresh_token', 'rotated'],
    ]);
    expect(merged).toBe('zitaware_crm_access_token=new; other=1; zitaware_crm_refresh_token=rotated');
  });

  it('reads the name and value from Set-Cookie lines', () => {
    expect(
      readSetCookiePairs(['zitaware_crm_access_token=abc.def; Path=/; HttpOnly; SameSite=Lax']),
    ).toEqual([['zitaware_crm_access_token', 'abc.def']]);
  });

  it('shares one refresh call across concurrent callers with the same refresh token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { getSetCookie: () => ['zitaware_crm_access_token=new; Path=/; HttpOnly'] },
    });
    vi.stubGlobal('fetch', fetchMock);

    const [first, second] = await Promise.all([
      refreshSession('zitaware_crm_refresh_token=r'),
      refreshSession('other=1; zitaware_crm_refresh_token=r'),
    ]);

    expect(first).toEqual({ ok: true, setCookies: ['zitaware_crm_access_token=new; Path=/; HttpOnly'] });
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/trpc/auth.refresh',
      expect.objectContaining({
        method: 'POST',
        body: '{}',
        credentials: 'omit',
        headers: expect.objectContaining({ cookie: 'zitaware_crm_refresh_token=r' }),
      }),
    );
  });

  it("never answers one user's refresh with another user's (ADR-158)", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: { headers: Record<string, string> }) =>
      Promise.resolve({ ok: true, headers: { getSetCookie: () => [`zitaware_crm_access_token=for-${init.headers.cookie}; Path=/`] } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([refreshSession('zitaware_crm_refresh_token=userA'), refreshSession('zitaware_crm_refresh_token=userB')]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(a.setCookies[0]).toContain('userA');
    expect(b.setCookies[0]).toContain('userB');
  });
});
