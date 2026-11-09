import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { PURCHASE_IMPORT_HEADERS, buildPurchaseSample, parsePurchaseWorkbook, purchaseColumnOf, readSheetDate } from './purchase-import';
import { cleanAccount } from '../direct-expenses/server-subscription-import';

/** The team's own register headers, plus the two payment columns. */
const TEAM_HEADERS = [
  'No', 'Date', 'Details', 'Supplier', 'Company', 'Invoice Link', 'Category', 'Other Charges', 'Amount', 'Amount With GST', 'Project', 'Paid by',
  'Payment Receipt', 'Material Inward', 'Reimbursement Status', 'Reimbursement Date', 'status', 'Payment Mode', 'Card/Account no',
];

async function sheet(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(TEAM_HEADERS);
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('purchase register reader (ADR-178)', () => {
  it('reads the team register headers, ignoring the columns not imported', () => {
    expect(TEAM_HEADERS.map(purchaseColumnOf)).toEqual([
      null, 'date', 'details', 'supplier', 'company', 'invoiceLink', 'category', 'otherCharges', 'amount', 'total', 'project', 'paidBy',
      'receipt', null, null, null, null, 'mode', 'account',
    ]);
    expect(PURCHASE_IMPORT_HEADERS.map(purchaseColumnOf).filter(Boolean)).toHaveLength(14);
  });

  it('reads the sheet dates as written', () => {
    expect(['13-Nov-24', '1-Jan-25', '04-Jan-25', '23-Oct-26', '23/10/2026', '31-Feb-25', 'Oct 23'].map(readSheetDate)).toEqual([
      '2024-11-13', '2025-01-01', '2025-01-04', '2026-10-23', '2026-10-23', null, null,
    ]);
  });

  it('reads rows like the register: commas, "-" for none, other charges, multi-line details', async () => {
    const parsed = await parsePurchaseWorkbook(
      await sheet([
        ['', '23-Oct-26', 'Porter for stamp from office to Makarba Pareshbhai', 'Porter', 'ZITAWARE SOLUTIONS PRIVATE LIMITED', 'https://drive.google.com/x', 'Porter/Courier', '-', '91', '91', 'Smart Parking', 'HDFC-8436 - Zitaware solution Pvt ltd.', '-', 'Done', 'Credited', '', '', 'Bank Transfer', 'HDFC 8436'],
        ['', '23-Oct-26', 'MS Brackets with Screw\nfor Aluminium Enclosure- 15 Set', 'WELL CONTACTS CO', 'NINJA TECH.', 'https://drive.google.com/y', 'GST', '350', '1,575', '2,272', 'Railway Underpass', 'Hemdeep', 'https://drive.google.com/z', 'Done', 'Credited', '', '', 'NEFT', '0595'],
        ['', '23-Oct-26', 'No payment columns', 'Porter', 'Co', '', '', '', '100', '90', '', '', '', '', '', '', '', '', ''],
      ]),
    );
    if (!parsed.ok) throw new Error(parsed.message);
    const [porter, brackets, broken] = parsed.rows;
    expect([porter!.date, porter!.otherCharges.toString(), porter!.amount?.toString(), porter!.total?.toString(), porter!.receipt, porter!.errors]).toEqual(['2026-10-23', '0', '91', '91', '', []]);
    expect([brackets!.details, brackets!.otherCharges.toString(), brackets!.amount?.toString(), brackets!.total?.toString(), brackets!.mode, brackets!.errors]).toEqual([
      'MS Brackets with Screw\nfor Aluminium Enclosure- 15 Set', '350', '1575', '2272', 'NEFT', [],
    ]);
    expect(broken!.errors).toEqual([
      'Payment Mode is required.',
      'Card/Account no is required: the card or bank account it was paid from.',
      'Amount With GST 90.00 is less than Amount + Other Charges (100.00).',
    ]);
  });

  it('drops the spaces inside a card or account number, keeps an account name readable, and tidies the category', async () => {
    expect(['1234 55555 5555 555', ' 4321-8765-0000-1111 ', 'HDFC  8436', 'HDFC 8436'].map(cleanAccount)).toEqual(['1234555555555555', '4321876500001111', 'HDFC 8436', 'HDFC 8436']);
    const parsed = await parsePurchaseWorkbook(
      await sheet([['', '23-Oct-26', 'Cable', 'Porter', 'Co', '', '  porter /  COURIER ', '', '100', '118', '', '', '', '', '', '', '', 'Credit Card', '1234 55555 5555 555']]),
    );
    if (!parsed.ok) throw new Error(parsed.message);
    expect([parsed.rows[0]!.category, parsed.rows[0]!.account]).toEqual(['porter / COURIER', '1234555555555555']);
  });

  it('reads its own sample', async () => {
    const parsed = await parsePurchaseWorkbook(await buildPurchaseSample());
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.rows.map((r) => [r.supplier, r.date, r.errors])).toEqual([
      ['Porter', '2026-10-23', []],
      ['WELL CONTACTS CO', '2026-10-23', []],
    ]);
  });
});
