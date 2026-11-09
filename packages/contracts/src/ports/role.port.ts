export interface RoleSummary {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  memberCount: number;
}

export interface RoleDetail {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionKeys: string[];
  memberCount: number;
  version: number;
}

/** One entry of the code-defined permission catalog (seeded, read-only). */
export interface PermissionCatalogEntry {
  key: string;
  resource: string;
  action: string;
  description: string | null;
}

export interface RolePort {
  list(input: { organizationId: string }): Promise<RoleSummary[]>;

  getDetail(input: { organizationId: string; roleId: string }): Promise<RoleDetail | null>;

  getPermissions(input: { organizationId: string; roleId: string }): Promise<string[]>;

  /** The full permission catalog (global, code-defined) for the matrix UI. */
  listPermissionCatalog(): Promise<PermissionCatalogEntry[]>;

  create(input: {
    organizationId: string;
    name: string;
    description: string | undefined;
    permissionKeys: string[];
    actorId: string;
    correlationId: string;
  }): Promise<RoleDetail>;

  update(input: {
    organizationId: string;
    roleId: string;
    name: string | undefined;
    description: string | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<RoleDetail>;

  setPermissions(input: {
    organizationId: string;
    roleId: string;
    permissionKeys: string[];
    actorId: string;
    correlationId: string;
  }): Promise<RoleDetail>;

  delete(input: {
    organizationId: string;
    roleId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void>;

  assignRole(input: {
    organizationId: string;
    userId: string;
    roleId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void>;

  removeRole(input: {
    organizationId: string;
    userId: string;
    roleId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void>;

  setPermissionOverride(input: {
    organizationId: string;
    userId: string;
    permissionKey: string;
    effect: 'GRANT' | 'REVOKE';
    reason: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<void>;

  /** Reverts a permission back to plain role-inheritance. */
  clearPermissionOverride(input: {
    organizationId: string;
    userId: string;
    permissionKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<void>;

  /** Resolved effective permission set for a user, per resolvePermissions(). */
  getEffectivePermissions(input: {
    organizationId: string;
    userId: string;
  }): Promise<Set<string>>;
}
