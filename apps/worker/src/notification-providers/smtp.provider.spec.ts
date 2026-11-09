import { describe, expect, it, vi } from 'vitest';
import { SmtpNotificationProvider, formatFromAddress, type MailTransport } from './smtp.provider';

const payload = { recipientEmail: 'user@zitaware.test', subject: 'Invitation', bodyText: 'Hello' };

describe('SmtpNotificationProvider', () => {
  it('sends the payload from the configured address and returns the message id', async () => {
    const sendMail = vi.fn<MailTransport['sendMail']>().mockResolvedValue({ messageId: '<abc@zitaware.test>' });
    const provider = new SmtpNotificationProvider({ sendMail }, 'zitawaresolutions@gmail.com', 'Zitaware CRM');

    const result = await provider.send(payload);

    expect(result).toEqual({ success: true, providerMessageId: '<abc@zitaware.test>' });
    expect(sendMail).toHaveBeenCalledWith({
      from: '"Zitaware CRM" <zitawaresolutions@gmail.com>',
      to: 'user@zitaware.test',
      subject: 'Invitation',
      text: 'Hello',
    });
  });

  it('reports a transport failure instead of throwing, so the outbox can retry', async () => {
    const sendMail = vi.fn<MailTransport['sendMail']>().mockRejectedValue(new Error('535 Invalid credentials'));
    const provider = new SmtpNotificationProvider({ sendMail }, 'zitawaresolutions@gmail.com');

    await expect(provider.send(payload)).resolves.toEqual({ success: false, error: '535 Invalid credentials' });
  });
});

describe('formatFromAddress', () => {
  it('uses the bare address when no display name is set', () => {
    expect(formatFromAddress('a@zitaware.test', undefined)).toBe('a@zitaware.test');
  });

  it('quotes and escapes the display name', () => {
    expect(formatFromAddress('a@zitaware.test', 'Acme, "CRM"')).toBe('"Acme, \\"CRM\\"" <a@zitaware.test>');
  });
});
