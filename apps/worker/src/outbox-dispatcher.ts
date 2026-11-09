import {
  generateId,
  claimOutboxBatch,
  markOutboxPublished,
  markOutboxFailedOrDeadLettered,
  Prisma,
  type PrismaClient,
} from '@zitaware/database';
import { createLogger } from '@zitaware/config';
import type { NotificationProvider } from './notification-providers/provider';

const logger = createLogger({ service: 'worker' });

const NOTIFICATION_EVENT_TYPES = new Set(['USER_INVITATION_EMAIL', 'USER_PASSWORD_RESET_EMAIL', 'PAYMENT_ALERT_OPENED']);

interface RenderedNotification {
  recipientEmail: string;
  subject: string;
  bodyText: string;
  template: string;
}

/** Renders the small, fixed set of Phase 2 transactional emails. Extending
 * this to a real template engine is future-phase scope — Phase 2 only
 * needs the invitation and password-reset emails to prove the pipeline. */
function renderNotification(eventType: string, payload: unknown, webPublicUrl: string): RenderedNotification {
  const data = payload as Record<string, string>;

  switch (eventType) {
    case 'USER_INVITATION_EMAIL':
      return {
        recipientEmail: data.email!,
        subject: 'You have been invited to Zitaware CRM',
        bodyText: `Hello ${data.displayName},\n\nYou have been invited to Zitaware CRM. Accept your invitation here:\n${webPublicUrl}/accept-invite?token=${data.invitationToken}\n`,
        template: 'user_invitation',
      };
    case 'USER_PASSWORD_RESET_EMAIL':
      return {
        recipientEmail: data.email!,
        subject: 'Password reset requested',
        bodyText: `Hello ${data.displayName},\n\nA password reset was requested for your account. Reset it here:\n${webPublicUrl}/reset-password?token=${data.resetToken}\n`,
        template: 'password_reset',
      };
    case 'PAYMENT_ALERT_OPENED':
      return {
        recipientEmail: data.email!,
        subject: `Payment alert: ${data.title}`,
        bodyText: `A payment alert is due.\n\n${data.title}\nAmount: ${data.amount}\nDue date: ${data.dueDate}\n\nOpen the Payment Alert tab on the project to snooze or act on it.\n`,
        template: 'payment_alert_opened',
      };
    default:
      throw new Error(`Unknown notification event type: ${eventType}`);
  }
}

export interface DispatchOutboxBatchOptions {
  prisma: PrismaClient;
  provider: NotificationProvider;
  workerId: string;
  batchSize: number;
  leaseTimeoutMinutes: number;
  webPublicUrl: string;
}

export interface DispatchOutboxBatchResult {
  claimed: number;
  processed: number;
  failed: number;
}

/**
 * Claims a batch of PENDING/abandoned-PROCESSING outbox rows and, for each
 * one that maps to a known notification event type, creates a deduplicated
 * `notifications` row (unique on source_outbox_event_id — recovering from a
 * crash between notification-create and outbox-publish never double-sends)
 * and dispatches it through the given provider. Unknown event types are
 * marked published immediately (no handler exists for them yet) rather than
 * retried forever.
 */
export async function dispatchOutboxBatch(
  options: DispatchOutboxBatchOptions,
): Promise<DispatchOutboxBatchResult> {
  const claimed = await claimOutboxBatch(options.prisma, {
    workerId: options.workerId,
    batchSize: options.batchSize,
    leaseTimeoutMinutes: options.leaseTimeoutMinutes,
  });

  let processed = 0;
  let failed = 0;

  for (const event of claimed) {
    try {
      if (!NOTIFICATION_EVENT_TYPES.has(event.eventType)) {
        logger.warn('outbox.no_handler', { eventType: event.eventType, id: event.id });
        await markOutboxPublished(options.prisma, event.id);
        processed++;
        continue;
      }

      const existingNotification = await options.prisma.notification.findUnique({
        where: { sourceOutboxEventId: event.id },
      });
      if (existingNotification) {
        // Recovering from a prior crash after the notification was created
        // but before the outbox row was marked published — don't resend.
        await markOutboxPublished(options.prisma, event.id);
        processed++;
        continue;
      }

      const rendered = renderNotification(event.eventType, event.payload, options.webPublicUrl);
      const notificationId = generateId();
      await options.prisma.notification.create({
        data: {
          id: notificationId,
          organizationId: event.organizationId,
          recipientEmail: rendered.recipientEmail,
          template: rendered.template,
          payload: event.payload as Prisma.InputJsonValue,
          status: 'PENDING',
          sourceOutboxEventId: event.id,
        },
      });

      const result = await options.provider.send({
        recipientEmail: rendered.recipientEmail,
        subject: rendered.subject,
        bodyText: rendered.bodyText,
      });

      if (result.success) {
        await options.prisma.notification.update({
          where: { id: notificationId },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            providerMessageId: result.providerMessageId ?? null,
          },
        });
        await markOutboxPublished(options.prisma, event.id);
        processed++;
      } else {
        const errorMessage = result.error ?? 'Notification provider reported failure.';
        await options.prisma.notification.update({
          where: { id: notificationId },
          data: { status: 'FAILED', failedReason: errorMessage },
        });
        await markOutboxFailedOrDeadLettered(options.prisma, event.id, errorMessage);
        failed++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('outbox.dispatch_error', { id: event.id, eventType: event.eventType, error: message });
      await markOutboxFailedOrDeadLettered(options.prisma, event.id, message);
      failed++;
    }
  }

  return { claimed: claimed.length, processed, failed };
}

/** Wraps dispatchOutboxBatch with job_runs bookkeeping (RUNNING ->
 * SUCCEEDED/FAILED, items_processed) so operators can see dispatcher tick
 * history without reading logs. */
export async function runOutboxDispatchJob(options: DispatchOutboxBatchOptions): Promise<void> {
  const jobRun = await options.prisma.jobRun.create({
    data: { id: generateId(), jobName: 'outbox-dispatcher', status: 'RUNNING' },
  });

  try {
    const result = await dispatchOutboxBatch(options);
    await options.prisma.jobRun.update({
      where: { id: jobRun.id },
      data: { status: 'SUCCEEDED', itemsProcessed: result.processed, finishedAt: new Date() },
    });
    if (result.claimed > 0) {
      logger.info('outbox.dispatch_tick', result);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await options.prisma.jobRun.update({
      where: { id: jobRun.id },
      data: { status: 'FAILED', error: message, finishedAt: new Date() },
    });
    logger.error('outbox.dispatch_tick_failed', { error: message });
  }
}
