import ExcelJS from 'exceljs';
import { Money } from '@zitaware/accounting';
import type { EmployeeImportPreview, EmployeeImportPreviewRow } from '@zitaware/contracts';

/** Columns of the employee import sample. The first sheet must use these headers. */
export const EMPLOYEE_IMPORT_HEADERS = [
  'Employee Code',
  'Full Name',
  'Department',
  'Designation',
  'Employment Type',
  'Reimbursable',
  'Monthly Salary',
  'Joining Date',
  'Status',
  'Legal Entity',
  'Salary Effective From',
] as const;

const HEADER_KEYS = {
  employeecode: 'employeeCode',
  fullname: 'fullName',
  department: 'department',
  designation: 'designation',
  employmenttype: 'employmentType',
  reimbursable: 'reimbursable',
  monthlysalary: 'monthlySalary',
  joiningdate: 'joiningDate',
  status: 'status',
  legalentity: 'legalEntity',
  salaryeffectivefrom: 'salaryEffectiveFrom',
} as const;

/** Columns a file may leave out; older samples have no Legal Entity or Salary Effective From column. */
const OPTIONAL_HEADERS = new Set<keyof typeof HEADER_KEYS>(['legalentity', 'joiningdate', 'salaryeffectivefrom']);

type ColumnKey = (typeof HEADER_KEYS)[keyof typeof HEADER_KEYS];

const MAX_ROWS = 500;
const MAX_BYTES = 2_000_000;

export interface MasterRef {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

/** A department or designation the sheet names that is not in Masters: it stands in for the id until the import adds it. */
export const NEW_MASTER_PREFIX = 'new:';

/** Names compared without case and with runs of spaces as one: "Dot  net" is "dot net". */
export function masterKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** An employee already in the CRM, as the import compares a row against it (ADR-170). */
export interface ExistingEmployeeRef {
  id: string;
  version: number;
  deleted: boolean;
  fullName: string;
  legalEntityId: string | null;
  internalDepartmentId: string | null;
  designationId: string | null;
  employmentTypeId: string | null;
  isReimbursable: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  joiningDate: string | null;
  /** The open salary revision, or the stored salary when there is none (effectiveFrom null). */
  currentSalary: { amount: string; effectiveFrom: string | null } | null;
}

/** The fields an update changes; a field left out is kept as it is. */
export interface EmployeeImportUpdate {
  fullName?: string;
  legalEntityId?: string;
  internalDepartmentId?: string;
  designationId?: string;
  employmentTypeId?: string;
  isReimbursable?: boolean;
  status?: 'ACTIVE' | 'INACTIVE';
  joiningDate?: string;
}

export type ResolvedEmployeeImportRow =
  | {
      kind: 'CREATE';
      rowNumber: number;
      employeeCode: string;
      fullName: string;
      legalEntityId: string | null;
      internalDepartmentId: string | null;
      designationId: string | null;
      employmentTypeId: string | null;
      isReimbursable: boolean;
      joiningDate: string | null;
      status: 'ACTIVE' | 'INACTIVE';
      salary: { amount: string; effectiveFrom: string } | null;
    }
  | {
      kind: 'UPDATE';
      rowNumber: number;
      employeeCode: string;
      employeeId: string;
      version: number;
      update: EmployeeImportUpdate;
      /** The current salary it replaces, for the revision's audit. */
      salary: { amount: string; effectiveFrom: string } | null;
    };

interface DraftRow {
  rowNumber: number;
  employeeCode: string;
  fullName: string;
  legalEntity: string;
  department: string;
  designation: string;
  employmentType: string;
  /** Null when the cell is blank: a new employee gets No, an existing one keeps theirs. */
  isReimbursable: boolean | null;
  displayedSalaryAmount: string | null;
  joiningDate: string | null;
  salaryEffectiveFrom: string | null;
  /** Null when the cell is blank: a new employee is ACTIVE, an existing one keeps theirs. */
  status: 'ACTIVE' | 'INACTIVE' | null;
  errors: string[];
}

export function decodeImportWorkbook(contentBase64: string): Buffer {
  const trimmed = contentBase64.trim();
  if (!trimmed) {
    throw new Error('Choose an Excel file.');
  }
  const buffer = Buffer.from(trimmed, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_BYTES) {
    throw new Error('The Excel file is empty or larger than 2 MB.');
  }
  return buffer;
}

export async function buildEmployeeImportSample(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Employees');
  sheet.addRow([...EMPLOYEE_IMPORT_HEADERS]);
  sheet.getRow(1).font = { bold: true };
  const example = sheet.addRow([
    'EMP-001',
    'Sample Employee',
    'Accounts',
    'Accountant',
    'Full-time',
    'Yes',
    50000,
    new Date(Date.UTC(2026, 3, 1)),
    'ACTIVE',
    'Sample Company Pvt Ltd',
    null,
  ]);
  example.getCell(7).numFmt = '0.00';
  example.getCell(8).numFmt = 'yyyy-mm-dd';
  sheet.columns.forEach((column) => {
    column.width = 22;
  });

  const notes = workbook.addWorksheet('Instructions');
  notes.addRow(['Replace the example row on the Employees sheet.']);
  notes.addRow(['Employee Code and Full Name are required. Joining Date is optional.']);
  notes.addRow(['An Employee Code already in the CRM updates that employee: a filled cell changes the field, a blank cell keeps it.']);
  notes.addRow(['Department, Designation and Employment Type must already exist. Use the name or the code. Leave a cell blank when it does not apply.']);
  notes.addRow(['Legal Entity is the company the employee works for: its legal name or PAN. Leave it blank to set it later in Employees.']);
  notes.addRow(['Reimbursable is Yes or No. Blank means No.']);
  notes.addRow(['Monthly Salary is optional, up to 4 decimal places. For a new employee it starts from Salary Effective From, or else the Joining Date.']);
  notes.addRow(['For an existing employee, the same salary as now is kept as it is. A different salary is recorded as a raise from Salary Effective From, which must then be filled in and be after the current salary started.']);
  notes.addRow(['Joining Date and Salary Effective From are YYYY-MM-DD or DD/MM/YYYY.']);
  notes.addRow(['Status is ACTIVE or INACTIVE. Blank means ACTIVE for a new employee and no change for an existing one.']);
  notes.addRow(['A file with any invalid row imports nothing. Login access is not imported.']);
  notes.getColumn(1).width = 120;

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

export async function parseEmployeeWorkbook(buffer: Buffer): Promise<{ ok: true; rows: DraftRow[] } | { ok: false; message: string }> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return { ok: false, message: 'This file is not a readable Excel workbook (.xlsx).' };
  }
  const sheet = workbook.getWorksheet('Employees') ?? workbook.worksheets[0];
  if (!sheet) {
    return { ok: false, message: 'The workbook has no sheet.' };
  }

