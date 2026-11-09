import { describe, expect, it } from 'vitest';
import { Prisma } from '@zitaware/database';
import { deductionLifecycle, deductionPeriodEnd } from './tds-lifecycle.util';

const d = (v: string) => new Prisma.Decimal(v);

describe('deductionPeriodEnd (ADR-112)', () => {
  it('ends TDS with its calendar quarter and GST-TDS with its month', () => {
    expect(deductionPeriodEnd('TDS', '2026-07-10')).toBe('2026-09-30');
    expect(deductionPeriodEnd('TDS', '2026-03-31')).toBe('2026-03-31');
    expect(deductionPeriodEnd('TDS', '2026-12-01')).toBe('2026-12-31');
    expect(deductionPeriodEnd('CGST_TDS', '2026-07-10')).toBe('2026-07-31');
    expect(deductionPeriodEnd('IGST_TDS', '2028-02-10')).toBe('2028-02-29');
  });
});

describe('deductionLifecycle (docs/05)', () => {
  const base = { amount: d('1000'), certificateMatched: d('0'), statementMatched: d('0'), periodEnd: '2026-09-30' };

  it('is RECORDED inside its period and CERTIFICATE_PENDING after it', () => {
    expect(deductionLifecycle({ ...base, asOfDate: '2026-09-30' }).lifecycle).toBe('RECORDED');
    expect(deductionLifecycle({ ...base, asOfDate: '2026-10-01' }).lifecycle).toBe('CERTIFICATE_PENDING');
  });

  it('needs the whole amount covered: certificates → CERTIFICATE_RECEIVED, the statement → RECONCILED', () => {
    expect(deductionLifecycle({ ...base, certificateMatched: d('1000'), asOfDate: '2026-10-01' }).lifecycle).toBe('CERTIFICATE_RECEIVED');
    expect(deductionLifecycle({ ...base, statementMatched: d('1000'), asOfDate: '2026-08-01' }).lifecycle).toBe('RECONCILED');
    expect(deductionLifecycle({ ...base, certificateMatched: d('1000'), statementMatched: d('1000'), asOfDate: '2026-10-01' }).lifecycle).toBe('RECONCILED');
  });

  it('flags a partial match without advancing the state', () => {
    expect(deductionLifecycle({ ...base, certificateMatched: d('400'), asOfDate: '2026-10-01' })).toEqual({ lifecycle: 'CERTIFICATE_PENDING', partiallyMatched: true });
    expect(deductionLifecycle({ ...base, certificateMatched: d('1000'), statementMatched: d('999.99'), asOfDate: '2026-10-01' })).toEqual({ lifecycle: 'CERTIFICATE_RECEIVED', partiallyMatched: true });
  });
});
