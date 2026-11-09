import { Injectable } from '@nestjs/common';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type {
  AccountGroupSummary,
  AccountType,
  ChartOfAccountsPort,
  LedgerAccountSummary,
  NormalBalance,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isConstraintViolation } from '../organization/constraint-error.util';

interface AccountGroupRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  accountType: string;
  normalBalance: string;
  parentGroupId: string | null;
  isSystemDefined: boolean;
  isActive: boolean;
  createdAt: Date;
  version: number;
  parentGroup: { name: string } | null;
}

interface LedgerAccountRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  accountGroupId: string;
  allowManualPosting: boolean;
  isActive: boolean;
  createdAt: Date;
  version: number;
  accountGroup: { name: string; accountType: string; normalBalance: string };
  bankAccounts?: Array<{ id: string; accountName: string; bankName: string | null; maskedAccountNumber: string | null; invoiceAccountNumber?: string | null; ifsc: string | null; isActive: boolean; legalEntity: { legalName: string } }>;
  cardAccounts?: Array<{ id: string; displayName: string; issuerName: string | null; maskedLastFour: string; cardNumber?: string | null; isActive: boolean; legalEntity: { legalName: string } }>;
}

/** What a ledger needs to show which bank accounts and credit cards post to it (ADR-160). */
const LEDGER_INCLUDE = {
  accountGroup: { select: { name: true, accountType: true, normalBalance: true } },
  bankAccounts: { select: { id: true, accountName: true, bankName: true, maskedAccountNumber: true, invoiceAccountNumber: true, ifsc: true, isActive: true, legalEntity: { select: { legalName: true } } } },
  cardAccounts: { select: { id: true, displayName: true, issuerName: true, maskedLastFour: true, cardNumber: true, isActive: true, legalEntity: { select: { legalName: true } } } },
} as const;

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function toGroupSummary(row: AccountGroupRow): AccountGroupSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    accountType: row.accountType as AccountType,
    normalBalance: row.normalBalance as NormalBalance,
    parentGroupId: row.parentGroupId,
    parentGroupName: row.parentGroup?.name ?? null,
    isSystemDefined: row.isSystemDefined,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

function toAccountSummary(row: LedgerAccountRow): LedgerAccountSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    accountGroupId: row.accountGroupId,
    accountGroupName: row.accountGroup.name,
    accountType: row.accountGroup.accountType as AccountType,
    normalBalance: row.accountGroup.normalBalance as NormalBalance,
    allowManualPosting: row.allowManualPosting,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
    linkedAccounts: [
      ...(row.bankAccounts ?? []).map((b) => ({
        kind: 'BANK_ACCOUNT' as const, id: b.id, name: b.accountName, legalEntityName: b.legalEntity.legalName,
        bankName: b.bankName, number: b.invoiceAccountNumber || b.maskedAccountNumber, ifsc: b.ifsc, isActive: b.isActive,
      })),
      ...(row.cardAccounts ?? []).map((c) => ({
        kind: 'CREDIT_CARD' as const, id: c.id, name: c.displayName, legalEntityName: c.legalEntity.legalName,
        bankName: c.issuerName, number: c.cardNumber ?? `****${c.maskedLastFour}`, ifsc: null, isActive: c.isActive,
      })),
    ],
  };
}

@Injectable()
export class ChartOfAccountsService implements ChartOfAccountsPort {
  constructor(private readonly prisma: PrismaService) {}

  /** Walks up from `candidateParentId` via parentGroupId; throws if
   * `movingGroupId` appears anywhere in that chain (including as the
   * candidate itself) — catches both direct (A->A) and indirect
   * (A->B->C, then A's parent set to C) cycles. */
  private async assertNoCycle(organizationId: string, movingGroupId: string, candidateParentId: string): Promise<void> {
    let currentId: string | null = candidateParentId;
    const seen = new Set<string>();
    while (currentId) {
      if (currentId === movingGroupId) {
        throwAppError('VALIDATION_FAILED', 'This would create a circular account group hierarchy.');
      }
      if (seen.has(currentId)) break; // defensive: pre-existing cycle, stop walking
      seen.add(currentId);
      const row: { parentGroupId: string | null } | null = await this.prisma.client.accountGroup.findFirst({
        where: { id: currentId, organizationId },
        select: { parentGroupId: true },
      });
      currentId = row?.parentGroupId ?? null;
    }
  }

