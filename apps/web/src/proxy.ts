import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  isAccessTokenExpired,
  mergeCookieHeader,
  readSetCookiePairs,
  refreshSession,
} from '@/lib/session-tokens';

/**
 * Fast-path redirect for requests with no usable session. An expired
 * access token is renewed from the refresh cookie before the page
 * renders, so a one-hour access token does not end a still-valid day-long
 * session. This remains a presence/expiry check; signature and revocation
 * are still confirmed by auth.me in (platform)/layout.tsx.
 */
export async function proxy(request: NextRequest) {
  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  const accessUsable = accessToken !== undefined && !isAccessTokenExpired(accessToken);

  if (accessUsable) {
    return NextResponse.next();
  }
  if (!refreshToken) {
    return redirectToLogin(request);
  }

  const cookieHeader = request.headers.get('cookie');
  const refreshed = await refreshSession(cookieHeader ?? undefined);
  if (!refreshed.ok || refreshed.setCookies.length === 0) {
    return redirectToLogin(request);
  }

  // One refresh call both rotates the token and returns the new cookies.
  // A second call with the same refresh token would be treated as reuse
  // and would revoke the session. Copy the new cookies onto this response
  // and onto the request the layout is about to read.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('cookie', mergeCookieHeader(cookieHeader, readSetCookiePairs(refreshed.setCookies)));
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const line of refreshed.setCookies) response.headers.append('set-cookie', line);
  return response;
}

function redirectToLogin(request: NextRequest) {
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except: API routes, Next's own static/image assets, the
  // unauthenticated (auth) screens themselves, and any request for a
  // file with an extension (public/ assets like logo-mark.png, favicon.png).
  matcher: ['/((?!api|_next/static|_next/image|login|forgot-password|reset-password|accept-invite|.*\\..*).*)'],
};
