export interface NotificationPayload {
  recipientEmail: string;
  subject: string;
  bodyText: string;
}

export interface NotificationSendResult {
  success: boolean;
  providerMessageId?: string | undefined;
  error?: string | undefined;
}

export interface NotificationProvider {
  send(payload: NotificationPayload): Promise<NotificationSendResult>;
}
