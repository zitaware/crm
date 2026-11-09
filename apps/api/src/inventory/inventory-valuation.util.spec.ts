import { describe, expect, it } from 'vitest';
import { Prisma } from '@zitaware/database';
import { applyConsumption, applyReceipt, zeroBalance, type StockBalance } from './inventory-valuation.util';

const d = (v: string | number) => new Prisma.Decimal(v);

function receive(balance: StockBalance, qty: string, cost: string): StockBalance {
  return applyReceipt(balance, d(qty), d(cost)).balance;
}

describe('applyReceipt', () => {
  it('sets the rate to the purchase cost on the first receipt into an empty item', () => {
    const result = applyReceipt(zeroBalance(), d(10), d('100.00'));
    expect(result.movementValueAmount.toFixed(2)).toBe('1000.00');
    expect(result.balance.quantity.toFixed(4)).toBe('10.0000');
    expect(result.balance.valueAmount.toFixed(2)).toBe('1000.00');
    expect(result.balance.weightedAverageRate.toFixed(4)).toBe('100.0000');
  });

  it('blends two different purchase costs into a true weighted average, not a simple mean', () => {
    // 10 @ 100 = 1000, then 30 @ 200 = 6000 -> 7000 / 40 = 175.
    // A simple mean of the two rates would be 150, which is wrong.
    const afterFirst = receive(zeroBalance(), '10', '100.00');
    const result = applyReceipt(afterFirst, d(30), d('200.00'));
    expect(result.balance.quantity.toFixed(4)).toBe('40.0000');
    expect(result.balance.valueAmount.toFixed(2)).toBe('7000.00');
    expect(result.balance.weightedAverageRate.toFixed(4)).toBe('175.0000');
  });

  it('accepts a zero-cost receipt (free replacement stock) without corrupting the average', () => {
    const afterFirst = receive(zeroBalance(), '10', '100.00');
    const result = applyReceipt(afterFirst, d(10), d(0));
    expect(result.movementValueAmount.toFixed(2)).toBe('0.00');
    expect(result.balance.valueAmount.toFixed(2)).toBe('1000.00');
    expect(result.balance.weightedAverageRate.toFixed(4)).toBe('50.0000');
  });

  it('handles fractional quantities and rounds the moved value to 2dp', () => {
    const result = applyReceipt(zeroBalance(), d('2.5'), d('33.333'));
    // 2.5 x 33.333 = 83.3325 -> 83.33
    expect(result.movementValueAmount.toFixed(2)).toBe('83.33');
  });

  it('rejects a non-positive quantity and a negative cost', () => {
    expect(() => applyReceipt(zeroBalance(), d(0), d('10'))).toThrow(/greater than zero/i);
    expect(() => applyReceipt(zeroBalance(), d(-1), d('10'))).toThrow(/greater than zero/i);
    expect(() => applyReceipt(zeroBalance(), d(1), d('-0.01'))).toThrow(/cannot be negative/i);
  });
});

