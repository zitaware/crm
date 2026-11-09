import { afterEach, describe, expect, it, vi } from 'vitest';

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: cookiesMock }));

import { getServerSession } from './session';

describe('getServerSession', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cookiesMock.mockReset();
  });

  it('returns null when no access-token cookie is present', async () => {
    cookiesMock.mockResolvedValue({ get: () => undefined });

    const session = await getServerSession();

    expect(session).toBeNull();
  });

  it('returns the profile when the API confirms the session', async () => {
    cookiesMock.mockResolvedValue({ get: () => ({ value: 'a-valid-token' }) });
    const profile = {
      userId: 'u1',
      organizationId: 'o1',
      displayName: 'Alkesh',
      organizationName: 'Zitaware Solutions',
      permissions: ['master.read'],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: { data: profile } }) }),
    );

    const session = await getServerSession();

    expect(session).toEqual(profile);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/trpc/auth.me'),
      expect.objectContaining({ headers: { Cookie: 'zitaware_crm_access_token=a-valid-token' } }),
    );
  });

  it('returns null when the API rejects the token', async () => {
    cookiesMock.mockResolvedValue({ get: () => ({ value: 'an-expired-token' }) });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const session = await getServerSession();

    expect(session).toBeNull();
  });

  it('returns null when the request itself fails', async () => {
    cookiesMock.mockResolvedValue({ get: () => ({ value: 'a-token' }) });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const session = await getServerSession();

    expect(session).toBeNull();
  });
});
