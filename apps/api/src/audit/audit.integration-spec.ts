import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

const prisma = new PrismaService();
const audit = new AuditService(prisma);

let organizationId: string;
let otherOrganizationId: string;

async function seedEvent(overrides: {
  organizationId: string;
  entityType: string;
  action: string;
  actorEmail: string;
  createdAt: Date;
}) {
  return prisma.client.auditEvent.create({
    data: {
      id: generateId(),
      organizationId: overrides.organizationId,
      entityType: overrides.entityType,
      entityId: generateId(),
      action: overrides.action,
      actorId: generateId(),
      actorEmail: overrides.actorEmail,
      newValues: { example: true },
      correlationId: generateId(),
      createdAt: overrides.createdAt,
    },
  });
}

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Audit Test Org', code: `AUDITTEST-${generateId()}` },
  });
  organizationId = organization.id;
  const otherOrganization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Audit Test Other Org', code: `AUDITTEST-OTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrganization.id;

  await seedEvent({
    organizationId,
    entityType: 'ROLE',
    action: 'ROLE_CREATED',
    actorEmail: 'admin@zitaware.test',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  await seedEvent({
    organizationId,
    entityType: 'ROLE',
    action: 'ROLE_UPDATED',
    actorEmail: 'admin@zitaware.test',
    createdAt: new Date('2026-01-05T00:00:00.000Z'),
  });
  await seedEvent({
    organizationId,
    entityType: 'USER',
    action: 'USER_INVITED',
    actorEmail: 'accountant@zitaware.test',
    createdAt: new Date('2026-01-10T00:00:00.000Z'),
  });
  await seedEvent({
    organizationId: otherOrganizationId,
    entityType: 'ROLE',
    action: 'ROLE_CREATED',
    actorEmail: 'other-org-admin@zitaware.test',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
});

afterAll(async () => {
  await prisma.client.auditEvent.deleteMany({ where: { organizationId } });
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: otherOrganizationId } });
  await prisma.client.organization.delete({ where: { id: organizationId } });
  await prisma.client.organization.delete({ where: { id: otherOrganizationId } });
  await prisma.client.$disconnect();
});

describe('AuditService', () => {
  it('lists events for the organization only, newest first, org-scoped away from other orgs', async () => {
    const { rows, total } = await audit.list({ organizationId, page: 1, pageSize: 25, filters: {} });
    expect(total).toBe(3);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.action).toBe('USER_INVITED');
    expect(rows.every((row) => row.organizationId === organizationId)).toBe(true);
  });

  it('paginates correctly', async () => {
    const page1 = await audit.list({ organizationId, page: 1, pageSize: 2, filters: {} });
    expect(page1.rows).toHaveLength(2);
    expect(page1.total).toBe(3);
    const page2 = await audit.list({ organizationId, page: 2, pageSize: 2, filters: {} });
    expect(page2.rows).toHaveLength(1);
    expect(page2.total).toBe(3);
  });

  it('filters by actorEmail substring (case-insensitive)', async () => {
    const { rows, total } = await audit.list({
      organizationId,
      page: 1,
      pageSize: 25,
      filters: { actorEmail: 'ACCOUNTANT' },
    });
    expect(total).toBe(1);
    expect(rows[0]!.actorEmail).toBe('accountant@zitaware.test');
  });

  it('filters by entityType', async () => {
    const { total } = await audit.list({ organizationId, page: 1, pageSize: 25, filters: { entityType: 'ROLE' } });
    expect(total).toBe(2);
  });

  it('filters by action', async () => {
    const { total } = await audit.list({
      organizationId,
      page: 1,
      pageSize: 25,
      filters: { action: 'ROLE_UPDATED' },
    });
    expect(total).toBe(1);
  });

  it('filters by date range (inclusive bounds)', async () => {
    const { total } = await audit.list({
      organizationId,
      page: 1,
      pageSize: 25,
      filters: { dateFrom: '2026-01-05', dateTo: '2026-01-10' },
    });
    expect(total).toBe(2);
  });

  it('listEntityTypes/listActions return only distinct values present for this organization', async () => {
    const entityTypes = await audit.listEntityTypes({ organizationId });
    expect(new Set(entityTypes)).toEqual(new Set(['ROLE', 'USER']));

    const actions = await audit.listActions({ organizationId });
    expect(new Set(actions)).toEqual(new Set(['ROLE_CREATED', 'ROLE_UPDATED', 'USER_INVITED']));
  });

  describe('getById', () => {
    it('returns the event when it belongs to the requesting organization', async () => {
      const { rows } = await audit.list({ organizationId, page: 1, pageSize: 25, filters: { action: 'ROLE_UPDATED' } });
      const target = rows[0]!;
      const found = await audit.getById({ organizationId, id: target.id });
      expect(found.id).toBe(target.id);
      expect(found.action).toBe('ROLE_UPDATED');
    });

    it('throws NOT_FOUND for an event belonging to a different organization', async () => {
      const { rows } = await audit.list({ organizationId: otherOrganizationId, page: 1, pageSize: 25, filters: {} });
      const otherOrgEvent = rows[0]!;
      await expect(audit.getById({ organizationId, id: otherOrgEvent.id })).rejects.toThrow();
    });

    it('throws NOT_FOUND for a non-existent id', async () => {
      await expect(audit.getById({ organizationId, id: generateId() })).rejects.toThrow();
    });
  });
});
