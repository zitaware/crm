import { Injectable } from '@nestjs/common';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { resolvePermissions, throwAppError } from '@zitaware/contracts';
import type { RoleDetail, RolePort, RoleSummary, PermissionCatalogEntry } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

@Injectable()
export class RolesService implements RolePort {
  constructor(private readonly prisma: PrismaService) {}

  async list(input: { organizationId: string }): Promise<RoleSummary[]> {
    const roles = await this.prisma.client.role.findMany({
      where: { organizationId: input.organizationId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { userRoles: true } } },
    });
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      memberCount: role._count.userRoles,
    }));
  }

  async getDetail(input: { organizationId: string; roleId: string }): Promise<RoleDetail | null> {
    const role = await this.prisma.client.role.findFirst({
      where: { id: input.roleId, organizationId: input.organizationId },
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { userRoles: true } },
      },
    });
    if (!role) {
      return null;
    }
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissionKeys: role.rolePermissions.map((grant) => grant.permission.key),
      memberCount: role._count.userRoles,
      version: role.version,
    };
  }

  async getPermissions(input: { organizationId: string; roleId: string }): Promise<string[]> {
    const grants = await this.prisma.client.rolePermission.findMany({
      where: { roleId: input.roleId, role: { organizationId: input.organizationId } },
      include: { permission: true },
    });
    return grants.map((grant) => grant.permission.key);
  }

  async listPermissionCatalog(): Promise<PermissionCatalogEntry[]> {
    const permissions = await this.prisma.client.permission.findMany({
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    });
    return permissions.map((permission) => ({
      key: permission.key,
      resource: permission.resource,
      action: permission.action,
      description: permission.description,
    }));
  }

  async create(input: {
    organizationId: string;
    name: string;
    description: string | undefined;
    permissionKeys: string[];
    actorId: string;
    correlationId: string;
  }): Promise<RoleDetail> {
    const permissionIds = await this.resolvePermissionIds(input.permissionKeys);
    const roleId = generateId();
    try {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.role.create({
          data: {
            id: roleId,
            organizationId: input.organizationId,
            name: input.name,
            description: input.description ?? null,
            isSystem: false,
            createdBy: input.actorId,
          },
        });
        if (permissionIds.length > 0) {
          await tx.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({
              id: generateId(),
              roleId,
              permissionId,
              createdBy: input.actorId,
            })),
          });
        }
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'ROLE',
          entityId: roleId,
          action: 'ROLE_CREATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { name: input.name, permissionKeys: input.permissionKeys },
        });
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'A role with this name already exists.');
      }
      throw error;
    }
    return (await this.getDetail({ organizationId: input.organizationId, roleId }))!;
  }

  async update(input: {
    organizationId: string;
    roleId: string;
    name: string | undefined;
    description: string | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<RoleDetail> {
    await this.assertCustomRole(input.organizationId, input.roleId);
    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;

    try {
      const { count } = await this.prisma.client.role.updateMany({
        where: { id: input.roleId, organizationId: input.organizationId, version: input.expectedVersion },
        data,
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This role was changed by someone else. Reload and try again.');
      }
      await this.prisma.client.$transaction(async (tx) => {
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'ROLE',
          entityId: input.roleId,
          action: 'ROLE_UPDATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { name: input.name, description: input.description },
        });
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'A role with this name already exists.');
      }
      throw error;
    }
    return (await this.getDetail({ organizationId: input.organizationId, roleId: input.roleId }))!;
  }

  async setPermissions(input: {
    organizationId: string;
    roleId: string;
    permissionKeys: string[];
    actorId: string;
    correlationId: string;
  }): Promise<RoleDetail> {
    await this.assertCustomRole(input.organizationId, input.roleId);
    const permissionIds = await this.resolvePermissionIds(input.permissionKeys);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: input.roleId } });
      if (permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({
            id: generateId(),
            roleId: input.roleId,
            permissionId,
            createdBy: input.actorId,
          })),
        });
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'ROLE',
        entityId: input.roleId,
        action: 'ROLE_PERMISSIONS_CHANGED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { permissionKeys: input.permissionKeys },
      });
    });
    return (await this.getDetail({ organizationId: input.organizationId, roleId: input.roleId }))!;
  }

  async delete(input: {
    organizationId: string;
    roleId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    const role = await this.assertCustomRole(input.organizationId, input.roleId);
    const memberCount = await this.prisma.client.userRole.count({ where: { roleId: input.roleId } });
    if (memberCount > 0) {
      throwAppError('VALIDATION_FAILED', 'This role is still assigned to users. Remove those assignments first.');
    }
    await this.prisma.client.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: input.roleId } });
      await tx.role.delete({ where: { id: input.roleId } });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'ROLE',
        entityId: input.roleId,
        action: 'ROLE_DELETED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { name: role.name },
      });
    });
  }

  /** Loads a role and rejects if it is a locked system role (or not found). */
  private async assertCustomRole(organizationId: string, roleId: string): Promise<{ name: string }> {
    const role = await this.prisma.client.role.findFirst({
      where: { id: roleId, organizationId },
      select: { name: true, isSystem: true },
    });
    if (!role) {
      throwAppError('NOT_FOUND', 'Role not found.');
    }
    if (role.isSystem) {
      throwAppError('VALIDATION_FAILED', 'System roles cannot be edited or deleted.');
    }
    return role;
  }

  private async resolvePermissionIds(keys: string[]): Promise<string[]> {
    const unique = Array.from(new Set(keys));
    if (unique.length === 0) return [];
    const permissions = await this.prisma.client.permission.findMany({ where: { key: { in: unique } } });
    if (permissions.length !== unique.length) {
      const found = new Set(permissions.map((p) => p.key));
      const missing = unique.filter((k) => !found.has(k));
      throwAppError('VALIDATION_FAILED', `Unknown permission key(s): ${missing.join(', ')}`);
    }
    return permissions.map((p) => p.id);
  }

  async assignRole(input: {
    organizationId: string;
    userId: string;
    roleId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: input.userId, roleId: input.roleId } },
        create: {
          id: generateId(),
          organizationId: input.organizationId,
          userId: input.userId,
          roleId: input.roleId,
          createdBy: input.actorId,
        },
        update: {},
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'USER',
        entityId: input.userId,
        action: 'USER_ROLE_ASSIGNED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { roleId: input.roleId },
      });
    });
  }

  async removeRole(input: {
    organizationId: string;
    userId: string;
    roleId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.userRole.deleteMany({
        where: { userId: input.userId, roleId: input.roleId, organizationId: input.organizationId },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'USER',
        entityId: input.userId,
        action: 'USER_ROLE_REMOVED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { roleId: input.roleId },
      });
    });
  }

  async setPermissionOverride(input: {
    organizationId: string;
    userId: string;
    permissionKey: string;
    effect: 'GRANT' | 'REVOKE';
    reason: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    const permission = await this.prisma.client.permission.findUnique({
      where: { key: input.permissionKey },
    });
    if (!permission) {
      throwAppError('NOT_FOUND', `Unknown permission key: ${input.permissionKey}`);
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.userPermissionOverride.deleteMany({
        where: {
          userId: input.userId,
          permissionId: permission.id,
          organizationId: input.organizationId,
          scopeType: null,
        },
      });
      await tx.userPermissionOverride.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          userId: input.userId,
          permissionId: permission.id,
          effect: input.effect,
          reason: input.reason ?? null,
          createdBy: input.actorId,
        },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'USER',
        entityId: input.userId,
        action:
          input.effect === 'GRANT'
            ? 'USER_PERMISSION_OVERRIDE_GRANTED'
            : 'USER_PERMISSION_OVERRIDE_REVOKED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        reason: input.reason,
        newValues: { permissionKey: input.permissionKey, effect: input.effect },
      });
    });
  }

  /** Reverts a permission back to plain role-inheritance by removing any
   * per-user override, the complement to setPermissionOverride's upsert. */
  async clearPermissionOverride(input: {
    organizationId: string;
    userId: string;
    permissionKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    const permission = await this.prisma.client.permission.findUnique({
      where: { key: input.permissionKey },
    });
    if (!permission) {
      throwAppError('NOT_FOUND', `Unknown permission key: ${input.permissionKey}`);
    }

    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.userPermissionOverride.deleteMany({
        where: {
          userId: input.userId,
          permissionId: permission.id,
          organizationId: input.organizationId,
          scopeType: null,
        },
      });
      if (count === 0) {
        return;
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'USER',
        entityId: input.userId,
        action: 'USER_PERMISSION_OVERRIDE_CLEARED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues: { permissionKey: input.permissionKey },
      });
    });
  }

  async getEffectivePermissions(input: {
    organizationId: string;
    userId: string;
  }): Promise<Set<string>> {
    const userRoles = await this.prisma.client.userRole.findMany({
      where: { userId: input.userId, organizationId: input.organizationId },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });
    const roleGrants = userRoles.flatMap((userRole) =>
      userRole.role.rolePermissions.map((grant) => grant.permission.key),
    );

    const overrides = await this.prisma.client.userPermissionOverride.findMany({
      where: { userId: input.userId, organizationId: input.organizationId, scopeType: null },
      include: { permission: true },
    });
    const userGrants = overrides
      .filter((override) => override.effect === 'GRANT')
      .map((override) => override.permission.key);
    const userRevocations = overrides
      .filter((override) => override.effect === 'REVOKE')
      .map((override) => override.permission.key);

    return resolvePermissions(roleGrants, userGrants, userRevocations);
  }
}
