import { describe, expect, it } from 'vitest';
import { computeLines } from './invoices.service';

const line = {
  description: 'Work',
  hsnSac: '998314',
  quantity: '1',
  unitPrice: '100000.00',
  gstRatePercent: '9',
};

describe('invoice GST split', () => {
  it('charges the entered percent as CGST and as SGST in the same state', () => {
    const [computed] = computeLines([line], true);
    expect(computed?.cgstAmount.toFixed(2)).toBe('9000.00');
    expect(computed?.sgstAmount.toFixed(2)).toBe('9000.00');
    expect(computed?.igstAmount.toFixed(2)).toBe('0.00');
    expect(computed?.lineTotal.toFixed(2)).toBe('118000.00');
  });

  it('charges both percents together as IGST in a different state', () => {
    const [computed] = computeLines([line], false);
    expect(computed?.cgstAmount.toFixed(2)).toBe('0.00');
    expect(computed?.sgstAmount.toFixed(2)).toBe('0.00');
    expect(computed?.igstAmount.toFixed(2)).toBe('18000.00');
    expect(computed?.lineTotal.toFixed(2)).toBe('118000.00');
  });
});
