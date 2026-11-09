import { describe, expect, it } from 'vitest';
import { redact } from './redact';

describe('redact', () => {
  it('masks keys matching sensitive patterns', () => {
    const result = redact({ password: 'hunter2', name: 'ok' }) as Record<string, unknown>;
    expect(result.password).toBe('[REDACTED]');
    expect(result.name).toBe('ok');
  });

  it('redacts nested sensitive keys', () => {
    const result = redact({ user: { sessionToken: 'abc', id: 1 } }) as {
      user: Record<string, unknown>;
    };
    expect(result.user.sessionToken).toBe('[REDACTED]');
    expect(result.user.id).toBe(1);
  });
});
