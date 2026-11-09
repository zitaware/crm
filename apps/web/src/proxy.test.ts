import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

function requestFor(path: string, cookie?: string) {
  return new NextRequest(new URL(path, 'http://localhost:3000'), cookie ? { headers: { cookie } } : {});
}

function expiredAccessToken(): string {
  const exp = Math.floor(Date.now() / 1000) - 60;
  const payload = btoa(JSON.stringify({ exp })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

describe('proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('passes through when the access-token cookie is present', async () => {
    const response = await proxy(requestFor('/projects/123', 'zitaware_crm_access_token=a-token'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('redirects to /login with the attempted path and query captured as next', async () => {
    const response = await proxy(requestFor('/projects/123?tab=milestones'));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/projects/123?tab=milestones');
  });

  it('redirects the bare root path with next=/', async () => {
    const response = await proxy(requestFor('/'));

    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('next')).toBe('/');
  });

  it('renews an expired access token once and forwards the new cookies', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        getSetCookie: () => [
          'zitaware_crm_access_token=new-access; Path=/; HttpOnly',
          'zitaware_crm_refresh_token=new-refresh; Path=/; HttpOnly',
        ],
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await proxy(
      requestFor('/projects/123', `zitaware_crm_access_token=${expiredAccessToken()}; zitaware_crm_refresh_token=refresh-1`),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('zitaware_crm_access_token=new-access');
    expect(setCookie).toContain('zitaware_crm_refresh_token=new-refresh');
  });

  it('sends an expired session to login when refresh fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, headers: { getSetCookie: () => [] } }),
    );

    const response = await proxy(
      requestFor('/projects/123', `zitaware_crm_access_token=${expiredAccessToken()}; zitaware_crm_refresh_token=refresh-1`),
    );

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/login');
  });
});
