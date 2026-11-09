import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { cellText, excelSerialToIso, formatDateValue, normalizeHeader, parseDateText } from '../employees/employee-import';

/**
 * Reading the Server & Subscription sheet (ADR-169). This file only reads
 * cells into plain values and flags what cannot be read; matching names to
 * the masters is the service's job.
 */

/** A card or account number loses its spaces and dashes ("1234 5678 9012 3456"); a name like "HDFC 8436" keeps single spaces. */
export function cleanAccount(value: string): string {
  return /^[\d\s\-–]+$/.test(value) ? value.replace(/[\s\-–]/g, '') : value.replace(/\s+/g, ' ');
}

export const SERVER_SUBSCRIPTION_HEADERS = [
  'Sr.no',
  'Employee Name',
  'Subscription Name',
  'Basic Amount',
  'GST Amount',
  'Total Paid',
  'Date',
  'Project Name',
  'Server/Subscription',
  'Payment Mode',
  'Card/Account no',
  'Legal Entity',
  'Bill Link',
] as const;

export type SheetColumn =
  | 'employee'
  | 'title'
  | 'basic'
  | 'gst'
  | 'total'
  | 'date'
  | 'project'
  | 'spendType'
  | 'paymentMode'
  | 'account'
  | 'legalEntity'
  | 'category'
  | 'gstType'
  | 'reference'
  | 'billLink';

const REQUIRED: SheetColumn[] = ['employee', 'title', 'basic', 'date', 'spendType', 'paymentMode', 'account', 'legalEntity'];

const MAX_ROWS = 500;

/**
 * Which column a header names. Headers are matched loosely, since sheets
 * are typed by hand ("Subscibtion Name", "Server /Subscription"); the
 * order of the checks settles headers that contain more than one word.
 */
export function columnOf(header: string): SheetColumn | null {
  const h = normalizeHeader(header);
  if (!h || h === 'srno' || h === 'sr' || h === 'no' || h === 'serialno') return null;
  if (h.includes('link') || h.includes('url')) return 'billLink';
  if (h.includes('employ')) return 'employee';
  if (h.includes('project')) return 'project';
  if (h.includes('legal') || h.includes('entity') || h === 'company') return 'legalEntity';
  if (h.includes('card') || h.includes('account')) return 'account';
  if (h.includes('mode')) return 'paymentMode';
  if (h.includes('gsttype') || h.includes('supplytype')) return 'gstType';
  if (h.includes('gst') || h.includes('tax')) return h.includes('taxable') ? 'basic' : 'gst';
  if (h.includes('total')) return 'total';
  if (h.includes('basic') || h.includes('amount')) return 'basic';
  if (h.includes('date')) return 'date';
  if (h.includes('categ')) return 'category';
  if ((h.includes('server') && h.includes('sub')) || h === 'type' || h === 'spendtype') return 'spendType';
  if (h.includes('reference') || h.includes('transaction') || h.includes('utr')) return 'reference';
  if (h.includes('name') || h.includes('subs') || h.includes('server') || h.includes('title') || h.includes('description') || h.includes('service')) return 'title';
  return null;
}

export interface SheetRow {
  rowNumber: number;
  employee: string;
  title: string;
  spendType: 'SERVER' | 'SUBSCRIPTION' | null;
  expenseDate: string | null;
  project: string;
  paymentMode: string;
  account: string;
  legalEntity: string;
  category: string;
  gstType: 'INTRASTATE' | 'INTERSTATE' | null;
  reference: string;
  billLink: string;
  /** In rupees, as the sheet states them; a ₹ sign and commas are ignored. */
  basic: Prisma.Decimal | null;
  gst: Prisma.Decimal;
  total: Prisma.Decimal | null;
  errors: string[];
}

function sourceOf(value: ExcelJS.CellValue): ExcelJS.CellValue {
  return typeof value === 'object' && value !== null && 'result' in value ? value.result : value;
}

/**
 * A number from a cell. A typed number is taken as it is; text has every
 * currency sign, letter and thousands separator dropped ("₹3,500.00",
 * "Rs 630" both read), so only the digits count.
 */