describe('applyConsumption', () => {
  it('issues at the ruling weighted average, not at the most recent purchase cost', () => {
    // Blended rate is 175; the last purchase was at 200.
    let balance = receive(zeroBalance(), '10', '100.00');
    balance = receive(balance, '30', '200.00');

    const result = applyConsumption(balance, d(4));
    expect(result.unitCostAmount.toFixed(4)).toBe('175.0000');
    expect(result.movementValueAmount.toFixed(2)).toBe('700.00');
    expect(result.balance.quantity.toFixed(4)).toBe('36.0000');
    expect(result.balance.valueAmount.toFixed(2)).toBe('6300.00');
    // Issuing at the ruling average must leave the average unchanged.
    expect(result.balance.weightedAverageRate.toFixed(4)).toBe('175.0000');
  });

  it('carries out the entire remaining value on full depletion, stranding no residue', () => {
    // 1000 / 3 = 333.3333 exactly-repeating: qty x rate can never equal the
    // stored value, so the final issue must absorb the difference.
    const balance = receive(zeroBalance(), '3', '333.3333');
    expect(balance.valueAmount.toFixed(2)).toBe('1000.00');

    const first = applyConsumption(balance, d(1));
    const second = applyConsumption(first.balance, d(1));
    const third = applyConsumption(second.balance, d(1));

    expect(third.balance.quantity.toFixed(4)).toBe('0.0000');
    expect(third.balance.valueAmount.toFixed(2)).toBe('0.00');
    expect(third.balance.weightedAverageRate.toFixed(4)).toBe('0.0000');

    // The three issues together must post exactly the received value —
    // this is the Phase 7 exit criterion in miniature.
    const totalIssued = first.movementValueAmount
      .plus(second.movementValueAmount)
      .plus(third.movementValueAmount);
    expect(totalIssued.toFixed(2)).toBe('1000.00');
  });

  it('depletes and reprices cleanly when stock is rebuilt after hitting zero', () => {
    let balance = receive(zeroBalance(), '10', '100.00');
    balance = applyConsumption(balance, d(10)).balance;
    expect(balance.quantity.toFixed(4)).toBe('0.0000');
    expect(balance.valueAmount.toFixed(2)).toBe('0.00');

    // A fresh receipt after depletion starts from the new cost alone, with
    // no memory of the old rate.
    const rebuilt = applyReceipt(balance, d(5), d('250.00'));
    expect(rebuilt.balance.weightedAverageRate.toFixed(4)).toBe('250.0000');
    expect(rebuilt.balance.valueAmount.toFixed(2)).toBe('1250.00');
  });

  it('keeps quantity and value reconciled across a long mixed receipt/issue sequence', () => {
    let balance = zeroBalance();
    let received = new Prisma.Decimal(0);
    let issued = new Prisma.Decimal(0);

    const receipts: Array<[string, string]> = [
      ['7', '13.37'],
      ['11', '19.99'],
      ['3', '101.01'],
      ['23', '7.77'],
    ];
    const issues = ['5', '9', '2', '13'];

    for (let i = 0; i < receipts.length; i++) {
      const [qty, cost] = receipts[i]!;
      const r = applyReceipt(balance, d(qty), d(cost));
      received = received.plus(r.movementValueAmount);
      balance = r.balance;

      const c = applyConsumption(balance, d(issues[i]!));
      issued = issued.plus(c.movementValueAmount);
      balance = c.balance;
    }

    // Value on hand must always equal everything received minus everything
    // issued — no drift accumulates from repeated rounding.
    expect(balance.valueAmount.toFixed(2)).toBe(received.minus(issued).toFixed(2));
    // And the stored rate must still describe the stored balance.
    expect(balance.weightedAverageRate.toFixed(4)).toBe(
      balance.valueAmount.dividedBy(balance.quantity).toDecimalPlaces(4).toFixed(4),
    );
  });

  it('refuses to issue more than is on hand, naming both figures', () => {
    const balance = receive(zeroBalance(), '5', '10.00');
    expect(() => applyConsumption(balance, d(6))).toThrow(/only 5\.0000 in stock/i);
    expect(() => applyConsumption(zeroBalance(), d(1))).toThrow(/only 0\.0000 in stock/i);
  });

  it('rejects a non-positive issued quantity', () => {
    const balance = receive(zeroBalance(), '5', '10.00');
    expect(() => applyConsumption(balance, d(0))).toThrow(/greater than zero/i);
    expect(() => applyConsumption(balance, d(-2))).toThrow(/greater than zero/i);
  });

  it('allows issuing the exact quantity on hand', () => {
    const balance = receive(zeroBalance(), '5', '10.00');
    const result = applyConsumption(balance, d(5));
    expect(result.movementValueAmount.toFixed(2)).toBe('50.00');
    expect(result.balance.quantity.isZero()).toBe(true);
  });
});
