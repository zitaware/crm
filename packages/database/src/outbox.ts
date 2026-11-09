import { Prisma, type PrismaClient } from '@prisma/client';
import { generateId } from './uuid';

export interface EnqueueOutboxEventInput {
  organizationId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
}

/**
 * Inserts one outbox row. Call inside the same `$transaction` as the
 * business mutation and its `recordAuditEvent` call — this is what makes
 * the async side effect (e.g. a notification) atomic with the command.
 */
export async function enqueueOutboxEvent(
  tx: Prisma.TransactionClient,
  input: EnqueueOutboxEventInput,
): Promise<string> {
  const id = generateId();
  await tx.outboxEvent.create({
    data: {
      id,
      organizationId: input.organizationId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload as Prisma.InputJsonValue,
    },
  });
  return id;
}

export interface ClaimedOutboxEvent {
  id: string;
  organizationId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  attempts: number;
}

/**
 * Claims a batch of PENDING rows (plus any PROCESSING rows whose lease has
 * expired — an abandoned claim from a crashed worker) using
 * `FOR UPDATE SKIP LOCKED` so concurrent worker ticks never double-claim
 * the same row. This is the sole mechanism preventing duplicate delivery
 * at the claim layer; final dedup is `notifications.source_outbox_event_id`
 * being unique.
 */
export async function claimOutboxBatch(
  prisma: PrismaClient,
  options: { workerId: string; batchSize: number; leaseTimeoutMinutes: number },
): Promise<ClaimedOutboxEvent[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      organization_id: string;
      aggregate_type: string;
      aggregate_id: string;
      event_type: string;
      payload: unknown;
      attempts: number;
    }>
  >(Prisma.sql`
    WITH claimed AS (
      SELECT id FROM outbox_events
      WHERE (status = 'PENDING' AND next_attempt_at <= now())
         OR (status = 'PROCESSING' AND locked_at < now() - (${options.leaseTimeoutMinutes}::text || ' minutes')::interval)
      ORDER BY created_at
      LIMIT ${options.batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE outbox_events
    SET status = 'PROCESSING', locked_at = now(), locked_by = ${options.workerId}
    WHERE id IN (SELECT id FROM claimed)
    RETURNING id, organization_id, aggregate_type, aggregate_id, event_type, payload, attempts
  `);

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    payload: row.payload,
    attempts: row.attempts,
  }));
}

export async function markOutboxPublished(prisma: PrismaClient, id: string): Promise<void> {
  await prisma.outboxEvent.update({
    where: { id },
    data: { status: 'PUBLISHED', processedAt: new Date(), lockedAt: null, lockedBy: null },
  });
}

const BACKOFF_MINUTES_BY_ATTEMPT = [0.5, 2, 10, 30, 60];
const MAX_ATTEMPTS = BACKOFF_MINUTES_BY_ATTEMPT.length;

/** Tiered backoff: 30s, 2m, 10m, 30m, 1h, then dead-letter. Not exponential. */
function nextAttemptDelayMinutes(attempts: number): number {
  const index = Math.max(0, Math.min(attempts, BACKOFF_MINUTES_BY_ATTEMPT.length - 1));
  // Safe: index is clamped to the array's valid range above.
  return BACKOFF_MINUTES_BY_ATTEMPT[index]!;
}

export async function markOutboxFailedOrDeadLettered(
  prisma: PrismaClient,
  id: string,
  error: string,
): Promise<void> {
  const current = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
  const attempts = current.attempts + 1;

  if (attempts >= MAX_ATTEMPTS) {
    await prisma.outboxEvent.update({
      where: { id },
      data: { status: 'DEAD_LETTERED', attempts, lastError: error, lockedAt: null, lockedBy: null },
    });
    return;
  }

  const delayMs = nextAttemptDelayMinutes(attempts) * 60_000;
  await prisma.outboxEvent.update({
    where: { id },
    data: {
      status: 'PENDING',
      attempts,
      lastError: error,
      nextAttemptAt: new Date(Date.now() + delayMs),
      lockedAt: null,
      lockedBy: null,
    },
  });
}
