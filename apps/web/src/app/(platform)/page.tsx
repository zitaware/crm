'use client';

import { useState } from 'react';
import Link from 'next/link';
import dayjs from 'dayjs';
import { Alert, Button, Empty, Select, Spin } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import { FilterCard, FilterField, PageHeader, StatusTag, UiCard, type StatusTagTone } from '@zitaware/ui';
import { DASHBOARD_READ_PERMISSION } from '@zitaware/contracts/dashboard';
import { REPORT_BASIS_LABELS } from '@zitaware/contracts/reports';
import type { DashboardAttentionItem, DashboardAttentionKind, DashboardCard, DashboardFigure, DashboardOverview } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { CashTrendChart } from './dashboard/cash-trend';
import { AgingChart } from './dashboard/aging-chart';
import { TopProjectsChart } from './dashboard/top-projects';
import { BreakdownCard, FigureTile, HeadlineTile, SectionTitle } from './dashboard/finance-summary';

interface Filters {
  legalEntityId: string | undefined;
  dateFrom: string;
  asOfDate: string;
}

/** The current Indian financial year to date (1 April), like every period report. */
function defaultFilters(): Filters {
  const today = dayjs();
  const fyStartYear = today.month() >= 3 ? today.year() : today.year() - 1;
  return { legalEntityId: undefined, dateFrom: `${fyStartYear}-04-01`, asOfDate: today.format('YYYY-MM-DD') };
}

/** Quick periods. The Indian financial year runs April–March, and its quarters are the calendar quarters. */
const PRESETS: Array<{ label: string; range: () => { dateFrom: string; asOfDate: string } }> = [
  { label: 'This Month', range: () => ({ dateFrom: dayjs().startOf('month').format('YYYY-MM-DD'), asOfDate: dayjs().format('YYYY-MM-DD') }) },
  {
    label: 'Last Month',
    range: () => {
      const last = dayjs().subtract(1, 'month');
      return { dateFrom: last.startOf('month').format('YYYY-MM-DD'), asOfDate: last.endOf('month').format('YYYY-MM-DD') };
    },
  },
  {
    label: 'This Quarter',
    range: () => {
      const today = dayjs();
      const start = today.month(Math.floor(today.month() / 3) * 3).startOf('month');
      return { dateFrom: start.format('YYYY-MM-DD'), asOfDate: today.format('YYYY-MM-DD') };
    },
  },
  { label: `This FY (${fyLabel(0)})`, range: () => ({ dateFrom: defaultFilters().dateFrom, asOfDate: dayjs().format('YYYY-MM-DD') }) },
  {
    label: 'Last FY',
    range: () => {
      const start = dayjs(defaultFilters().dateFrom).subtract(1, 'year');
      return { dateFrom: start.format('YYYY-MM-DD'), asOfDate: start.add(1, 'year').subtract(1, 'day').format('YYYY-MM-DD') };
    },
  },
  { label: 'All Time', range: () => ({ dateFrom: '2000-01-01', asOfDate: dayjs().format('YYYY-MM-DD') }) },
];

