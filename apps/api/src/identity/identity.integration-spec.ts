import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from './identity.service';
import { hashPassword } from './password.util';
import { hashToken } from './token.util';

const prisma = new PrismaService();
const identity = new IdentityService(prisma);

let organizationId: string;
let userId: string;
const testEmail = `identity-test-${generateId()}@zitaware.test`;

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Identity Test Org', code: `IDTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const passwordHash = await hashPassword('CorrectHorseBattery1!');
  const user = await prisma.client.user.create({
    data: {
      id: generateId(),
      organizationId,
      email: testEmail,
      passwordHash,
      displayName: 'Identity Test User',
      status: 'ACTIVE',
    },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.client.session.deleteMany({ where: { organizationId } });
  await prisma.client.userInvitation.deleteMany({ where: { organizationId } });
  await prisma.client.passwordResetToken.deleteMany({ where: { organizationId } });
  await prisma.client.outboxEvent.deleteMany({ where: { organizationId } });
  await prisma.client.auditEvent.deleteMany({ where: { organizationId } });
  await prisma.client.user.deleteMany({ where: { organizationId } });
  await prisma.client.organization.delete({ where: { id: organizationId } });
  await prisma.client.$disconnect();
});

describe('IdentityService.login', () => {
  it('rejects an unknown email with a generic error', async () => {
    await expect(
      identity.login({
        email: 'no-such-user@zitaware.test',
        password: 'anything',
        ipAddress: undefined,
        userAgent: undefined,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('Invalid email or password.');
  });

  it('rejects a wrong password with the same generic error', async () => {
    await expect(
      identity.login({
        email: testEmail,
        password: 'wrong-password',
        ipAddress: undefined,
        userAgent: undefined,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('Invalid email or password.');
  });

  it('issues access + refresh tokens on success and verifies the access token', async () => {
    const result = await identity.login({
      email: testEmail,
      password: 'CorrectHorseBattery1!',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      correlationId: generateId(),
    });

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();

    const verified = await identity.verifyAccessToken(result.accessToken);
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe(userId);
    expect(verified?.organizationId).toBe(organizationId);
  });

  it('locks the account after the configured number of failed attempts', async () => {
    const lockoutEmail = `lockout-test-${generateId()}@zitaware.test`;
    const passwordHash = await hashPassword('SomeStrongPassword1!');
    await prisma.client.user.create({
      data: {
        id: generateId(),
        organizationId,
        email: lockoutEmail,
        passwordHash,
        displayName: 'Lockout Test User',
        status: 'ACTIVE',
      },
    });

    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(
        identity.login({
          email: lockoutEmail,
          password: 'wrong',
          ipAddress: undefined,
          userAgent: undefined,
          correlationId: generateId(),
        }),
      ).rejects.toThrow();
    }

    // Even the correct password now fails — the account is locked.
    await expect(
      identity.login({
        email: lockoutEmail,
        password: 'SomeStrongPassword1!',
        ipAddress: undefined,
        userAgent: undefined,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('Invalid email or password.');
  });
});

describe('IdentityService.refresh', () => {
  it('rotates the refresh token and detects reuse of a rotated token', async () => {
    const initialLogin = await identity.login({
      email: testEmail,
      password: 'CorrectHorseBattery1!',
      ipAddress: undefined,
      userAgent: undefined,
      correlationId: generateId(),
    });

    const refreshed = await identity.refresh({
      refreshToken: initialLogin.refreshToken,
      ipAddress: undefined,
      userAgent: undefined,
      correlationId: generateId(),
    });
    expect(refreshed.refreshToken).not.toBe(initialLogin.refreshToken);

    // Past the reuse grace window (ADR-158): move the rotation back in time.
    await prisma.client.session.update({
      where: { refreshTokenHash: hashToken(initialLogin.refreshToken) },
      data: { revokedAt: new Date(Date.now() - 10 * 60_000) },
    });

    // Reusing the now-rotated (revoked) original refresh token must fail
    // AND revoke the entire session family (the new token too).
    await expect(
      identity.refresh({
        refreshToken: initialLogin.refreshToken,
        ipAddress: undefined,
        userAgent: undefined,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('Invalid refresh token.');

    await expect(
      identity.refresh({
        refreshToken: refreshed.refreshToken,
        ipAddress: undefined,
        userAgent: undefined,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('Invalid refresh token.');
  });

  it('lets two concurrent refreshes of one token both succeed, recording one successor (ADR-158)', async () => {
    const login = await identity.login({
      email: testEmail,
      password: 'CorrectHorseBattery1!',
      ipAddress: undefined,
      userAgent: undefined,
      correlationId: generateId(),
    });

    // Two tabs, or the web server and the browser, refresh at once. Only one
    // wins the guarded rotation; the other gets its own successor in the same
    // family instead of logging the user out.
    const results = await Promise.all([
      identity.refresh({ refreshToken: login.refreshToken, ipAddress: undefined, userAgent: undefined, correlationId: generateId() }),
      identity.refresh({ refreshToken: login.refreshToken, ipAddress: undefined, userAgent: undefined, correlationId: generateId() }),
    ]);
    expect(results[0].refreshToken).not.toBe(results[1].refreshToken);
    for (const r of results) expect(await identity.verifyAccessToken(r.accessToken)).not.toBeNull();

    // uq_sessions_rotated_from_session_id: still one recorded successor.
    const originalSession = await prisma.client.session.findUniqueOrThrow({
      where: { refreshTokenHash: hashToken(login.refreshToken) },
    });
    expect(await prisma.client.session.count({ where: { rotatedFromSessionId: originalSession.id } })).toBe(1);
    expect(await prisma.client.session.count({ where: { refreshTokenFamilyId: originalSession.refreshTokenFamilyId, revokedAt: null } })).toBe(2);
  });

  it('accepts a token rotated a moment ago, and the access token of that session, without revoking the login (ADR-158)', async () => {
    const login = await identity.login({ email: testEmail, password: 'CorrectHorseBattery1!', ipAddress: undefined, userAgent: undefined, correlationId: generateId() });
    const first = await identity.refresh({ refreshToken: login.refreshToken, ipAddress: undefined, userAgent: undefined, correlationId: generateId() });

    // The previous access token still passes for the grace window.
    expect(await identity.verifyAccessToken(login.accessToken)).not.toBeNull();

    const again = await identity.refresh({ refreshToken: login.refreshToken, ipAddress: undefined, userAgent: undefined, correlationId: generateId() });
    expect(again.refreshToken).not.toBe(first.refreshToken);
    // The first successor is still alive: nothing was treated as theft.
    expect(await identity.verifyAccessToken(first.accessToken)).not.toBeNull();
  });

  it('does not reopen a logged-out login through the grace window', async () => {
    const login = await identity.login({ email: testEmail, password: 'CorrectHorseBattery1!', ipAddress: undefined, userAgent: undefined, correlationId: generateId() });
    const first = await identity.refresh({ refreshToken: login.refreshToken, ipAddress: undefined, userAgent: undefined, correlationId: generateId() });
    await identity.logout({ refreshToken: first.refreshToken, correlationId: generateId() });

    await expect(
      identity.refresh({ refreshToken: login.refreshToken, ipAddress: undefined, userAgent: undefined, correlationId: generateId() }),
    ).rejects.toThrow('Invalid refresh token.');
    expect(await identity.verifyAccessToken(login.accessToken)).toBeNull();
  });
});

describe('IdentityService.logout', () => {
  it('revokes the session so its access token no longer verifies', async () => {
    const login = await identity.login({
      email: testEmail,
      password: 'CorrectHorseBattery1!',
      ipAddress: undefined,
      userAgent: undefined,
      correlationId: generateId(),
    });

    expect(await identity.verifyAccessToken(login.accessToken)).not.toBeNull();

    await identity.logout({ refreshToken: login.refreshToken, correlationId: generateId() });

    expect(await identity.verifyAccessToken(login.accessToken)).toBeNull();
  });
});

describe('IdentityService.requestPasswordReset', () => {
  it('enqueues a USER_PASSWORD_RESET_EMAIL outbox event for an existing active user', async () => {
    await identity.requestPasswordReset({ email: testEmail, correlationId: generateId() });

    const outboxRows = await prisma.client.outboxEvent.findMany({
      where: { organizationId, eventType: 'USER_PASSWORD_RESET_EMAIL', aggregateId: userId },
    });
    expect(outboxRows).toHaveLength(1);

    const payload = outboxRows[0]!.payload as { email: string; resetToken: string };
    expect(payload.email).toBe(testEmail);
    expect(payload.resetToken.length).toBeGreaterThan(0);
  });

  it('enqueues nothing for an unknown email (enumeration prevention)', async () => {
    const before = await prisma.client.outboxEvent.count({ where: { organizationId } });

    await identity.requestPasswordReset({ email: 'no-such-user@zitaware.test', correlationId: generateId() });

    const after = await prisma.client.outboxEvent.count({ where: { organizationId } });
    expect(after).toBe(before);
  });
});
