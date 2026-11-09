import { describe, expect, it } from 'vitest';
import { Prisma } from '@zitaware/database';
import { apportion, naturalCashAmount, percentOf } from './cash-attribution.util';

const d = (v: string) => new Prisma.Decimal(v);
const strings = (values: Prisma.Decimal[]) => values.map((v) => v.toFixed(2));

describe('apportion (ADR-110)', () => {
  it('gives one weight the whole amount', () => {
    expect(strings(apportion(d('27000'), [d('30000')]))).toEqual(['27000.00']);
  });

  it('splits in proportion, the parts adding up to the total exactly', () => {
    // 100 across three equal weights: 33.33 + 33.33 + 33.34.
    const parts = apportion(d('100'), [d('1'), d('1'), d('1')]);
    expect(strings(parts)).toEqual(['33.33', '33.33', '33.34']);
    expect(parts.reduce((s, p) => s.plus(p), d('0')).toFixed(2)).toBe('100.00');
  });

  it('keeps the sign of a reversal', () => {
    expect(strings(apportion(d('-27000'), [d('20000'), d('10000')]))).toEqual(['-18000.00', '-9000.00']);
  });

  it('puts everything on the last part when the weights are all zero', () => {
    expect(strings(apportion(d('50'), [d('0'), d('0')]))).toEqual(['0.00', '50.00']);
  });
});

describe('naturalCashAmount', () => {
  it('counts money in positive for receipts and money out positive for payments', () => {
    expect(naturalCashAmount('CLIENT_RECEIPT', d('500')).toFixed(2)).toBe('500.00');
    expect(naturalCashAmount('VENDOR_PAYMENT', d('-500')).toFixed(2)).toBe('500.00');
    // A returned deposit is money in, so it is negative "out".
    expect(naturalCashAmount('SECURITY_DEPOSIT', d('250')).toFixed(2)).toBe('-250.00');
  });
});

describe('percentOf', () => {
  it('rounds half up to 2 dp and has no value without a positive base', () => {
    expect(percentOf(d('804033.32'), d('815833.32'))).toBe('98.55');
    expect(percentOf(d('83016.66'), d('80000'))).toBe('103.77');
    expect(percentOf(d('10'), d('0'))).toBeNull();
    expect(percentOf(d('10'), null)).toBeNull();
    expect(percentOf(d('10'), d('-5'))).toBeNull();
  });
});
