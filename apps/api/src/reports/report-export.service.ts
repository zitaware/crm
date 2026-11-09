import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { formatDisplayDate } from '../common/display-date.util';

export type ReportColumnKind = 'text' | 'money' | 'number' | 'date';

export interface ReportColumn {
  key: string;
  label: string;
  kind: ReportColumnKind;
}

export interface ReportSection {
  title: string;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  /** Values for a closing total row, keyed by column. */
  totals?: Record<string, string | null> | undefined;
}

/** A report ready to print: the same figures the screen shows, already computed. */
export interface ReportDocument {
  title: string;
  subtitle: string;
  details: string[];
  sections: ReportSection[];
}

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Indian digit grouping (12,34,567.89) for printed amounts. */
export function formatInr(value: string): string {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = '00'] = value.replace('-', '').split('.');
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${rest ? `${rest},${lastThree}` : lastThree}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

function sheetName(title: string, index: number): string {
  // Excel forbids : \ / ? * [ ] and caps names at 31 characters.
  const cleaned = title.replace(/[:\\/?*[\]]/g, ' ').slice(0, 28).trim();
  return cleaned || `Sheet ${index + 1}`;
}

/**
 * Renders a computed report to Excel or PDF (ADR-108). It formats; it never
 * calculates. Every figure arrives as the decimal string the screen shows, so
 * an export cannot disagree with the screen or the ledger comparison.
 */
@Injectable()
export class ReportExportService {
  async toXlsx(doc: ReportDocument): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Zitaware CRM';
    doc.sections.forEach((section, index) => {
      const sheet = workbook.addWorksheet(sheetName(section.title, index));
      sheet.addRow([doc.title]).font = { bold: true, size: 14 };
      sheet.addRow([doc.subtitle]);
      for (const line of doc.details) sheet.addRow([line]);
      sheet.addRow([]);
      sheet.addRow([section.title]).font = { bold: true, size: 12 };
      sheet.addRow(section.columns.map((c) => c.label)).font = { bold: true };

      // Amounts become numeric cells so they sum in Excel; the value is the
      // two-decimal string the report computed, not a recalculation.
      const cell = (column: ReportColumn, value: string | number | null | undefined) => {
        if (value === null || value === undefined || value === '') return null;
        if (column.kind === 'date') return formatDisplayDate(String(value));
        return column.kind === 'money' || column.kind === 'number' ? Number(value) : value;
      };
      for (const row of section.rows) sheet.addRow(section.columns.map((c) => cell(c, row[c.key])));
      if (section.totals) {
        const totals = section.totals;
        sheet.addRow(section.columns.map((c, i) => (totals[c.key] !== undefined ? cell(c, totals[c.key]) : i === 0 ? 'Total' : null))).font = { bold: true };
      }
      section.columns.forEach((c, i) => {
        const column = sheet.getColumn(i + 1);
        column.width = c.kind === 'text' ? 30 : 16;
        if (c.kind === 'money') column.numFmt = '#,##0.00';
      });
    });
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  toPdf(doc: ReportDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const pdf = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
      const chunks: Buffer[] = [];
      pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);

      const left = pdf.page.margins.left;
      const width = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
      const bottom = () => pdf.page.height - pdf.page.margins.bottom;
      const rowHeight = 15;

      pdf.font('Helvetica-Bold').fontSize(15).fillColor('#000').text(doc.title, left, pdf.y);
      pdf.font('Helvetica').fontSize(9).fillColor('#444').text(doc.subtitle);
      for (const line of doc.details) pdf.text(line);
      pdf.fillColor('#000');

      for (const section of doc.sections) {
        const units = section.columns.map((c) => (c.kind === 'text' ? 2 : 1));
        const unitWidth = width / units.reduce((a, b) => a + b, 0);
        const widths = units.map((u) => u * unitWidth);
        const drawRow = (cells: string[], bold: boolean) => {
          if (pdf.y + rowHeight > bottom()) pdf.addPage();
          const y = pdf.y;
          let x = left;
          pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5);
          cells.forEach((text, i) => {
            const column = section.columns[i]!;
            const align = column.kind === 'text' ? 'left' : 'right';
            pdf.text(text, x + 2, y + 3, { width: widths[i]! - 4, align, lineBreak: false, ellipsis: true });
            x += widths[i]!;
          });
          pdf.moveTo(left, y + rowHeight).lineTo(left + width, y + rowHeight).lineWidth(0.3).strokeColor('#ccc').stroke();
          pdf.x = left;
          pdf.y = y + rowHeight;
        };
        const display = (column: ReportColumn, value: string | number | null | undefined): string => {
          if (value === null || value === undefined) return '';
          if (column.kind === 'date') return formatDisplayDate(String(value));
          return column.kind === 'money' ? formatInr(String(value)) : String(value);
        };

        pdf.moveDown(1);
        if (pdf.y + rowHeight * 3 > bottom()) pdf.addPage();
        pdf.font('Helvetica-Bold').fontSize(11).text(section.title, left, pdf.y);
        pdf.moveDown(0.3);
        drawRow(section.columns.map((c) => c.label), true);
        for (const row of section.rows) drawRow(section.columns.map((c) => display(c, row[c.key])), false);
        if (section.totals) {
          const totals = section.totals;
          drawRow(section.columns.map((c, i) => (totals[c.key] !== undefined ? display(c, totals[c.key]) : i === 0 ? 'Total' : '')), true);
        }
      }
      pdf.end();
    });
  }
}
