/**
 * Unified monthly employee allocation, and the project manpower cost derived
 * from it (Phase 7.5, ADR-095).
 *
 * docs/04 §13 MERGEs `employee-effort-entry.html` and
 * `employee-contribution-entry.html` into ONE record: exactly one percentage
 * truth per employee-month, never two.
 *
 * **Nothing here posts a journal.** docs/06: allocation "moves cost
 * analytically to project/non-project dimensions without changing total
 * salary expense." The expense itself belongs to the salary import; these
 * percentages only say how to attribute it, and project manpower cost is
 * therefore always a derived read — imported gross × percentage — never a
 * stored or posted figure.
 */
export type EmployeeAllocationStatus = 'DRAFT' | 'SUBMITTED';

export interface EmployeeAllocationLineInput {
  /** Exactly one of these two is set — enforced by the database and by the
   * service, never by convention. */
  projectId: string | undefined;
  allocationTargetId: string | undefined;
  percentage: string;
  contributionNote: string | undefined;
}

export interface EmployeeAllocationLineRow {
  id: string;
  sequence: number;
  projectId: string | null;
  projectName: string | null;
  allocationTargetId: string | null;
  allocationTargetName: string | null;
  percentage: string;
  contributionNote: string | null;
  /** Server-computed share of the month's imported gross salary. Null when
   * no salary has been imported for the month yet — the allocation is still
   * perfectly valid, it simply has no money attached to it. */
  allocatedAmount: string | null;
  /** True on the one line the deterministic rounding remainder landed on, so
   * an amount a paisa off the naive product can be explained rather than
   * look like an error. */
  carriesRoundingRemainder: boolean;
}

export interface EmployeeAllocationMonth {
  /** Null until the employee's month has been saved for the first time. */
  id: string | null;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  allocationMonth: string;
  status: EmployeeAllocationStatus;
  note: string | null;
  lines: EmployeeAllocationLineRow[];
  totalPercentage: string;
  /** Phase 7's own exit criterion, answered by the server: a month may only
   * be submitted when this is exactly 100. */
  isSubmittable: boolean;
  /** The month's imported gross salary, or null if no salary import covers
   * it yet. This is the historical costing source (ADR-094), never
   * `Employee.displayedSalaryAmount`. */
  grossSalaryAmount: string | null;
  salaryImportId: string | null;
  allocatedTotalAmount: string | null;
  submittedAt: string | null;
  version: number;
}

/** One row of the Allocation Summary screen — an employee-month at a glance. */
export interface EmployeeAllocationSummaryRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  /** The employee's legal entity (ADR-154); null until set. */
  legalEntityId: string | null;
  allocationMonth: string;
  status: EmployeeAllocationStatus | 'NOT_STARTED';
  totalPercentage: string;
  projectPercentage: string;
  nonProjectPercentage: string;
  grossSalaryAmount: string | null;
  allocatedTotalAmount: string | null;
}

/** One row of the Project Manpower Cost screen. */
export interface ProjectManpowerCostRow {
  projectId: string;
  projectName: string;
  allocationMonth: string;
  employeeCount: number;
  totalPercentage: string;
  manpowerCostAmount: string;
}

export interface ProjectManpowerCostReport {
  rows: ProjectManpowerCostRow[];
  totalManpowerCostAmount: string;
  /** Employee-months that are still DRAFT and therefore excluded. Surfaced
   * so a total that looks low can be explained rather than doubted —
   * docs/16's "totals reconcile to salary import and allocation records". */
  excludedDraftEmployeeMonths: number;
}

export interface EmployeeAllocationPort {
  getMonth(input: {
    organizationId: string;
    employeeId: string;
    allocationMonth: string;
  }): Promise<EmployeeAllocationMonth>;

  saveDraft(input: {
    organizationId: string;
    employeeId: string;
    allocationMonth: string;
    note: string | undefined;
    lines: EmployeeAllocationLineInput[];
    expectedVersion: number | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeAllocationMonth>;

  submit(input: {
    organizationId: string;
    employeeId: string;
    allocationMonth: string;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeAllocationMonth>;

  reopen(input: {
    organizationId: string;
    employeeId: string;
    allocationMonth: string;
    expectedVersion: number;
    reason: string;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeAllocationMonth>;

  getSummary(input: {
    organizationId: string;
    allocationMonth: string;
    filters: { status: EmployeeAllocationStatus | 'NOT_STARTED' | undefined };
  }): Promise<{ rows: EmployeeAllocationSummaryRow[] }>;

  getProjectManpowerCost(input: {
    organizationId: string;
    fromMonth: string;
    toMonth: string;
    projectId: string | undefined;
    /** Only projects of this legal entity (ADR-154). */
    legalEntityId?: string | undefined;
    actorId: string;
    canSeeAllProjects: boolean;
  }): Promise<ProjectManpowerCostReport>;
}
