export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: Date;
  roleNames: string[];
  employeeLinked: boolean;
}

export interface UserRoleGrant {
  id: string;
  name: string;
}

export interface UserPermissionOverrideSummary {
  permissionKey: string;
  effect: 'GRANT' | 'REVOKE';
  reason: string | null;
}

export interface LinkedEmployeeSummary {
  id: string;
  employeeCode: string;
  fullName: string;
}

export interface UserDetail extends UserSummary {
  lastLoginAt: Date | null;
  invitedAt: Date | null;
  disabledAt: Date | null;
  roles: UserRoleGrant[];
  overrides: UserPermissionOverrideSummary[];
  effectivePermissions: string[];
  employee: LinkedEmployeeSummary | null;
}

export interface UserPort {
  list(input: { organizationId: string }): Promise<UserSummary[]>;

  get(input: { organizationId: string; userId: string }): Promise<UserSummary | null>;

  getDetail(input: { organizationId: string; userId: string }): Promise<UserDetail | null>;

  invite(input: {
    organizationId: string;
    email: string;
    displayName: string;
    roleIds: string[];
    /** Optional existing, unlinked employee to attach via Employee.userId in the same transaction. */
    employeeId: string | undefined;
    actorId: string;
    correlationId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<{ userId: string; invitationId: string }>;

  reinvite(input: {
    organizationId: string;
    userId: string;
    actorId: string;
    correlationId: string;
  }): Promise<{ invitationId: string }>;

  disable(input: {
    organizationId: string;
    userId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void>;

  enable(input: {
    organizationId: string;
    userId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void>;

  revokeSessions(input: {
    organizationId: string;
    userId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void>;

  linkEmployee(input: {
    organizationId: string;
    userId: string;
    employeeId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void>;

  unlinkEmployee(input: {
    organizationId: string;
    userId: string;
    actorId: string;
    correlationId: string;
  }): Promise<void>;
}
