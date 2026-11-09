import { Injectable } from '@nestjs/common';
import { loadEnv, createLogger } from '@zitaware/config';
import { generateId, recordAuditEvent, enqueueOutboxEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type { AuthPort } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, verifyPassword } from './password.util';
import { generateToken, hashToken } from './token.util';
import { signAccessToken, verifyAccessToken as verifyJwt } from './access-token.util';
import { loadBrandingImage } from '../organization/branding-image-store';

const env = loadEnv();
const logger = createLogger({ service: 'api' });

/** Rotated, not revoked, and only within the reuse grace window (ADR-158). */
function isGraceRotation(session: { revokedAt: Date | null; revokedReason: string | null }): boolean {
  return (
    session.revokedReason === 'ROTATED' &&
    session.revokedAt !== null &&
    Date.now() - session.revokedAt.getTime() <= env.REFRESH_REUSE_GRACE_SECONDS * 1000
  );
}

@Injectable()
export class IdentityService implements AuthPort {
  constructor(private readonly prisma: PrismaService) {}

  async login(input: {
    email: string;
    password: string;
    ipAddress: string | undefined;
    userAgent: string | undefined;
    correlationId: string;
  }) {
    const user = await this.prisma.client.user.findFirst({
      where: { email: { equals: input.email, mode: 'insensitive' } },
    });

    // Generic failure for both "no such user" and "wrong password" —
    // account-enumeration prevention (new default, no doc basis).
    const genericFailure = (): never => {
      throwAppError('UNAUTHENTICATED', 'Invalid email or password.');
    };

    if (!user || user.status !== 'ACTIVE' || !user.passwordHash) {
      if (user) {
        await this.recordLoginFailure(user.id, user.organizationId, input.correlationId);
      }
      genericFailure();
    }

    const activeUser = user!;

    if (activeUser.lockedUntil && activeUser.lockedUntil > new Date()) {
      genericFailure();
    }

    const passwordOk = await verifyPassword(activeUser.passwordHash!, input.password);
    if (!passwordOk) {
      await this.recordLoginFailure(activeUser.id, activeUser.organizationId, input.correlationId);
      genericFailure();
    }

    return this.prisma.client.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: activeUser.id },
        data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      });

      const session = await this.createSession(tx, {
        userId: activeUser.id,
        organizationId: activeUser.organizationId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      await recordAuditEvent(tx, {
        organizationId: activeUser.organizationId,
        entityType: 'USER',
        entityId: activeUser.id,
        action: 'USER_LOGIN_SUCCEEDED',
        actorId: activeUser.id,
        actorEmail: activeUser.email,
        correlationId: input.correlationId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      return this.issueTokens(activeUser.id, activeUser.organizationId, session);
    });
  }

  async refresh(input: {
    refreshToken: string;
    ipAddress: string | undefined;
    userAgent: string | undefined;
    correlationId: string;
  }) {
    const tokenHash = hashToken(input.refreshToken);
    const session = await this.prisma.client.session.findUnique({ where: { refreshTokenHash: tokenHash } });

    if (!session) {
      throwAppError('UNAUTHENTICATED', 'Invalid refresh token.');
    }

    if (session.expiresAt < new Date()) {
      throwAppError('UNAUTHENTICATED', 'Refresh token expired.');
    }

    // A token rotated a moment ago is presented again when two tabs, or the
    // web server and the browser, refresh at once. That is not theft: it
    // gets its own successor below (ADR-158), unless the login has since
    // been logged out or revoked.
    const graceReuse = session.revokedAt !== null && isGraceRotation(session);
    if (graceReuse && (await this.activeInFamily(session.refreshTokenFamilyId)) === 0) {
      throwAppError('UNAUTHENTICATED', 'Invalid refresh token.');
    }

    if (session.revokedAt && !graceReuse) {
      // Reuse of an already-rotated/revoked token: theft signal — revoke
      // the entire family.
      await this.prisma.client.session.updateMany({
        where: { refreshTokenFamilyId: session.refreshTokenFamilyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' },
      });
      await this.prisma.client.$transaction(async (tx) => {
        await recordAuditEvent(tx, {
          organizationId: session.organizationId,
          entityType: 'SESSION',
          entityId: session.id,
          action: 'SESSION_FAMILY_REVOKED',
          correlationId: input.correlationId,
          reason: 'Refresh token reuse detected',
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        });
      });
      throwAppError('UNAUTHENTICATED', 'Invalid refresh token.');
    }

    return this.prisma.client.$transaction(async (tx) => {
      // Guarded compare-and-swap: only proceed if this session is STILL
      // unrevoked at the moment of the actual write, not merely at the read
      // above. Two concurrent refresh calls on the same token both pass the
      // read-time check above; only one of them can win this updateMany
      // (count === 1), so only one successor session is ever created. The
      // loser sees count === 0 and is rejected — never silently mints a
      // second valid successor from the same predecessor.
      // A loser that was rotated within the grace window by the winner gets
      // its own successor too (ADR-158), so a parallel tab is not logged out.
      const { count } = await tx.session.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'ROTATED' },
      });
      if (count === 0) {
        const now = await tx.session.findUniqueOrThrow({ where: { id: session.id }, select: { revokedAt: true, revokedReason: true } });
        if (!isGraceRotation(now)) throwAppError('UNAUTHENTICATED', 'Invalid refresh token.');
      }

      // uq_sessions_rotated_from_session_id keeps one recorded successor per
      // session; a grace successor links to the family only.
      const newSession = await this.createSession(tx, {
        userId: session.userId,
        organizationId: session.organizationId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        familyId: session.refreshTokenFamilyId,
        ...(count === 1 ? { rotatedFromSessionId: session.id } : {}),
        // Still viewing as this user after a refresh (ADR-174).
        impersonatorUserId: session.impersonatorUserId,
        impersonatorSessionId: session.impersonatorSessionId,
      });

      await recordAuditEvent(tx, {
        organizationId: session.organizationId,
        entityType: 'SESSION',
        entityId: newSession.id,
        action: 'SESSION_REFRESHED',
        actorId: session.userId,
        correlationId: input.correlationId,
        ...(count === 1 ? {} : { reason: 'Refreshed again within the reuse grace window' }),
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      return this.issueTokens(session.userId, session.organizationId, newSession);
    });
  }

  private activeInFamily(familyId: string): Promise<number> {
    return this.prisma.client.session.count({ where: { refreshTokenFamilyId: familyId, revokedAt: null } });
  }

  async logout(input: { refreshToken: string; correlationId: string }) {
    const tokenHash = hashToken(input.refreshToken);
    const session = await this.prisma.client.session.findUnique({ where: { refreshTokenHash: tokenHash } });
    if (!session || session.revokedAt) {
      return;
    }

    await this.prisma.client.$transaction(async (tx) => {
      // The whole login: a grace refresh (ADR-158) can leave a second live
      // session in the family, and logging out must end both.
      await tx.session.updateMany({
        where: { refreshTokenFamilyId: session.refreshTokenFamilyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
      });
      await recordAuditEvent(tx, {
        organizationId: session.organizationId,
        entityType: 'SESSION',
        entityId: session.id,
        action: 'SESSION_REVOKED',
        actorId: session.userId,
        correlationId: input.correlationId,
      });
    });
  }

  async requestPasswordReset(input: { email: string; correlationId: string }) {
    const user = await this.prisma.client.user.findFirst({
      where: { email: { equals: input.email, mode: 'insensitive' }, status: 'ACTIVE' },
    });

    // Silent no-op if the user doesn't exist — enumeration prevention.
    if (!user) {
      return;
    }

    const token = generateToken();
    await this.prisma.client.$transaction(async (tx) => {
      await tx.passwordResetToken.create({
        data: {
          id: generateId(),
          organizationId: user.organizationId,
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TOKEN_TTL_HOURS * 3_600_000),
        },
      });
      await recordAuditEvent(tx, {
        organizationId: user.organizationId,
        entityType: 'USER',
        entityId: user.id,
        action: 'USER_PASSWORD_RESET_REQUESTED',
        correlationId: input.correlationId,
      });
      await enqueueOutboxEvent(tx, {
        organizationId: user.organizationId,
        aggregateType: 'USER',
        aggregateId: user.id,
        eventType: 'USER_PASSWORD_RESET_EMAIL',
        payload: {
          email: user.email,
          displayName: user.displayName,
          resetToken: token,
        },
      });
    });

    logger.info('identity.password_reset_token_issued', { userId: user.id });
  }

  async completePasswordReset(input: { token: string; newPassword: string; correlationId: string }) {
    const tokenHash = hashToken(input.token);
    const resetToken = await this.prisma.client.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throwAppError('VALIDATION_FAILED', 'Invalid or expired reset token.');
    }

    const passwordHash = await hashPassword(input.newPassword);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      });
      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      });
      // Corrected per round 2: revoke every active session for this user.
      await tx.session.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'PASSWORD_RESET' },
      });
      await recordAuditEvent(tx, {
        organizationId: resetToken.organizationId,
        entityType: 'USER',
        entityId: resetToken.userId,
        action: 'USER_PASSWORD_RESET_COMPLETED',
        correlationId: input.correlationId,
      });
    });
  }

  async acceptInvite(input: { token: string; password: string; correlationId: string }) {
    const tokenHash = hashToken(input.token);
    const invitation = await this.prisma.client.userInvitation.findUnique({ where: { tokenHash } });

    if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt < new Date()) {
      throwAppError('VALIDATION_FAILED', 'Invalid or expired invitation.');
    }

    const passwordHash = await hashPassword(input.password);

    return this.prisma.client.$transaction(async (tx) => {
      await tx.userInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      const user = await tx.user.update({
        where: { id: invitation.userId },
        data: { passwordHash, status: 'ACTIVE' },
      });
      await recordAuditEvent(tx, {
        organizationId: user.organizationId,
        entityType: 'USER',
        entityId: user.id,
        action: 'USER_ACCEPTED_INVITE',
        actorId: user.id,
        actorEmail: user.email,
        correlationId: input.correlationId,
      });

      const session = await this.createSession(tx, {
        userId: user.id,
        organizationId: user.organizationId,
        ipAddress: undefined,
        userAgent: undefined,
      });

      return this.issueTokens(user.id, user.organizationId, session);
    });
  }

  async verifyAccessToken(accessToken: string) {
    const claims = verifyJwt(accessToken, env.SESSION_SECRET);
    if (!claims) {
      return null;
    }

    // The JWT signature/expiry alone isn't enough: a logout, disablement,
    // or password reset must take effect immediately, not after the
    // access token's own TTL elapses. Confirm the underlying session is
    // still active on every verification.
    // A rotation is not a revocation: for a moment after it, a request sent
    // with the previous access token still passes (ADR-158). Logout,
    // password reset and reuse revocation still end it at once.
    const session = await this.prisma.client.session.findUnique({
      where: { id: claims.sessionId },
      select: { revokedAt: true, revokedReason: true, expiresAt: true, refreshTokenFamilyId: true, impersonatorUserId: true },
    });
    if (!session || session.expiresAt < new Date()) {
      return null;
    }
    if (session.revokedAt && (!isGraceRotation(session) || (await this.activeInFamily(session.refreshTokenFamilyId)) === 0)) {
      return null;
    }

    return { userId: claims.sub, organizationId: claims.organizationId, sessionId: claims.sessionId, impersonatorUserId: session.impersonatorUserId };
  }

  // ------------------------------------------------ impersonation (ADR-174)

  /** A live session: not revoked (a moment-ago rotation counts as live, ADR-158) and not expired. */
  private async sessionIsLive(sessionId: string): Promise<boolean> {
    const session = await this.prisma.client.session.findUnique({
      where: { id: sessionId },
      select: { revokedAt: true, revokedReason: true, expiresAt: true, refreshTokenFamilyId: true },
    });
    if (!session || session.expiresAt < new Date()) return false;
    if (!session.revokedAt) return true;
    return isGraceRotation(session) || (await this.activeInFamily(session.refreshTokenFamilyId)) > 0;
  }

  async startImpersonation(input: {
    organizationId: string;
    adminUserId: string;
    adminSessionId: string;
    targetUserId: string;
    ipAddress: string | undefined;
    userAgent: string | undefined;
    correlationId: string;
  }) {
    if (input.targetUserId === input.adminUserId) throwAppError('VALIDATION_FAILED', 'You are already logged in as yourself.');
    const target = await this.prisma.client.user.findFirst({ where: { id: input.targetUserId, organizationId: input.organizationId } });
    if (!target) throwAppError('NOT_FOUND', 'User not found.');
    if (target.status !== 'ACTIVE') throwAppError('VALIDATION_FAILED', 'Only an active user can be logged in as.');
    const adminSession = await this.prisma.client.session.findUnique({ where: { id: input.adminSessionId }, select: { refreshTokenFamilyId: true } });
    if (!adminSession) throwAppError('UNAUTHENTICATED', 'Your session has ended. Log in again.');

    return this.prisma.client.$transaction(async (tx) => {
      const session = await this.createSession(tx, {
        userId: target.id,
        organizationId: target.organizationId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        impersonatorUserId: input.adminUserId,
        impersonatorSessionId: input.adminSessionId,
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'USER',
        entityId: target.id,
        action: 'USER_IMPERSONATION_STARTED',
        actorId: input.adminUserId,
        correlationId: input.correlationId,
        newValues: { sessionId: session.id, viewingAs: target.email },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
      return this.issueTokens(target.id, target.organizationId, session);
    });
  }

  async stopImpersonation(input: { sessionId: string; ipAddress: string | undefined; userAgent: string | undefined; correlationId: string }) {
    const session = await this.prisma.client.session.findUnique({ where: { id: input.sessionId } });
    if (!session || !session.impersonatorUserId || !session.impersonatorSessionId) throwAppError('VALIDATION_FAILED', 'You are not viewing as another user.');
    const adminUserId = session.impersonatorUserId;
    const adminLive = await this.sessionIsLive(session.impersonatorSessionId);
    const admin = await this.prisma.client.user.findFirst({ where: { id: adminUserId, organizationId: session.organizationId } });

    return this.prisma.client.$transaction(async (tx) => {
      // The viewing-as login ends, every refresh of it included.
      await tx.session.updateMany({
        where: { refreshTokenFamilyId: session.refreshTokenFamilyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'IMPERSONATION_ENDED' },
      });
      await recordAuditEvent(tx, {
        organizationId: session.organizationId,
        entityType: 'USER',
        entityId: session.userId,
        action: 'USER_IMPERSONATION_ENDED',
        actorId: adminUserId,
        correlationId: input.correlationId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
      if (!adminLive || !admin || admin.status !== 'ACTIVE') return null;
      // The Admin's own login carries on, as a new session in it.
      const adminSession = await tx.session.findUniqueOrThrow({ where: { id: session.impersonatorSessionId! }, select: { refreshTokenFamilyId: true } });
      const back = await this.createSession(tx, {
        userId: admin.id,
        organizationId: admin.organizationId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        familyId: adminSession.refreshTokenFamilyId,
      });
      return this.issueTokens(admin.id, admin.organizationId, back);
    });
  }

  async getImpersonator(sessionId: string) {
    const session = await this.prisma.client.session.findUnique({ where: { id: sessionId }, select: { impersonatorUserId: true, organizationId: true } });
    if (!session?.impersonatorUserId) return null;
    const admin = await this.prisma.client.user.findFirst({ where: { id: session.impersonatorUserId, organizationId: session.organizationId }, select: { id: true, displayName: true } });
    return admin ? { userId: admin.id, displayName: admin.displayName } : null;
  }

  async getProfile(userId: string, organizationId: string) {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId, organizationId },
      select: { displayName: true, organization: { select: { name: true } } },
    });
    if (!user) {
      return null;
    }
    const brand = await this.ownLegalEntity(userId, organizationId);
    return {
      displayName: user.displayName,
      organizationName: user.organization.name,
      brandName: brand?.legalName ?? null,
      brandHasLogo: !!brand?.logoContentType,
    };
  }

  async getBrandLogo(userId: string, organizationId: string): Promise<{ contentType: 'image/png' | 'image/jpeg'; dataBase64: string } | null> {
    const brand = await this.ownLegalEntity(userId, organizationId, true);
    if (!brand) return null;
    const logo = await loadBrandingImage(brand.logoContentType, brand.logoStorageKey ?? null, brand.logoBytes ?? null);
    return logo ? { contentType: logo.contentType, dataBase64: logo.bytes.toString('base64') } : null;
  }

  /** The legal entity of the user's own employee record: the brand the shell shows them. */
  private async ownLegalEntity(userId: string, organizationId: string, withLogo = false) {
    const employee = await this.prisma.client.employee.findFirst({
      where: { organizationId, userId, deletedAt: null },
      select: { legalEntity: { select: { legalName: true, logoContentType: true, ...(withLogo ? { logoStorageKey: true, logoBytes: true } : {}) } } },
    });
    return employee?.legalEntity ?? null;
  }

  private async recordLoginFailure(userId: string, organizationId: string, correlationId: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { failedLoginAttempts: { increment: 1 } },
      });

      if (user.failedLoginAttempts >= env.LOGIN_LOCKOUT_ATTEMPTS) {
        await tx.user.update({
          where: { id: userId },
          data: { lockedUntil: new Date(Date.now() + env.LOGIN_LOCKOUT_MINUTES * 60_000) },
        });
        await recordAuditEvent(tx, {
          organizationId,
          entityType: 'USER',
          entityId: userId,
          action: 'USER_LOCKED_OUT',
          correlationId,
        });
      }

      await recordAuditEvent(tx, {
        organizationId,
        entityType: 'USER',
        entityId: userId,
        action: 'USER_LOGIN_FAILED',
        correlationId,
      });
    });
  }

  private async createSession(
    tx: Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0],
    input: {
      userId: string;
      organizationId: string;
      ipAddress: string | undefined;
      userAgent: string | undefined;
      familyId?: string;
      rotatedFromSessionId?: string;
      impersonatorUserId?: string | null;
      impersonatorSessionId?: string | null;
    },
  ) {
    const refreshToken = generateToken();
    const session = await tx.session.create({
      data: {
        id: generateId(),
        organizationId: input.organizationId,
        userId: input.userId,
        refreshTokenHash: hashToken(refreshToken),
        refreshTokenFamilyId: input.familyId ?? generateId(),
        rotatedFromSessionId: input.rotatedFromSessionId ?? null,
        impersonatorUserId: input.impersonatorUserId ?? null,
        impersonatorSessionId: input.impersonatorSessionId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      },
    });
    return { ...session, rawRefreshToken: refreshToken };
  }

  private issueTokens(
    userId: string,
    organizationId: string,
    session: { id: string; rawRefreshToken: string; expiresAt: Date },
  ) {
    const accessExpiresAt = new Date(Date.now() + env.ACCESS_TOKEN_TTL_MINUTES * 60_000);
    const accessToken = signAccessToken(
      { sub: userId, organizationId, sessionId: session.id },
      env.SESSION_SECRET,
      env.ACCESS_TOKEN_TTL_MINUTES,
    );
    return {
      accessToken,
      accessExpiresAt,
      refreshToken: session.rawRefreshToken,
      refreshExpiresAt: session.expiresAt,
    };
  }
}
