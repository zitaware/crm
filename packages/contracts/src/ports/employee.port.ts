
/** One period of an employee's compensation history (ADR-098). Revisions are
 * append-and-supersede: the open row is closed by setting `effectiveTo` and a
 * new open row inserted, so a past month's salary is never rewritten. */
export interface EmployeeSalaryRevisionRow {
  id: string;
  employeeId: string;
  grossAmount: string;
  effectiveFrom: string;
  /** Null means this is the current salary. */
  effectiveTo: string | null;
  isCurrent: boolean;
  reason: string | null;
  createdAt: string;
  version: number;
}

export interface EmployeeSummary {
  id: string;
  /** Nullable — an employee may exist without application access. Unique
   * when populated — at most one employee record per user. When set, the
   * linked user must belong to the same organization as this employee
   * (enforced via a composite FK). */
  userId: string | null;
  /** The legal entity the employee works for (ADR-154); null until set. */
  legalEntityId: string | null;
  internalDepartmentId: string | null;
  designationId: string | null;
  employmentTypeId: string | null;
  employeeCode: string;
  fullName: string;
  isReimbursable: boolean;
  /** Decimal string (numeric(19,4)); non-authoritative display figure only —
   * never used for payroll calculation in Phase 2. */
  displayedSalaryAmount: string | null;
  /** Null for an employee imported without one (ADR-170). */
  joiningDate: string | null;
  /** Sole lifecycle source of truth — there is deliberately no separate
   * isActive flag. Filters, activation/deactivation, and UI controls all
   * read/write this field only. */
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
}

/** Minimal shape for the user invite/edit employee picker. */
export interface LinkableEmployee {
  id: string;
  employeeCode: string;
  fullName: string;
}

/** The linked login's identity/access summary, for the Employees screen's
 * "System Access" section — mirrors UsersService.getDetail's composition. */
export interface LinkedUserSummary {
  id: string;
  email: string;
  status: string;
  roleNames: string[];
}

export interface EmployeeDetail extends EmployeeSummary {
  user: LinkedUserSummary | null;
}

/** One checked row from an employee Excel import. `errors` empty means the row can be saved. */
export interface EmployeeImportPreviewRow {
  rowNumber: number;
  employeeCode: string;
  fullName: string;
  departmentName: string | null;
  legalEntityName: string | null;
  designationName: string | null;
  /** The Department / Designation is not in Masters yet; importing adds it. */
  newDepartment: boolean;
  newDesignation: boolean;
  employmentTypeName: string | null;
  isReimbursable: boolean;
  displayedSalaryAmount: string | null;
  joiningDate: string | null;
  /** When the row's salary starts, when it records one. */
  salaryEffectiveFrom: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  /** CREATE a new employee, UPDATE an existing one (by code), or nothing to change (ADR-170). */
  action: 'CREATE' | 'UPDATE' | 'UNCHANGED';
  /** For an update, each change in words, e.g. "Salary: ₹50,000.00 → ₹55,000.00 from 01/11/2026". */
  changes: string[];
  errors: string[];
}

export interface EmployeeImportPreview {
  rows: EmployeeImportPreviewRow[];
  validCount: number;
  errorCount: number;
  createCount: number;
  updateCount: number;
  unchangedCount: number;
  /** Departments and designations the import adds to Masters, as written in the sheet. */
  newDepartmentNames: string[];
  newDesignationNames: string[];
}

export interface EmployeePort {
  list(input: { organizationId: string; includeInactive: boolean | undefined }): Promise<EmployeeSummary[]>;

  /** The legal entity on a user's own employee record, which limits what they see (ADR-172). */
  legalEntityOfUser(input: { organizationId: string; userId: string }): Promise<string | null>;

  getDetail(input: { organizationId: string; id: string }): Promise<EmployeeDetail | null>;

  /** Active employees in the org with no linked user yet — drives the Users
   * screen's "link to employee" picker (ADR-045: never auto-created/excluded
   * by role, always org-scoped, active-only, unlinked-only). */
  listLinkable(input: { organizationId: string }): Promise<LinkableEmployee[]>;

  create(input: {
    organizationId: string;
    userId: string | undefined;
    legalEntityId?: string | undefined;
    internalDepartmentId: string | undefined;
    designationId: string | undefined;
    employmentTypeId: string | undefined;
    employeeCode: string;
    fullName: string;
    isReimbursable: boolean | undefined;
    displayedSalaryAmount: string | undefined;
    joiningDate: string;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeSummary>;

  update(input: {
    organizationId: string;
    id: string;
    userId: string | undefined;
    legalEntityId?: string | undefined;
    internalDepartmentId: string | undefined;
    designationId: string | undefined;
    employmentTypeId: string | undefined;
    fullName: string | undefined;
    isReimbursable: boolean | undefined;
    displayedSalaryAmount: string | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeSummary>;

  setStatus(input: {
    organizationId: string;
    id: string;
    status: 'ACTIVE' | 'INACTIVE';
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void>;

  /** The .xlsx sample for employee import. Same columns the preview accepts. */
  downloadImportSample(): Promise<{ filename: string; contentBase64: string }>;

  /** Reads an .xlsx workbook and checks every row. Saves nothing. */
  previewImport(input: { organizationId: string; contentBase64: string }): Promise<EmployeeImportPreview>;

  /** Creates new employees and updates existing ones (by code) from a workbook that previewed with no errors, in one transaction. */
  importRows(input: {
    organizationId: string;
    contentBase64: string;
    actorId: string;
    correlationId: string;
  }): Promise<{ created: number; updated: number; unchanged: number }>;
}

/** Compensation history (ADR-098). Separate from EmployeePort because a
 * revision is its own append-and-supersede record, not a field on the
 * master. */
export interface EmployeeSalaryRevisionPort {
  list(input: { organizationId: string; employeeId: string }): Promise<EmployeeSalaryRevisionRow[]>;

  revise(input: {
    organizationId: string;
    employeeId: string;
    grossAmount: string;
    effectiveFrom: string;
    reason: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<EmployeeSalaryRevisionRow>;
}
