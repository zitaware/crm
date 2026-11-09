import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';
import { RolesService } from './roles.service';

const prisma = new PrismaService();
const roles = new RolesService(prisma);
const users = new UsersService(prisma, roles);

let organizationId: string;
const actorId = generateId();

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Users Outbox Test Org', code: `USERSOUTBOX-${generateId()}` },
  });
  organizationId = organization.id;
});

afterAll(async () => {
  await prisma.client.auditEvent.deleteMany({ where: { organizationId } });
  await prisma.client.notification.deleteMany({ where: { organizationId } });
  await prisma.client.outboxEvent.deleteMany({ where: { organizationId } });
  await prisma.client.idempotencyKey.deleteMany({ where: { organizationId } });
  await prisma.client.userInvitation.deleteMany({ where: { organizationId } });
  await prisma.client.userPermissionOverride.deleteMany({ where: { organizationId } });
  await prisma.client.userRole.deleteMany({ where: { organizationId } });
  await prisma.client.rolePermission.deleteMany({ where: { role: { organizationId } } });
  await prisma.client.role.deleteMany({ where: { organizationId } });
  await prisma.client.employee.deleteMany({ where: { organizationId } });
  await prisma.client.session.deleteMany({ where: { user: { organizationId } } });
  await prisma.client.user.deleteMany({ where: { organizationId } });
  await prisma.client.organization.delete({ where: { id: organizationId } });
  await prisma.client.$disconnect();
});

async function createLinkableEmployee(fullName: string) {
  return prisma.client.employee.create({
    data: {
      id: generateId(),
      organizationId,
      employeeCode: `EMP-${generateId()}`,
      fullName,
      joiningDate: new Date('2024-01-01T00:00:00.000Z'),
      status: 'ACTIVE',
    },
  });
}

describe('UsersService.invite outbox wiring', () => {
  it('enqueues exactly one USER_INVITATION_EMAIL outbox event on invite', async () => {
    const result = await users.invite({
      organizationId,
      email: 'newuser@zitaware.test',
      displayName: 'New User',
      roleIds: [],
      employeeId: undefined,
      actorId,
      correlationId: generateId(),
      idempotencyKey: generateId(),
      requestHash: 'hash-1',
    });

    const outboxRows = await prisma.client.outboxEvent.findMany({
      where: { organizationId, aggregateId: result.userId, eventType: 'USER_INVITATION_EMAIL' },
    });
    expect(outboxRows).toHaveLength(1);

    const payload = outboxRows[0]!.payload as { email: string; invitationToken: string };
    expect(payload.email).toBe('newuser@zitaware.test');
    expect(payload.invitationToken.length).toBeGreaterThan(0);
  });

  it('does not enqueue a second outbox event when the same idempotency key is replayed', async () => {
    const idempotencyKey = generateId();
    const first = await users.invite({
      organizationId,
      email: 'replay@zitaware.test',
      displayName: 'Replay User',
      roleIds: [],
      employeeId: undefined,
      actorId,
      correlationId: generateId(),
      idempotencyKey,
      requestHash: 'hash-replay',
    });

    const second = await users.invite({
      organizationId,
      email: 'replay@zitaware.test',
      displayName: 'Replay User',
      roleIds: [],
      employeeId: undefined,
      actorId,
      correlationId: generateId(),
      idempotencyKey,
      requestHash: 'hash-replay',
    });

    expect(second).toEqual(first);

    const outboxRows = await prisma.client.outboxEvent.findMany({
      where: { organizationId, aggregateId: first.userId, eventType: 'USER_INVITATION_EMAIL' },
    });
    expect(outboxRows).toHaveLength(1);
  });

  it('enqueues a new USER_INVITATION_EMAIL outbox event on reinvite', async () => {
    const invited = await users.invite({
      organizationId,
      email: 'reinvite@zitaware.test',
      displayName: 'Reinvite User',
      roleIds: [],
      employeeId: undefined,
      actorId,
      correlationId: generateId(),
      idempotencyKey: generateId(),
      requestHash: 'hash-reinvite',
    });

    await users.reinvite({
      organizationId,
      userId: invited.userId,
      actorId,
      correlationId: generateId(),
    });

    const outboxRows = await prisma.client.outboxEvent.findMany({
      where: { organizationId, aggregateId: invited.userId, eventType: 'USER_INVITATION_EMAIL' },
    });
    expect(outboxRows).toHaveLength(2);
  });
});

