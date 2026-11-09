/** Designations that may manage a project (ADR-153), matched against a
 * designation's name or code ignoring case, spaces and hyphens. */
export const PROJECT_MANAGER_DESIGNATIONS = ['Project Manager', 'Hardware Manager'] as const;
/** Designations that may be a project's sales manager (ADR-153). */
export const SALES_MANAGER_DESIGNATIONS = ['Business Development Manager', 'Marketing Manager'] as const;

/** Active employees of the project's legal entity eligible for each
 * manager role (ADR-153, ADR-154). */
export interface ProjectManagerCandidates {
  projectManagers: Array<{ id: string; fullName: string; designationName: string }>;
  salesManagers: Array<{ id: string; fullName: string; designationName: string }>;
}

export interface ProjectSummary {
  id: string;
  clientId: string;
  clientName: string;
  legalEntityId: string;
  legalEntityName: string;
  leadId: string | null;
  leadTitle: string | null;
  tenderId: string | null;
  tenderTitle: string | null;
  projectManagerId: string | null;
  projectManagerName: string | null;
  salesManagerId: string | null;
  salesManagerName: string | null;
  introducerId: string | null;
  introducerName: string | null;
  projectTypeId: string | null;
  projectTypeName: string | null;
  name: string;
  description: string | null;
  stage: string;
  operationalStatus: string;
  value: string | null;
  budget: string | null;
  gstApplicable: boolean;
  workOrderNumber: string | null;
  workOrderDate: string | null;
  createdAt: string;
  version: number;
}

export interface ProjectTeamMemberSummary {
  id: string;
  employeeId: string;
  employeeName: string;
  role: string | null;
  createdAt: string;
}

export interface ProjectProgressSummary {
  id: string;
  title: string;
  percentage: number;
  note: string;
  createdAt: string;
  createdByEmail: string | null;
}

/** Every category `project-expense.html`'s own footer note names now has a
 * real, postable backing source, so none remain deferred (ADR-086 deferred
 * four of them explicitly "until their own source modules exist"; Phase 7
 * built the last three).
 *
 * Server and Subscription costs are deliberately NOT their own categories:
 * a recurring cycle's payment posts through `DirectExpensesService`, so it
 * already arrives here as `DIRECT_EXPENSE`. Giving them a separate label
 * would double-count or, worse, split one ledger source two ways.
 *
 * MANPOWER is the one category with no underlying document — allocation
 * posts no journal at all (docs/06: it moves cost "analytically ... without
 * changing total salary expense"), so its rows are derived per month from
 * imported gross salary times allocation percentage, and carry a null
 * `linkId`.
 *
 * This ledger is a gross, per-transaction "Spend" listing — it intentionally
 * does NOT exclude recoverable Input GST the way the Financials tab's
 * `recognizedProjectExpense` does; see ADR-089. */
export type ProjectExpenseCategory =
  | 'PURCHASE'
  | 'REIMBURSEMENT'
  | 'DIRECT_EXPENSE'
  | 'MATERIAL'
  | 'MANPOWER'
  | 'INTRODUCER';

export type ProjectExpenseLinkType =
  | 'VENDOR_BILL'
  | 'EMPLOYEE_EXPENSE_CLAIM'
  | 'DIRECT_EXPENSE'
  | 'INVENTORY_CONSUMPTION'
  | 'INTRODUCER_ACCRUAL'
  /** Manpower cost is an analytical derivation, not a document — there is
   * nothing to open. The row still belongs in the ledger; the UI simply
   * offers no View action for it. */
  | 'NONE';

export interface ProjectExpenseRow {
  id: string;
  category: ProjectExpenseCategory;
  date: string;
  title: string;
  subtitle: string;
  amount: string;
  linkType: ProjectExpenseLinkType;
  /** Null exactly when `linkType` is 'NONE'. */
  linkId: string | null;
}

export interface ProjectExpenseCategoryTotal {
  category: ProjectExpenseCategory;
  amount: string;
}

export interface ProjectExpenseLedger {
  rows: ProjectExpenseRow[];
  totalAmount: string;
  categoryTotals: ProjectExpenseCategoryTotal[];
  largestCategory: ProjectExpenseCategory | null;
  /** 0-100, rounded server-side — never computed client-side, per
   * CLAUDE.md's "never calculate accounting totals independently in
   * React". */
  largestCategoryPercent: number;
}

export interface ProjectPort {
  /** `canSeeAll` (from the `project.read_all` permission) unscopes the
   * result; otherwise only projects where `actorId`'s linked Employee is
   * the `projectManagerId` or a `ProjectTeamMember` are returned. */
  list(input: { organizationId: string; actorId: string; canSeeAll: boolean }): Promise<ProjectSummary[]>;

  /** Who can be picked as project manager and sales manager on a project
   * of this legal entity (ADR-153, ADR-154). */
  listManagerCandidates(input: { organizationId: string; legalEntityId: string }): Promise<ProjectManagerCandidates>;

