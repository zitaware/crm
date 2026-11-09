import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { ReportExportService, formatInr, type ReportDocument } from './report-export.service';

const doc: ReportDocument = {
  title: 'Receivable Aging',
  subtitle: 'Accrual basis — test',
  details: ['As of: 2026-08-31', 'Currency: INR'],
  sections: [
    {
      title: 'Invoices',
      columns: [
        { key: 'invoiceNumber', label: 'Invoice', kind: 'text' },
        { key: 'daysPastDue', label: 'Days past due', kind: 'number' },
        { key: 'outstandingAmount', label: 'Outstanding', kind: 'money' },
      ],
      rows: [
        { invoiceNumber: 'INV-0001', daysPastDue: 34, outstandingAmount: '20209.86' },
        { invoiceNumber: 'INV-0002', daysPastDue: -30, outstandingAmount: '16388.88' },
      ],
      totals: { outstandingAmount: '36598.74' },
    },
  ],
};

describe('formatInr', () => {
  it('groups digits the Indian way and keeps two decimals', () => {
    expect(formatInr('453598.74')).toBe('4,53,598.74');
    expect(formatInr('12345678.9')).toBe('1,23,45,678.90');
    expect(formatInr('-2450.00')).toBe('-2,450.00');
    expect(formatInr('0.00')).toBe('0.00');
  });
});

describe('ReportExportService', () => {
  const exporter = new ReportExportService();

  it('writes an Excel workbook with the header, rows as numbers and a total row', async () => {
    const buffer = await exporter.toXlsx(doc);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('Invoices')!;
    // exceljs leaves an empty cell as a hole in the row array; Array.from turns holes into null.
    const values = sheet.getSheetValues().filter(Boolean).map((row) => Array.from((row as unknown[]).slice(1), (v) => v ?? null));

    expect(values[0]).toEqual(['Receivable Aging']);
    expect(values).toContainEqual(['Invoice', 'Days past due', 'Outstanding']);
    expect(values).toContainEqual(['INV-0001', 34, 20209.86]);
    expect(values).toContainEqual(['Total', null, 36598.74]);
    expect(sheet.getColumn(3).numFmt).toBe('#,##0.00');
  });

  it('writes a PDF document', async () => {
    const buffer = await exporter.toPdf(doc);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
