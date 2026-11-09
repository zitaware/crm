import { describe, expect, it } from 'vitest';
import { Money } from './money';

describe('Money', () => {
  it('adds and subtracts without floating-point drift', () => {
    const a = Money.fromString('0.1');
    const b = Money.fromString('0.2');
    expect(a.add(b).toFixed(4)).toBe('0.3000');
  });

  it('rejects non-finite numbers', () => {
    expect(() => Money.fromNumber(Number.NaN)).toThrow();
  });

  it('compares values', () => {
    expect(Money.fromString('5').compare(Money.fromString('3'))).toBe(1);
  });
});
