export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
export type NormalBalance = 'DEBIT' | 'CREDIT';

export interface AccountGroupSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  accountType: AccountType;
  normalBalance: NormalBalance;
  parentGroupId: string | null;
  parentGroupName: string | null;
  isSystemDefined: boolean;
  isActive: boolean;
  createdAt: string;
  version: number;
}

export interface LedgerAccountSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  accountGroupId: string;
  accountGroupName: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  allowManualPosting: boolean;
  isActive: boolean;
  createdAt: string;
  version: number;
  /** The bank accounts and credit cards that post to this ledger, with their details (ADR-160). */
  linkedAccounts: LedgerLinkedAccount[];
}

export interface LedgerLinkedAccount {
  kind: 'BANK_ACCOUNT' | 'CREDIT_CARD';
  id: string;
  /** The bank account name, or the card's display name. */
  name: string;
  legalEntityName: string;
  /** The bank, or the card issuer. */
  bankName: string | null;
  /** The masked account number, or "****" and the card's last four. */
  number: string | null;
  ifsc: string | null;
  isActive: boolean;
}

export interface ChartOfAccountsPort {
  listGroups(input: { organizationId: string; includeInactive: boolean | undefined }): Promise<AccountGroupSummary[]>;

  /** `parentGroupId` is required — only the seed script ever creates a
   * parent-less (root) group, directly via Prisma. `accountType`/
   * `normalBalance` are never accepted here; they're copied from the
   * parent. */
  createGroup(input: {
    organizationId: string;
    code: string;
    name: string;
    description: string | undefined;
    parentGroupId: string;
    actorId: string;
    correlationId: string;
  }): Promise<AccountGroupSummary>;

  /** `code`/`accountType`/`normalBalance` are immutable and not accepted
   * here. Re-parenting (changing `parentGroupId`) is rejected for
   * system-defined groups, for a non-existent/inactive candidate parent,
   * for a candidate parent whose accountType/normalBalance don't match
   * this group's own, and for any cycle (direct or indirect). */
  updateGroup(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    description: string | undefined;
    parentGroupId: string | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<AccountGroupSummary>;

  /** Deactivating is rejected while any active child group or active
   * ledger account still references this group. System-defined groups
   * can never be deactivated. */
  setGroupActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void>;

  listAccounts(input: {
    organizationId: string;
    accountGroupId: string | undefined;
    includeInactive: boolean | undefined;
  }): Promise<LedgerAccountSummary[]>;

  createAccount(input: {
    organizationId: string;
    code: string;
    name: string;
    description: string | undefined;
    accountGroupId: string;
    allowManualPosting: boolean | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<LedgerAccountSummary>;

  /** `code` is immutable and not accepted here. Moving to a new
   * `accountGroupId` is rejected unless the candidate group is active and
   * its derived accountType/normalBalance match the account's current
   * group's. */
  updateAccount(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    description: string | undefined;
    accountGroupId: string | undefined;
    allowManualPosting: boolean | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<LedgerAccountSummary>;

  setAccountActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void>;
}
