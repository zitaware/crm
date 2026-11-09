import { Prisma } from '@zitaware/database';
import type { TaxDeductionType, TdsDeductionLifecycle } from '@zitaware/contracts';

/**
 * The end of the period a deduction is reported in: the calendar quarter for
 * income-tax TDS (quarterly TDS returns and Form 16A), the month for GST-TDS
 * (monthly GSTR-7). Until it is over, a missing certificate is not yet late.
 */
export function deductionPeriodEnd(type: TaxDeductionType, deductionDate: string): string {
  const year = Number(deductionDate.slice(0, 4));
  const month = Number(deductionDate.slice(5, 7)); // 1-based
  const lastMonth = type === 'TDS' ? Math.ceil(month / 3) * 3 : month;
  // Day 0 of the following month is the last day of lastMonth.
  return new Date(Date.UTC(year, lastMonth, 0)).toISOString().slice(0, 10);
}

/**
 * docs/05 "Deduction lifecycle — TDS and GST-TDS", derived (ADR-112):
 * RECONCILED once the government's own statement (26AS, GST portal) credits
 * the whole amount; CERTIFICATE_RECEIVED once certificates cover it;
 * CERTIFICATE_PENDING when neither does and its period is over;
 * RECORDED before that.
 */
export function deductionLifecycle(input: {
  amount: Prisma.Decimal;
  certificateMatched: Prisma.Decimal;
  statementMatched: Prisma.Decimal;
  periodEnd: string;
  asOfDate: string;
}): { lifecycle: TdsDeductionLifecycle; partiallyMatched: boolean } {
  const { amount, certificateMatched, statementMatched } = input;
  const partial = (m: Prisma.Decimal) => m.greaterThan(0) && m.lessThan(amount);
  const partiallyMatched = partial(certificateMatched) || partial(statementMatched);
  if (statementMatched.greaterThanOrEqualTo(amount)) return { lifecycle: 'RECONCILED', partiallyMatched };
  if (certificateMatched.greaterThanOrEqualTo(amount)) return { lifecycle: 'CERTIFICATE_RECEIVED', partiallyMatched };
  if (input.asOfDate > input.periodEnd) return { lifecycle: 'CERTIFICATE_PENDING', partiallyMatched };
  return { lifecycle: 'RECORDED', partiallyMatched };
}
