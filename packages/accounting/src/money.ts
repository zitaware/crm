import Decimal from 'decimal.js';

const STORAGE_DECIMAL_PLACES = 4; // matches PostgreSQL numeric(19,4), docs/07

/**
 * Money value object. Never construct this from a raw JS number that
 * originated from user input, a DB row, or an external API — those must
 * go through fromString. fromNumber exists only for trusted numeric
 * literals in code (e.g. test fixtures) and rejects non-finite values.
 */
export class Money {
  private constructor(private readonly value: Decimal) {}

  static zero(): Money {
    return new Money(new Decimal(0));
  }

  static fromString(input: string): Money {
    return new Money(new Decimal(input));
  }

  static fromNumber(input: number): Money {
    if (!Number.isFinite(input)) {
      throw new Error(`Money.fromNumber requires a finite value, received: ${input}`);
    }
    return new Money(new Decimal(input));
  }

  add(other: Money): Money {
    return new Money(this.value.plus(other.value));
  }

  subtract(other: Money): Money {
    return new Money(this.value.minus(other.value));
  }

  multiply(factor: Money | string): Money {
    const multiplier = factor instanceof Money ? factor.value : new Decimal(factor);
    return new Money(this.value.times(multiplier));
  }

  compare(other: Money): -1 | 0 | 1 {
    return this.value.comparedTo(other.value) as -1 | 0 | 1;
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  /** Decimal string suitable for numeric(19,4) storage. */
  toFixed(decimalPlaces: number = STORAGE_DECIMAL_PLACES): string {
    return this.value.toFixed(decimalPlaces);
  }

  toString(): string {
    return this.value.toString();
  }
}
