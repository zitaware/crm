import type { TaxDeductionType } from '@zitaware/contracts';

/**
 * When withheld tax must reach the government (ADR-113): income-tax TDS by
 * the 7th of the following month, except tax withheld in March, due 30
 * April; GST-TDS by the 10th of the following month (with GSTR-7).
 */
export function tdsDepositDueDate(type: TaxDeductionType, deductionDate: string): string {
  const year = Number(deductionDate.slice(0, 4));
  const month = Number(deductionDate.slice(5, 7)); // 1-based
  if (type === 'TDS' && month === 3) return `${year}-04-30`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const day = type === 'TDS' ? '07' : '10';
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${day}`;
}
