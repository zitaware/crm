import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { cellText, normalizeHeader } from '../employees/employee-import';
import { cleanAccount, readAmount, readDate } from '../direct-expenses/server-subscription-import';

/**
 * Reading the purchase register (ADR-178), laid out as the team keeps it:
 * one row per bill already paid. Cells become plain values here; matching
 * names to vendors, legal entities, projects and masters is the service's.
 */
export const PURCHASE_IMPORT_HEADERS = [
  'No',
  'Date',
  'Details',
  'Supplier',
  'Company',
  'Invoice Link',
  'Category',
  'Other Charges',
  'Amount',
  'Amount With GST',
  'Project',
  'Paid by',
  'Payment Receipt',
  'Material Inward',
  'Reimbursement Status',
  'Reimbursement Date',
  'status',
  'Payment Mode',
  'Card/Account no',
] as const;

export type PurchaseColumn =
  | 'date' | 'details' | 'supplier' | 'company' | 'invoiceLink' | 'category' | 'otherCharges' | 'amount' | 'total' | 'project' | 'paidBy' | 'receipt'
  | 'mode' | 'account' | 'billNo';

const REQUIRED: PurchaseColumn[] = ['date', 'details', 'supplier', 'company', 'amount', 'total', 'mode', 'account'];
const MAX_ROWS = 1000;

const LABEL: Record<PurchaseColumn, string> = {
  date: 'Date', details: 'Details', supplier: 'Supplier', company: 'Company', invoiceLink: 'Invoice Link', category: 'Category', otherCharges: 'Other Charges',
  amount: 'Amount', total: 'Amount With GST', project: 'Project', paidBy: 'Paid by', receipt: 'Payment Receipt', mode: 'Payment Mode', account: 'Card/Account no',
  billNo: 'Bill No',
};

/** Which column a header names, read loosely; the order settles headers with several words in them. Columns the import does not use read as null. */
export function purchaseColumnOf(header: string): PurchaseColumn | null {
  const h = normalizeHeader(header);
  if (!h || h === 'no' || h === 'srno' || h === 'sr') return null;
  if (h.includes('reimburs') || h.includes('material') || h === 'status') return null;
  if (h.includes('withgst') || h.includes('total')) return 'total';
  if (h.includes('other')) return 'otherCharges';
  if (h.includes('mode')) return 'mode';
  if (h.includes('card') || h.includes('account')) return 'account';
  if (h.includes('receipt')) return 'receipt';
  if (h.includes('paidby') || h === 'paid') return 'paidBy';
  if (h.includes('invoice') || h.includes('bill')) return h.includes('link') || h.includes('url') ? 'invoiceLink' : 'billNo';
  if (h.includes('link')) return 'invoiceLink';
  if (h.includes('supplier') || h.includes('vendor') || h === 'party') return 'supplier';
  if (h.includes('company') || h.includes('legalentity') || h === 'entity') return 'company';
  if (h.includes('project')) return 'project';
  if (h.includes('categ')) return 'category';
  if (h.includes('amount') || h.includes('basic') || h.includes('taxable')) return 'amount';
  if (h.includes('date')) return 'date';
  if (h.includes('detail') || h.includes('description') || h.includes('particular')) return 'details';
  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A date cell, DD/MM/YYYY, YYYY-MM-DD, or the sheet's own "13-Nov-24" / "1-Jan-25". */
export function readSheetDate(value: ExcelJS.CellValue): string | null {
  const plain = readDate(value);
  if (plain) return plain;
  const m = /^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]+(\d{2}|\d{4})$/.exec(cellText(value));
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const day = Number(m[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** A link cell gives its address; a typed one, its text. */
function linkOf(value: ExcelJS.CellValue): string {
  if (value && typeof value === 'object' && 'hyperlink' in value && typeof value.hyperlink === 'string') return value.hyperlink.trim();
  return cellText(value);
}

/** "-" and blank are nothing; anything else must be a number. */
function readOptionalAmount(value: ExcelJS.CellValue, label: string): { value: Prisma.Decimal; error: string | null } {
  const text = cellText(value);
  if (!text || /^[-–—]+$/.test(text)) return { value: new Prisma.Decimal(0), error: null };
  const read = readAmount(value, label);
  return { value: read.value ?? new Prisma.Decimal(0), error: read.error };
}

export interface PurchaseSheetRow {
  rowNumber: number;
  date: string | null;
  details: string;
  supplier: string;
  company: string;
  invoiceLink: string;
  category: string;
  otherCharges: Prisma.Decimal;
  amount: Prisma.Decimal | null;
  total: Prisma.Decimal | null;
  project: string;
  paidBy: string;
  receipt: string;
  mode: string;
  account: string;
  billNo: string;
  errors: string[];
}

export async function parsePurchaseWorkbook(buffer: Buffer): Promise<{ ok: true; rows: PurchaseSheetRow[] } | { ok: false; message: string }> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return { ok: false, message: 'This file is not a readable Excel workbook (.xlsx).' };
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return { ok: false, message: 'The workbook has no sheet.' };

  const columns = new Map<PurchaseColumn, number>();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const key = purchaseColumnOf(cellText(cell.value));
    if (key && !columns.has(key)) columns.set(key, col);
  });
  const missing = REQUIRED.filter((key) => !columns.has(key));
  if (missing.length > 0) return { ok: false, message: `The first row must have the sample's headers. Missing: ${missing.map((k) => LABEL[k]).join(', ')}.` };

  const rows: PurchaseSheetRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const raw = (key: PurchaseColumn): ExcelJS.CellValue => {
      const col = columns.get(key);
      return col ? row.getCell(col).value : null;
    };
    const text = (key: PurchaseColumn) => cellText(raw(key)).replace(/^[-–—]+$/, '');
    if ([...columns.keys()].every((key) => text(key) === '')) continue;

    const errors: string[] = [];
    for (const key of ['details', 'supplier', 'company', 'mode'] as const) if (!text(key)) errors.push(`${LABEL[key]} is required.`);
    if (!text('account')) errors.push('Card/Account no is required: the card or bank account it was paid from.');

    const date = readSheetDate(raw('date'));
    if (!text('date') && !(raw('date') instanceof Date)) errors.push('Date is required.');
    else if (!date) errors.push(`Date "${text('date')}" must be like 13-Nov-24 or 13/11/2024.`);

    const amount = readAmount(raw('amount'), 'Amount');
    const total = readAmount(raw('total'), 'Amount With GST');
    const other = readOptionalAmount(raw('otherCharges'), 'Other Charges');
    for (const e of [amount.error, total.error, other.error]) if (e) errors.push(e);
    if (!amount.error && !amount.value) errors.push('Amount is required.');
    else if (amount.value && !amount.value.greaterThan(0)) errors.push('Amount must be more than zero.');
    if (!total.error && !total.value) errors.push('Amount With GST is required.');
    if (amount.value && total.value) {
      const taxable = amount.value.plus(other.value);
      if (total.value.lessThan(taxable)) errors.push(`Amount With GST ${total.value.toFixed(2)} is less than Amount + Other Charges (${taxable.toFixed(2)}).`);
      else if (total.value.minus(taxable).greaterThan(taxable.times(0.28))) errors.push(`The GST (${total.value.minus(taxable).toFixed(2)}) is more than 28% of the amount; check Amount and Amount With GST.`);
    }

    rows.push({
      rowNumber,
      date,
      details: text('details'),
      supplier: text('supplier'),
      company: text('company'),
      invoiceLink: linkOf(raw('invoiceLink')).replace(/^[-–—]+$/, ''),
      category: text('category').replace(/\s+/g, ' '),
      otherCharges: other.value,
      amount: amount.value,
      total: total.value,
      project: text('project'),
      paidBy: text('paidBy'),
      receipt: linkOf(raw('receipt')).replace(/^[-–—]+$/, ''),
      mode: text('mode'),
      account: cleanAccount(text('account')),
      billNo: text('billNo'),
      errors,
    });
    if (rows.length > MAX_ROWS) return { ok: false, message: `Import at most ${MAX_ROWS} rows at a time.` };
  }
  return { ok: true, rows };
}

