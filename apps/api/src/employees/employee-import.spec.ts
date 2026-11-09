import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { EMPLOYEE_IMPORT_HEADERS, buildEmployeeImportSample, parseDateText, parseEmployeeWorkbook, resolveEmployeeImportRows, type ExistingEmployeeRef } from './employee-import';

const masters = { departments: [], designations: [], employmentTypes: [] };

async function workbook(rows: unknown[][]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Employees');
  sheet.addRow([...EMPLOYEE_IMPORT_HEADERS]);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe('employee Excel import', () => {
  it('reads the sample, marks a missing department and designation as new, and still reports other missing masters', async () => {
    const parsed = await parseEmployeeWorkbook(await buildEmployeeImportSample());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const resolved = resolveEmployeeImportRows(parsed.rows, masters, new Map());
    expect(resolved.preview.rows).toHaveLength(1);
    expect(resolved.preview.rows[0]).toMatchObject({
      employeeCode: 'EMP-001',
      fullName: 'Sample Employee',
      joiningDate: '2026-04-01',
      displayedSalaryAmount: '50000.0000',
      isReimbursable: true,
      status: 'ACTIVE',
    });
    expect(resolved.preview.errorCount).toBe(1);
    const errors = resolved.preview.rows[0]?.errors.join(' ') ?? '';
    expect(errors).not.toContain('Department');
    expect(errors).not.toContain('Designation');
    expect(errors).toContain('Employment Type');
    expect([resolved.preview.rows[0]?.newDepartment, resolved.preview.rows[0]?.newDesignation]).toEqual([true, true]);
  });

  it('reads short dates: one-digit day and month, and a two-digit year', () => {
    expect(['6/10/2024', '6/4/2025', '6/4/25', '06-04-25', '6.4.2025', ' 6 / 4 / 2025 ', '2025-4-6', '08/07/02', '1/1/98'].map(parseDateText)).toEqual([
      '2024-10-06',
      '2025-04-06',
      '2025-04-06',
      '2025-04-06',
      '2025-04-06',
      '2025-04-06',
      '2025-04-06',
      '2002-07-08',
      '1998-01-01',
    ]);
    expect(['31/2/2025', '6/4', 'April 6'].map(parseDateText)).toEqual([null, null, null]);
  });

  it('adds each new department and designation once, matching names without case or extra spaces', async () => {
    const parsed = await parseEmployeeWorkbook(
      await workbook([
        ['EMP-7', 'Mehul', 'Dot net', 'Manager (BA)', '', '', '', '6/11/2024', ''],
        ['EMP-8', 'Tej', 'dot  NET', 'BA', '', '', '', '7/10/26', ''],
        ['EMP-9', 'Nishant', 'Accounts', 'ba', '', '', '', '12/9/2024', ''],
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const withAccounts = { ...masters, departments: [{ id: 'dep-acc', code: 'ACC', name: 'Accounts', isActive: true }] };
    const resolved = resolveEmployeeImportRows(parsed.rows, withAccounts, new Map());
    expect(resolved.preview.errorCount).toBe(0);
    expect(resolved.preview.newDepartmentNames).toEqual(['Dot net']);
    expect(resolved.preview.newDesignationNames).toEqual(['Manager (BA)', 'BA']);
    expect(resolved.preview.rows.map((r) => [r.newDepartment, r.newDesignation])).toEqual([[true, true], [true, true], [false, true]]);
    expect(resolved.preview.rows.map((r) => r.joiningDate)).toEqual(['2024-11-06', '2026-10-07', '2024-09-12']);
  });

  it('rejects a sheet that does not use the sample headers', async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet('Employees').addRow(['Name', 'Code']);
    const parsed = await parseEmployeeWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
    expect(parsed.ok).toBe(false);
  });

  it('accepts DD/MM/YYYY, a blank salary, and flags a repeated code on every row', async () => {
    const parsed = await parseEmployeeWorkbook(
      await workbook([
        ['EMP-1', 'First', '', '', '', 'No', '', '15/01/2026', ''],
        ['EMP-1', 'Second', '', '', '', 'Yes', '1,250.50', '2026-02-01', 'INACTIVE'],
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const resolved = resolveEmployeeImportRows(parsed.rows, masters, new Map());
    expect(resolved.preview.errorCount).toBe(2);
    expect(resolved.preview.rows[0]?.joiningDate).toBe('2026-01-15');
    expect(resolved.preview.rows[0]?.displayedSalaryAmount).toBeNull();
    expect(resolved.preview.rows[1]?.displayedSalaryAmount).toBe('1250.5000');
    expect(resolved.preview.rows[1]?.status).toBe('INACTIVE');
    expect(resolved.preview.rows[0]?.errors.join(' ')).toContain('repeated');
    expect(resolved.preview.rows[1]?.errors.join(' ')).toContain('repeated');
    expect(resolved.ready).toHaveLength(0);
  });

  it('matches a master by code and rejects an inactive one', async () => {
    const parsed = await parseEmployeeWorkbook(
      await workbook([
        ['EMP-2', 'Matched', 'ACC', '', '', '', '', '2026-03-01', 'ACTIVE'],
        ['EMP-3', 'Inactive dept', 'Old Accounts', '', '', '', '', '2026-03-01', 'ACTIVE'],
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const resolved = resolveEmployeeImportRows(
      parsed.rows,
      {
        departments: [
          { id: 'dept-1', code: 'ACC', name: 'Accounts', isActive: true },
          { id: 'dept-2', code: 'OLD', name: 'Old Accounts', isActive: false },
        ],
        designations: [],
        employmentTypes: [],
      },
      new Map(),
    );
    expect(resolved.preview.rows[0]?.errors).toEqual([]);
    expect(resolved.ready[0]).toMatchObject({ kind: 'CREATE', internalDepartmentId: 'dept-1' });
    expect(resolved.preview.rows[1]?.errors.join(' ')).toContain('inactive');
  });

  it('leaves Joining Date optional, starting a salary from Salary Effective From', async () => {
    // Code, Name, Dept, Designation, Type, Reimbursable, Salary, Joining, Status, Legal Entity, Salary Effective From
    const parsed = await parseEmployeeWorkbook(
      await workbook([
        ['EMP-A', 'No dates', '', '', '', '', '', '', ''],
        ['EMP-B', 'Salary from a date', '', '', '', '', '40000', '', '', '', '01/10/2026'],
        ['EMP-C', 'Salary, no date', '', '', '', '', '40000', '', ''],
      ]),
    );
    if (!parsed.ok) throw new Error(parsed.message);
    const resolved = resolveEmployeeImportRows(parsed.rows, masters, new Map());
    expect(resolved.preview.rows.map((r) => [r.action, r.joiningDate, r.salaryEffectiveFrom, r.errors])).toEqual([
      ['CREATE', null, null, []],
      ['CREATE', null, '2026-10-01', []],
      ['CREATE', null, null, ['Monthly Salary needs Salary Effective From when there is no Joining Date.']],
    ]);
    expect(resolved.ready.map((r) => (r.kind === 'CREATE' ? [r.joiningDate, r.salary] : null))).toEqual([
      [null, null],
      [null, { amount: '40000.0000', effectiveFrom: '2026-10-01' }],
    ]);
  });

  it('updates an existing employee: same salary kept, a new one from its effective date, blanks kept', async () => {
    const existing = (code: string, overrides: Partial<ExistingEmployeeRef> = {}): [string, ExistingEmployeeRef] => [
      code,
      {
        id: `id-${code}`, version: 3, deleted: false, fullName: 'Asha Patel', legalEntityId: null, internalDepartmentId: null, designationId: null, employmentTypeId: null,
        isReimbursable: true, status: 'ACTIVE', joiningDate: '2026-01-01', currentSalary: { amount: '50000.0000', effectiveFrom: '2026-01-01' }, ...overrides,
      },
    ];
    const known = new Map([existing('E1'), existing('E2'), existing('E3'), existing('E4'), existing('E5', { joiningDate: null, currentSalary: null })]);
    const parsed = await parseEmployeeWorkbook(
      await workbook([
        ['E1', 'Asha Patel', '', '', '', '', '50,000', '', ''],
        ['E2', 'Asha Patel', '', '', '', '', '55000', '', '', '', '01/11/2026'],
        ['E3', 'Asha Patel', '', '', '', '', '55000', '', ''],
        ['E4', 'Asha P.', '', '', '', 'No', '55000', '', '', '', '01/01/2026'],
        ['E5', 'Asha Patel', '', '', '', '', '30000', '15/06/2026', ''],
      ]),
    );
    if (!parsed.ok) throw new Error(parsed.message);
    const { preview, ready } = resolveEmployeeImportRows(parsed.rows, masters, known);
    expect(preview.rows.map((r) => [r.employeeCode, r.action, r.changes, r.errors])).toEqual([
      ['E1', 'UNCHANGED', [], []],
      ['E2', 'UPDATE', ['Salary: ₹50,000.00 → ₹55,000.00 from 01/11/2026'], []],
      ['E3', 'UPDATE', [], ['Salary changes from ₹50,000.00 to ₹55,000.00: add the date it takes effect in Salary Effective From.']],
      ['E4', 'UPDATE', ['Name: Asha Patel → Asha P.', 'Reimbursable: Yes → No'], ['Salary Effective From must be after 01/01/2026, when the current salary started.']],
      ['E5', 'UPDATE', ['Joining date set to 15/06/2026', 'Salary: ₹30,000.00 from 15/06/2026'], []],
    ]);
    expect([preview.createCount, preview.updateCount, preview.unchangedCount, preview.errorCount]).toEqual([0, 2, 1, 2]);
    expect(ready).toEqual([
      { kind: 'UPDATE', rowNumber: 3, employeeCode: 'E2', employeeId: 'id-E2', version: 3, update: {}, salary: { amount: '55000.0000', effectiveFrom: '2026-11-01' } },
      { kind: 'UPDATE', rowNumber: 6, employeeCode: 'E5', employeeId: 'id-E5', version: 3, update: { joiningDate: '2026-06-15' }, salary: { amount: '30000.0000', effectiveFrom: '2026-06-15' } },
    ]);
  });

  it('reads a file without the Legal Entity column, and matches a legal entity by PAN', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Employees');
    sheet.addRow(EMPLOYEE_IMPORT_HEADERS.filter((header) => header !== 'Legal Entity'));
    sheet.addRow(['EMP-OLD', 'Older Template', '', '', '', 'No', '', '2026-01-15', '']);
    const older = await parseEmployeeWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
    expect(older.ok).toBe(true);

    const parsed = await parseEmployeeWorkbook(await workbook([['EMP-LE', 'With Company', '', '', '', 'No', '', '2026-01-15', '', 'abcpm1234p']]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const legalEntities = [{ id: 'le-1', code: 'ABCPM1234P', name: 'Zitaware Projects Pvt Ltd', isActive: true }];
    const resolved = resolveEmployeeImportRows(parsed.rows, { ...masters, legalEntities }, new Map());
    expect(resolved.preview.rows[0]).toMatchObject({ legalEntityName: 'abcpm1234p', errors: [] });
    expect(resolved.ready[0]).toMatchObject({ kind: 'CREATE', legalEntityId: 'le-1' });
  });
});