describe('UsersService (getDetail, enable, revokeSessions, employee link)', () => {
  it('getDetail composes roles, overrides, effective permissions and linked employee', async () => {
    const role = await roles.create({
      organizationId,
      name: `Detail Test Role ${generateId()}`,
      description: undefined,
      permissionKeys: ['master.read', 'document.read'],
      actorId,
      correlationId: generateId(),
    });
    const employee = await createLinkableEmployee('Detail Test Employee');

    const invited = await users.invite({
      organizationId,
      email: `detail-${generateId()}@zitaware.test`,
      displayName: 'Detail Test User',
      roleIds: [role.id],
      employeeId: employee.id,
      actorId,
      correlationId: generateId(),
      idempotencyKey: generateId(),
      requestHash: `hash-detail-${generateId()}`,
    });

    await roles.setPermissionOverride({
      organizationId,
      userId: invited.userId,
      permissionKey: 'document.read',
      effect: 'REVOKE',
      reason: 'test override',
      actorId,
      correlationId: generateId(),
    });
    await roles.setPermissionOverride({
      organizationId,
      userId: invited.userId,
      permissionKey: 'audit.read',
      effect: 'GRANT',
      reason: undefined,
      actorId,
      correlationId: generateId(),
    });

    const detail = await users.getDetail({ organizationId, userId: invited.userId });
    expect(detail?.roles.map((r) => r.id)).toEqual([role.id]);
    expect(detail?.employee?.id).toBe(employee.id);
    expect(new Set(detail?.effectivePermissions)).toEqual(new Set(['master.read', 'audit.read']));
    expect(detail?.overrides.some((o) => o.permissionKey === 'document.read' && o.effect === 'REVOKE')).toBe(true);
  });

  it('rejects inviting with an already-linked employee, and disable keeps the employee link', async () => {
    const employee = await createLinkableEmployee('Already Linked Employee');
    const invited = await users.invite({
      organizationId,
      email: `linked-${generateId()}@zitaware.test`,
      displayName: 'Linked User',
      roleIds: [],
      employeeId: employee.id,
      actorId,
      correlationId: generateId(),
      idempotencyKey: generateId(),
      requestHash: `hash-linked-${generateId()}`,
    });

    await expect(
      users.invite({
        organizationId,
        email: `linked-2-${generateId()}@zitaware.test`,
        displayName: 'Second User',
        roleIds: [],
        employeeId: employee.id,
        actorId,
        correlationId: generateId(),
        idempotencyKey: generateId(),
        requestHash: `hash-linked-2-${generateId()}`,
      }),
    ).rejects.toThrow(/not available to link/i);

    // disable() requires an accepted invitation (a set password) per the DB's
    // own chk_users_status_password_consistency constraint.
    await prisma.client.user.update({ where: { id: invited.userId }, data: { passwordHash: 'test-hash', status: 'ACTIVE' } });
    await users.disable({ organizationId, userId: invited.userId, actorId, correlationId: generateId() });
    const stillLinked = await prisma.client.employee.findUnique({ where: { id: employee.id } });
    expect(stillLinked?.userId).toBe(invited.userId);
  });

  it('enable reverses disable only for a user with a set password, and revokeSessions kills sessions without changing status', async () => {
    const invited = await users.invite({
      organizationId,
      email: `enable-${generateId()}@zitaware.test`,
      displayName: 'Enable Test User',
      roleIds: [],
      employeeId: undefined,
      actorId,
      correlationId: generateId(),
      idempotencyKey: generateId(),
      requestHash: `hash-enable-${generateId()}`,
    });

    // Never accepted invite (no passwordHash) — disable itself must be rejected
    // (the DB's chk_users_status_password_consistency constraint forbids a
    // DISABLED row with a null password_hash).
    await expect(
      users.disable({ organizationId, userId: invited.userId, actorId, correlationId: generateId() }),
    ).rejects.toThrow(/has not accepted their invitation/i);
    await expect(
      users.enable({ organizationId, userId: invited.userId, actorId, correlationId: generateId() }),
    ).rejects.toThrow(/Only a disabled user/i);

    await prisma.client.user.update({
      where: { id: invited.userId },
      data: { passwordHash: 'test-hash', status: 'DISABLED' },
    });
    await users.enable({ organizationId, userId: invited.userId, actorId, correlationId: generateId() });
    const enabled = await prisma.client.user.findUnique({ where: { id: invited.userId } });
    expect(enabled?.status).toBe('ACTIVE');

    await prisma.client.session.create({
      data: {
        id: generateId(),
        organizationId,
        userId: invited.userId,
        refreshTokenHash: `session-hash-${generateId()}`,
        refreshTokenFamilyId: generateId(),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await users.revokeSessions({ organizationId, userId: invited.userId, actorId, correlationId: generateId() });
    const sessions = await prisma.client.session.findMany({ where: { userId: invited.userId } });
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
    const afterRevoke = await prisma.client.user.findUnique({ where: { id: invited.userId } });
    expect(afterRevoke?.status).toBe('ACTIVE');
  });

  it('linkEmployee/unlinkEmployee manage the link from the user side', async () => {
    const invited = await users.invite({
      organizationId,
      email: `link-${generateId()}@zitaware.test`,
      displayName: 'Link Test User',
      roleIds: [],
      employeeId: undefined,
      actorId,
      correlationId: generateId(),
      idempotencyKey: generateId(),
      requestHash: `hash-link-${generateId()}`,
    });
    const employee = await createLinkableEmployee('Link Side Employee');

    await users.linkEmployee({
      organizationId,
      userId: invited.userId,
      employeeId: employee.id,
      actorId,
      correlationId: generateId(),
    });
    const linked = await prisma.client.employee.findUnique({ where: { id: employee.id } });
    expect(linked?.userId).toBe(invited.userId);

    await users.unlinkEmployee({ organizationId, userId: invited.userId, actorId, correlationId: generateId() });
    const unlinked = await prisma.client.employee.findUnique({ where: { id: employee.id } });
    expect(unlinked?.userId).toBeNull();
  });
});
