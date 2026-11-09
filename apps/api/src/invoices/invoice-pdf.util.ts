import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { formatDisplayDate } from '../common/display-date.util';

const LOGO_PATH = join(__dirname, '../assets/logo.png');
const RED = '#c00000';
const GRAY = '#d9d9d9';
const INK = '#111111';

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function drawImage(doc: PDFKit.PDFDocument, image: Buffer, x: number, y: number, fit: [number, number]): boolean {
  try {
    doc.image(image, x, y, { fit, align: 'center', valign: 'center' });
    return true;
  } catch {
    return false;
  }
}

export interface InvoicePdfLine {
  description: string;
  hsnSac: string | null;
  quantity: string;
  unitPrice: string;
  taxableAmount: string;
  gstRatePercent: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  lineTotal: string;
}

export interface InvoicePdfData {
  documentTitle: string;
  invoiceNumber: string | null;
  proformaNumber: string | null;
  status: string;
  invoiceDate: string | null;
  dueDate: string | null;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
  sellerLegalName: string;
  sellerPan: string | null;
  sellerGstin: string | null;
  sellerState: string | null;
  sellerStateCode?: string | null | undefined;
  sellerAddress: string | null;
  buyerName: string;
  buyerGstin: string | null;
  buyerState: string | null;
  buyerStateCode?: string | null | undefined;
  buyerAddress: string | null;
  placeOfSupply?: string | null | undefined;
  jurisdiction?: string | null | undefined;
  projectName?: string | null | undefined;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  totalAmount: string;
  narrative: string | null;
  lines: InvoicePdfLine[];
  logo?: Buffer | null | undefined;
  seal?: Buffer | null | undefined;
  authorizedSign?: Buffer | null | undefined;
  bankName?: string | null | undefined;
  bankAccountName?: string | null | undefined;
  bankAccountNumber?: string | null | undefined;
  bankIfsc?: string | null | undefined;
}

function money(value: string): Prisma.Decimal {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '.') return new Prisma.Decimal(0);
  return new Prisma.Decimal(trimmed);
}

/** Indian grouping. Zero prints as 0.00. */
export function formatInr(value: string): string {
  const amount = money(value).toFixed(2);
  const negative = amount.startsWith('-');
  const [wholeRaw, frac] = amount.replace('-', '').split('.');
  const whole = wholeRaw ?? '0';
  if (whole === '0' && frac === '00') return '0.00';
  let grouped = whole;
  if (whole.length > 3) {
    const head = whole.slice(0, whole.length - 3);
    const tail = whole.slice(-3);
    const parts: string[] = [];
    for (let i = head.length; i > 0; i -= 2) parts.unshift(head.slice(Math.max(0, i - 2), i));
    grouped = `${parts.join(',')},${tail}`;
  }
  return `${negative ? '-' : ''}${grouped}.${frac ?? '00'}`;
}

function belowThousand(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  if (n < 100) {
    const ten = Math.floor(n / 10);
    const one = n % 10;
    return `${TENS[ten] ?? ''}${one ? ` ${ONES[one]}` : ''}`.trim();
  }
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  return `${ONES[hundred]} Hundred${rest ? ` ${belowThousand(rest)}` : ''}`;
}

function integerWords(value: bigint): string {
  if (value === BigInt(0)) return 'Zero';
  const crore = BigInt(10000000);
  const lakh = BigInt(100000);
  const thousand = BigInt(1000);
  const parts: string[] = [];
  const crores = value / crore;
  let rest = value % crore;
  if (crores > BigInt(0)) parts.push(`${integerWords(crores)} Crore`);
  const lakhs = rest / lakh;
  rest %= lakh;
  if (lakhs > BigInt(0)) parts.push(`${belowThousand(Number(lakhs))} Lakh`);
  const thousands = rest / thousand;
  rest %= thousand;
  if (thousands > BigInt(0)) parts.push(`${belowThousand(Number(thousands))} Thousand`);
  if (rest > BigInt(0)) parts.push(belowThousand(Number(rest)));
  return parts.join(' ');
}

