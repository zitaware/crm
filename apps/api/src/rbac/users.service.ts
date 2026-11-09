import { Injectable } from '@nestjs/common';
import { loadEnv } from '@zitaware/config';
import { generateId, recordAuditEvent, enqueueOutboxEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type { UserDetail, UserPort, UserSummary } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { generateToken, hashToken } from '../identity/token.util';
import { isConstraintViolation } from '../organization/constraint-error.util';
import { RolesService } from './roles.service';

const env = loadEnv();

@Injectable()
export class UsersService implements UserPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: RolesService,
  ) {}

  async list(input: { organizationId: string }): Promise<UserSummary[]> {
    const users = await this.prisma.client.user.findMany({
      where: { organizationId: input.organizationId },
      orderBy: { createdAt: 'desc' },
      include: { userRoles: { include: { role: true } }, employees: { select: { id: true } } },
    });
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      createdAt: user.createdAt,
      roleNames: user.userRoles.map((userRole) => userRole.role.name),
      employeeLinked: user.employees.length > 0,
    }));
  }

  async get(input: { organizationId: string; userId: string }): Promise<UserSummary | null> {
    const user = await this.prisma.client.user.findFirst({
      where: { id: input.userId, organizationId: input.organizationId },
      include: { userRoles: { include: { role: true } }, employees: { select: { id: true } } },
    });
    if (!user) {
      return null;
    }
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      createdAt: user.createdAt,
      roleNames: user.userRoles.map((userRole) => userRole.role.name),
      employeeLinked: user.employees.length > 0,
    };
  }

  async getDetail(input: { organizationId: string; userId: string }): Promise<UserDetail | null> {
    const user = await this.prisma.client.user.findFirst({
      where: { id: input.userId, organizationId: input.organizationId },
    });
    if (!user) {
      return null;
    }

    const [userRoles, overrides, effectivePermissions, employee] = await Promise.all([
      this.prisma.client.userRole.findMany({
        where: { userId: input.userId, organizationId: input.organizationId },
        include: { role: true },
      }),
      this.prisma.client.userPermissionOverride.findMany({
        where: { userId: input.userId, organizationId: input.organizationId, scopeType: null },
        include: { permission: true },
      }),
      this.roles.getEffectivePermissions({ organizationId: input.organizationId, userId: input.userId }),
      this.prisma.client.employee.findFirst({
        where: { userId: input.userId, organizationId: input.organizationId },
        select: { id: true, employeeCode: true, fullName: true },
      }),
    ]);

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      createdAt: user.createdAt,
      roleNames: userRoles.map((userRole) => userRole.role.name),
      employeeLinked: employee != null,
      lastLoginAt: user.lastLoginAt,
      invitedAt: user.invitedAt,
      disabledAt: user.disabledAt,
      roles: userRoles.map((userRole) => ({ id: userRole.role.id, name: userRole.role.name })),
      overrides: overrides.map((override) => ({
        permissionKey: override.permission.key,
        effect: override.effect as 'GRANT' | 'REVOKE',
        reason: override.reason,
      })),
      effectivePermissions: Array.from(effectivePermissions),
      employee,
    };
  }

  async invite(input: {
    organizationId: string;
    email: string;
    displayName: string;
    roleIds: string[];
    employeeId: string | undefined;
    actorId: string;
    correlationId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<{ userId: string; invitationId: string }> {
    const existingKey = await this.prisma.client.idempotencyKey.findUnique({
      where: {
        organizationId_commandType_idempotencyKey: {
          organizationId: input.organizationId,
          commandType: 'user.invite',
          idempotencyKey: input.idempotencyKey,
        },
      },
    });

    if (existingKey) {
      if (existingKey.requestHash !== input.requestHash) {
        throwAppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different request.');
      }
      // Replay: return the original result unchanged — no new user, no new
      // invitation, no new notification (round-2 correction §B item 7).
      return existingKey.resultReference as { userId: string; invitationId: string };
    }

    const token = generateToken();
    const userId = generateId();
    const invitationId = generateId();

    const result = await this.prisma.client.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: userId,
          organizationId: input.organizationId,
          email: input.email,
          displayName: input.displayName,
          status: 'INVITED',
          invitedAt: new Date(),
          invitedBy: input.actorId,
          createdBy: input.actorId,
        },
      });

      await tx.userInvitation.create({
        data: {
          id: invitationId,
          organizationId: input.organizationId,
          userId,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + env.INVITATION_TOKEN_TTL_HOURS * 3_600_000),
          createdBy: input.actorId,
        },
      });

      for (const roleId of input.roleIds) {
        await tx.userRole.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            userId,
            roleId,
            createdBy: input.actorId,
          },
        });
      }

      if (input.employeeId) {
        const { count } = await tx.employee.updateMany({
          where: { id: input.employeeId, organizationId: input.organizationId, userId: null, status: 'ACTIVE' },
          data: { userId, updatedBy: input.actorId, version: { increment: 1 } },
        });
        if (count === 0) {
          throwAppError(
            'VALIDATION_FAILED',
            'The selected employee is not available to link (already linked, inactive, or not found).',
          );
        }
      }

      const resultReference = { userId, invitationId };

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'USER',
        entityId: userId,
        action: 'USER_INVITED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { email: input.email, roleIds: input.roleIds, employeeId: input.employeeId },
      });

      await tx.idempotencyKey.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          commandType: 'user.invite',
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          sourceRecordType: 'USER',
          sourceRecordId: userId,
          resultReference,
        },
      });

      await enqueueOutboxEvent(tx, {
        organizationId: input.organizationId,
        aggregateType: 'USER',
        aggregateId: userId,
        eventType: 'USER_INVITATION_EMAIL',
        payload: {
          email: input.email,
          displayName: input.displayName,
          invitationToken: token,
        },
      });

      return resultReference;
    });

    return result;
  }

  async reinvite(input: {
    organizationId: string;
    userId: string;
    actorId: string;
    correlationId: string;
  }): Promise<{ invitationId: string }> {
    const token = generateToken();
    const invitationId = generateId();

    return this.prisma.client.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });

      await tx.userInvitation.updateMany({
        where: { userId: input.userId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.userInvitation.create({
        data: {
          id: invitationId,
          organizationId: input.organizationId,
          userId: input.userId,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + env.INVITATION_TOKEN_TTL_HOURS * 3_600_000),
          createdBy: input.actorId,
        },
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'USER',
        entityId: input.userId,
        action: 'USER_REINVITED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });

      await enqueueOutboxEvent(tx, {
        organizationId: input.organizationId,
        aggregateType: 'USER',
        aggregateId: input.userId,
        eventType: 'USER_INVITATION_EMAIL',
        payload: {
          email: user.email,
          displayName: user.displayName,
          invitationToken: token,
        },
      });

      return { invitationId };
    });
  }

  async disable(input: {
    organizationId: string;
    userId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: input.userId, organizationId: input.organizationId },
      });
      if (!user) {
        throwAppError('NOT_FOUND', 'User not found.');
      }
      if (user.status === 'INVITED') {
        throwAppError(
          'VALIDATION_FAILED',
          'This user has not accepted their invitation yet. Revoke the invitation instead of disabling.',
        );
      }
      await tx.user.update({
        where: { id: input.userId },
        data: { status: 'DISABLED', disabledAt: new Date(), disabledBy: input.actorId },
      });
      await tx.session.updateMany({
        where: { userId: input.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'USER_DISABLED' },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'USER',
        entityId: input.userId,
        action: 'USER_DISABLED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }

  async enable(input: {
    organizationId: string;
    userId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: input.userId, organizationId: input.organizationId },
      });
      if (!user) {
        throwAppError('NOT_FOUND', 'User not found.');
      }
      if (user.status !== 'DISABLED') {
        throwAppError('VALIDATION_FAILED', 'Only a disabled user can be re-enabled.');
      }
      if (!user.passwordHash) {
        throwAppError(
          'VALIDATION_FAILED',
          'This user never completed their invitation. Use "Reinvite" instead of "Enable".',
        );
      }
      await tx.user.update({
        where: { id: input.userId },
        data: { status: 'ACTIVE', disabledAt: null, disabledBy: null, updatedBy: input.actorId },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'USER',
        entityId: input.userId,
        action: 'USER_ENABLED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }

  async revokeSessions(input: {
    organizationId: string;
    userId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.session.updateMany({
        where: { userId: input.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'ADMIN_REVOKED' },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'USER',
        entityId: input.userId,
        action: 'USER_SESSIONS_REVOKED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }

  async linkEmployee(input: {
    organizationId: string;
    userId: string;
    employeeId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    try {
      await this.prisma.client.$transaction(async (tx) => {
        const { count } = await tx.employee.updateMany({
          where: {
            id: input.employeeId,
            organizationId: input.organizationId,
            userId: null,
            status: 'ACTIVE',
          },
          data: { userId: input.userId, updatedBy: input.actorId, version: { increment: 1 } },
        });
        if (count === 0) {
          throwAppError(
            'VALIDATION_FAILED',
            'The selected employee is not available to link (already linked, inactive, or not found).',
          );
        }
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'USER',
          entityId: input.userId,
          action: 'USER_EMPLOYEE_LINKED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { employeeId: input.employeeId },
        });
      });
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'This user already has a linked employee record.');
      }
      throw error;
    }
  }

  async unlinkEmployee(input: {
    organizationId: string;
    userId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.employee.updateMany({
        where: { userId: input.userId, organizationId: input.organizationId },
        data: { userId: null, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) {
        throwAppError('NOT_FOUND', 'This user has no linked employee record.');
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'USER',
        entityId: input.userId,
        action: 'USER_EMPLOYEE_UNLINKED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }
}
