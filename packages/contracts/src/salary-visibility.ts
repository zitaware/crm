import type { EmployeeAllocationMonth, EmployeeAllocationSummaryRow } from './ports/employee-allocation.port';
import type { EmployeeSummary } from './ports/employee.port';

/**
 * Salary is confidential (ADR-175): only a holder of employee.read_salary
 * (Admin, Accountant, CEO) is sent an employee's salary or the salary cost an
 * allocation carries. Everyone else gets the same records with the money
 * left out, so a manager can still allocate the team.
 */
export const SALARY_PERMISSION = 'employee.read_salary';

export function seesSalary(permissions: ReadonlySet<string>): boolean {
  return permissions.has(SALARY_PERMISSION);
}

export function withoutSalary<T extends Pick<EmployeeSummary, 'displayedSalaryAmount'>>(employee: T): T {
  return { ...employee, displayedSalaryAmount: null };
}

export function monthWithoutSalary(month: EmployeeAllocationMonth): EmployeeAllocationMonth {
  return {
    ...month,
    grossSalaryAmount: null,
    salaryImportId: null,
    allocatedTotalAmount: null,
    lines: month.lines.map((line) => ({ ...line, allocatedAmount: null, carriesRoundingRemainder: false })),
  };
}

export function summaryRowWithoutSalary(row: EmployeeAllocationSummaryRow): EmployeeAllocationSummaryRow {
  return { ...row, grossSalaryAmount: null, allocatedTotalAmount: null };
}