/** Whole rupees and paise, from the decimal string. Never uses a binary float. */
export function amountInWords(value: string): string {
  const fixed = money(value).toFixed(2);
  const negative = fixed.startsWith('-');
  const [rupeeText, paiseText] = fixed.replace('-', '').split('.');
  const rupees = BigInt(rupeeText || '0');
  const paise = BigInt(paiseText || '0');
  if (rupees === BigInt(0) && paise === BigInt(0)) return 'Rupees Zero Only';
  const rupeeWords = integerWords(rupees);
  const paiseWords = paise === BigInt(0) ? '' : ` and ${integerWords(paise)} Paise`;
  return `${negative ? 'Minus ' : ''}Rupees ${rupeeWords}${paiseWords} Only`;
}

function formatInvoiceDate(iso: string | null): string {
  if (!iso) return '';
  return formatDisplayDate(iso);
}

function sameStateSupply(data: InvoicePdfData): boolean {
  const igst = money(data.igstAmount);
  const local = money(data.cgstAmount).plus(data.sgstAmount);
  if (igst.gt(0) && local.isZero()) return false;
  if (local.gt(0)) return true;
  const lineIgst = data.lines.some((line) => money(line.igstAmount).gt(0));
  const lineLocal = data.lines.some((line) => money(line.cgstAmount).gt(0) || money(line.sgstAmount).gt(0));
  if (lineIgst && !lineLocal) return false;
  if (lineLocal) return true;
  const seller = (data.sellerState ?? '').trim().toLowerCase();
  const buyer = (data.buyerState ?? '').trim().toLowerCase();
  if (seller && buyer) return seller === buyer;
  return true;
}

function rateTriple(gstRate: string, intra: boolean): { cgst: string; sgst: string; igst: string } {
  const rate = money(gstRate).toDecimalPlaces(2);
  if (!intra) return { cgst: '0.00', sgst: '0.00', igst: rate.times(2).toFixed(2) };
  const printed = rate.toFixed(2);
  return { cgst: printed, sgst: printed, igst: '0.00' };
}

function lineGross(line: InvoicePdfLine): string {
  return money(line.quantity).mul(line.unitPrice).toDecimalPlaces(2).toFixed(2);
}

interface Cursor {
  doc: PDFKit.PDFDocument;
  left: number;
  width: number;
  bottom: number;
  y: number;
}

function strokeBox(cursor: Cursor, x: number, y: number, w: number, h: number, fill?: string) {
  const { doc } = cursor;
  if (fill) {
    doc.save();
    doc.rect(x, y, w, h).fill(fill);
    doc.restore();
  }
  doc.lineWidth(0.4).strokeColor(INK).rect(x, y, w, h).stroke();
}

function paintText(
  cursor: Cursor,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  options: { align?: 'left' | 'center' | 'right'; bold?: boolean; size?: number; color?: string },
) {
  const { doc } = cursor;
  const size = options.size ?? 7;
  doc.fillColor(options.color ?? INK).font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
  const pad = 2;
  const inner = Math.max(4, w - pad * 2);
  const textHeight = doc.heightOfString(text || ' ', { width: inner });
  const top = y + Math.max(1, (h - Math.min(textHeight, h - 2)) / 2);
  doc.text(text, x + pad, top, { width: inner, height: Math.max(4, h - 2), align: options.align ?? 'left', lineGap: 0 });
}

function workHeading(data: InvoicePdfData): string {
  const narrative = data.narrative?.trim();
  if (narrative) return narrative;
  const project = data.projectName?.trim() || '';
  if (data.servicePeriodStart && data.servicePeriodEnd) {
    const period = `For ${formatDisplayDate(data.servicePeriodStart)} to ${formatDisplayDate(data.servicePeriodEnd)}`;
    return project ? `${project} ${period}` : period;
  }
  return project;
}

const COLUMNS: Array<{ key: string; label: string; width: number; align: 'left' | 'center' | 'right'; span?: boolean }> = [
  { key: 'sno', label: 'S. No.', width: 20, align: 'center', span: true },
  { key: 'desc', label: 'Product Description', width: 0, align: 'left', span: true },
  { key: 'sac', label: 'SAC code', width: 34, align: 'center', span: true },
  { key: 'amount', label: 'Amount', width: 38, align: 'right', span: true },
  { key: 'discount', label: 'Discount', width: 34, align: 'right', span: true },
  { key: 'taxable', label: 'Taxable Value', width: 42, align: 'right', span: true },
  { key: 'cgstRate', label: 'Rate', width: 24, align: 'right' },
  { key: 'cgstAmt', label: 'Amount', width: 30, align: 'right' },
  { key: 'sgstRate', label: 'Rate', width: 24, align: 'right' },
  { key: 'sgstAmt', label: 'Amount', width: 30, align: 'right' },
  { key: 'igstRate', label: 'Rate', width: 24, align: 'right' },
  { key: 'igstAmt', label: 'Amount', width: 30, align: 'right' },
  { key: 'cessRate', label: 'Rate', width: 22, align: 'right' },
  { key: 'cessAmt', label: 'Amount', width: 28, align: 'right' },
  { key: 'total', label: 'Total', width: 38, align: 'right', span: true },
];