  /** Out-of-scope access (existing project, but the actor isn't assigned
   * and lacks `project.read_all`) throws `NOT_FOUND` — matching this
   * codebase's cross-org-isolation philosophy of not confirming existence
   * to an unauthorized caller. */
  getDetail(input: {
    organizationId: string;
    id: string;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<ProjectSummary>;

  create(input: {
    organizationId: string;
    clientId: string;
    legalEntityId: string;
    leadId: string | undefined;
    tenderId: string | undefined;
    projectManagerId: string | undefined;
    salesManagerId?: string | undefined;
    introducerId: string | undefined;
    projectTypeId: string | undefined;
    name: string;
    description: string | undefined;
    value: string | undefined;
    budget: string | undefined;
    gstApplicable: boolean | undefined;
    workOrderNumber: string | undefined;
    workOrderDate: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<ProjectSummary>;

  /** `clientId`/`legalEntityId` are immutable after creation — not part of
   * the update input. `stage`/`operationalStatus` are never touched here —
   * only `changeStage`/`changeStatus` may change them. */
  update(input: {
    organizationId: string;
    id: string;
    /** null clears it; undefined leaves it unchanged (same for the fields below). */
    leadId: string | null | undefined;
    tenderId: string | undefined;
    projectManagerId: string | null | undefined;
    salesManagerId?: string | null | undefined;
    introducerId: string | null | undefined;
    projectTypeId: string | null | undefined;
    name: string | undefined;
    description: string | undefined;
    value: string | undefined;
    budget: string | undefined;
    gstApplicable: boolean | undefined;
    workOrderNumber: string | undefined;
    workOrderDate: string | null | undefined;
    expectedVersion: number;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<ProjectSummary>;

  changeStage(input: {
    organizationId: string;
    id: string;
    targetStage: string;
    reason: string | undefined;
    expectedVersion: number;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<ProjectSummary>;

  changeStatus(input: {
    organizationId: string;
    id: string;
    targetStatus: string;
    reason: string | undefined;
    expectedVersion: number;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<ProjectSummary>;

  listTeamMembers(input: {
    organizationId: string;
    projectId: string;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<ProjectTeamMemberSummary[]>;

  addTeamMember(input: {
    organizationId: string;
    projectId: string;
    employeeId: string;
    role: string | undefined;
    actorId: string;
    canSeeAll?: boolean;
    correlationId: string;
  }): Promise<ProjectTeamMemberSummary>;

  removeTeamMember(input: {
    organizationId: string;
    projectId: string;
    employeeId: string;
    actorId: string;
    canSeeAll?: boolean;
    correlationId: string;
  }): Promise<void>;

  listProgress(input: {
    organizationId: string;
    projectId: string;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<ProjectProgressSummary[]>;

  /** `percentage` must be an integer 0-100 and strictly greater than the
   * current latest percentage (0 baseline if none exist yet) — "each
   * update can only increase %". Rejected once the project is
   * CANCELLED/CLOSED, same terminal-status guard as team management. */
  addProgress(input: {
    organizationId: string;
    projectId: string;
    title: string;
    percentage: number;
    note: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<ProjectProgressSummary>;

  /** Rolls up this project's own cost so far, matching project-expense.html's
   * own tab (labeled "Spend" in the UI as of ADR-089 — this is a gross,
   * per-transaction listing, not the ITC-excluded recognized expense
   * ProjectFinancialsPort computes). Reuses getDetail's own project-access
   * scope check first (throws NOT_FOUND the same way listProgress does).
   * Six sources, each with its own "this one really happened" filter — they
   * are deliberately not uniform, because each module expresses finality
   * differently:
   *   Purchase      = FINALIZED VendorBill
   *   Reimbursement = APPROVED/REIMBURSED EmployeeExpenseClaim
   *   Direct Expense= POSTED DirectExpense (also covers Server/Subscription
   *                   cycle payments, which post through that same service)
   *   Material      = POSTED InventoryConsumption lines
   *   Manpower      = SUBMITTED EmployeeMonthlyAllocation, one row per month
   *   Introducer    = POSTED IntroducerAccrual
   *
   * has*ReadPermission flags gate each category independently — a category
   * the actor can't read is fully excluded from rows AND from totalAmount/
   * categoryTotals/largestCategory, not just hidden in the row list.
   * category/dateFrom/dateTo narrow the ledger; all totals and the
   * largest-category percent are computed server-side with Decimal, never
   * summed client-side. */
  getExpenseLedger(input: {
    organizationId: string;
    projectId: string;
    actorId: string;
    canSeeAll: boolean;
    hasVendorBillReadPermission: boolean;
    hasEmployeeClaimReadPermission: boolean;
    hasDirectExpenseReadPermission: boolean;
    hasInventoryReadPermission: boolean;
    hasProjectCostReadPermission: boolean;
    hasIntroducerFeeReadPermission: boolean;
    category: ProjectExpenseCategory | undefined;
    dateFrom: string | undefined;
    dateTo: string | undefined;
  }): Promise<ProjectExpenseLedger>;
}
