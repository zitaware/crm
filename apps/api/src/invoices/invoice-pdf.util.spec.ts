import { describe, expect, it } from 'vitest';
import { renderInvoicePdf, amountInWords, formatInr, type InvoicePdfData } from './invoice-pdf.util';

const baseData: InvoicePdfData = {
  documentTitle: 'TAX INVOICE',
  invoiceNumber: '0001',
  proformaNumber: null,
  status: 'FINALIZED',
  invoiceDate: '2026-04-20',
  dueDate: '2026-05-20',
  servicePeriodStart: null,
  servicePeriodEnd: null,
  sellerLegalName: 'Test Seller Pvt Ltd',
  sellerPan: 'ABCPS1234P',
  sellerGstin: '24AAAAA0000A1Z5',
  sellerState: 'Gujarat',
  sellerAddress: 'Ahmedabad, Gujarat',
  buyerName: 'Test Buyer',
  buyerGstin: '24BBBBB1111B1Z5',
  buyerState: 'Gujarat',
  buyerAddress: 'Gandhinagar, Gujarat',
  taxableAmount: '100000.00',
  cgstAmount: '9000.00',
  sgstAmount: '9000.00',
  igstAmount: '0.00',
  totalAmount: '118000.00',
  narrative: 'Reference: WO-2026-001',
  lines: [
    {
      description: 'Implementation services',
      hsnSac: '998314',
      quantity: '1.00',
      unitPrice: '100000.00',
      taxableAmount: '100000.00',
      gstRatePercent: '18.00',
      cgstAmount: '9000.00',
      sgstAmount: '9000.00',
      igstAmount: '0.00',
      lineTotal: '118000.00',
    },
  ],
};

describe('renderInvoicePdf', () => {
  it('spells rupees from paise, with Indian grouping', () => {
    expect(amountInWords('118000.00')).toBe('Rupees One Lakh Eighteen Thousand Only');
    expect(amountInWords('0.00')).toBe('Rupees Zero Only');
    expect(amountInWords('10000000.50')).toBe('Rupees One Crore and Fifty Paise Only');
    expect(formatInr('118000.00')).toBe('1,18,000.00');
    expect(formatInr('0.00')).toBe('0.00');
  });

  it('renders a well-formed PDF buffer for a finalized invoice', async () => {
    const buffer = await renderInvoicePdf(baseData);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('renders a draft invoice (no invoice number, no GST components) without throwing', async () => {
    const buffer = await renderInvoicePdf({
      ...baseData,
      invoiceNumber: null,
      status: 'DRAFT',
      invoiceDate: null,
      dueDate: null,
      cgstAmount: '0.00',
      sgstAmount: '0.00',
      narrative: null,
    });
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('renders an inter-state (IGST) invoice without CGST/SGST lines', async () => {
    const buffer = await renderInvoicePdf({
      ...baseData,
      cgstAmount: '0.00',
      sgstAmount: '0.00',
      igstAmount: '18000.00',
    });
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('renders a legal-entity logo, seal, and authorized sign', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const buffer = await renderInvoicePdf({ ...baseData, logo: png, seal: png, authorizedSign: png });
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(0);
  });
});
