import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinancialYearService } from '../organization/financial-year.service';
import { extendFinancialYearsThroughToday } from './financial-years.test-util';

function recordingService() {
  const created: Array<{ label: string; startDate: string; endDate: string; setCurrent: boolean }> = [];
  const service = {
    create: (input: { label: string; startDate: string; endDate: string; setCurrent: boolean }) => {
      created.push({ label: input.label, startDate: input.startDate, endDate: input.endDate, setCurrent: input.setCurrent });
      return Promise.resolve();
    },
  } as unknown as FinancialYearService;
  return { service, created };
}

const input = { organizationId: 'org', legalEntityId: 'le', lastEndDate: '2026-12-31', actorId: 'actor' };

describe('extendFinancialYearsThroughToday', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds nothing while the fixture\'s own year still covers today', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-11T10:00:00.000Z') });
    const { service, created } = recordingService();
    await extendFinancialYearsThroughToday(service, input);
    expect(created).toEqual([]);
  });

  it('adds consecutive non-current years until one contains today', async () => {
    vi.useFakeTimers({ now: new Date('2028-03-15T10:00:00.000Z') });
    const { service, created } = recordingService();
    await extendFinancialYearsThroughToday(service, input);
    expect(created).toEqual([
      { label: 'FY-2027-01-01', startDate: '2027-01-01', endDate: '2027-12-31', setCurrent: false },
      { label: 'FY-2028-01-01', startDate: '2028-01-01', endDate: '2028-12-31', setCurrent: false },
    ]);
  });

  it('keeps an April–March fiscal year aligned, across a leap day', async () => {
    vi.useFakeTimers({ now: new Date('2028-04-01T00:00:00.000Z') });
    const { service, created } = recordingService();
    await extendFinancialYearsThroughToday(service, { ...input, lastEndDate: '2027-03-31' });
    expect(created.map((y) => [y.startDate, y.endDate])).toEqual([
      ['2027-04-01', '2028-03-31'],
      ['2028-04-01', '2029-03-31'],
    ]);
  });
});
