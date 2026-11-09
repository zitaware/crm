import { initTRPC } from '@trpc/server';
import type { Context } from './context';
import { throwAppError, type AppErrorCode } from './errors';

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    const cause = error.cause as { appErrorCode?: AppErrorCode } | undefined;
    return {
      ...shape,
      data: { ...shape.data, appErrorCode: cause?.appErrorCode ?? null },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const mergeRouters = t.mergeRouters;
/** For tests that call procedures directly, permission middleware included. */
export const createCallerFactory = t.createCallerFactory;

/** Requires a valid, non-expired, non-revoked session. Throws
 * UNAUTHENTICATED (not FORBIDDEN) when there is no session at all. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.auth.user) {
    throwAppError('UNAUTHENTICATED', 'A valid session is required.');
  }
  // Held here: a narrowed property does not stay narrowed inside a closure.
  const user = ctx.auth.user;
  const run = () => next({ ctx: { ...ctx, auth: { ...ctx.auth, user } } });
  // Every signed-in procedure runs in the user's entity scope (ADR-172).
  return (ctx.runScoped ? ctx.runScoped(run) : run()) as ReturnType<typeof run>;
});

/** Requires the resolved permission set to include `permissionKey`. Must be
 * chained after protectedProcedure (or is itself protected). Throws
 * FORBIDDEN — the caller is authenticated but lacks the grant. */
export function requirePermission(permissionKey: string) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!ctx.auth.permissions.has(permissionKey)) {
      throwAppError('FORBIDDEN', `Missing permission: ${permissionKey}`);
    }
    return next({ ctx });
  });
}

/** Like `requirePermission`, but passes if the caller holds any one of
 * `permissionKeys` — for a lookup that legitimately serves more than one
 * "owning" permission (e.g. a GST-registration picker needed by both
 * `legal_entity.read` holders and `vendor_bill.create` holders) without
 * granting either role the other's full permission. */
export function requireAnyPermission(...permissionKeys: string[]) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!permissionKeys.some((key) => ctx.auth.permissions.has(key))) {
      throwAppError('FORBIDDEN', `Missing one of permissions: ${permissionKeys.join(', ')}`);
    }
    return next({ ctx });
  });
}
