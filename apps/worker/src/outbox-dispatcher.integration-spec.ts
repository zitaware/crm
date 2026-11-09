import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, generateId, enqueueOutboxEvent } from '@zitaware/database';
import { dispatchOutboxBatch } from './outbox-dispatcher';
import type { NotificationProvider, NotificationSendResult } from './notification-providers/provider';

const prisma = createPrismaClient();

let organizationId: string;

class RecordingProvider implements NotificationProvider {
  sent: Array<{ recipientEmail: string; subject: string }> = [];
  nextResult: NotificationSendResult = { success: true, providerMessageId: 'test-message-id' };

  async send(payload: { recipientEmail: string; subject: string; bodyText: string }): Promise<NotificationSendResult> {
    this.sent.push({ recipientEmail: payload.recipientEmail, subject: payload.subject });
    return this.nextResult;
  }
}

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { id: generateId(), name: 'Outbox Test Org', code: `OUTBOXTEST-${generateId()}` },
  });
  organizationId = organization.id;

  // dispatchOutboxBatch claims the oldest due events of ANY organization, and
  // other specs' global jobs (the payment-alert opener sweeps every
  // organization) can leave due events behind in the shared test database.
  // Those would be claimed ahead of this spec's own and starve its asserts,
  // so park them first. Worker spec files run one at a time, so nothing
  // refills the queue while this file runs.
  await prisma.outboxEvent.updateMany({
    where: { organizationId: { not: organizationId }, status: 'PENDING' },
    data: { nextAttemptAt: new Date('2999-01-01T00:00:00.000Z') },
  });
  await prisma.outboxEvent.updateMany({
    where: { organizationId: { not: organizationId }, status: 'PROCESSING' },
    data: { lockedAt: new Date() },
  });
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { organizationId } });
  await prisma.outboxEvent.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
  await prisma.$disconnect();
});

