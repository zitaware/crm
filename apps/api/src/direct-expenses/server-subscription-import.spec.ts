import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { columnOf, parseServerSubscriptionWorkbook, readAmount, readDate, readGstType, readSpendType, SERVER_SUBSCRIPTION_HEADERS } from './server-subscription-import';

async function workbook(headers: readonly string[], rows: Array<Array<string | number | Date | null>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow([...headers]);
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('Server & Subscription sheet reader (ADR-169)', () => {
  it('reads the headers as typed in the team sheet', () => {
    const typed = ['Sr.no', 'Employe Name', 'Subscibtion Name', 'Basic Amount', 'GST Amount', 'Total Paid', 'Date', 'Project Name', 'Server /Subscriptio', 'Payment Mode', 'Card/Account no', 'Legal Entity'];
    expect(typed.map(columnOf)).toEqual([null, 'employee', 'title', 'basic', 'gst', 'total', 'date', 'project', 'spendType', 'paymentMode', 'account', 'legalEntity']);
    expect(SERVER_SUBSCRIPTION_HEADERS.map(columnOf)).toEqual([null, 'employee', 'title', 'basic', 'gst', 'total', 'date', 'project', 'spendType', 'paymentMode', 'account', 'legalEntity', 'billLink']);
    expect(['Total Amount', 'GST Type', 'Expense Category', 'Reference', 'Bill URL'].map(columnOf)).toEqual(['total', 'gstType', 'category', 'reference', 'billLink']);
  });

  it('ignores currency signs and separators in amounts', () => {
    expect(['₹3,500.00', '$20', 'Rs 630', 4130, '  1,00,000.50 '].map((v) => readAmount(v, 'Amount').value?.toFixed(2))).toEqual(['3500.00', '20.00', '630.00', '4130.00', '100000.50']);
    expect(readAmount('twenty', 'Basic Amount').error).toBe('Basic Amount "twenty" is not a number.');
    expect(readAmount(null, 'GST Amount')).toEqual({ value: null, error: null });
  });

  it('reads DD/MM/YYYY, YYYY-MM-DD and real date cells', () => {
    expect([readDate('29/10/2026'), readDate('1/9/2026'), readDate('2026-10-27'), readDate(new Date(Date.UTC(2026, 9, 27))), readDate('31/02/2026'), readDate('Oct 29')]).toEqual([
      '2026-10-29',
      '2026-09-01',
      '2026-10-27',
      '2026-10-27',
      null,
      null,
    ]);
  });

  it('reads the server/subscription and GST type words', () => {
    expect(['Server', 'servers', 'Subscription', 'Subscribtion', 'Hardware'].map(readSpendType)).toEqual(['SERVER', 'SERVER', 'SUBSCRIPTION', 'SUBSCRIPTION', null]);
    expect(['IGST', 'CGST+SGST', 'intra-state', ''].map((t) => readGstType(t).value)).toEqual(['INTERSTATE', 'INTRASTATE', 'INTRASTATE', null]);
  });

  it('checks Total Paid and skips empty rows', async () => {
    const buffer = await workbook(SERVER_SUBSCRIPTION_HEADERS, [
      [1, 'Rushik Shah', 'Signature renewal', '₹3,500.00', 630, '₹4,130.00', '29/10/2026', '', 'Subscription', 'Credit Card', '4421 4500 0109 7823', 'Co'],
      [2, null, null, null, null, null, null, null, null, null, null, null],
      [3, 'Jay', 'Editor', 1900, 0, 2000, '27/10/2026', '', 'Subscription', 'Credit Card', '7823', 'Co'],
    ]);
    const parsed = await parseServerSubscriptionWorkbook(buffer);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.rows.map((r) => [r.rowNumber, r.basic?.toFixed(2), r.errors])).toEqual([
      [2, '3500.00', []],
      [4, '1900.00', ['Total Paid 2000.00 is not Basic + GST (1900.00).']],
    ]);
  });

  it('refuses an old sheet that still has an INR Rate column, so a foreign amount is not taken as rupees', async () => {
    const old = ['Sr.no', 'Employee Name', 'Subscription Name', 'Basic Amount', 'GST Amount', 'Total Paid', 'Date', 'INR Rate', 'Project Name', 'Server/Subscription', 'Payment Mode', 'Card/Account no', 'Legal Entity'];
    const parsed = await parseServerSubscriptionWorkbook(await workbook(old, [[1, 'Jay', 'Editor', 20, 0, 20, '27/10/2026', 95, '', 'Subscription', 'Credit Card', '7823', 'Co']]));
    expect(parsed.ok ? '' : parsed.message).toBe('INR Rate is no longer used. Remove that column and enter every amount in rupees.');
  });

  it('reads Bill Link from typed text or a hyperlink cell, and rejects anything that is not a web address', async () => {
    const base = [1, 'Rushik Shah', 'Renewal', 3500, 630, 4130, '29/10/2026', '', 'Subscription', 'Credit Card', '7823', 'Co'];
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow([...SERVER_SUBSCRIPTION_HEADERS]);
    ws.addRow([...base, 'https://drive.google.com/file/abc']);
    ws.addRow([...base, null]).getCell(13).value = { text: 'Invoice', hyperlink: 'https://portal.example.com/inv/9' };
    ws.addRow([...base, 'drive folder']);
    ws.addRow([...base, null]);
    const parsed = await parseServerSubscriptionWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.rows.map((r) => [r.billLink, r.errors])).toEqual([
      ['https://drive.google.com/file/abc', []],
      ['https://portal.example.com/inv/9', []],
      ['drive folder', ['Bill Link "drive folder" must be a web address starting with https://.']],
      ['', []],
    ]);
  });

  it('names the missing columns', async () => {
    const parsed = await parseServerSubscriptionWorkbook(await workbook(['Employee Name', 'Basic Amount'], []));
    expect(parsed.ok ? '' : parsed.message).toContain('Missing: Subscription Name, Date, Server/Subscription, Payment Mode, Card/Account no, Legal Entity.');
  });
});
