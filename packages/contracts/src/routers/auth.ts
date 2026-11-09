import { z } from 'zod';
import { publicProcedure, protectedProcedure, requirePermission, router } from '../trpc';
import { throwAppError } from '../errors';
import type { CookieSetter } from '../context';
import type { IssuedSessionTokens } from '../ports/auth.port';

const ACCESS_TOKEN_COOKIE = 'zitaware_crm_access_token';
const REFRESH_TOKEN_COOKIE = 'zitaware_crm_refresh_token';

// `secure: true` unconditionally would make browsers silently refuse to
// store/send the cookie over plain http://localhost in local dev — curl
// doesn't enforce this browser-only rule, which is why it went unnoticed
// during curl-based backend testing. Only require Secure in production,
// where the app is actually served over HTTPS.
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

export const authRouter = router({
  login: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.services.auth.login({
        email: input.email,
        password: input.password,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        correlationId: ctx.correlationId,
      });
      setSessionCookies(ctx.res, result);
      return { status: 'ok' as const };
    }),

  refresh: publicProcedure.mutation(async ({ ctx }) => {
    const refreshToken = requireCookie(ctx.cookies, REFRESH_TOKEN_COOKIE);
    const result = await ctx.services.auth.refresh({
      refreshToken,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });
    setSessionCookies(ctx.res, result);
    return { status: 'ok' as const };
  }),

  /** ADR-174: an Admin logs in as another user. Not another Admin, and not while already viewing as someone. */
  startImpersonation: requirePermission('user.impersonate')
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.impersonatorUserId) throwAppError('FORBIDDEN', 'Return to your own login first.');
      const targetPermissions = await ctx.services.roles.getEffectivePermissions({ organizationId: ctx.auth.user.organizationId, userId: input.userId });
      if (targetPermissions.has('user.impersonate')) throwAppError('FORBIDDEN', 'You cannot log in as another Admin.');
      const result = await ctx.services.auth.startImpersonation({
        organizationId: ctx.auth.user.organizationId,
        adminUserId: ctx.auth.user.id,
        adminSessionId: ctx.auth.sessionId!,
        targetUserId: input.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        correlationId: ctx.correlationId,
      });
      setSessionCookies(ctx.res, result);
      return { status: 'ok' as const };
    }),

  stopImpersonation: protectedProcedure.mutation(async ({ ctx }) => {
    const result = await ctx.services.auth.stopImpersonation({
      sessionId: ctx.auth.sessionId!,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });
    if (result) {
      setSessionCookies(ctx.res, result);
      return { status: 'ok' as const };
    }
    // The Admin's own login ended meanwhile: sign in again.
    ctx.res.clearCookie(ACCESS_TOKEN_COOKIE, cookieOptions);
    ctx.res.clearCookie(REFRESH_TOKEN_COOKIE, cookieOptions);
    return { status: 'signed_out' as const };
  }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    const refreshToken = requireCookie(ctx.cookies, REFRESH_TOKEN_COOKIE);
    await ctx.services.auth.logout({ refreshToken, correlationId: ctx.correlationId });
    ctx.res.clearCookie(ACCESS_TOKEN_COOKIE, cookieOptions);
    ctx.res.clearCookie(REFRESH_TOKEN_COOKIE, cookieOptions);
    return { status: 'ok' as const };
  }),

  requestPasswordReset: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.auth.requestPasswordReset({
        email: input.email,
        correlationId: ctx.correlationId,
      });
      // Always the same generic response — enumeration prevention.
      return { status: 'ok' as const };
    }),

  completePasswordReset: publicProcedure
    .input(z.object({ token: z.string().min(1), newPassword: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.auth.completePasswordReset({
        token: input.token,
        newPassword: input.newPassword,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  acceptInvite: publicProcedure
    .input(z.object({ token: z.string().min(1), password: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.services.auth.acceptInvite({
        token: input.token,
        password: input.password,
        correlationId: ctx.correlationId,
      });
      setSessionCookies(ctx.res, result);
      return { status: 'ok' as const };
    }),

  /** The sidebar logo of the user's own legal entity. Fetched apart from `me`, which every page loads, to keep that small. */
  brandLogo: protectedProcedure.query(async ({ ctx }) => ctx.services.auth.getBrandLogo(ctx.auth.user!.id, ctx.auth.user!.organizationId)),

  me: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.auth.user!.id;
    const organizationId = ctx.auth.user!.organizationId;
    const profile = await ctx.services.auth.getProfile(userId, organizationId);
    return {
      userId,
      organizationId,
      displayName: profile?.displayName ?? null,
      organizationName: profile?.organizationName ?? null,
      /** The user's own legal entity, shown in the sidebar in place of the organization (white labelling). */
      brandName: profile?.brandName ?? null,
      brandHasLogo: profile?.brandHasLogo ?? false,
      permissions: Array.from(ctx.auth.permissions),
      /** ALL, OWN or NONE (ADR-172); the screens say so when it is NONE. */
      legalEntityAccess: ctx.entityAccess?.kind ?? 'ALL',
      /** The Admin viewing as this user (ADR-174); the screens show a way back. */
      impersonatedBy: ctx.impersonatorUserId && ctx.auth.sessionId ? await ctx.services.auth.getImpersonator(ctx.auth.sessionId) : null,
    };
  }),
});

function setSessionCookies(res: CookieSetter, result: IssuedSessionTokens) {
  res.cookie(ACCESS_TOKEN_COOKIE, result.accessToken, {
    ...cookieOptions,
    expires: result.accessExpiresAt,
  });
  res.cookie(REFRESH_TOKEN_COOKIE, result.refreshToken, {
    ...cookieOptions,
    expires: result.refreshExpiresAt,
  });
}

function requireCookie(cookies: Record<string, string>, name: string): string {
  const value = cookies[name];
  if (!value) {
    throwAppError('UNAUTHENTICATED', `Missing ${name} cookie`);
  }
  return value;
}
