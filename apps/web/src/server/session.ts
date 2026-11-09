import { cookies } from 'next/headers';

import { ACCESS_TOKEN_COOKIE } from '@/lib/session-tokens';

const API_PUBLIC_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export { ACCESS_TOKEN_COOKIE };

export interface ServerSession {
  userId: string;
  organizationId: string;
  displayName: string | null;
  organizationName: string | null;
  /** The legal entity of the user's own employee record: the sidebar shows it in place of the organization. */
  brandName: string | null;
  brandHasLogo: boolean;
  permissions: string[];
}

/**
 * Server-side session check for the (platform) route group's layout.
 * Runs during SSR on the Next.js server, before any protected markup is
 * produced — this is the actual authentication guard (docs/04-screen-contracts.md
 * §5.2: "Block direct route access on the server when permission or
 * project scope is missing"), not merely a client-side redirect-on-error.
 *
 * apps/web and apps/api are different origins, so the incoming request's
 * cookie has to be forwarded manually — Server Components don't do this
 * automatically for an outgoing fetch to a different host.
 */
export async function getServerSession(): Promise<ServerSession | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return null;
  }

  try {
    const response = await fetch(`${API_PUBLIC_URL}/trpc/auth.me`, {
      headers: { Cookie: `${ACCESS_TOKEN_COOKIE}=${accessToken}` },
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { result?: { data?: ServerSession } };
    return body.result?.data ?? null;
  } catch {
    return null;
  }
}
