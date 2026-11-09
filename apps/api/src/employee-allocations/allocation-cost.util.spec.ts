import { describe, expect, it } from 'vitest';
import { Prisma } from '@zitaware/database';
import { allocateSalary, isExactlyHundred, totalPercentage, type AllocationShare } from './allocation-cost.util';

const d = (v: string | number) => new Prisma.Decimal(v);
const share = (key: string, sequence: number, percentage: string | number): AllocationShare => ({
  key,
  sequence,
  percentage: d(percentage),
});

function sum(parts: Array<{ amount: Prisma.Decimal }>): Prisma.Decimal {
  return parts.reduce((s, p) => s.plus(p.amount), d(0));
}

describe('totalPercentage / isExactlyHundred', () => {
  it('recognises an exact 100 across awkward fractions', () => {
    const shares = [share('a', 1, '33.3333'), share('b', 2, '33.3333'), share('c', 3, '33.3334')];
    expect(totalPercentage(shares).toFixed(4)).toBe('100.0000');
    expect(isExactlyHundred(shares)).toBe(true);
  });

  it('rejects anything that is not exactly 100 — including one ten-thousandth short', () => {
    expect(isExactlyHundred([share('a', 1, '99.9999')])).toBe(false);
    expect(isExactlyHundred([share('a', 1, '100.0001')])).toBe(false);
    expect(isExactlyHundred([])).toBe(false);
    expect(isExactlyHundred([share('a', 1, 60), share('b', 2, 40)])).toBe(true);
  });
});

describe('allocateSalary', () => {
  it('splits a clean division exactly, with no remainder line', () => {
    const parts = allocateSalary(d('100000.00'), [share('a', 1, 60), share('b', 2, 40)]);
    expect(parts.map((p) => p.amount.toFixed(2))).toEqual(['60000.00', '40000.00']);
    expect(parts.some((p) => p.carriesRemainder)).toBe(false);
    expect(sum(parts).toFixed(2)).toBe('100000.00');
  });

  it('assigns the rounding remainder so a three-way split still sums to the whole', () => {
    // The case docs/06's own rounding sentence is about: each third of
    // 100.00 rounds down to 33.33, and 3 x 33.33 is 99.99 — a paisa short of
    // the salary actually paid.
    const parts = allocateSalary(d('100.00'), [
      share('a', 1, '33.3333'),
      share('b', 2, '33.3333'),
      share('c', 3, '33.3334'),
    ]);
    expect(sum(parts).toFixed(2)).toBe('100.00');
    // The largest share carries it — here the third.
    const remainderLine = parts.find((p) => p.carriesRemainder)!;
    expect(remainderLine.key).toBe('c');
    expect(parts.map((p) => p.amount.toFixed(2))).toEqual(['33.33', '33.33', '33.34']);
  });

  it('produces no remainder when the shares happen to divide exactly', () => {
    // Same percentages, a gross that divides cleanly — the remainder branch
    // must not fire and no line may be marked as carrying one.
    const parts = allocateSalary(d('10000.00'), [
      share('a', 1, '33.3333'),
      share('b', 2, '33.3333'),
      share('c', 3, '33.3334'),
    ]);
    expect(parts.map((p) => p.amount.toFixed(2))).toEqual(['3333.33', '3333.33', '3333.34']);
    expect(parts.some((p) => p.carriesRemainder)).toBe(false);
    expect(sum(parts).toFixed(2)).toBe('10000.00');
  });

  it('breaks a tie on the largest share by the earliest sequence, deterministically', () => {
    const first = allocateSalary(d('10000.01'), [share('a', 1, 50), share('b', 2, 50)]);
    const second = allocateSalary(d('10000.01'), [share('b', 2, 50), share('a', 1, 50)]);
    // Same input, different array order — the same line must carry it.
    expect(first.find((p) => p.carriesRemainder)!.key).toBe('a');
    expect(second.find((p) => p.carriesRemainder)!.key).toBe('a');
    expect(sum(first).toFixed(2)).toBe('10000.01');
    expect(sum(second).toFixed(2)).toBe('10000.01');
  });

  it('never loses a paisa across a wide, awkward split', () => {
    const shares = [
      share('a', 1, '14.2857'),
      share('b', 2, '14.2857'),
      share('c', 3, '14.2857'),
      share('d', 4, '14.2857'),
      share('e', 5, '14.2857'),
      share('f', 6, '14.2857'),
      share('g', 7, '14.2858'),
    ];
    expect(isExactlyHundred(shares)).toBe(true);
    for (const gross of ['57333.33', '1.00', '99999.99', '250000.55']) {
      const parts = allocateSalary(d(gross), shares);
      expect(sum(parts).toFixed(2)).toBe(d(gross).toFixed(2));
    }
  });

  it('handles a zero gross salary — an unpaid month allocates to zero, not to an error', () => {
    const parts = allocateSalary(d('0.00'), [share('a', 1, 50), share('b', 2, 50)]);
    expect(parts.map((p) => p.amount.toFixed(2))).toEqual(['0.00', '0.00']);
    expect(sum(parts).toFixed(2)).toBe('0.00');
  });

  it('returns nothing for no shares rather than inventing a line', () => {
    expect(allocateSalary(d('10000.00'), [])).toEqual([]);
  });

  it('previews a part-filled draft at what it says, not scaled up to the whole salary', () => {
    // 40% allocated so far: the lines are 40% of gross, and the difference
    // from gross is NOT silently pushed into them.
    const parts = allocateSalary(d('10000.00'), [share('a', 1, 40)]);
    expect(parts[0]!.amount.toFixed(2)).toBe('10000.00');
  });
});
