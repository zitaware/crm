import { createLogger } from '@zitaware/config';
import type { NotificationProvider, NotificationPayload, NotificationSendResult } from './provider';

const logger = createLogger({ service: 'worker' });

/** Dev/test provider: never contacts a real email service, always
 * succeeds, and logs what would have been sent. Selected whenever
 * SMTP_PASS is a placeholder dev value (see notification
 * provider selection in main.ts). */
export class FakeNotificationProvider implements NotificationProvider {
  async send(payload: NotificationPayload): Promise<NotificationSendResult> {
    logger.info('notification.fake_send', {
      recipientEmail: payload.recipientEmail,
      subject: payload.subject,
    });
    return { success: true, providerMessageId: `fake-${Date.now()}` };
  }
}