  const columns = new Map<ColumnKey, number>();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const key = HEADER_KEYS[normalizeHeader(cellText(cell.value)) as keyof typeof HEADER_KEYS];
    if (key && !columns.has(key)) columns.set(key, col);
  });
  const missing = (Object.keys(HEADER_KEYS) as Array<keyof typeof HEADER_KEYS>).filter(
    (header) => !OPTIONAL_HEADERS.has(header) && !columns.has(HEADER_KEYS[header]),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      message: `The first row must use the sample headers: ${EMPLOYEE_IMPORT_HEADERS.join(', ')}.`,
    };
  }

  const rows: DraftRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const read = (key: ColumnKey) => {
      const col = columns.get(key);
      if (!col) return { text: '', raw: null as ExcelJS.CellValue };
      const cell = row.getCell(col);
      return { text: cellText(cell.value), raw: cell.value };
    };
    const values = {
      employeeCode: read('employeeCode'),
      fullName: read('fullName'),
      department: read('department'),
      designation: read('designation'),
      employmentType: read('employmentType'),
      reimbursable: read('reimbursable'),
      monthlySalary: read('monthlySalary'),
      joiningDate: read('joiningDate'),
      status: read('status'),
      legalEntity: read('legalEntity'),
      salaryEffectiveFrom: read('salaryEffectiveFrom'),
    };
    const blank = Object.values(values).every((value) => value.text === '' && !isDate(value.raw) && typeof value.raw !== 'number');
    if (blank) continue;

    const errors: string[] = [];
    const employeeCode = values.employeeCode.text;
    const fullName = values.fullName.text;
    if (!employeeCode) errors.push('Employee Code is required.');
    else if (employeeCode.length > 50) errors.push('Employee Code must be 50 characters or fewer.');
    if (!fullName) errors.push('Full Name is required.');
    else if (fullName.length > 200) errors.push('Full Name must be 200 characters or fewer.');

    const reimbursable = parseReimbursable(values.reimbursable.text);
    if (reimbursable.error) errors.push(reimbursable.error);
    const salary = parseSalary(values.monthlySalary.raw, values.monthlySalary.text);
    if (salary.error) errors.push(salary.error);
    const joiningDate = parseOptionalDate(values.joiningDate.raw, values.joiningDate.text, 'Joining Date');
    if (joiningDate.error) errors.push(joiningDate.error);
    const salaryEffectiveFrom = parseOptionalDate(values.salaryEffectiveFrom.raw, values.salaryEffectiveFrom.text, 'Salary Effective From');
    if (salaryEffectiveFrom.error) errors.push(salaryEffectiveFrom.error);
    const status = parseStatus(values.status.text);
    if (status.error) errors.push(status.error);

    rows.push({
      rowNumber,
      employeeCode,
      fullName,
      legalEntity: values.legalEntity.text,
      department: values.department.text,
      designation: values.designation.text,
      employmentType: values.employmentType.text,
      isReimbursable: reimbursable.value,
      displayedSalaryAmount: salary.amount,
      joiningDate: joiningDate.value,
      salaryEffectiveFrom: salaryEffectiveFrom.value,
      status: status.value,
      errors,
    });
    if (rows.length > MAX_ROWS) {
      return { ok: false, message: `Import at most ${MAX_ROWS} employees at a time.` };
    }
  }
  return { ok: true, rows };
}

const showDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const showMoney = (amount: string) => `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const sameMoney = (a: string, b: string) => Money.fromString(a).compare(Money.fromString(b)) === 0;

/**
 * Checks every row against the masters and, for an Employee Code already in
 * the CRM, against that employee (ADR-170): what the row would change, and
 * whether its salary is the current one or a raise that needs a date.
 */
export function resolveEmployeeImportRows(
  rows: DraftRow[],
  masters: { departments: MasterRef[]; designations: MasterRef[]; employmentTypes: MasterRef[]; legalEntities?: MasterRef[] },
  existing: ReadonlyMap<string, ExistingEmployeeRef>,
): { preview: EmployeeImportPreview; ready: ResolvedEmployeeImportRow[] } {
  const codeRows = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.employeeCode) continue;
    const list = codeRows.get(row.employeeCode) ?? [];
    list.push(row.rowNumber);
    codeRows.set(row.employeeCode, list);
  }
  const nameOf = (list: MasterRef[], id: string | null) =>
    !id ? '—' : id.startsWith(NEW_MASTER_PREFIX) ? id.slice(NEW_MASTER_PREFIX.length) : (list.find((m) => m.id === id)?.name ?? '—');
  const newDepartments = new Map<string, string>();
  const newDesignations = new Map<string, string>();

  const ready: ResolvedEmployeeImportRow[] = [];
  const previewRows: EmployeeImportPreviewRow[] = rows.map((row) => {
    const errors = [...row.errors];
    const changes: string[] = [];
    const repeats = row.employeeCode ? (codeRows.get(row.employeeCode) ?? []) : [];
    if (repeats.length > 1) {
      const others = repeats.filter((rowNumber) => rowNumber !== row.rowNumber).join(', ');
      errors.push(`Employee Code is repeated (also on row ${others}).`);
    }
    // A department or designation not in Masters yet is added by the import (simple masters, a name only).
    const department = resolveMaster(row.department, masters.departments, 'Department', true);
    const designation = resolveMaster(row.designation, masters.designations, 'Designation', true);
    // The first spelling in the sheet names the new master; later rows that differ only in case or spaces use it.
    if (department.isNew && !newDepartments.has(masterKey(row.department))) newDepartments.set(masterKey(row.department), department.id!.slice(NEW_MASTER_PREFIX.length));
    if (designation.isNew && !newDesignations.has(masterKey(row.designation))) newDesignations.set(masterKey(row.designation), designation.id!.slice(NEW_MASTER_PREFIX.length));
    const employmentType = resolveMaster(row.employmentType, masters.employmentTypes, 'Employment Type');
    const legalEntity = resolveMaster(row.legalEntity, masters.legalEntities ?? [], 'Legal Entity');
    for (const e of [legalEntity.error, department.error, designation.error, employmentType.error]) if (e) errors.push(e);

    const current = row.employeeCode ? existing.get(row.employeeCode) : undefined;
    if (current?.deleted) errors.push('This Employee Code belongs to a removed employee.');

    let action: EmployeeImportPreviewRow['action'] = 'CREATE';
    let salaryEffectiveFrom: string | null = null;
    let resolved: ResolvedEmployeeImportRow | null = null;

    if (!current) {
      // A new employee: the salary starts from its own date, or else the joining date.
      let salary: { amount: string; effectiveFrom: string } | null = null;
      if (row.displayedSalaryAmount) {
        salaryEffectiveFrom = row.salaryEffectiveFrom ?? row.joiningDate;
        if (!salaryEffectiveFrom) errors.push('Monthly Salary needs Salary Effective From when there is no Joining Date.');
        else if (row.joiningDate && salaryEffectiveFrom < row.joiningDate) errors.push('Salary Effective From cannot be before the Joining Date.');
        else salary = { amount: row.displayedSalaryAmount, effectiveFrom: salaryEffectiveFrom };
      }
      resolved = {
        kind: 'CREATE',
        rowNumber: row.rowNumber,
        employeeCode: row.employeeCode,
        fullName: row.fullName,
        legalEntityId: legalEntity.id,
        internalDepartmentId: department.id,
        designationId: designation.id,
        employmentTypeId: employmentType.id,
        isReimbursable: row.isReimbursable ?? false,
        joiningDate: row.joiningDate,
        status: row.status ?? 'ACTIVE',
        salary,
      };
    } else if (!current.deleted) {
      // An existing employee: a filled cell that differs is a change, a blank one is kept.
      const update: EmployeeImportUpdate = {};
      if (row.fullName && row.fullName !== current.fullName) {
        update.fullName = row.fullName;
        changes.push(`Name: ${current.fullName} → ${row.fullName}`);
      }
      const master = (id: string | null, now: string | null, list: MasterRef[], label: string, key: 'legalEntityId' | 'internalDepartmentId' | 'designationId' | 'employmentTypeId') => {
        if (id && id !== now) {
          update[key] = id;
          changes.push(`${label}: ${nameOf(list, now)} → ${nameOf(list, id)}`);
        }
      };
      master(legalEntity.id, current.legalEntityId, masters.legalEntities ?? [], 'Legal entity', 'legalEntityId');
      master(department.id, current.internalDepartmentId, masters.departments, 'Department', 'internalDepartmentId');
      master(designation.id, current.designationId, masters.designations, 'Designation', 'designationId');
      master(employmentType.id, current.employmentTypeId, masters.employmentTypes, 'Employment type', 'employmentTypeId');
      if (row.isReimbursable !== null && row.isReimbursable !== current.isReimbursable) {
        update.isReimbursable = row.isReimbursable;
        changes.push(`Reimbursable: ${current.isReimbursable ? 'Yes' : 'No'} → ${row.isReimbursable ? 'Yes' : 'No'}`);
      }
      if (row.status !== null && row.status !== current.status) {
        update.status = row.status;
        changes.push(`Status: ${current.status} → ${row.status}`);
      }
      if (row.joiningDate && row.joiningDate !== current.joiningDate) {
        if (current.joiningDate) errors.push(`Joining Date ${showDate(row.joiningDate)} differs from the one recorded (${showDate(current.joiningDate)}). Leave it blank to keep it.`);
        else {
          update.joiningDate = row.joiningDate;
          changes.push(`Joining date set to ${showDate(row.joiningDate)}`);
        }
      }
      const joining = row.joiningDate ?? current.joiningDate;

      let salary: { amount: string; effectiveFrom: string } | null = null;
      const salaryDiffers = !!row.displayedSalaryAmount && !(current.currentSalary && sameMoney(row.displayedSalaryAmount, current.currentSalary.amount));
      if (row.displayedSalaryAmount && salaryDiffers) {
        // A different salary is a raise from its own date; with no salary yet, the joining date will do.
        salaryEffectiveFrom = row.salaryEffectiveFrom ?? (current.currentSalary ? null : joining);
        const from = current.currentSalary ? `${showMoney(current.currentSalary.amount)} → ` : '';
        if (!salaryEffectiveFrom) {
          errors.push(`Salary changes from ${showMoney(current.currentSalary!.amount)} to ${showMoney(row.displayedSalaryAmount)}: add the date it takes effect in Salary Effective From.`);
        } else if (current.currentSalary?.effectiveFrom && salaryEffectiveFrom <= current.currentSalary.effectiveFrom) {
          errors.push(`Salary Effective From must be after ${showDate(current.currentSalary.effectiveFrom)}, when the current salary started.`);
        } else if (joining && salaryEffectiveFrom < joining) {
          errors.push('Salary Effective From cannot be before the Joining Date.');
        } else {
          salary = { amount: row.displayedSalaryAmount, effectiveFrom: salaryEffectiveFrom };
          changes.push(`Salary: ${from}${showMoney(row.displayedSalaryAmount)} from ${showDate(salaryEffectiveFrom)}`);
        }
      }
      action = changes.length > 0 || salaryDiffers ? 'UPDATE' : 'UNCHANGED';
      resolved = { kind: 'UPDATE', rowNumber: row.rowNumber, employeeCode: row.employeeCode, employeeId: current.id, version: current.version, update, salary };
    }

    if (errors.length === 0 && resolved && action !== 'UNCHANGED') ready.push(resolved);
    return {
      rowNumber: row.rowNumber,
      employeeCode: row.employeeCode,
      fullName: row.fullName,
      legalEntityName: row.legalEntity || null,
      departmentName: row.department || null,
      designationName: row.designation || null,
      newDepartment: department.isNew,
      newDesignation: designation.isNew,
      employmentTypeName: row.employmentType || null,
      isReimbursable: row.isReimbursable ?? current?.isReimbursable ?? false,
      displayedSalaryAmount: row.displayedSalaryAmount,
      joiningDate: row.joiningDate,
      salaryEffectiveFrom,
      status: row.status ?? current?.status ?? 'ACTIVE',
      action,
      changes,
      errors,
    };
  });

  const clear = previewRows.filter((row) => row.errors.length === 0);
  return {
    preview: {
      rows: previewRows,
      validCount: clear.length,
      errorCount: previewRows.length - clear.length,
      createCount: clear.filter((row) => row.action === 'CREATE').length,
      updateCount: clear.filter((row) => row.action === 'UPDATE').length,
      unchangedCount: clear.filter((row) => row.action === 'UNCHANGED').length,
      newDepartmentNames: [...newDepartments.values()],
      newDesignationNames: [...newDesignations.values()],
    },
    ready,
  };
}

function resolveMaster(label: string, rows: MasterRef[], labelName: string, addIfMissing = false): { id: string | null; error: string | null; isNew: boolean } {
  const key = masterKey(label);
  if (!key) return { id: null, error: null, isNew: false };
  const matches = rows.filter((row) => masterKey(row.name) === key || masterKey(row.code) === key);
  const unique = [...new Map(matches.map((row) => [row.id, row])).values()];
  if (unique.length === 0) {
    if (addIfMissing) return { id: `${NEW_MASTER_PREFIX}${label.trim().replace(/\s+/g, ' ')}`, error: null, isNew: true };
    return { id: null, error: `${labelName} "${label.trim()}" was not found.`, isNew: false };
  }
  if (unique.length > 1) return { id: null, error: `${labelName} "${label.trim()}" matches more than one record.`, isNew: false };
  const match = unique[0]!;
  if (!match.isActive) return { id: null, error: `${labelName} "${match.name}" is inactive.`, isNew: false };
  return { id: match.id, error: null, isNew: false };
}

export function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) return formatDateValue(value) ?? '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim();
    }
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('result' in value) return cellText(value.result ?? null);
  }
  return '';
}

function isDate(value: ExcelJS.CellValue): boolean {
  return value instanceof Date;
}

function parseReimbursable(text: string): { value: boolean | null; error: string | null } {
  const key = text.trim().toLowerCase();
  if (!key) return { value: null, error: null };
  if (key === 'yes' || key === 'y' || key === 'true' || key === '1') return { value: true, error: null };
  if (key === 'no' || key === 'n' || key === 'false' || key === '0') return { value: false, error: null };
  return { value: false, error: 'Reimbursable must be Yes or No.' };
}

function parseStatus(text: string): { value: 'ACTIVE' | 'INACTIVE' | null; error: string | null } {
  const key = text.trim().toLowerCase();
  if (!key) return { value: null, error: null };
  if (key === 'active') return { value: 'ACTIVE', error: null };
  if (key === 'inactive') return { value: 'INACTIVE', error: null };
  return { value: 'ACTIVE', error: 'Status must be ACTIVE or INACTIVE.' };
}

function parseSalary(raw: ExcelJS.CellValue, text: string): { amount: string | null; error: string | null } {
  const source = typeof raw === 'object' && raw && 'result' in raw ? raw.result : raw;
  if (source == null || (typeof source === 'string' && source.trim() === '')) return { amount: null, error: null };
  if (source instanceof Date) return { amount: null, error: 'Monthly Salary must be a number with up to 4 decimal places.' };
  try {
    if (typeof source === 'number') {
      const money = Money.fromNumber(source);
      if (money.isNegative()) return { amount: null, error: 'Monthly Salary cannot be negative.' };
      return { amount: money.toFixed(), error: null };
    }
    const normalized = text.replace(/,/g, '').trim();
    if (!/^\d{1,15}(\.\d{1,4})?$/.test(normalized)) {
      return { amount: null, error: 'Monthly Salary must be a number with up to 4 decimal places.' };
    }
    const money = Money.fromString(normalized);
    if (money.isNegative()) return { amount: null, error: 'Monthly Salary cannot be negative.' };
    return { amount: money.toFixed(), error: null };
  } catch {
    return { amount: null, error: 'Monthly Salary must be a number with up to 4 decimal places.' };
  }
}

/** A date cell that may be left blank. */
function parseOptionalDate(raw: ExcelJS.CellValue, text: string, label: string): { value: string | null; error: string | null } {
  const source = typeof raw === 'object' && raw && 'result' in raw ? raw.result : raw;
  if ((source == null || text === '') && !(source instanceof Date) && typeof source !== 'number') return { value: null, error: null };
  if (source instanceof Date) {
    const iso = formatDateValue(source);
    return iso ? { value: iso, error: null } : { value: null, error: `${label} is not a valid date.` };
  }
  if (typeof source === 'number' && Number.isFinite(source)) {
    const iso = excelSerialToIso(source);
    return iso ? { value: iso, error: null } : { value: null, error: `${label} is not a valid date.` };
  }
  const iso = parseDateText(text);
  return iso ? { value: iso, error: null } : { value: null, error: `${label} "${text}" is not a date. Use DD/MM/YYYY (6/4/2025 and 6/4/25 also work).` };
}

export function formatDateValue(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const utcMidnight = date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0;
  const year = utcMidnight ? date.getUTCFullYear() : date.getFullYear();
  const month = (utcMidnight ? date.getUTCMonth() : date.getMonth()) + 1;
  const day = utcMidnight ? date.getUTCDate() : date.getDate();
  return calendarDate(year, month, day);
}

export function excelSerialToIso(serial: number): string | null {
  const whole = Math.round(serial);
  const utc = new Date(Date.UTC(1899, 11, 30) + whole * 86_400_000);
  return calendarDate(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

/**
 * A typed date: YYYY-MM-DD, or day first with one- or two-digit day and month
 * and a two- or four-digit year ("06/04/2025", "6/4/2025", "6/4/25", "6-4-25",
 * "6.4.2025"). A two-digit year is this century up to next year, else the last
 * ("25" is 2025, "98" is 1998).
 */
export function parseDateText(text: string): string | null {
  const value = text.trim().replace(/\s*([/.-])\s*/g, '$1');
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (iso) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(value);
  if (dmy) return calendarDate(fullYear(dmy[3]!), Number(dmy[2]), Number(dmy[1]));
  return null;
}

function fullYear(year: string): number {
  if (year.length === 4) return Number(year);
  const pivot = (new Date().getUTCFullYear() % 100) + 1;
  return Number(year) <= pivot ? 2000 + Number(year) : 1900 + Number(year);
}

function calendarDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
