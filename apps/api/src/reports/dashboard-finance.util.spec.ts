import { describe, expect, it } from 'vitest';
import { buildDashboardFinance, type FinanceSources } from './dashboard-finance.util';

const catalog = (path: string) => ({ path }) as never;
const none: FinanceSources = {
  clientPayments: null, projectPl: null, costToCompany: null, aging: null, pending: null, emdSd: null,
  holds: null, penalties: null, tdsInward: null, gstNet: null, projectTypeById: new Map(),
};

describe('buildDashboardFinance (ADR-159)', () => {
  it('shows nothing a viewer may not read', () => {
    expect(buildDashboardFinance(none)).toEqual({ headline: [], recover: [], breakdowns: [] });
  });

  it('states net profit as P&L contribution, with its margin on income', () => {
    const projectPl = {
      catalog: catalog('/reports/project-pl'),
      totals: { income: '24100000.00', expense: '15800000.00', contribution: '8300000.00' },
      accounts: [],
    } as never;
    const f = buildDashboardFinance({ ...none, projectPl });
    const profit = f.headline.find((h) => h.key === 'NET_PROFIT')!;
    expect(profit.value).toBe('8300000.00');
    expect(profit.details).toContainEqual({ label: 'margin', value: '34.4', kind: 'PERCENT' });
    expect(f.headline.find((h) => h.key === 'TOTAL_EXPENSE')!.value).toBe('15800000.00');
  });

  it('lists the six largest expense heads and folds the rest into Other, adding up to total expense', () => {
    const accounts = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((name, i) => ({ accountType: 'EXPENSE', name, totalAmount: String((8 - i) * 10) }));
    const projectPl = {
      catalog: catalog('/reports/project-pl'),
      totals: { income: '0', expense: '360', contribution: '-360' },
      accounts: [...accounts, { accountType: 'INCOME', name: 'Revenue', totalAmount: '999' }, { accountType: 'EXPENSE', name: 'Zero', totalAmount: '0' }],
    } as never;
    const b = buildDashboardFinance({ ...none, projectPl }).breakdowns.find((x) => x.key === 'EXPENSE_BY_CATEGORY')!;
    expect(b.rows.map((r) => [r.label, r.amount])).toEqual([
      ['A', '80.00'], ['B', '70.00'], ['C', '60.00'], ['D', '50.00'], ['E', '40.00'], ['F', '30.00'], ['Other', '30.00'],
    ]);
    expect(b.rows.reduce((s, r) => s + Number(r.amount), 0)).toBe(360);
    expect(b.rows[0]!.percent).toBe('22.2');
  });

  it('groups project costs by project type, with project counts', () => {
    const costToCompany = {
      catalog: catalog('/reports/cost-to-company'),
      rows: [
        { projectId: 'p1', total: '100' }, { projectId: 'p2', total: '50' }, { projectId: 'p3', total: '50' }, { projectId: 'p4', total: '0' },
      ],
    } as never;
    const projectTypeById = new Map<string, string | null>([['p1', 'Paid'], ['p2', 'Paid'], ['p3', null]]);
    const b = buildDashboardFinance({ ...none, costToCompany, projectTypeById }).breakdowns.find((x) => x.key === 'EXPENSE_BY_PROJECT_TYPE')!;
    expect(b.total).toBe('200.00');
    expect(b.rows).toEqual([
      { label: 'Paid', amount: '150.00', percent: '75.0', note: '2 projects' },
      { label: 'No type', amount: '50.00', percent: '25.0', note: '1 project' },
    ]);
  });

  it('adds unpaid invoices, hold and retention, and lodged EMD and SD into what is locked', () => {
    const aging = { catalog: catalog('/reports/receivable-aging'), invoiceTotal: '460000.00', heldTotal: '100000.00', invoices: [{}, {}] } as never;
    const emdSd = {
      catalog: catalog('/reports/emd-sd-recovery'),
      rows: [
        { category: 'EMD', outstandingAmount: '145000.00', status: 'LODGED' },
        { category: 'SD', outstandingAmount: '228000.00', status: 'OVERDUE' },
        { category: 'SD', outstandingAmount: '0.00', status: 'RETURNED' },
      ],
    } as never;
    const f = buildDashboardFinance({ ...none, aging, emdSd });
    const b = f.breakdowns.find((x) => x.key === 'RECEIVABLE_COMPOSITION')!;
    expect(b.total).toBe('933000.00');
    expect(b.rows.map((r) => r.amount)).toEqual(['460000.00', '100000.00', '145000.00', '228000.00']);
    const sd = f.recover.find((r) => r.key === 'SD_TO_RECOVER')!;
    expect([sd.value, sd.details]).toEqual(['228000.00', [{ label: 'instruments pending', value: '1', kind: 'COUNT' }, { label: 'overdue', value: '1', kind: 'COUNT' }]]);
  });

  it('labels a negative net GST as a credit', () => {
    const gstNet = { catalog: catalog('/reports/gst-net'), totals: { output: '100.00', eligibleInput: '150.00', net: '-50.00' } } as never;
    const b = buildDashboardFinance({ ...none, gstNet }).breakdowns[0]!;
    expect([b.totalLabel, b.total, b.rows[2]!.label]).toEqual(['net credit', '50.00', 'Net GST credit']);
  });
});