const TAX_GROUPS = [
  { label: 'CGST', keys: ['cgstRate', 'cgstAmt'] },
  { label: 'SGST', keys: ['sgstRate', 'sgstAmt'] },
  { label: 'IGST', keys: ['igstRate', 'igstAmt'] },
  { label: 'Cess', keys: ['cessRate', 'cessAmt'] },
] as const;

function columnLayout(width: number) {
  const fixed = COLUMNS.reduce((sum, column) => sum + column.width, 0);
  return COLUMNS.map((column) => (column.key === 'desc' ? { ...column, width: Math.max(70, width - fixed) } : column));
}

function tableHeader(cursor: Cursor, columns: ReturnType<typeof columnLayout>): number {
  const top = 11;
  const sub = 11;
  const grouped = new Set<string>(TAX_GROUPS.flatMap((group) => [...group.keys]));
  let x = cursor.left;
  for (const column of columns) {
    const group = TAX_GROUPS.find((item) => item.keys[0] === column.key);
    if (group) {
      const width = group.keys.reduce((sum, key) => sum + (columns.find((item) => item.key === key)?.width ?? 0), 0);
      strokeBox(cursor, x, cursor.y, width, top, GRAY);
      paintText(cursor, group.label, x, cursor.y, width, top, { align: 'center', bold: true, size: 6 });
      let subX = x;
      for (const key of group.keys) {
        const subColumn = columns.find((item) => item.key === key);
        if (!subColumn) continue;
        strokeBox(cursor, subX, cursor.y + top, subColumn.width, sub, GRAY);
        paintText(cursor, subColumn.label, subX, cursor.y + top, subColumn.width, sub, { align: 'center', bold: true, size: 5.5 });
        subX += subColumn.width;
      }
      x += width;
      continue;
    }
    if (grouped.has(column.key)) continue;
    strokeBox(cursor, x, cursor.y, column.width, top + sub, GRAY);
    paintText(cursor, column.label, x, cursor.y, column.width, top + sub, { align: 'center', bold: true, size: 5.5 });
    x += column.width;
  }
  cursor.y += top + sub;
  return top + sub;
}

function lineCells(line: InvoicePdfLine, index: number, intra: boolean): Record<string, string> {
  const rates = rateTriple(line.gstRatePercent, intra);
  return {
    sno: String(index + 1),
    desc: line.description,
    sac: line.hsnSac ?? '',
    amount: formatInr(lineGross(line)),
    discount: '0.00',
    taxable: formatInr(line.taxableAmount),
    cgstRate: formatInr(rates.cgst),
    cgstAmt: formatInr(line.cgstAmount),
    sgstRate: formatInr(rates.sgst),
    sgstAmt: formatInr(line.sgstAmount),
    igstRate: formatInr(rates.igst),
    igstAmt: formatInr(line.igstAmount),
    cessRate: '0.00',
    cessAmt: '0.00',
    total: formatInr(line.lineTotal),
  };
}

function rowHeight(cursor: Cursor, description: string, descWidth: number): number {
  cursor.doc.font('Helvetica').fontSize(6);
  const textHeight = cursor.doc.heightOfString(description || ' ', { width: Math.max(8, descWidth - 4) });
  return Math.max(12, Math.min(textHeight + 4, 42));
}

/**
 * Bordered GST tax invoice. Regenerated from stored invoice data (ADR-068).
 * Status, due date, and PAN are not printed.
 */
