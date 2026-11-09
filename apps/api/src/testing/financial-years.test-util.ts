import { generateId } from '@zitaware/database';
import type { FinancialYearService } from '../organization/financial-year.service';

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Adds consecutive twelve-month financial years after `lastEndDate` until one
 * covers today.
 *
 * A credit/debit note always posts into today's accounting period (a
 * deliberate rule — ADR-070 decision 6), so a fixture
 * whose only financial year is a fixed calendar year stops working the day
 * that year ends: every note finalize fails with "No financial year covers
 * today's date". Calling this after the fixture's own year keeps such specs
 * valid indefinitely. The added years are never current, so the fixture's
 * own choice of current year is untouched.
 */
export async function extendFinancialYearsThroughToday(
  financialYears: FinancialYearService,
  input: { organizationId: string; legalEntityId: string; lastEndDate: string; actorId: string },
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  let endDate = input.lastEndDate;
  while (endDate < today) {
    const startDate = addDays(endDate, 1);
    const nextYearStart = `${Number(startDate.slice(0, 4)) + 1}${startDate.slice(4)}`;
    endDate = addDays(nextYearStart, -1);
    await financialYears.create({
      organizationId: input.organizationId, legalEntityId: input.legalEntityId, label: `FY-${startDate}`, startDate, endDate,
      setCurrent: false, actorId: input.actorId, correlationId: generateId(),
    });
  }
}