export function readAmount(value: ExcelJS.CellValue, label: string): { value: Prisma.Decimal | null; error: string | null } {
  const source = sourceOf(value);
  if (source == null) return { value: null, error: null };
  if (typeof source === 'number') {
    if (!Number.isFinite(source)) return { value: null, error: `${label} is not a number.` };
    return { value: new Prisma.Decimal(String(source)).toDecimalPlaces(4), error: null };
  }
  const text = cellText(source);
  if (!text) return { value: null, error: null };
  const cleaned = text.replace(/[^0-9.-]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { value: null, error: `${label} "${text}" is not a number.` };
  return { value: new Prisma.Decimal(cleaned).toDecimalPlaces(4), error: null };
}

/** A date cell, or a typed date as the employee import reads it: DD/MM/YYYY, 6/4/2025, 6/4/25 or YYYY-MM-DD. */
export function readDate(value: ExcelJS.CellValue): string | null {
  const source = sourceOf(value);
  if (source instanceof Date) return formatDateValue(source);
  if (typeof source === 'number' && Number.isFinite(source)) return excelSerialToIso(source);
  return parseDateText(cellText(source));
}

export function readSpendType(text: string): 'SERVER' | 'SUBSCRIPTION' | null {
  const key = normalizeHeader(text);
  if (key.startsWith('server') || key === 'hosting') return 'SERVER';
  if (key.startsWith('subscri') || key.startsWith('subscib') || key === 'sub') return 'SUBSCRIPTION';
  return null;
}

/** CGST+SGST (same state) or IGST (another state); blank leaves it to the default. */
export function readGstType(text: string): { value: 'INTRASTATE' | 'INTERSTATE' | null; error: string | null } {
  const key = normalizeHeader(text);
  if (!key) return { value: null, error: null };
  if (key.includes('igst') || key.includes('inter')) return { value: 'INTERSTATE', error: null };
  if (key.includes('cgst') || key.includes('sgst') || key.includes('intra')) return { value: 'INTRASTATE', error: null };
  return { value: null, error: `GST Type "${text}" must be IGST or CGST+SGST.` };
}

export async function parseServerSubscriptionWorkbook(buffer: Buffer): Promise<{ ok: true; rows: SheetRow[] } | { ok: false; message: string }> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return { ok: false, message: 'This file is not a readable Excel workbook (.xlsx).' };
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return { ok: false, message: 'The workbook has no sheet.' };

  const columns = new Map<SheetColumn, number>();
  let oldRateColumn = false;
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const header = cellText(cell.value);
    if (/^(inr|usd|fx|exchange|conversion)?rate$/.test(normalizeHeader(header))) oldRateColumn = true;
    const key = columnOf(header);
    if (key && !columns.has(key)) columns.set(key, col);
  });
  // Amounts are rupees now; an old sheet's rate column would otherwise be skipped and its amounts taken as rupees.
  if (oldRateColumn) return { ok: false, message: 'INR Rate is no longer used. Remove that column and enter every amount in rupees.' };
  const missing = REQUIRED.filter((key) => !columns.has(key));
  if (missing.length > 0) {
    return { ok: false, message: `The first row must have the sample's headers: ${SERVER_SUBSCRIPTION_HEADERS.join(', ')}. Missing: ${missing.map(labelOf).join(', ')}.` };
  }

  const rows: SheetRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const raw = (key: SheetColumn): ExcelJS.CellValue => {
      const col = columns.get(key);
      return col ? row.getCell(col).value : null;
    };
    const text = (key: SheetColumn) => cellText(raw(key));

    // Sr.no is not read, so a row with only a serial number counts as empty.
    if ([...columns.keys()].every((key) => text(key) === '')) continue;

    const errors: string[] = [];
    const employee = text('employee');
    const title = text('title');
    if (!employee) errors.push('Employee Name is required.');
    if (!title) errors.push('Subscription Name is required.');
    else if (title.length > 300) errors.push('Subscription Name must be 300 characters or fewer.');

    const spendTypeText = text('spendType');
    const spendType = readSpendType(spendTypeText);
    if (!spendTypeText) errors.push('Server/Subscription is required.');
    else if (!spendType) errors.push(`Server/Subscription "${spendTypeText}" must be Server or Subscription.`);

    const expenseDate = readDate(raw('date'));
    if (!text('date') && !(sourceOf(raw('date')) instanceof Date)) errors.push('Date is required.');
    else if (!expenseDate) errors.push(`Date "${text('date')}" must be DD/MM/YYYY.`);

    const basic = readAmount(raw('basic'), 'Basic Amount');
    const gst = readAmount(raw('gst'), 'GST Amount');
    const total = readAmount(raw('total'), 'Total Paid');
    for (const e of [basic.error, gst.error, total.error]) if (e) errors.push(e);
    if (!basic.error && !basic.value) errors.push('Basic Amount is required.');
    else if (basic.value && !basic.value.greaterThan(0)) errors.push('Basic Amount must be more than zero.');
    const gstValue = gst.value ?? new Prisma.Decimal(0);
    if (gstValue.isNegative()) errors.push('GST Amount cannot be negative.');
    if (basic.value && gstValue.greaterThan(basic.value)) errors.push('GST Amount is more than the Basic Amount.');
    if (basic.value && total.value && !basic.value.plus(gstValue).equals(total.value)) {
      errors.push(`Total Paid ${total.value.toFixed(2)} is not Basic + GST (${basic.value.plus(gstValue).toFixed(2)}).`);
    }

    const gstType = readGstType(text('gstType'));
    if (gstType.error) errors.push(gstType.error);

    const billLink = linkOf(raw('billLink'));
    if (billLink && !/^https?:\/\/\S+$/i.test(billLink)) errors.push(`Bill Link "${billLink}" must be a web address starting with https://.`);
    else if (billLink.length > 1000) errors.push('Bill Link must be 1000 characters or fewer.');

    if (!text('paymentMode')) errors.push('Payment Mode is required.');
    if (!text('legalEntity')) errors.push('Legal Entity is required.');

    rows.push({
      rowNumber,
      employee,
      title,
      spendType,
      expenseDate,
      project: text('project'),
      paymentMode: text('paymentMode'),
      account: cleanAccount(text('account')),
      legalEntity: text('legalEntity'),
      category: text('category'),
      gstType: gstType.value,
      reference: text('reference'),
      billLink,
      basic: basic.value,
      gst: gstValue,
      total: total.value,
      errors,
    });
    if (rows.length > MAX_ROWS) return { ok: false, message: `Import at most ${MAX_ROWS} rows at a time.` };
  }
  return { ok: true, rows };
}