export function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 14 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const cursor: Cursor = {
      doc,
      left: doc.page.margins.left,
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      bottom: doc.page.height - doc.page.margins.bottom,
      y: doc.page.margins.top,
    };
    const columns = columnLayout(cursor.width);
    const descWidth = columns.find((column) => column.key === 'desc')?.width ?? 80;

    const newPage = () => {
      doc.addPage();
      cursor.y = doc.page.margins.top;
    };
    const ensure = (height: number) => {
      if (cursor.y + height > cursor.bottom) newPage();
    };

    const address = data.sellerAddress?.trim() || '';
    const logoW = 118;
    const titleH = 16;
    const nameH = 22;
    doc.font('Helvetica').fontSize(7);
    const addressH = Math.max(14, address ? doc.heightOfString(address, { width: cursor.width - logoW - 8 }) + 4 : 14);
    const logoH = titleH + nameH + addressH;
    strokeBox(cursor, cursor.left, cursor.y, logoW, logoH);
    const logoBox = { x: cursor.left + 4, y: cursor.y + 4, fit: [logoW - 8, logoH - 8] as [number, number] };
    const drewLogo = !!data.logo && data.logo.length > 0 && drawImage(doc, data.logo, logoBox.x, logoBox.y, logoBox.fit);
    if (!drewLogo) {
      try {
        doc.image(LOGO_PATH, logoBox.x, logoBox.y, { fit: logoBox.fit, align: 'center', valign: 'center' });
      } catch {
        // A missing fallback logo leaves the box empty.
      }
    }
    const rightX = cursor.left + logoW;
    const rightWHeader = cursor.width - logoW;
    strokeBox(cursor, rightX, cursor.y, rightWHeader, titleH, GRAY);
    paintText(cursor, data.documentTitle, rightX, cursor.y, rightWHeader, titleH, { align: 'center', bold: true, size: 9 });
    strokeBox(cursor, rightX, cursor.y + titleH, rightWHeader, nameH);
    paintText(cursor, data.sellerLegalName, rightX, cursor.y + titleH, rightWHeader, nameH, {
      align: 'center',
      bold: true,
      size: 12,
      color: RED,
    });
    strokeBox(cursor, rightX, cursor.y + titleH + nameH, rightWHeader, addressH);
    paintText(cursor, address, rightX, cursor.y + titleH + nameH, rightWHeader, addressH, { align: 'center', size: 7 });
    cursor.y += logoH;

    const invoiceNo = data.invoiceNumber ?? data.proformaNumber ?? 'DRAFT';
    const sellerCode = data.sellerStateCode ?? '';
    const buyerCode = data.buyerStateCode ?? (data.buyerGstin ? data.buyerGstin.slice(0, 2) : '');
    const place = data.placeOfSupply ?? data.sellerState ?? '';
    const rightW = 214;
    const leftW = cursor.width - rightW;
    const rowH = 13;
    const codeValueW = 36;
    const codeLabelW = 32;
    const valueX = cursor.left + leftW - codeValueW;
    strokeBox(cursor, cursor.left, cursor.y, leftW, rowH);
    paintText(cursor, `Invoice No: ${invoiceNo}`, cursor.left, cursor.y, leftW, rowH, { size: 7, bold: true });
    strokeBox(cursor, cursor.left, cursor.y + rowH, leftW, rowH);
    paintText(cursor, `Invoice date: ${formatInvoiceDate(data.invoiceDate)}`, cursor.left, cursor.y + rowH, leftW, rowH, { size: 7 });
    strokeBox(cursor, cursor.left + leftW, cursor.y, rightW, rowH * 2);
    paintText(cursor, 'Original For Recipient / Duplicate For Supplier', cursor.left + leftW, cursor.y, rightW, rowH * 2, { align: 'center', bold: true, size: 7 });
    cursor.y += rowH * 2;

    strokeBox(cursor, cursor.left, cursor.y, leftW - codeValueW, rowH);
    paintText(cursor, 'Reverse Charge (Y/N):', cursor.left, cursor.y, leftW - codeValueW, rowH, { size: 7 });
    strokeBox(cursor, valueX, cursor.y, codeValueW, rowH);
    paintText(cursor, 'N', valueX, cursor.y, codeValueW, rowH, { align: 'center', bold: true, size: 7 });
    strokeBox(cursor, cursor.left + leftW, cursor.y, rightW, rowH);
    paintText(cursor, `GSTIN of Supplier : ${data.sellerGstin ?? ''}`, cursor.left + leftW, cursor.y, rightW, rowH, { size: 6.5 });
    cursor.y += rowH;

    const stateW = leftW - codeLabelW - codeValueW;
    strokeBox(cursor, cursor.left, cursor.y, stateW, rowH);
    paintText(cursor, `State: ${data.sellerState ?? ''}`, cursor.left, cursor.y, stateW, rowH, { size: 7 });
    strokeBox(cursor, valueX - codeLabelW, cursor.y, codeLabelW, rowH, GRAY);
    paintText(cursor, 'Code', valueX - codeLabelW, cursor.y, codeLabelW, rowH, { align: 'center', bold: true, size: 6.5 });
    strokeBox(cursor, valueX, cursor.y, codeValueW, rowH);
    paintText(cursor, sellerCode, valueX, cursor.y, codeValueW, rowH, { align: 'center', bold: true, size: 7 });
    strokeBox(cursor, cursor.left + leftW, cursor.y, rightW, rowH);
    paintText(cursor, `Place of Supply : ${place}`, cursor.left + leftW, cursor.y, rightW, rowH, { size: 6.5 });
    cursor.y += rowH;

    const partyH = 14;
    strokeBox(cursor, cursor.left, cursor.y, cursor.width, partyH, GRAY);
    paintText(cursor, 'Bill to Party', cursor.left, cursor.y, cursor.width, partyH, { align: 'center', bold: true, size: 8 });
    cursor.y += partyH;

    const buyerAddress = data.buyerAddress?.trim() || '';
    doc.font('Helvetica').fontSize(7);
    const buyerAddressH = Math.max(13, buyerAddress ? Math.min(36, doc.heightOfString(buyerAddress, { width: cursor.width - 8 }) + 4) : 13);
    const buyerRows: Array<{ text: string; height: number; bold?: boolean }> = [
      { text: `Name: ${data.buyerName}`, height: 13 },
      { text: `Address: ${buyerAddress}`, height: buyerAddressH },
      { text: `GSTIN (Mandatory if Registered) : ${data.buyerGstin ?? ''}`, height: 13, bold: true },
    ];
    for (const row of buyerRows) {
      strokeBox(cursor, cursor.left, cursor.y, cursor.width, row.height);
      paintText(cursor, row.text, cursor.left, cursor.y, cursor.width, row.height, { size: 7, ...(row.bold ? { bold: true } : {}) });
      cursor.y += row.height;
    }
    const stateH = 14;
    const codeW = 70;
    strokeBox(cursor, cursor.left, cursor.y, cursor.width - codeW, stateH);
    paintText(cursor, `State: ${data.buyerState ?? ''}`, cursor.left, cursor.y, cursor.width - codeW, stateH, { size: 7 });
    strokeBox(cursor, cursor.left + cursor.width - codeW, cursor.y, 28, stateH, GRAY);
    paintText(cursor, 'Code', cursor.left + cursor.width - codeW, cursor.y, 28, stateH, { align: 'center', bold: true, size: 6.5 });
    strokeBox(cursor, cursor.left + cursor.width - codeW + 28, cursor.y, codeW - 28, stateH);
    paintText(cursor, buyerCode, cursor.left + cursor.width - codeW + 28, cursor.y, codeW - 28, stateH, { align: 'center', size: 7 });
    cursor.y += stateH;

    const heading = workHeading(data);
    if (heading) {
      doc.font('Helvetica-Bold').fontSize(8);
      const headingH = Math.max(14, doc.heightOfString(heading, { width: cursor.width - 8 }) + 4);
      strokeBox(cursor, cursor.left, cursor.y, cursor.width, headingH);
      paintText(cursor, heading, cursor.left, cursor.y, cursor.width, headingH, { align: 'center', bold: true, size: 8 });
      cursor.y += headingH;
    }

    const drawHeader = () => tableHeader(cursor, columns);
    ensure(20);
    drawHeader();

    const totals = {
      amount: new Prisma.Decimal(0),
      taxable: new Prisma.Decimal(0),
      cgst: new Prisma.Decimal(0),
      sgst: new Prisma.Decimal(0),
      igst: new Prisma.Decimal(0),
      total: new Prisma.Decimal(0),
    };
    const intra = sameStateSupply(data);
    data.lines.forEach((line, index) => {
      const height = rowHeight(cursor, line.description, descWidth);
      if (cursor.y + height > cursor.bottom) {
        newPage();
        drawHeader();
      }
      const cells = lineCells(line, index, intra);
      let x = cursor.left;
      for (const column of columns) {
        strokeBox(cursor, x, cursor.y, column.width, height);
        paintText(cursor, cells[column.key] ?? '', x, cursor.y, column.width, height, { align: column.align, size: 6 });
        x += column.width;
      }
      cursor.y += height;
      totals.amount = totals.amount.plus(lineGross(line));
      totals.taxable = totals.taxable.plus(line.taxableAmount);
      totals.cgst = totals.cgst.plus(line.cgstAmount);
      totals.sgst = totals.sgst.plus(line.sgstAmount);
      totals.igst = totals.igst.plus(line.igstAmount);
      totals.total = totals.total.plus(line.lineTotal);
    });

    const totalCells: Record<string, string> = {
      amount: formatInr(totals.amount.toFixed(2)),
      discount: '0.00',
      taxable: formatInr(totals.taxable.toFixed(2)),
      cgstAmt: formatInr(totals.cgst.toFixed(2)),
      sgstAmt: formatInr(totals.sgst.toFixed(2)),
      igstAmt: formatInr(totals.igst.toFixed(2)),
      cessAmt: '0.00',
      total: formatInr(totals.total.toFixed(2)),
    };
    if (cursor.y + 14 > cursor.bottom) {
      newPage();
      drawHeader();
    }
    {
      const height = 14;
      const merged = columns.filter((column) => column.key === 'sno' || column.key === 'desc' || column.key === 'sac');
      const mergedW = merged.reduce((sum, column) => sum + column.width, 0);
      strokeBox(cursor, cursor.left, cursor.y, mergedW, height, GRAY);
      paintText(cursor, 'Total', cursor.left, cursor.y, mergedW, height, { align: 'center', bold: true, size: 7 });
      let x = cursor.left + mergedW;
      for (const column of columns) {
        if (column.key === 'sno' || column.key === 'desc' || column.key === 'sac') continue;
        strokeBox(cursor, x, cursor.y, column.width, height, GRAY);
        paintText(cursor, totalCells[column.key] ?? '', x, cursor.y, column.width, height, { align: 'right', bold: true, size: 6 });
        x += column.width;
      }
      cursor.y += height;
    }

    const taxTotal = money(data.cgstAmount).plus(data.sgstAmount).plus(data.igstAmount).toFixed(2);
    const summary: Array<[string, string, boolean]> = [
      ['Total Amount before Tax', formatInr(data.taxableAmount), false],
      ['Add: CGST', formatInr(data.cgstAmount), false],
      ['Add: SGST', formatInr(data.sgstAmount), false],
      ['Add: IGST', formatInr(data.igstAmount), false],
      ['Total Tax Amount', formatInr(taxTotal), true],
      ['Total Amount after Tax:', formatInr(data.totalAmount), true],
    ];
    const summaryRow = 13;
    const summaryH = summary.length * summaryRow;
    const bankBody = 14 + 12 * 4 + 14 + 14;
    const signRow = 16;
    const footerH = summaryH + bankBody + signRow;
    if (cursor.y + footerH > cursor.bottom) newPage();

    const wordsW = Math.round(cursor.width * 0.56);
    const taxW = cursor.width - wordsW;
    const valueW = 52;
    strokeBox(cursor, cursor.left, cursor.y, wordsW, summaryRow, GRAY);
    paintText(cursor, 'Total Invoice amount in words', cursor.left, cursor.y, wordsW, summaryRow, { align: 'center', bold: true, size: 7 });
    strokeBox(cursor, cursor.left, cursor.y + summaryRow, wordsW, summaryH - summaryRow);
    paintText(cursor, amountInWords(data.totalAmount), cursor.left, cursor.y + summaryRow, wordsW, summaryH - summaryRow, { size: 8 });
    summary.forEach(([label, value, bold], index) => {
      const rowY = cursor.y + index * summaryRow;
      strokeBox(cursor, cursor.left + wordsW, rowY, taxW - valueW, summaryRow);
      strokeBox(cursor, cursor.left + cursor.width - valueW, rowY, valueW, summaryRow);
      paintText(cursor, label, cursor.left + wordsW, rowY, taxW - valueW, summaryRow, { size: 6.5, bold });
      paintText(cursor, value, cursor.left + cursor.width - valueW, rowY, valueW, summaryRow, { align: 'right', size: 6.5, bold });
    });
    cursor.y += summaryH;

    const chargeX = cursor.left + wordsW;
    const rightCol = taxW;
    const leftCol = Math.round(wordsW * 0.78);
    const midCol = wordsW - leftCol;
    const labelW = 62;
    strokeBox(cursor, cursor.left, cursor.y, leftCol, bankBody);
    strokeBox(cursor, cursor.left + leftCol, cursor.y, midCol, bankBody);
    const labelColW = taxW - valueW;
    const amountX = chargeX + labelColW;
    const chargeRow = 14;
    strokeBox(cursor, chargeX, cursor.y, rightCol, bankBody + signRow);
    strokeBox(cursor, cursor.left, cursor.y, leftCol, 14, GRAY);
    paintText(cursor, 'Bank Details', cursor.left, cursor.y, leftCol, 14, { bold: true, size: 7 });
    strokeBox(cursor, chargeX, cursor.y, labelColW, chargeRow, GRAY);
    paintText(cursor, 'GST on Reverse Charge', chargeX, cursor.y, labelColW, chargeRow, { align: 'left', bold: true, size: 6.5 });
    strokeBox(cursor, amountX, cursor.y, valueW, chargeRow);
    paintText(cursor, formatInr('0.00'), amountX, cursor.y, valueW, chargeRow, { align: 'right', size: 6.5 });
    const bankRows: Array<[string, string]> = [
      ['Bank:', data.bankName ?? ''],
      ['Bank Name:', data.bankAccountName ?? ''],
      ['Bank A/C:', data.bankAccountNumber ?? ''],
      ['IFSC Code:', data.bankIfsc ?? ''],
    ];
    bankRows.forEach(([label, value], index) => {
      const rowY = cursor.y + 14 + index * 12;
      strokeBox(cursor, cursor.left, rowY, labelW, 12);
      strokeBox(cursor, cursor.left + labelW, rowY, leftCol - labelW, 12);
      paintText(cursor, label, cursor.left, rowY, labelW, 12, { bold: true, size: 6.5 });
      paintText(cursor, value, cursor.left + labelW, rowY, leftCol - labelW, 12, { size: 6.5 });
    });
    const termsY = cursor.y + 14 + bankRows.length * 12;
    strokeBox(cursor, cursor.left, termsY, leftCol, 14, GRAY);
    paintText(cursor, 'Terms & conditions', cursor.left, termsY, leftCol, 14, { align: 'center', bold: true, size: 7 });
    const jurisdiction = data.jurisdiction ?? data.sellerState ?? '';
    strokeBox(cursor, cursor.left, termsY + 14, leftCol, 14);
    paintText(cursor, jurisdiction ? `1 Subject to ${jurisdiction} Jurisdiction` : '', cursor.left, termsY + 14, leftCol, 14, { size: 7 });
    const bodyTop = cursor.y + chargeRow;
    const certH = 26;
    const forH = 16;
    strokeBox(cursor, chargeX, bodyTop, rightCol, certH);
    paintText(cursor, 'Certified that the particulars given above are true and correct', chargeX, bodyTop, rightCol, certH, { align: 'center', size: 6.5 });
    strokeBox(cursor, chargeX, bodyTop + certH, rightCol, forH);
    paintText(cursor, `For ${data.sellerLegalName}`, chargeX, bodyTop + certH, rightCol, forH, { align: 'center', bold: true, size: 7 });
    const signImageTop = bodyTop + certH + forH + 2;
    const signImageH = Math.max(16, cursor.y + bankBody - signImageTop - 2);
    cursor.y += bankBody;

    strokeBox(cursor, cursor.left, cursor.y, leftCol + midCol, signRow);
    strokeBox(cursor, cursor.left + leftCol, cursor.y, midCol, signRow);
    strokeBox(cursor, chargeX, cursor.y, rightCol, signRow);
    paintText(cursor, 'Company Seal', cursor.left + leftCol, cursor.y, midCol, signRow, { align: 'center', size: 7 });
    paintText(cursor, 'Authorised signatory', chargeX, cursor.y, rightCol, signRow, { align: 'center', size: 7 });
    if (data.seal && data.seal.length > 0) drawImage(doc, data.seal, cursor.left + leftCol + 4, bodyTop, [midCol - 8, cursor.y - bodyTop - 4]);
    if (data.authorizedSign && data.authorizedSign.length > 0) {
      drawImage(doc, data.authorizedSign, chargeX + 8, signImageTop, [rightCol - 16, signImageH]);
    }

    doc.end();
  });
}
