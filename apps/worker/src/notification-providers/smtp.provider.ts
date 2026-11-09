import nodemailer from 'nodemailer';
import type { NotificationProvider, NotificationPayload, NotificationSendResult } from './provider';

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromEmail: string;
  fromName?: string | undefined;
}

/** The slice of a nodemailer transporter this provider uses, so tests can
 * supply a stub instead of opening a real SMTP connection. */
export interface MailTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<{ messageId?: string | undefined }>;
}

export function createSmtpTransport(settings: SmtpSettings): MailTransport {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    // 465 is implicit TLS; any other port (587) upgrades with STARTTLS.
    secure: settings.port === 465,
    requireTLS: settings.port !== 465,
    auth: { user: settings.user, pass: settings.pass },
  });
}

export function formatFromAddress(fromEmail: string, fromName: string | undefined): string {
  if (!fromName) return fromEmail;
  // Quote the display name so commas or other specials in it stay part of it.
  return `"${fromName.replace(/["\\]/g, '\\$&')}" <${fromEmail}>`;
}

/** Sends notification email over SMTP (Gmail by default, ADR-190). */
export class SmtpNotificationProvider implements NotificationProvider {
  private readonly from: string;

  constructor(
    private readonly transport: MailTransport,
    fromEmail: string,
    fromName?: string | undefined,
  ) {
    this.from = formatFromAddress(fromEmail, fromName);
  }

  async send(payload: NotificationPayload): Promise<NotificationSendResult> {
    try {
      const info = await this.transport.sendMail({
        from: this.from,
        to: payload.recipientEmail,
        subject: payload.subject,
        text: payload.bodyText,
      });
      return { success: true, providerMessageId: info.messageId };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