describe('dispatchOutboxBatch', () => {
  it('claims a USER_INVITATION_EMAIL event, sends it, and marks it published', async () => {
    const provider = new RecordingProvider();
    const outboxId = await prisma.$transaction((tx) =>
      enqueueOutboxEvent(tx, {
        organizationId,
        aggregateType: 'USER',
        aggregateId: generateId(),
        eventType: 'USER_INVITATION_EMAIL',
        payload: { email: 'invitee@zitaware.test', displayName: 'Invitee', invitationToken: 'tok123' },
      }),
    );

    const result = await dispatchOutboxBatch({
      prisma,
      provider,
      workerId: 'test-worker',
      batchSize: 10,
      leaseTimeoutMinutes: 5,
      webPublicUrl: 'https://app.example.test',
    });

    expect(result.claimed).toBeGreaterThanOrEqual(1);
    expect(provider.sent.some((s) => s.recipientEmail === 'invitee@zitaware.test')).toBe(true);

    const outboxRow = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: outboxId } });
    expect(outboxRow.status).toBe('PUBLISHED');

    const notification = await prisma.notification.findUniqueOrThrow({
      where: { sourceOutboxEventId: outboxId },
    });
    expect(notification.status).toBe('SENT');
    expect(notification.recipientEmail).toBe('invitee@zitaware.test');
  });

  it('marks a failed send as PENDING with a later next_attempt_at (retry scheduled)', async () => {
    const provider = new RecordingProvider();
    provider.nextResult = { success: false, error: 'simulated provider failure' };

    const outboxId = await prisma.$transaction((tx) =>
      enqueueOutboxEvent(tx, {
        organizationId,
        aggregateType: 'USER',
        aggregateId: generateId(),
        eventType: 'USER_PASSWORD_RESET_EMAIL',
        payload: { email: 'resetme@zitaware.test', displayName: 'Reset Me', resetToken: 'reset123' },
      }),
    );

    await dispatchOutboxBatch({
      prisma,
      provider,
      workerId: 'test-worker',
      batchSize: 10,
      leaseTimeoutMinutes: 5,
      webPublicUrl: 'https://app.example.test',
    });

    const outboxRow = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: outboxId } });
    expect(outboxRow.status).toBe('PENDING');
    expect(outboxRow.attempts).toBe(1);
    expect(outboxRow.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    const notification = await prisma.notification.findUniqueOrThrow({
      where: { sourceOutboxEventId: outboxId },
    });
    expect(notification.status).toBe('FAILED');
  });

  it('reclaims an abandoned PROCESSING row past its lease and does not double-send', async () => {
    const provider = new RecordingProvider();
    const outboxId = await prisma.$transaction((tx) =>
      enqueueOutboxEvent(tx, {
        organizationId,
        aggregateType: 'USER',
        aggregateId: generateId(),
        eventType: 'USER_INVITATION_EMAIL',
        payload: { email: 'abandoned@zitaware.test', displayName: 'Abandoned', invitationToken: 'tokabandoned' },
      }),
    );

    // Simulate a worker that claimed the row, created the notification, then
    // crashed before marking the outbox row published — lease now expired.
    const notificationId = generateId();
    await prisma.outboxEvent.update({
      where: { id: outboxId },
      data: {
        status: 'PROCESSING',
        lockedAt: new Date(Date.now() - 10 * 60_000),
        lockedBy: 'crashed-worker',
      },
    });
    await prisma.notification.create({
      data: {
        id: notificationId,
        organizationId,
        recipientEmail: 'abandoned@zitaware.test',
        template: 'user_invitation',
        payload: { email: 'abandoned@zitaware.test' },
        status: 'SENT',
        sourceOutboxEventId: outboxId,
        sentAt: new Date(),
      },
    });

    const result = await dispatchOutboxBatch({
      prisma,
      provider,
      workerId: 'recovering-worker',
      batchSize: 10,
      leaseTimeoutMinutes: 5,
      webPublicUrl: 'https://app.example.test',
    });

    expect(result.claimed).toBeGreaterThanOrEqual(1);
    // Recovery path finalizes the outbox row without calling the provider
    // again — no duplicate send for this event.
    expect(provider.sent.some((s) => s.recipientEmail === 'abandoned@zitaware.test')).toBe(false);

    const outboxRow = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: outboxId } });
    expect(outboxRow.status).toBe('PUBLISHED');

    const notificationCount = await prisma.notification.count({ where: { sourceOutboxEventId: outboxId } });
    expect(notificationCount).toBe(1);
  });

  it('claims a PAYMENT_ALERT_OPENED event, sends it, and marks it published', async () => {
    const provider = new RecordingProvider();
    const outboxId = await prisma.$transaction((tx) =>
      enqueueOutboxEvent(tx, {
        organizationId,
        aggregateType: 'PAYMENT_ALERT',
        aggregateId: generateId(),
        eventType: 'PAYMENT_ALERT_OPENED',
        payload: { email: 'accountant@zitaware.test', title: 'CAP-001-E01 — Go-Live', amount: '3500000.00', dueDate: '2026-04-30' },
      }),
    );

    const result = await dispatchOutboxBatch({
      prisma,
      provider,
      workerId: 'test-worker',
      batchSize: 10,
      leaseTimeoutMinutes: 5,
      webPublicUrl: 'https://app.example.test',
    });

    expect(result.claimed).toBeGreaterThanOrEqual(1);
    expect(provider.sent.some((s) => s.recipientEmail === 'accountant@zitaware.test' && s.subject.includes('CAP-001-E01'))).toBe(true);

    const outboxRow = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: outboxId } });
    expect(outboxRow.status).toBe('PUBLISHED');

    const notification = await prisma.notification.findUniqueOrThrow({ where: { sourceOutboxEventId: outboxId } });
    expect(notification.status).toBe('SENT');
    expect(notification.template).toBe('payment_alert_opened');
  });
});