export async function buildPurchaseSample(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Purchases');
  sheet.addRow([...PURCHASE_IMPORT_HEADERS]);
  sheet.getRow(1).font = { bold: true };
  sheet.addRow([1, '23-Oct-26', 'Porter for stamp from office to Makarba', 'Porter', 'Your Company Pvt Ltd', 'https://drive.google.com/your-invoice', 'Porter/Courier', '-', 91, 91, 'Smart Parking', 'Pareshbhai', '-', '', 'Done', '23-Oct-26', '', 'Bank Transfer', 'HDFC 8436']);
  sheet.addRow([2, '23-Oct-26', 'MS Brackets with Screw for Aluminium Enclosure - 15 Set', 'WELL CONTACTS CO', 'Your Company Pvt Ltd', 'https://drive.google.com/your-invoice', 'Consumable', 350, 1575, 2272, 'Railway Underpass', 'Hemdeep', 'https://drive.google.com/your-receipt', 'Done', 'Done', '24-Oct-26', '', 'Credit Card', '1234 5678 9012 3456']);
  sheet.columns.forEach((column) => {
    column.width = 20;
  });

  const notes = workbook.addWorksheet('Instructions');
  for (const line of [
    'One row per bill already paid. Each row becomes an approved purchase bill, paid on its Date from the card or account given.',
    'Supplier: matched by name; a supplier not found is added to Vendors (in the Company\'s state, so GST is CGST + SGST).',
    'Company: the legal entity, as named in Legal Entities. Project: optional; blank is company overhead.',
    'Category: an expense category from Masters, matched ignoring case and spaces; one not found is added to Masters; blank uses Office / Administrative.',
    'Amount is before GST; Other Charges (blank or - for none) are added to it; Amount With GST is the total paid. GST is the difference.',
    'Payment Mode: Bank Transfer (NEFT, RTGS, IMPS), UPI, Cheque, Cash, Debit Card or Credit Card. Card/Account no: the bank account number (last four digits) or name, or the card number (its last four digits are matched). Spaces in a number are ignored.',
    'GST is CGST + SGST when the supplier is in the Company\'s state (a new supplier is), else IGST; the preview lets you switch any row.',
    'Invoice Link and Payment Receipt are kept on the bill. Paid by is added to the bill\'s details. Material Inward and Reimbursement columns are not imported.',
    'A row with an error shows it in the preview; nothing is imported until every row is clear.',
  ]) notes.addRow([line]);
  notes.getColumn(1).width = 130;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
