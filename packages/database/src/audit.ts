import { Prisma } from '@prisma/client';
import { currentImpersonator } from './entity-scope';
import { generateId } from './uuid';

export interface RecordAuditEventInput {
  organizationId: string;
  legalEntityId?: string | undefined;
  entityType: string;
  entityId: string;
  action: string;
  actorId?: string | undefined;
  actorEmail?: string | undefined;
  oldValues?: unknown;
  newValues?: unknown;
  commandPayload?: unknown;
  reason?: string | undefined;
  correlationId: string;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * Writes one append-only audit_events row. Must always be called inside
 * the same `$transaction` as the business mutation it describes — never
 * from the router/procedure layer directly (docs/08: "command handlers
 * own the transaction"). The audit_events table itself has UPDATE/DELETE
 * revoked for the app's runtime role (see the phase2_00b migration).
 *
 * docs/09 requires an actor-email snapshot on every audit event, but most
 * call sites only have `actorId` on hand (the tRPC auth context carries no
 * email — only `{ id, organizationId }`), so `actorEmail` is resolved here
 * from `actorId` when the caller doesn't supply it explicitly, rather than
 * threading an extra parameter through every router/service in the app.
 * Callers that already have the row loaded (e.g. IdentityService, which is
 * doing auth) may still pass `actorEmail` directly to skip the lookup.
 */
export async function recordAuditEvent(
  tx: Prisma.TransactionClient,
  input: RecordAuditEventInput,
): Promise<void> {
  let actorEmail = input.actorEmail ?? null;
  if (!actorEmail && input.actorId) {
    const actor = await tx.user.findUnique({ where: { id: input.actorId }, select: { email: true } });
    actorEmail = actor?.email ?? null;
  }

  // ADR-174: what an Admin does while viewing as another user names the Admin.
  const impersonatorUserId = currentImpersonator();
  const commandPayload = impersonatorUserId
    ? { ...((input.commandPayload as Record<string, unknown> | undefined) ?? {}), impersonatedBy: impersonatorUserId }
    : input.commandPayload;

  await tx.auditEvent.create({
    data: {
      id: generateId(),
      organizationId: input.organizationId,
      legalEntityId: input.legalEntityId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorId: input.actorId ?? null,
      actorEmail,
      oldValues: (input.oldValues as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
      newValues: (input.newValues as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
      commandPayload: (commandPayload as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
      reason: input.reason ?? null,
      correlationId: input.correlationId,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}
