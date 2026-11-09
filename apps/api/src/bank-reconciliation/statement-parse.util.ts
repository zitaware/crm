import { createHash } from 'node:crypto';
import { Prisma } from '@zitaware/database';
import type { BankStatementDateFormat, BankStatementProfileInput } from '@zitaware/contracts';

const MONTHS: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };

function realDate(year: string, month: string, day: string): string | null {
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

/** A statement date in the account's declared format, or null. No guessing between formats (ADR-114). */
export function parseStatementDate(value: string, format: BankStatementDateFormat): string | null {
  const v = value.trim();
  let m: RegExpExecArray | null;
  switch (format) {
    case 'YYYY_MM_DD':
      m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
      return m ? realDate(m[1]!, m[2]!, m[3]!) : null;
    case 'DD_MM_YYYY_SLASH':
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
      return m ? realDate(m[3]!, m[2]!, m[1]!) : null;
    case 'DD_MM_YYYY_DASH':
      m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(v);
      return m ? realDate(m[3]!, m[2]!, m[1]!) : null;
    case 'DD_MMM_YYYY':
      m = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{4})$/.exec(v);
      return m && MONTHS[m[2]!.toUpperCase()] ? realDate(m[3]!, MONTHS[m[2]!.toUpperCase()]!, m[1]!) : null;
    case 'MM_DD_YYYY_SLASH':
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
      return m ? realDate(m[3]!, m[1]!, m[2]!) : null;
  }
}

/**
 * A statement amount: thousands separators, the rupee sign and spaces are
 * stripped; "(1,000.00)" and a trailing "Dr"/"Cr" are not guessed at. Blank
 * is null. Anything else unparseable is undefined.
 */
export function parseStatementAmount(value: string | undefined): Prisma.Decimal | null | undefined {
  const v = (value ?? '').replace(/[,\s₹]/g, '');
  if (v === '' || v === '-') return null;
  const parenthesised = /^\((\d+(\.\d+)?)\)$/.exec(v);
  if (parenthesised) return new Prisma.Decimal(parenthesised[1]!).negated();
  if (!/^-?\d+(\.\d+)?$/.test(v)) return undefined;
  const amount = new Prisma.Decimal(v);
  return amount.decimalPlaces() > 2 ? undefined : amount;
}

/**
 * The signed amount of one row under the profile: positive money in.
 * Returns an error message instead when the row cannot be read.
 */
export function rowAmount(profile: BankStatementProfileInput, cell: (column: string | undefined) => string | undefined): Prisma.Decimal | null | string {
  if (profile.amountMode === 'DEBIT_CREDIT_COLUMNS') {
    const debit = parseStatementAmount(cell(profile.debitColumn));
    const credit = parseStatementAmount(cell(profile.creditColumn));
    if (debit === undefined) return 'The withdrawal is not a number.';
    if (credit === undefined) return 'The deposit is not a number.';
    if (debit && credit && !debit.isZero() && !credit.isZero()) return 'Both a withdrawal and a deposit are filled.';
    if (debit && !debit.isZero()) return debit.abs().negated();
    if (credit && !credit.isZero()) return credit.abs();
    return null;
  }
  const amount = parseStatementAmount(cell(profile.amountColumn));
  if (amount === undefined) return 'The amount is not a number.';
  if (amount === null || amount.isZero()) return null;
  if (profile.amountMode === 'SIGNED_AMOUNT') return amount;
  const indicator = (cell(profile.indicatorColumn) ?? '').trim().toUpperCase();
  if (!indicator) return 'The Dr/Cr indicator is empty.';
  return indicator === (profile.creditIndicator ?? 'CR').trim().toUpperCase() ? amount.abs() : amount.abs().negated();
}

/** Identity of a statement line for re-import detection; `occurrence` separates identical lines in one file. */
export function statementFingerprint(line: { transactionDate: string; amount: Prisma.Decimal; description: string; reference: string | null; balance: Prisma.Decimal | null }, occurrence: number): string {
  const key = [line.transactionDate, line.amount.toFixed(2), line.description.trim().toUpperCase(), (line.reference ?? '').trim().toUpperCase(), line.balance?.toFixed(2) ?? '', occurrence].join('|');
  return createHash('sha256').update(key).digest('hex');
}
