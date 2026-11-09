import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import type { Context, Services } from '@zitaware/contracts';
import { withEntityScope, withImpersonator } from '@zitaware/database';
import { parseCookies } from './parse-cookies';

const ACCESS_TOKEN_COOKIE = 'zitaware_crm_access_token';

export function createContextFactory(services: Services) {
  return async function createContext({ req, res }: CreateExpressContextOptions): Promise<Context> {
    const cookies = parseCookies(req.headers.cookie);
    const correlationId = crypto.randomUUID();

    let auth: Context['auth'] = { user: null, permissions: new Set(), sessionId: null };
    let entityAccess: NonNullable<Context['entityAccess']> = { kind: 'ALL' };
    let impersonatorUserId: string | null = null;

    const accessToken = cookies[ACCESS_TOKEN_COOKIE];
    if (accessToken) {
      const verified = await services.auth.verifyAccessToken(accessToken);
      if (verified) {
        const permissions = await services.roles.getEffectivePermissions({
          organizationId: verified.organizationId,
          userId: verified.userId,
        });
        auth = {
          user: { id: verified.userId, organizationId: verified.organizationId },
          permissions,
          sessionId: verified.sessionId,
        };
        impersonatorUserId = verified.impersonatorUserId;
        // ADR-172: without legal_entity.access_all, only the legal entity on
        // the user's own employee record; with none set, nothing.
        if (!permissions.has('legal_entity.access_all')) {
          const legalEntityId = await services.employees.legalEntityOfUser({ organizationId: verified.organizationId, userId: verified.userId });
          entityAccess = legalEntityId ? { kind: 'OWN', legalEntityId } : { kind: 'NONE' };
        }
      }
    }
    const scope =
      entityAccess.kind === 'ALL' ? null : { legalEntityIds: entityAccess.kind === 'OWN' ? [entityAccess.legalEntityId] : [] };

    return {
      correlationId,
      requestTimestamp: new Date().toISOString(),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      auth,
      services,
      res,
      cookies,
      entityAccess,
      impersonatorUserId,
      runScoped: (fn) => withImpersonator(impersonatorUserId, () => withEntityScope(scope, fn)),
    };
  };
}
