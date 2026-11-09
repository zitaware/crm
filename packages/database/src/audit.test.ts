import { describe, expect, it } from 'vitest';
import { PrismaClient } from './client';
import { recordAuditEvent } from './audit';
import { generateId } from './uuid';

// Inline rollback (not packages/testing's withRolledBackTransaction, which
// depends on this package — importing it here would be circular).
async function withRolledBackTransaction<T>(
  fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  const prisma = new PrismaClient();
  const ROLLBACK = Symbol('rollback');
  try {
    let result: T;
    await prisma
      .$transaction(async (tx) => {
        result = await fn(tx);
        throw ROLLBACK;
      })
      .catch((error: unknown) => {
        if (error !== ROLLBACK) throw error;
      });
    return result!;
  } finally {
    await prisma.$disconnect();
  }
}

describe('recordAuditEvent', () => {
  it('writes an append-only audit row inside the caller transaction', async () => {
    await withRolledBackTransaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { id: generateId(), name: 'Test Org', code: 'TEST-ORG' },
      });

      await recordAuditEvent(tx, {
        organizationId: organization.id,
        entityType: 'ORGANIZATION',
        entityId: organization.id,
        action: 'ORGANIZATION_CREATED',
        correlationId: generateId(),
      });

      const events = await tx.auditEvent.findMany({ where: { organizationId: organization.id } });
      expect(events).toHaveLength(1);
      expect(events[0]?.action).toBe('ORGANIZATION_CREATED');
    });
  });

  it('resolves actorEmail from actorId when the caller does not supply it directly', async () => {
    await withRolledBackTransaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { id: generateId(), name: 'Test Org', code: 'TEST-ORG-2' },
      });
      const user = await tx.user.create({
        data: {
          id: generateId(),
          organizationId: organization.id,
          email: 'snapshot-test@zitaware.test',
          passwordHash: 'test-hash',
          displayName: 'Snapshot Test User',
          status: 'ACTIVE',
        },
      });

      await recordAuditEvent(tx, {
        organizationId: organization.id,
        entityType: 'ORGANIZATION',
        entityId: organization.id,
        action: 'ORGANIZATION_UPDATED',
        actorId: user.id,
        correlationId: generateId(),
      });

      const events = await tx.auditEvent.findMany({ where: { organizationId: organization.id } });
      expect(events[0]?.actorEmail).toBe('snapshot-test@zitaware.test');
    });
  });

  it('leaves actorEmail null when there is no actorId to resolve from', async () => {
    await withRolledBackTransaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { id: generateId(), name: 'Test Org', code: 'TEST-ORG-3' },
      });

      await recordAuditEvent(tx, {
        organizationId: organization.id,
        entityType: 'ORGANIZATION',
        entityId: organization.id,
        action: 'ORGANIZATION_CREATED',
        correlationId: generateId(),
      });

      const events = await tx.auditEvent.findMany({ where: { organizationId: organization.id } });
      expect(events[0]?.actorEmail).toBeNull();
    });
  });
});