  async listGroups(input: { organizationId: string; includeInactive: boolean | undefined }): Promise<AccountGroupSummary[]> {
    const rows = await this.prisma.client.accountGroup.findMany({
      where: { organizationId: input.organizationId, ...(input.includeInactive ? {} : { isActive: true }) },
      include: { parentGroup: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    return rows.map(toGroupSummary);
  }

  async createGroup(input: {
    organizationId: string;
    code: string;
    name: string;
    description: string | undefined;
    parentGroupId: string;
    actorId: string;
    correlationId: string;
  }): Promise<AccountGroupSummary> {
    const parent = await this.prisma.client.accountGroup.findFirst({
      where: { id: input.parentGroupId, organizationId: input.organizationId },
    });
    if (!parent) throwAppError('VALIDATION_FAILED', 'The selected parent group does not exist.');
    if (!parent.isActive) throwAppError('VALIDATION_FAILED', 'The selected parent group is inactive.');

    const code = normalizeCode(input.code);
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.accountGroup.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            code,
            name: input.name,
            description: input.description ?? null,
            accountType: parent.accountType,
            normalBalance: parent.normalBalance,
            parentGroupId: input.parentGroupId,
            isSystemDefined: false,
            createdBy: input.actorId,
          },
        });
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'ACCOUNT_GROUP',
          entityId: row.id,
          action: 'ACCOUNT_GROUP_CREATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { code, name: input.name, parentGroupId: input.parentGroupId },
        });
        return toGroupSummary({ ...row, parentGroup: { name: parent.name } });
      });
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'An account group with this code already exists.');
      }
      throw error;
    }
  }

  async updateGroup(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    description: string | undefined;
    parentGroupId: string | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<AccountGroupSummary> {
    const before = await this.prisma.client.accountGroup.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
    });
    if (!before) throwAppError('NOT_FOUND', 'Account group not found.');

    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;

    if (input.parentGroupId !== undefined && input.parentGroupId !== before.parentGroupId) {
      if (before.isSystemDefined) {
        throwAppError('VALIDATION_FAILED', 'System-defined account groups cannot be re-parented.');
      }
      if (input.parentGroupId === input.id) {
        throwAppError('VALIDATION_FAILED', 'An account group cannot be its own parent.');
      }
      const candidate = await this.prisma.client.accountGroup.findFirst({
        where: { id: input.parentGroupId, organizationId: input.organizationId },
      });
      if (!candidate) throwAppError('VALIDATION_FAILED', 'The selected parent group does not exist.');
      if (!candidate.isActive) throwAppError('VALIDATION_FAILED', 'The selected parent group is inactive.');
      if (candidate.accountType !== before.accountType || candidate.normalBalance !== before.normalBalance) {
        throwAppError('VALIDATION_FAILED', 'The selected parent group has a different account classification.');
      }
      await this.assertNoCycle(input.organizationId, input.id, input.parentGroupId);
      data.parentGroupId = input.parentGroupId;
    }

    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    if (data.name !== undefined && data.name !== before.name) {
      oldValues.name = before.name;
      newValues.name = data.name;
    }
    if (data.description !== undefined && data.description !== before.description) {
      oldValues.description = before.description;
      newValues.description = data.description;
    }
    if (data.parentGroupId !== undefined) {
      oldValues.parentGroupId = before.parentGroupId;
      newValues.parentGroupId = data.parentGroupId;
    }

    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.accountGroup.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data,
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'ACCOUNT_GROUP',
        entityId: input.id,
        action: 'ACCOUNT_GROUP_UPDATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues,
        newValues,
      });
    });

    const row = await this.prisma.client.accountGroup.findFirstOrThrow({
      where: { id: input.id, organizationId: input.organizationId },
      include: { parentGroup: { select: { name: true } } },
    });
    return toGroupSummary(row);
  }

  async setGroupActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    const before = await this.prisma.client.accountGroup.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
    });
    if (!before) throwAppError('NOT_FOUND', 'Account group not found.');

    if (!input.isActive) {
      if (before.isSystemDefined) {
        throwAppError('VALIDATION_FAILED', 'System-defined account groups cannot be deactivated.');
      }
      const [activeChildGroups, activeLedgerAccounts] = await Promise.all([
        this.prisma.client.accountGroup.count({
          where: { organizationId: input.organizationId, parentGroupId: input.id, isActive: true },
        }),
        this.prisma.client.ledgerAccount.count({
          where: { organizationId: input.organizationId, accountGroupId: input.id, isActive: true },
        }),
      ]);
      if (activeChildGroups > 0 || activeLedgerAccounts > 0) {
        const parts: string[] = [];
        if (activeLedgerAccounts > 0) parts.push(`${activeLedgerAccounts} active ledger account(s)`);
        if (activeChildGroups > 0) parts.push(`${activeChildGroups} active sub-group(s)`);
        throwAppError('VALIDATION_FAILED', `Cannot deactivate — ${parts.join(' and ')} depend on this group.`);
      }
    }

    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.accountGroup.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: { isActive: input.isActive, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'ACCOUNT_GROUP',
        entityId: input.id,
        action: input.isActive ? 'ACCOUNT_GROUP_ACTIVATED' : 'ACCOUNT_GROUP_DEACTIVATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }

  async listAccounts(input: {
    organizationId: string;
    accountGroupId: string | undefined;
    includeInactive: boolean | undefined;
  }): Promise<LedgerAccountSummary[]> {
    const rows = await this.prisma.client.ledgerAccount.findMany({
      where: {
        organizationId: input.organizationId,
        ...(input.accountGroupId ? { accountGroupId: input.accountGroupId } : {}),
        ...(input.includeInactive ? {} : { isActive: true }),
      },
      include: LEDGER_INCLUDE,
      orderBy: { name: 'asc' },
    });
    return rows.map(toAccountSummary);
  }

  async createAccount(input: {
    organizationId: string;
    code: string;
    name: string;
    description: string | undefined;
    accountGroupId: string;
    allowManualPosting: boolean | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<LedgerAccountSummary> {
    const group = await this.prisma.client.accountGroup.findFirst({
      where: { id: input.accountGroupId, organizationId: input.organizationId },
    });
    if (!group) throwAppError('VALIDATION_FAILED', 'The selected account group does not exist.');
    if (!group.isActive) throwAppError('VALIDATION_FAILED', 'The selected account group is inactive.');

    const code = normalizeCode(input.code);
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.ledgerAccount.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            accountGroupId: input.accountGroupId,
            code,
            name: input.name,
            description: input.description ?? null,
            allowManualPosting: input.allowManualPosting ?? true,
            createdBy: input.actorId,
          },
        });
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'LEDGER_ACCOUNT',
          entityId: row.id,
          action: 'LEDGER_ACCOUNT_CREATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { code, name: input.name, accountGroupId: input.accountGroupId },
        });
        return toAccountSummary({
          ...row,
          accountGroup: { name: group.name, accountType: group.accountType, normalBalance: group.normalBalance },
        });
      });
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'A ledger account with this code already exists.');
      }
      throw error;
    }
  }

  async updateAccount(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    description: string | undefined;
    accountGroupId: string | undefined;
    allowManualPosting: boolean | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<LedgerAccountSummary> {
    const before = await this.prisma.client.ledgerAccount.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      include: { accountGroup: { select: { accountType: true, normalBalance: true } } },
    });
    if (!before) throwAppError('NOT_FOUND', 'Ledger account not found.');

    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.allowManualPosting !== undefined) data.allowManualPosting = input.allowManualPosting;

    if (input.accountGroupId !== undefined && input.accountGroupId !== before.accountGroupId) {
      const candidate = await this.prisma.client.accountGroup.findFirst({
        where: { id: input.accountGroupId, organizationId: input.organizationId },
      });
      if (!candidate) throwAppError('VALIDATION_FAILED', 'The selected account group does not exist.');
      if (!candidate.isActive) throwAppError('VALIDATION_FAILED', 'The selected account group is inactive.');
      if (candidate.accountType !== before.accountGroup.accountType || candidate.normalBalance !== before.accountGroup.normalBalance) {
        throwAppError('VALIDATION_FAILED', 'The selected account group has a different account classification.');
      }
      data.accountGroupId = input.accountGroupId;
    }

    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    if (data.name !== undefined && data.name !== before.name) {
      oldValues.name = before.name;
      newValues.name = data.name;
    }
    if (data.description !== undefined && data.description !== before.description) {
      oldValues.description = before.description;
      newValues.description = data.description;
    }
    if (data.accountGroupId !== undefined) {
      oldValues.accountGroupId = before.accountGroupId;
      newValues.accountGroupId = data.accountGroupId;
    }
    if (data.allowManualPosting !== undefined && data.allowManualPosting !== before.allowManualPosting) {
      oldValues.allowManualPosting = before.allowManualPosting;
      newValues.allowManualPosting = data.allowManualPosting;
    }

    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.ledgerAccount.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data,
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'LEDGER_ACCOUNT',
        entityId: input.id,
        action: 'LEDGER_ACCOUNT_UPDATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        oldValues,
        newValues,
      });
    });

    const row = await this.prisma.client.ledgerAccount.findFirstOrThrow({
      where: { id: input.id, organizationId: input.organizationId },
      include: LEDGER_INCLUDE,
    });
    return toAccountSummary(row);
  }

  async setAccountActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    const before = await this.prisma.client.ledgerAccount.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
    });
    if (!before) throwAppError('NOT_FOUND', 'Ledger account not found.');

    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.ledgerAccount.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: { isActive: input.isActive, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'LEDGER_ACCOUNT',
        entityId: input.id,
        action: input.isActive ? 'LEDGER_ACCOUNT_ACTIVATED' : 'LEDGER_ACCOUNT_DEACTIVATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }
}