/** A hyperlink cell gives its address; a typed one, its text. */
function linkOf(value: ExcelJS.CellValue): string {
  if (value && typeof value === 'object' && 'hyperlink' in value && typeof value.hyperlink === 'string') return value.hyperlink.trim();
  return cellText(value);
}

function labelOf(key: SheetColumn): string {
  const labels: Record<SheetColumn, string> = {
    employee: 'Employee Name',
    title: 'Subscription Name',
    basic: 'Basic Amount',
    gst: 'GST Amount',
    total: 'Total Paid',
    date: 'Date',
    project: 'Project Name',
    spendType: 'Server/Subscription',
    paymentMode: 'Payment Mode',
    account: 'Card/Account no',
    legalEntity: 'Legal Entity',
    category: 'Expense Category',
    gstType: 'GST Type',
    reference: 'Reference',
    billLink: 'Bill Link',
  };
  return labels[key];
}

export async function buildServerSubscriptionSample(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Servers & Subscriptions');
  sheet.addRow([...SERVER_SUBSCRIPTION_HEADERS]);
  sheet.getRow(1).font = { bold: true };
  sheet.addRow([1, 'Sample Employee', 'Digital signature renewal', 3500, 630, 4130, new Date(Date.UTC(2026, 9, 29)), '', 'Subscription', 'Credit Card', '4421 4500 0109 7823', 'Sample Company Pvt Ltd', 'https://drive.google.com/your-bill']);
  sheet.addRow([2, 'Sample Employee', 'Code editor plan', 1900, 0, 1900, new Date(Date.UTC(2026, 9, 27)), 'Sample Project', 'Subscription', 'Credit Card', '4421 4500 0109 7823', 'Sample Company Pvt Ltd', '']);
  for (const r of [2, 3]) sheet.getRow(r).getCell(7).numFmt = 'dd/mm/yyyy';
  sheet.columns.forEach((column) => {
    column.width = 20;
  });

  const notes = workbook.addWorksheet('Instructions');
  for (const line of [
    'One row per bill paid. Replace the two example rows.',
    'Employee Name: who paid or uses it. When two employees share a name, the import asks which one (by employee code). An employee code also works.',
    'Basic Amount, GST Amount and Total Paid are in rupees, as on the bill. A ₹ sign and commas are ignored. GST Amount blank means no GST. Total Paid must be Basic + GST.',
    'Date: DD/MM/YYYY.',
    'Project Name: blank means company overhead. The project must belong to the Legal Entity.',
    'Server/Subscription: Server or Subscription.',
    'Payment Mode: Credit Card, Debit Card, Bank Transfer (NEFT, RTGS and IMPS are Bank Transfer), UPI, Cheque or Cash.',
    'Card/Account no: required. For a card, the card number (only the last four digits are matched to Card Accounts). For any other mode, the bank account number (last four digits) or the account name from Bank Accounts.',
    'Legal Entity: the company that paid, as named in Legal Entities.',
    'Bill Link (optional): a web address of the bill, e.g. the vendor portal or a Google Drive link. A bill file can be attached after import from the Bill button on the list.',
    'Optional columns: GST Type (IGST or CGST+SGST; IGST when blank, and it can be changed in the preview), Expense Category (by default Hosting / Cloud / Infra for a server and Software Licenses for a subscription), Reference.',
    'A row that does not match a master shows its error in the preview. Nothing is imported until every row is clear.',
  ]) notes.addRow([line]);
  notes.getColumn(1).width = 130;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
