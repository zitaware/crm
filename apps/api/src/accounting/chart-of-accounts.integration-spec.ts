import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { ChartOfAccountsService } from './chart-of-accounts.service';

const prisma = new PrismaService();
const coa = new ChartOfAccountsService(prisma);

let organizationId: string;
let otherOrganizationId: string;
let assetRootId: string;
let liabilityRootId: string;
const actorId = generateId();

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'COA Test Org', code: `COATEST-${generateId()}` },
  });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'COA Test Other Org', code: `COATEST-OTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  await prisma.client.user.create({
    data: {
      id: actorId,
      organizationId,
      email: 'coa-actor@zitaware.test',
      passwordHash: 'test-hash',
      displayName: 'COA Actor',
      status: 'ACTIVE',
    },
  });

  // Roots are seeded directly via Prisma in real usage (never through the
  // service) — mirrored here for the test organization.
  const assetRoot = await prisma.client.accountGroup.create({
    data: {
      id: generateId(),
      organizationId,
      code: 'ASSETS',
      name: 'Assets',
      accountType: 'ASSET',
      normalBalance: 'DEBIT',
      isSystemDefined: true,
    },
  });
  assetRootId = assetRoot.id;

  const liabilityRoot = await prisma.client.accountGroup.create({
    data: {
      id: generateId(),
      organizationId,
      code: 'LIABILITIES',
      name: 'Liabilities',
      accountType: 'LIABILITY',
      normalBalance: 'CREDIT',
      isSystemDefined: true,
    },
  });
  liabilityRootId = liabilityRoot.id;
});

afterAll(async () => {
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.ledgerAccount.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.accountGroup.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.user.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
  await prisma.client.$disconnect();
});

describe('ChartOfAccountsService — Account Groups', () => {
  it('seeded roots have the correct fixed accountType/normalBalance and are system-defined', async () => {
    const groups = await coa.listGroups({ organizationId, includeInactive: true });
    const assets = groups.find((g) => g.id === assetRootId)!;
    expect(assets.accountType).toBe('ASSET');
    expect(assets.normalBalance).toBe('DEBIT');
    expect(assets.isSystemDefined).toBe(true);
    expect(assets.parentGroupId).toBeNull();
  });

  it('creates a custom group under the Assets root, inheriting accountType/normalBalance', async () => {
    const created = await coa.createGroup({
      organizationId,
      code: 'current_assets',
      name: 'Current Assets',
      description: undefined,
      parentGroupId: assetRootId,
      actorId,
      correlationId: generateId(),
    });
    expect(created.code).toBe('CURRENT_ASSETS'); // normalized
    expect(created.accountType).toBe('ASSET');
    expect(created.normalBalance).toBe('DEBIT');
    expect(created.parentGroupId).toBe(assetRootId);

    const events = await prisma.client.auditEvent.findMany({
      where: { organizationId, entityId: created.id, action: 'ACCOUNT_GROUP_CREATED' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.newValues).toMatchObject({ code: 'CURRENT_ASSETS', parentGroupId: assetRootId });
  });

  it('rejects a group create under a non-existent or inactive parent', async () => {
    await expect(
      coa.createGroup({
        organizationId,
        code: 'orphan',
        name: 'Orphan',
        description: undefined,
        parentGroupId: generateId(),
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('does not exist');

    const inactiveParent = await coa.createGroup({
      organizationId,
      code: 'to_deactivate',
      name: 'To Deactivate',
      description: undefined,
      parentGroupId: assetRootId,
      actorId,
      correlationId: generateId(),
    });
    await coa.setGroupActive({
      organizationId,
      id: inactiveParent.id,
      isActive: false,
      expectedVersion: inactiveParent.version,
      actorId,
      correlationId: generateId(),
    });
    await expect(
      coa.createGroup({
        organizationId,
        code: 'under_inactive',
        name: 'Under Inactive',
        description: undefined,
        parentGroupId: inactiveParent.id,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('inactive');
  });

  it('rejects a duplicate group code, including a normalized duplicate', async () => {
    await coa.createGroup({
      organizationId,
      code: 'BANK_GROUP',
      name: 'Bank Group',
      description: undefined,
      parentGroupId: assetRootId,
      actorId,
      correlationId: generateId(),
    });
    await expect(
      coa.createGroup({
        organizationId,
        code: 'bank_group',
        name: 'Bank Group Again',
        description: undefined,
        parentGroupId: assetRootId,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('already exists');
  });

  it('rejects renaming a system-defined root\'s classification fields via re-parenting, but allows name/description edits', async () => {
    const otherRoot = liabilityRootId;
    await expect(
      coa.updateGroup({
        organizationId,
        id: assetRootId,
        name: undefined,
        description: undefined,
        parentGroupId: otherRoot,
        expectedVersion: 1,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('cannot be re-parented');

    const updated = await coa.updateGroup({
      organizationId,
      id: assetRootId,
      name: 'Assets (Renamed)',
      description: 'Updated description',
      parentGroupId: undefined,
      expectedVersion: 1,
      actorId,
      correlationId: generateId(),
    });
    expect(updated.name).toBe('Assets (Renamed)');
    expect(updated.accountType).toBe('ASSET');

    // restore for subsequent tests/assertions relying on the original name
    await coa.updateGroup({
      organizationId,
      id: assetRootId,
      name: 'Assets',
      description: undefined,
      parentGroupId: undefined,
      expectedVersion: updated.version,
      actorId,
      correlationId: generateId(),
    });
  });

  it('rejects direct and multi-level re-parent cycles', async () => {
    const a = await coa.createGroup({
      organizationId,
      code: 'cycle_a',
      name: 'Cycle A',
      description: undefined,
      parentGroupId: assetRootId,
      actorId,
      correlationId: generateId(),
    });
    const b = await coa.createGroup({
      organizationId,
      code: 'cycle_b',
      name: 'Cycle B',
      description: undefined,
      parentGroupId: a.id,
      actorId,
      correlationId: generateId(),
    });
    const c = await coa.createGroup({
      organizationId,
      code: 'cycle_c',
      name: 'Cycle C',
      description: undefined,
      parentGroupId: b.id,
      actorId,
      correlationId: generateId(),
    });

    // direct: A -> A
    await expect(
      coa.updateGroup({
        organizationId,
        id: a.id,
        name: undefined,
        description: undefined,
        parentGroupId: a.id,
        expectedVersion: a.version,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('own parent');

    // indirect: A's parent set to C, where C is a descendant of A (A->B->C)
    await expect(
      coa.updateGroup({
        organizationId,
        id: a.id,
        name: undefined,
        description: undefined,
        parentGroupId: c.id,
        expectedVersion: a.version,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('circular');
  });

  it('rejects re-parenting under an inactive or classification-incompatible parent', async () => {
    const group = await coa.createGroup({
      organizationId,
      code: 'reparent_me',
      name: 'Reparent Me',
      description: undefined,
      parentGroupId: assetRootId,
      actorId,
      correlationId: generateId(),
    });

    await expect(
      coa.updateGroup({
        organizationId,
        id: group.id,
        name: undefined,
        description: undefined,
        parentGroupId: liabilityRootId,
        expectedVersion: group.version,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('different account classification');

    const inactiveParent = await coa.createGroup({
      organizationId,
      code: 'inactive_target',
      name: 'Inactive Target',
      description: undefined,
      parentGroupId: assetRootId,
      actorId,
      correlationId: generateId(),
    });
    await coa.setGroupActive({
      organizationId,
      id: inactiveParent.id,
      isActive: false,
      expectedVersion: inactiveParent.version,
      actorId,
      correlationId: generateId(),
    });
    await expect(
      coa.updateGroup({
        organizationId,
        id: group.id,
        name: undefined,
        description: undefined,
        parentGroupId: inactiveParent.id,
        expectedVersion: group.version,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('inactive');
  });

  it('rejects deactivating a group while an active child group or ledger account exists, and rejects deactivating a system root', async () => {
    await expect(
      coa.setGroupActive({
        organizationId,
        id: assetRootId,
        isActive: false,
        expectedVersion: 999,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('cannot be deactivated');

    const parent = await coa.createGroup({
      organizationId,
      code: 'dep_parent',
      name: 'Dependent Parent',
      description: undefined,
      parentGroupId: assetRootId,
      actorId,
      correlationId: generateId(),
    });
    await coa.createGroup({
      organizationId,
      code: 'dep_child',
      name: 'Dependent Child',
      description: undefined,
      parentGroupId: parent.id,
      actorId,
      correlationId: generateId(),
    });
    await expect(
      coa.setGroupActive({
        organizationId,
        id: parent.id,
        isActive: false,
        expectedVersion: parent.version,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('Cannot deactivate');

    const leaf = await coa.createGroup({
      organizationId,
      code: 'dep_leaf',
      name: 'Dependent Leaf',
      description: undefined,
      parentGroupId: assetRootId,
      actorId,
      correlationId: generateId(),
    });
    await coa.createAccount({
      organizationId,
      code: 'dep_account',
      name: 'Dependent Account',
      description: undefined,
      accountGroupId: leaf.id,
      allowManualPosting: undefined,
      actorId,
      correlationId: generateId(),
    });
    await expect(
      coa.setGroupActive({
        organizationId,
        id: leaf.id,
        isActive: false,
        expectedVersion: leaf.version,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('Cannot deactivate');
  });

  it('deactivates and reactivates a non-system group with no dependents', async () => {
    const group = await coa.createGroup({
      organizationId,
      code: 'lifecycle_group',
      name: 'Lifecycle Group',
      description: undefined,
      parentGroupId: assetRootId,
      actorId,
      correlationId: generateId(),
    });
    await coa.setGroupActive({
      organizationId,
      id: group.id,
      isActive: false,
      expectedVersion: group.version,
      actorId,
      correlationId: generateId(),
    });
    const afterDeactivate = (await coa.listGroups({ organizationId, includeInactive: true })).find(
      (g) => g.id === group.id,
    );
    expect(afterDeactivate?.isActive).toBe(false);

    await coa.setGroupActive({
      organizationId,
      id: group.id,
      isActive: true,
      expectedVersion: afterDeactivate!.version,
      actorId,
      correlationId: generateId(),
    });
    const afterReactivate = (await coa.listGroups({ organizationId, includeInactive: true })).find(
      (g) => g.id === group.id,
    );
    expect(afterReactivate?.isActive).toBe(true);
  });

  it('rejects a stale expectedVersion on update and setActive', async () => {
    const group = await coa.createGroup({
      organizationId,
      code: 'version_group',
      name: 'Version Group',
      description: undefined,
      parentGroupId: assetRootId,
      actorId,
      correlationId: generateId(),
    });
    await expect(
      coa.updateGroup({
        organizationId,
        id: group.id,
        name: 'New Name',
        description: undefined,
        parentGroupId: undefined,
        expectedVersion: group.version + 1,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('changed by someone else');
    await expect(
      coa.setGroupActive({
        organizationId,
        id: group.id,
        isActive: false,
        expectedVersion: group.version + 1,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('changed by someone else');
  });

  it('never returns or accepts a group from a different organization', async () => {
    const otherRoot = await prisma.client.accountGroup.create({
      data: {
        id: generateId(),
        organizationId: otherOrganizationId,
        code: 'OTHER_ASSETS',
        name: 'Other Assets',
        accountType: 'ASSET',
        normalBalance: 'DEBIT',
        isSystemDefined: true,
      },
    });
    const listed = await coa.listGroups({ organizationId, includeInactive: true });
    expect(listed.some((g) => g.id === otherRoot.id)).toBe(false);

    await expect(
      coa.createGroup({
        organizationId,
        code: 'cross_org',
        name: 'Cross Org',
        description: undefined,
        parentGroupId: otherRoot.id,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('does not exist');
  });
});

describe('ChartOfAccountsService — Ledger Accounts', () => {
  it('creates a ledger account under a group, deriving accountType/normalBalance from the group', async () => {
    const created = await coa.createAccount({
      organizationId,
      code: 'bank',
      name: 'Bank',
      description: undefined,
      accountGroupId: assetRootId,
      allowManualPosting: undefined,
      actorId,
      correlationId: generateId(),
    });
    expect(created.code).toBe('BANK');
    expect(created.accountType).toBe('ASSET');
    expect(created.normalBalance).toBe('DEBIT');
    expect(created.allowManualPosting).toBe(true);

    const events = await prisma.client.auditEvent.findMany({
      where: { organizationId, entityId: created.id, action: 'LEDGER_ACCOUNT_CREATED' },
    });
    expect(events).toHaveLength(1);
  });

  it('rejects a duplicate account code, including a normalized duplicate', async () => {
    await coa.createAccount({
      organizationId,
      code: 'CASH_ON_HAND',
      name: 'Cash on Hand',
      description: undefined,
      accountGroupId: assetRootId,
      allowManualPosting: undefined,
      actorId,
      correlationId: generateId(),
    });
    await expect(
      coa.createAccount({
        organizationId,
        code: 'cash_on_hand',
        name: 'Cash on Hand Again',
        description: undefined,
        accountGroupId: assetRootId,
        allowManualPosting: undefined,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('already exists');
  });

  it('rejects an account created under a non-existent or inactive group', async () => {
    await expect(
      coa.createAccount({
        organizationId,
        code: 'orphan_account',
        name: 'Orphan Account',
        description: undefined,
        accountGroupId: generateId(),
        allowManualPosting: undefined,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('does not exist');

    const inactiveGroup = await coa.createGroup({
      organizationId,
      code: 'inactive_for_account',
      name: 'Inactive For Account',
      description: undefined,
      parentGroupId: assetRootId,
      actorId,
      correlationId: generateId(),
    });
    await coa.setGroupActive({
      organizationId,
      id: inactiveGroup.id,
      isActive: false,
      expectedVersion: inactiveGroup.version,
      actorId,
      correlationId: generateId(),
    });
    await expect(
      coa.createAccount({
        organizationId,
        code: 'under_inactive_group',
        name: 'Under Inactive Group',
        description: undefined,
        accountGroupId: inactiveGroup.id,
        allowManualPosting: undefined,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('inactive');
  });

  it('moves a ledger account only to an active, classification-compatible group', async () => {
    const sourceGroup = await coa.createGroup({
      organizationId,
      code: 'move_source',
      name: 'Move Source',
      description: undefined,
      parentGroupId: assetRootId,
      actorId,
      correlationId: generateId(),
    });
    const compatibleTarget = await coa.createGroup({
      organizationId,
      code: 'move_target_compatible',
      name: 'Move Target Compatible',
      description: undefined,
      parentGroupId: assetRootId,
      actorId,
      correlationId: generateId(),
    });
    const incompatibleTarget = liabilityRootId;

    const account = await coa.createAccount({
      organizationId,
      code: 'movable_account',
      name: 'Movable Account',
      description: undefined,
      accountGroupId: sourceGroup.id,
      allowManualPosting: undefined,
      actorId,
      correlationId: generateId(),
    });

    await expect(
      coa.updateAccount({
        organizationId,
        id: account.id,
        name: undefined,
        description: undefined,
        accountGroupId: incompatibleTarget,
        allowManualPosting: undefined,
        expectedVersion: account.version,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('different account classification');

    const moved = await coa.updateAccount({
      organizationId,
      id: account.id,
      name: undefined,
      description: undefined,
      accountGroupId: compatibleTarget.id,
      allowManualPosting: undefined,
      expectedVersion: account.version,
      actorId,
      correlationId: generateId(),
    });
    expect(moved.accountGroupId).toBe(compatibleTarget.id);

    const events = await prisma.client.auditEvent.findMany({
      where: { organizationId, entityId: account.id, action: 'LEDGER_ACCOUNT_UPDATED' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.oldValues).toMatchObject({ accountGroupId: sourceGroup.id });
    expect(events[0]?.newValues).toMatchObject({ accountGroupId: compatibleTarget.id });
  });

  it('deactivates and reactivates a ledger account', async () => {
    const account = await coa.createAccount({
      organizationId,
      code: 'lifecycle_account',
      name: 'Lifecycle Account',
      description: undefined,
      accountGroupId: assetRootId,
      allowManualPosting: undefined,
      actorId,
      correlationId: generateId(),
    });
    await coa.setAccountActive({
      organizationId,
      id: account.id,
      isActive: false,
      expectedVersion: account.version,
      actorId,
      correlationId: generateId(),
    });
    const afterDeactivate = (await coa.listAccounts({ organizationId, accountGroupId: undefined, includeInactive: true })).find(
      (a) => a.id === account.id,
    );
    expect(afterDeactivate?.isActive).toBe(false);

    await coa.setAccountActive({
      organizationId,
      id: account.id,
      isActive: true,
      expectedVersion: afterDeactivate!.version,
      actorId,
      correlationId: generateId(),
    });
    const afterReactivate = (await coa.listAccounts({ organizationId, accountGroupId: undefined, includeInactive: true })).find(
      (a) => a.id === account.id,
    );
    expect(afterReactivate?.isActive).toBe(true);
  });

  it('rejects a stale expectedVersion on update and setActive', async () => {
    const account = await coa.createAccount({
      organizationId,
      code: 'version_account',
      name: 'Version Account',
      description: undefined,
      accountGroupId: assetRootId,
      allowManualPosting: undefined,
      actorId,
      correlationId: generateId(),
    });
    await expect(
      coa.updateAccount({
        organizationId,
        id: account.id,
        name: 'New Name',
        description: undefined,
        accountGroupId: undefined,
        allowManualPosting: undefined,
        expectedVersion: account.version + 1,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('changed by someone else');
    await expect(
      coa.setAccountActive({
        organizationId,
        id: account.id,
        isActive: false,
        expectedVersion: account.version + 1,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('changed by someone else');
  });

  it('never returns or accepts a ledger account from a different organization', async () => {
    const otherRoot = await prisma.client.accountGroup.findFirstOrThrow({
      where: { organizationId: otherOrganizationId, code: 'OTHER_ASSETS' },
    });
    const otherAccount = await prisma.client.ledgerAccount.create({
      data: {
        id: generateId(),
        organizationId: otherOrganizationId,
        accountGroupId: otherRoot.id,
        code: 'OTHER_ACCOUNT',
        name: 'Other Account',
      },
    });

    const listed = await coa.listAccounts({ organizationId, accountGroupId: undefined, includeInactive: true });
    expect(listed.some((a) => a.id === otherAccount.id)).toBe(false);

    await expect(
      coa.createAccount({
        organizationId,
        code: 'cross_org_account',
        name: 'Cross Org Account',
        description: undefined,
        accountGroupId: otherRoot.id,
        allowManualPosting: undefined,
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('does not exist');
  });
});
