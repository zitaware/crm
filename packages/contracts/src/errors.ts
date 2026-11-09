import { TRPCError } from '@trpc/server';
import type { TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc';

/**
 * Stable business error codes from docs/08-api-contracts.md, plus
 * `UNAUTHENTICATED` (proposed addition — see docs/12-decisions-log.md
 * ADR-035+ — for "no valid session," distinct from `FORBIDDEN`, which
 * means "authenticated but lacking permission").
 */
export type AppErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'INVALID_STATE_TRANSITION'
  | 'SELF_APPROVAL_NOT_ALLOWED'
  | 'IDEMPOTENCY_CONFLICT';

const TRPC_CODE_BY_APP_ERROR: Record<AppErrorCode, TRPC_ERROR_CODE_KEY> = {
  VALIDATION_FAILED: 'BAD_REQUEST',
  UNAUTHENTICATED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VERSION_CONFLICT: 'CONFLICT',
  INVALID_STATE_TRANSITION: 'CONFLICT',
  SELF_APPROVAL_NOT_ALLOWED: 'FORBIDDEN',
  IDEMPOTENCY_CONFLICT: 'CONFLICT',
};

/**
 * Throws a TRPCError carrying both the transport-level tRPC code (for
 * correct HTTP status mapping) and the project's own stable business code
 * (in `cause`, for typed client-side handling) — e.g.
 * `throwAppError('VERSION_CONFLICT', 'Record was modified by another user')`.
 */
export function throwAppError(code: AppErrorCode, message: string): never {
  throw new TRPCError({
    code: TRPC_CODE_BY_APP_ERROR[code],
    message,
    cause: { appErrorCode: code },
  });
}
