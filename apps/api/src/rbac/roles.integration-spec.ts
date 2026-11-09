import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { RolesService } from './roles.service';

const prisma = new PrismaService();
const roles = new RolesService(prisma);

let organizationId: string;
const actorId = generateId();

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Roles Test Org', code: `ROLESTEST-${generateId()}` },
  });
  organizationId = organization.id;
});

afterAll(async () => {
  await prisma.client.auditEvent.deleteMany({ where: { organizationId } });
  await prisma.client.userRole.deleteMany({ where: { organizationId } });
  const orgRoles = await prisma.client.role.findMany({ where: { organizationId } });
  await prisma.client.rolePermission.deleteMany({ where: { roleId: { in: orgRoles.map((r) => r.id) } } });
  await prisma.client.role.deleteMany({ where: { organizationId } });
  await prisma.client.user.deleteMany({ where: { organizationId } });
  await prisma.client.organization.delete({ where: { id: organizationId } });
  await prisma.client.$disconnect();
});

describe('RolesService (custom role CRUD)', () => {
  it('lists the full permission catalog (132 seeded permissions)', async () => {
    const catalog = await roles.listPermissionCatalog();
    // 151 since project.manage_team (ADR-137); less the 14 subscription.* and
    // server.* keys (ADR-169), plus legal_entity.access_all (ADR-172) and
    // user.impersonate (ADR-174) and employee.read_salary (ADR-175); less the
    // four tender.* and four security_instrument.* keys (ADR-192).
    expect(catalog.length).toBe(132);
    expect(catalog.every((entry) => entry.key && entry.resource && entry.action)).toBe(true);
    expect(catalog.some((entry) => entry.key === 'user.manage')).toBe(true);
  });

  /**
   * Per-role grant assertions (ADR-097 E2).
   *
   * Until now this suite checked only the SIZE of the permission catalog,
   * never which role actually receives which key — which is exactly how a
   * money-moving permission (`introducer_fee.pay`) reached Project Manager
   * instead of Accountant and shipped unnoticed. A count assertion cannot
   * catch a misplaced grant, because the count is unchanged.
   *
   * These assertions read the seeded system roles directly, so they fail if
   * a seed edit lands a key on the wrong role.
   */
  describe('seeded system role grants', () => {
    // Looked up by system-role identity rather than by this spec's own
    // throwaway organization, which has no seeded roles — these assertions
    // are about what `seed.ts` grants, the same way the catalog-count test
    // above is about what it inserts.
    async function keysFor(roleName: string): Promise<Set<string>> {
      const role = await prisma.client.role.findFirstOrThrow({
        where: { name: roleName, isSystem: true },
        include: { rolePermissions: { include: { permission: true } } },
      });
      return new Set(role.rolePermissions.map((rp) => rp.permission.key));
    }

    it('gives every money-moving key to the Accountant, and none of them to the Project Manager', async () => {
      const accountant = await keysFor('Accountant');
      const catalog = await prisma.client.permission.findMany({ select: { key: true } });
      // Every job (ADR-135), but only for their own legal entity: seeing every
      // legal entity is Admin's alone (ADR-172).
      const adminOnly = ['legal_entity.access_all', 'user.impersonate'];
      expect(accountant, 'Accountant can do every job (ADR-135)').toEqual(new Set(catalog.map((row) => row.key).filter((key) => !adminOnly.includes(key))));
      const admin = await keysFor('Admin');
      for (const key of adminOnly) expect(admin.has(key), `Admin should hold ${key}`).toBe(true);
      const projectManager = await keysFor('Project Manager');

      // Every action in Phase 7 that posts to the ledger or moves cash.
      // Stock receive/consume moved to the Project Manager with ADR-139,
      // which gives it the Hardware Manager's store work (asserted below).
      const moneyMoving = [
        'salary_import.commit',
        'salary_import.pay',
        'introducer_fee.create',
        'introducer_fee.pay',
      ];
      for (const key of moneyMoving) {
        expect(accountant.has(key), `Accountant should hold ${key}`).toBe(true);
        expect(projectManager.has(key), `Project Manager must NOT hold ${key}`).toBe(false);
      }
    });

    it('gives the Project Manager stock and allocation reads, but not project costs (ADR-157)', async () => {
      const projectManager = await keysFor('Project Manager');
      // The project's Costs tab renders each section only with its own read
      // key (ADR-097 B, ADR-099); the cost sections stay with finance.
      for (const key of ['inventory.read', 'employee_allocation.read']) {
        expect(projectManager.has(key), `Project Manager should hold ${key}`).toBe(true);
      }
      for (const key of ['project_cost.read', 'introducer_fee.read']) {
        expect(projectManager.has(key), `Project Manager must NOT hold ${key} (ADR-157)`).toBe(false);
      }
    });

    it('lets the Accountant read and export receivables reports, and the Project Manager only read them (ADR-108)', async () => {
      const accountant = await keysFor('Accountant');
      const projectManager = await keysFor('Project Manager');
      expect(accountant.has('report.receivables.read')).toBe(true);
      expect(accountant.has('report.export')).toBe(true);
      expect(accountant.has('report.profitability.read')).toBe(true);
      expect(projectManager.has('employee_claim.create')).toBe(true);
      expect(projectManager.has('project.read_all')).toBe(true);
      expect(projectManager.has('report.receivables.read')).toBe(false);
      expect(projectManager.has('project.read_financials')).toBe(false);
      expect(projectManager.has('lead.update')).toBe(false);
      expect(projectManager.has('dashboard.read')).toBe(false);
      expect(projectManager.has('report.export'), 'Project Manager must NOT download reports').toBe(false);
      expect(accountant.has('report.gst.read')).toBe(true);
      expect(projectManager.has('report.gst.read'), 'GST is company tax, not a project read (ADR-111)').toBe(false);
      for (const key of ['report.tds.read', 'tds_certificate.read', 'tds_certificate.manage', 'tds_deposit.read', 'tds_deposit.post', 'bank_reconciliation.read', 'bank_reconciliation.manage', 'bank_reconciliation.approve', 'report.cash.read', 'report.payables.read', 'report.operations.read', 'report.controls.read']) {
        expect(accountant.has(key), `Accountant should hold ${key}`).toBe(true);
        expect(projectManager.has(key), `Project Manager must NOT hold ${key} (ADR-112)`).toBe(false);
      }
    });

    it('gives the CEO every permission but the Admin-only ones (ADR-136, ADR-172)', async () => {
      const role = await prisma.client.role.findFirstOrThrow({
        where: { name: 'CEO' },
        include: { rolePermissions: { include: { permission: true } } },
      });
      const held = new Set(role.rolePermissions.map((rp) => rp.permission.key));
      const catalog = await prisma.client.permission.findMany({ select: { key: true } });
      const adminOnly = ['legal_entity.access_all', 'user.impersonate'];
      expect(held).toEqual(new Set(catalog.map((row) => row.key).filter((key) => !adminOnly.includes(key))));
    });

    it('opens the Dashboard to the Accountant and Admin, whose cards still follow their report keys (ADR-119)', async () => {
      for (const role of ['Accountant', 'Admin']) {
        expect((await keysFor(role)).has('dashboard.read'), `${role} should hold dashboard.read`).toBe(true);
      }
      expect((await keysFor('Project Manager')).has('dashboard.read')).toBe(false);
    });

    it('gives the Hardware Manager the store, and keeps payment and approval with the Accountant (ADR-129)', async () => {
      const hardware = await prisma.client.role.findFirstOrThrow({
        where: { name: 'Hardware Manager', isSystem: false },
        include: { rolePermissions: { include: { permission: true } } },
      });
      const keys = new Set(hardware.rolePermissions.map((rp) => rp.permission.key));
      for (const key of ['inventory.receive', 'inventory.consume', 'inventory_item.manage', 'vendor_bill.create', 'project.read_all', 'project.manage_team', 'employee.read', 'employee_allocation.read', 'employee_allocation.manage']) {
        expect(keys.has(key), `Hardware Manager should hold ${key}`).toBe(true);
      }
      for (const key of ['vendor_bill.approve', 'vendor_payment.post', 'receipt.post', 'invoice.finalize', 'invoice.read', 'lead.update', 'dashboard.read', 'direct_expense.post', 'user.manage', 'project.update', 'project.read_financials']) {
        expect(keys.has(key), `Hardware Manager must NOT hold ${key}`).toBe(false);
      }
    });

    it('gives Project Manager and Hardware Manager the same permissions (ADR-139)', async () => {
      const projectManager = await keysFor('Project Manager');
      const hardware = await prisma.client.role.findFirstOrThrow({
        where: { name: 'Hardware Manager' },
        include: { rolePermissions: { include: { permission: true } } },
      });
      const hardwareKeys = new Set(hardware.rolePermissions.map((rp) => rp.permission.key));
      expect(hardwareKeys).toEqual(projectManager);
      expect(projectManager.has('inventory.receive')).toBe(true);
      expect(projectManager.has('project.manage_team')).toBe(true);
      expect(projectManager.has('project.change_stage')).toBe(false);
      expect(hardwareKeys.has('lead.update')).toBe(false);
    });

    it('lets the Project Manager assign the team and allocate employees, without editing the project (ADR-137)', async () => {
      const projectManager = await keysFor('Project Manager');
      expect(projectManager.has('project.manage_team')).toBe(true);
      expect(projectManager.has('employee_allocation.manage')).toBe(true);
      // ADR-173: progress, milestones and dues on the project page; still no books.
      for (const key of ['project_progress.create', 'milestone.read', 'payment_alert.read']) expect(projectManager.has(key), `Project Manager should hold ${key}`).toBe(true);
      for (const key of ['invoice.read', 'receipt.read', 'journal.read', 'employee.read_salary']) expect(projectManager.has(key), `Project Manager must NOT hold ${key}`).toBe(false);
      // Employee is seeded as an editable (non-system) role.
      const employeeRole = await prisma.client.role.findFirstOrThrow({
        where: { name: 'Employee' },
        include: { rolePermissions: { include: { permission: true } } },
      });
      const employee = new Set(employeeRole.rolePermissions.map((rp) => rp.permission.key));
      expect([employee.has('document.upload'), employee.has('document.manage')]).toEqual([true, false]);
      expect(projectManager.has('employee.read')).toBe(true);
      expect(projectManager.has('project.update')).toBe(false);
    });
  });

  it('creates a custom role with a permission set and reads it back via getDetail', async () => {
    const created = await roles.create({
      organizationId,
      name: 'Field Auditor',
      description: 'Read-only field role',
      permissionKeys: ['master.read', 'document.read'],
      actorId,
      correlationId: generateId(),
    });
    expect(created.isSystem).toBe(false);
    expect(new Set(created.permissionKeys)).toEqual(new Set(['master.read', 'document.read']));
    expect(created.memberCount).toBe(0);

    const detail = await roles.getDetail({ organizationId, roleId: created.id });
    expect(detail?.name).toBe('Field Auditor');
  });

  it('rejects an unknown permission key on create', async () => {
    await expect(
      roles.create({
        organizationId,
        name: 'Bad Role',
        description: undefined,
        permissionKeys: ['not.a.real.permission'],
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow(/Unknown permission key/i);
  });

  it('replaces a role permission set via setPermissions', async () => {
    const role = await roles.create({
      organizationId,
      name: 'Reviewer',
      description: undefined,
      permissionKeys: ['master.read'],
      actorId,
      correlationId: generateId(),
    });

    const updated = await roles.setPermissions({
      organizationId,
      roleId: role.id,
      permissionKeys: ['audit.read', 'employee.read'],
      actorId,
      correlationId: generateId(),
    });
    expect(new Set(updated.permissionKeys)).toEqual(new Set(['audit.read', 'employee.read']));
  });

  it('rejects editing or deleting a system role', async () => {
    const systemRole = await prisma.client.role.create({
      data: { id: generateId(), organizationId, name: 'Seeded Admin', isSystem: true },
    });

    await expect(
      roles.setPermissions({
        organizationId,
        roleId: systemRole.id,
        permissionKeys: ['master.read'],
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow(/System roles cannot be edited/i);

    await expect(
      roles.delete({ organizationId, roleId: systemRole.id, actorId, correlationId: generateId() }),
    ).rejects.toThrow(/System roles cannot be edited/i);
  });

  it('deletes a custom role with no members but refuses one with members', async () => {
    const role = await roles.create({
      organizationId,
      name: 'Temp Role',
      description: undefined,
      permissionKeys: [],
      actorId,
      correlationId: generateId(),
    });

    // No members yet → deletes.
    await roles.delete({ organizationId, roleId: role.id, actorId, correlationId: generateId() });
    expect(await roles.getDetail({ organizationId, roleId: role.id })).toBeNull();

    // Recreate + assign a user, then deletion must be refused.
    const role2 = await roles.create({
      organizationId,
      name: 'Assigned Role',
      description: undefined,
      permissionKeys: [],
      actorId,
      correlationId: generateId(),
    });
    const user = await prisma.client.user.create({
      data: {
        id: generateId(),
        organizationId,
        email: `roles-test-${generateId()}@zitaware.test`,
        passwordHash: 'test-hash',
        displayName: 'Roles Test User',
        status: 'ACTIVE',
      },
    });
    await roles.assignRole({ organizationId, userId: user.id, roleId: role2.id, actorId, correlationId: generateId() });

    const list = await roles.list({ organizationId });
    expect(list.find((r) => r.id === role2.id)?.memberCount).toBe(1);

    await expect(
      roles.delete({ organizationId, roleId: role2.id, actorId, correlationId: generateId() }),
    ).rejects.toThrow(/still assigned to users/i);
  });

  it('clearPermissionOverride reverts a user back to plain role-inheritance', async () => {
    const user = await prisma.client.user.create({
      data: {
        id: generateId(),
        organizationId,
        email: `clear-override-${generateId()}@zitaware.test`,
        passwordHash: 'test-hash',
        displayName: 'Clear Override Test User',
        status: 'ACTIVE',
      },
    });

    await roles.setPermissionOverride({
      organizationId,
      userId: user.id,
      permissionKey: 'audit.read',
      effect: 'GRANT',
      reason: undefined,
      actorId,
      correlationId: generateId(),
    });
    expect(await roles.getEffectivePermissions({ organizationId, userId: user.id })).toEqual(new Set(['audit.read']));

    await roles.clearPermissionOverride({
      organizationId,
      userId: user.id,
      permissionKey: 'audit.read',
      actorId,
      correlationId: generateId(),
    });
    expect(await roles.getEffectivePermissions({ organizationId, userId: user.id })).toEqual(new Set());

    // Clearing an already-absent override is a harmless no-op.
    await roles.clearPermissionOverride({
      organizationId,
      userId: user.id,
      permissionKey: 'audit.read',
      actorId,
      correlationId: generateId(),
    });
  });
});