function fyLabel(offset: number): string {
  const start = dayjs(defaultFilters().dateFrom).add(offset, 'year').year();
  return `${start}–${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Old cards whose figure the financial summary already shows (ADR-162), by the
 * summary figure that covers it. A card is hidden only while that figure is on
 * screen, so a viewer without the summary's report still sees the card.
 */
const COVERED_BY: Partial<Record<DashboardCard['key'], string>> = {
  INVOICE_OUTSTANDING: 'INVOICED_NOT_RECEIVED',
  HOLD_RETENTION: 'RECEIVABLE_COMPOSITION',
  INCOME: 'NET_PROFIT',
  CONTRIBUTION: 'NET_PROFIT',
  EXPENSES: 'TOTAL_EXPENSE',
  GST_NET: 'GST_POSITION',
  EMD_SD_CASH: 'EMD_TO_RECOVER',
};

const asFigure = (c: DashboardCard): DashboardFigure => ({ key: c.key, label: c.label, value: c.value, details: c.details, measure: c.measure, reportPath: c.reportPath });
const hintOf = (c: DashboardCard) => `${c.reportTitle} · ${REPORT_BASIS_LABELS[c.basis]}`;

/** The tiles below the headline row, in two groups: what is owed to us, then cash, tax and what we owe. */
function tileGroups(data: DashboardOverview) {
  const { headline, recover, breakdowns } = data.finance;
  const shown = new Set([...headline, ...recover, ...breakdowns].map((f) => f.key));
  const cards = data.cards.filter((c) => !(COVERED_BY[c.key] && shown.has(COVERED_BY[c.key]!)));
  const tile = (c: DashboardCard) => ({ figure: asFigure(c), hint: hintOf(c) });
  return {
    // The unpaid-invoice figure is already the fourth headline tile.
    recover: [
      ...cards.filter((c) => c.section === 'RECEIVABLES').map(tile),
      ...recover.filter((f) => f.key !== 'TDS_INWARD' && !(f.key === 'INVOICE_UNPAID' && shown.has('INVOICED_NOT_RECEIVED'))).map((figure) => ({ figure, hint: undefined })),
    ],
    cashTax: [
      ...cards.filter((c) => c.section === 'CASH_AND_TAX').map(tile),
      ...recover.filter((f) => f.key === 'TDS_INWARD').map((figure) => ({ figure, hint: undefined })),
      ...cards.filter((c) => c.section === 'PERFORMANCE' || c.section === 'PAYABLES_AND_OPERATIONS').map(tile),
    ],
  };
}

const TILE_GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6';

const ATTENTION: Record<DashboardAttentionKind, { label: string; tone: StatusTagTone }> = {
  LEDGER_DIFFERENCE: { label: 'Ledger difference', tone: 'neg' },
  OVERDUE_INVOICE: { label: 'Past due', tone: 'neg' },
  BILLING_DUE: { label: 'Billing due', tone: 'warn' },
  EMD_SD_OVERDUE: { label: 'EMD/SD overdue', tone: 'warn' },
  TDS_DEPOSIT_OVERDUE: { label: 'TDS overdue', tone: 'neg' },
};

function AttentionRow({ item }: { item: DashboardAttentionItem }) {
  const kind = ATTENTION[item.kind];
  return (
    <Link href={item.href} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ui-2 px-4 py-3 first:border-t-0 hover:bg-brand-soft">
      <StatusTag status={item.kind} label={kind.label} tone={kind.tone} />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink">{item.title}</span>
        <span className="block text-[12px] text-muted">
          {item.detail}
          {item.date ? ` · ${formatDate(item.date)}` : ''}
        </span>
      </span>
      {item.amount ? <b className="tabular-nums text-ink">{formatMoney(item.amount)}</b> : null}
    </Link>
  );
}

/** Dashboard — docs/04 §1 `dashboard.getOverview`: every card is its source report's figure and links to it (ADR-119). */
export default function DashboardPage() {
  const me = trpc.auth.me.useQuery();
  const canRead = (me.data?.permissions ?? []).includes(DASHBOARD_READ_PERMISSION);
  const legalEntities = trpc.legalEntities.list.useQuery({ includeInactive: false }, { enabled: canRead });
  const [applied, setApplied] = useState<Filters>(defaultFilters);
  const [draft, setDraft] = useState<Filters>(applied);
  const overview = trpc.dashboard.getOverview.useQuery(applied, { enabled: canRead });
  const data = overview.data;
  const groups = data ? tileGroups(data) : null;

  if (me.isLoading) return <Spin />;
  if (!canRead) {
    return (
      <>
        <PageHeader title="Dashboard" description={`Welcome${me.data?.displayName ? `, ${me.data.displayName}` : ''}.`} />
        <UiCard>
          <p className="m-0 text-[13px] text-muted">Your role does not include the business dashboard. Use the menu to open the screens you work with.</p>
        </UiCard>
      </>
    );
  }

  const apply = (next: Filters) => {
    setDraft(next);
    setApplied(next);
  };

  return (
    <>
      <PageHeader title="Dashboard" description="Where the business stands. Every figure is taken from a report — open a card to see how it is made up." />

      <UiCard flush className="mb-4">
        <FilterCard
          actions={
            <>
              <Button onClick={() => apply(defaultFilters())}>Reset</Button>
              <Button type="primary" onClick={() => apply(draft)}>
                Apply
              </Button>
            </>
          }
        >
          <FilterField label="From">
            <DatePicker allowClear={false} value={dayjs(draft.dateFrom)} onChange={(d) => d && setDraft({ ...draft, dateFrom: d.format('YYYY-MM-DD') })} className="w-[160px]" />
          </FilterField>
          <FilterField label="To">
            <DatePicker allowClear={false} value={dayjs(draft.asOfDate)} onChange={(d) => d && setDraft({ ...draft, asOfDate: d.format('YYYY-MM-DD') })} className="w-[160px]" />
          </FilterField>
          <FilterField label="Legal Entity">
            <Select
              allowClear
              placeholder="All legal entities"
              value={draft.legalEntityId}
              onChange={(value?: string) => setDraft({ ...draft, legalEntityId: value })}
              loading={legalEntities.isLoading}
              className="w-[240px]"
              options={(legalEntities.data ?? []).map((e) => ({ value: e.id, label: e.legalName }))}
            />
          </FilterField>
        </FilterCard>
      </UiCard>

      <div className="-mt-2 mb-4 flex flex-wrap gap-2">
        {PRESETS.map((preset) => {
          const range = preset.range();
          const active = range.dateFrom === applied.dateFrom && range.asOfDate === applied.asOfDate;
          return (
            <Button key={preset.label} size="small" type={active ? 'primary' : 'default'} onClick={() => apply({ ...draft, ...range })}>
              {preset.label}
            </Button>
          );
        })}
      </div>

      {overview.isError ? <Alert type="error" showIcon className="mb-4" message={overview.error.message} /> : null}
      {data ? (
        <div className="mb-4 text-[12.5px] text-muted">
          <b className="text-ink">Period</b> {formatDate(data.scope.dateFrom)} – {formatDate(data.scope.asOfDate)} · balances as of {formatDate(data.scope.asOfDate)} ·{' '}
          <b className="text-ink">Legal entity</b> {data.scope.legalEntityName ?? 'All legal entities'} · <b className="text-ink">Currency</b> {data.scope.currency}
          {data.scope.restricted ? ' · Figures cover only the projects assigned to you.' : ''}
        </div>
      ) : null}
      {overview.isLoading ? <UiCard>Loading…</UiCard> : null}
      {data && data.cards.length === 0 ? (
        <UiCard className="mb-4">
          <Empty description="No report permissions yet — each card needs the permission to read its report." />
        </UiCard>
      ) : null}

      {data && data.finance.headline.length ? (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {data.finance.headline.map((f, i) => (
            <HeadlineTile key={f.key} figure={f} index={i} />
          ))}
        </div>
      ) : null}
      {groups?.recover.length ? (
        <section className="mb-6">
          <SectionTitle>Money to Recover &amp; Watch</SectionTitle>
          <div className={TILE_GRID}>
            {groups.recover.map((t, i) => (
              <FigureTile key={t.figure.key} figure={t.figure} hint={t.hint} index={i} />
            ))}
          </div>
        </section>
      ) : null}
      {groups?.cashTax.length ? (
        <section className="mb-6">
          <SectionTitle>Cash, Tax &amp; Payables</SectionTitle>
          <div className={TILE_GRID}>
            {groups.cashTax.map((t, i) => (
              <FigureTile key={t.figure.key} figure={t.figure} hint={t.hint} index={i} />
            ))}
          </div>
        </section>
      ) : null}
      {data && data.finance.breakdowns.length ? (
        <section className="mb-6">
          <SectionTitle>Breakdown</SectionTitle>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {data.finance.breakdowns.map((b) => (
              <BreakdownCard key={b.key} breakdown={b} />
            ))}
          </div>
        </section>
      ) : null}

      {data ? <SectionTitle>Trends &amp; Attention</SectionTitle> : null}
      {data ? (
        <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {data.cashTrend ? (
            <UiCard title="Bank Money In and Out by Month">
              {data.cashTrend.length ? <CashTrendChart points={data.cashTrend} /> : <Empty description="No bank movement in this period." />}
            </UiCard>
          ) : null}
          <UiCard title="Needs Attention" flush>
            {data.attention.length ? data.attention.map((item, i) => <AttentionRow key={`${item.kind}-${i}`} item={item} />) : <div className="px-4 py-6 text-[13px] text-muted">Nothing needs attention for this period.</div>}
          </UiCard>
        </div>
      ) : null}

      {data && (data.receivableAging || data.payablesAging || data.topProjects) ? (
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {data.receivableAging ? (
            <UiCard title="Receivables by Age">
              {data.receivableAging.some((b) => b.count > 0) ? (
                <AgingChart buckets={data.receivableAging} ramp="blue" countLabel="Invoices" />
              ) : (
                <Empty description="No invoice outstanding." />
              )}
            </UiCard>
          ) : null}
          {data.payablesAging ? (
            <UiCard title="Owed to Vendors by Age">
              {data.payablesAging.some((b) => b.count > 0) ? (
                <AgingChart buckets={data.payablesAging} ramp="orange" countLabel="Bills" />
              ) : (
                <Empty description="Nothing owed to vendors." />
              )}
            </UiCard>
          ) : null}
          {data.topProjects ? (
            <UiCard title="Top Projects by Income">
              {data.topProjects.length ? <TopProjectsChart projects={data.topProjects} /> : <Empty description="No project income in this period." />}
            </UiCard>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
