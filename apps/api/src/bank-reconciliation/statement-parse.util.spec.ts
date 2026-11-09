import { describe, expect, it } from 'vitest';
import { Prisma } from '@zitaware/database';
import type { BankStatementProfileInput } from '@zitaware/contracts';
import { parseStatementAmount, parseStatementDate, rowAmount, statementFingerprint } from './statement-parse.util';

const base: BankStatementProfileInput = {
  dateColumn: 'Date', dateFormat: 'DD_MM_YYYY_SLASH', descriptionColumn: 'Narration', referenceColumn: undefined,
  amountMode: 'DEBIT_CREDIT_COLUMNS', debitColumn: 'Withdrawal', creditColumn: 'Deposit', amountColumn: 'Amount', indicatorColumn: 'Dr/Cr', creditIndicator: 'CR', balanceColumn: undefined,
};
const cells = (values: Record<string, string>) => (column: string | undefined) => (column ? values[column] : undefined);
const s = (v: Prisma.Decimal | null | string) => (v instanceof Prisma.Decimal ? v.toFixed(2) : v);

describe('parseStatementDate (ADR-114)', () => {
  it('reads each declared format and nothing else', () => {
    expect(parseStatementDate('2026-07-05', 'YYYY_MM_DD')).toBe('2026-07-05');
    expect(parseStatementDate('05/07/2026', 'DD_MM_YYYY_SLASH')).toBe('2026-07-05');
    expect(parseStatementDate('5-7-2026', 'DD_MM_YYYY_DASH')).toBe('2026-07-05');
    expect(parseStatementDate('05-Jul-2026', 'DD_MMM_YYYY')).toBe('2026-07-05');
    expect(parseStatementDate('5 July 2026', 'DD_MMM_YYYY')).toBe('2026-07-05');
    expect(parseStatementDate('07/05/2026', 'MM_DD_YYYY_SLASH')).toBe('2026-07-05');
    expect(parseStatementDate('05/07/2026', 'YYYY_MM_DD')).toBeNull();
    expect(parseStatementDate('31/06/2026', 'DD_MM_YYYY_SLASH')).toBeNull();
    expect(parseStatementDate('Opening balance', 'DD_MM_YYYY_SLASH')).toBeNull();
  });
});

describe('parseStatementAmount', () => {
  it('strips separators and the rupee sign, reads parentheses as negative, and refuses the rest', () => {
    expect(parseStatementAmount('₹ 1,04,400.00')!.toFixed(2)).toBe('104400.00');
    expect(parseStatementAmount('(590.00)')!.toFixed(2)).toBe('-590.00');
    expect(parseStatementAmount('')).toBeNull();
    expect(parseStatementAmount('12.345')).toBeUndefined();
    expect(parseStatementAmount('1,000 Dr')).toBeUndefined();
  });
});

describe('rowAmount', () => {
  it('signs withdrawal and deposit columns, refusing a row with both', () => {
    expect(s(rowAmount(base, cells({ Withdrawal: '104,400.00', Deposit: '' })))).toBe('-104400.00');
    expect(s(rowAmount(base, cells({ Withdrawal: '', Deposit: '5,00,000.00' })))).toBe('500000.00');
    expect(rowAmount(base, cells({ Withdrawal: '', Deposit: '' }))).toBeNull();
    expect(rowAmount(base, cells({ Withdrawal: '10', Deposit: '10' }))).toBe('Both a withdrawal and a deposit are filled.');
  });

  it('reads a signed amount, or an amount with a Dr/Cr indicator', () => {
    expect(s(rowAmount({ ...base, amountMode: 'SIGNED_AMOUNT' }, cells({ Amount: '-590' })))).toBe('-590.00');
    const indicator = { ...base, amountMode: 'AMOUNT_WITH_INDICATOR' as const };
    expect(s(rowAmount(indicator, cells({ Amount: '590', 'Dr/Cr': 'dr' })))).toBe('-590.00');
    expect(s(rowAmount(indicator, cells({ Amount: '590', 'Dr/Cr': 'CR' })))).toBe('590.00');
    expect(rowAmount(indicator, cells({ Amount: '590', 'Dr/Cr': '' }))).toBe('The Dr/Cr indicator is empty.');
  });
});

describe('statementFingerprint', () => {
  it('is stable across re-imports and distinguishes identical lines by occurrence', () => {
    const line = { transactionDate: '2026-07-12', amount: new Prisma.Decimal('-11800'), description: 'NEFT ', reference: null, balance: null };
    expect(statementFingerprint(line, 0)).toBe(statementFingerprint({ ...line, description: 'neft' }, 0));
    expect(statementFingerprint(line, 0)).not.toBe(statementFingerprint(line, 1));
  });
});
