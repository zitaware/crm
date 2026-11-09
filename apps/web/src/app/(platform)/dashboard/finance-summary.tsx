'use client';

import { useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import Link from 'next/link';
import { Button, Table } from 'antd';
import { BarChartIcon, CreditDebitNoteIcon, ReceiptIcon, VendorBillIcon } from '@zitaware/ui';
import type { DashboardBreakdown, DashboardFigure } from '@zitaware/contracts';
import { formatMoney, formatMoneyShort } from '@/lib/format';

/*
 * Colours (dataviz reference palette, run through its validator against the
 * card surface). Categorical slots in fixed order; each category keeps its
 * slot by name, not by rank, so a new period does not repaint the survivors.
 * Slots under 3:1 against white are always paired with a printed label and
 * amount, and every chart has a table view.
 */
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
const OTHER = '#b9b7ae';
const STATUS = { critical: '#d03b3b', good: '#0ca30c' };
/** Fixed per part, validated as a set (all pairs): the parts are the same entities every period. */
const COMPOSITION: Record<string, string> = {
  'Invoice unpaid': '#eda100',
  'Hold & retention': '#e34948',
  'EMD lodged': '#2a78d6',
  'SD lodged': '#1baf7a',
};

/** A slot per name, stable for that name: its hash picks a slot, and a taken slot moves to the next free one. */
function colourByName(labels: string[]): Map<string, string> {
  const taken = new Set<number>();
  const out = new Map<string, string>();
  for (const label of labels) {
    if (label === 'Other') {
      out.set(label, OTHER);
      continue;
    }
    let slot = [...label].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % SERIES.length;
    for (let i = 0; i < SERIES.length && taken.has(slot); i++) slot = (slot + 1) % SERIES.length;
    taken.add(slot);
    out.set(label, SERIES[slot]!);
  }
  return out;
}

function Detail({ d }: { d: DashboardFigure['details'][number] }) {
  if (d.kind === 'TEXT') return <span>{d.label}</span>;
  if (d.kind === 'COUNT') return <span>{d.value} {d.label.toLowerCase()}</span>;
  if (d.kind === 'PERCENT') return <span><b className="font-semibold text-positive">{d.value}%</b> {d.label}</span>;
  return <span>{d.label} <span className="tabular-nums" title={formatMoney(d.value)}>{formatMoneyShort(d.value)}</span></span>;
}

function Details({ details }: { details: DashboardFigure['details'] }) {
  if (!details.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-x-1.5 text-[12.5px] text-muted">
      {details.map((d, i) => (
        <span key={d.label} className="inline-flex gap-1.5">
          {i > 0 ? <span aria-hidden>·</span> : null}
          <Detail d={d} />
        </span>
      ))}
    </div>
  );
}

const HEADLINE: Record<string, { accent: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }> = {
  PAYMENT_RECEIVED: { accent: 'var(--ui-positive)', Icon: ReceiptIcon },
  TOTAL_EXPENSE: { accent: 'var(--ui-negative)', Icon: VendorBillIcon },
  NET_PROFIT: { accent: 'var(--ui-brand)', Icon: BarChartIcon },
  INVOICED_NOT_RECEIVED: { accent: 'var(--ui-warning)', Icon: CreditDebitNoteIcon },
};

/** One of the four headline figures: an accent edge and icon, the amount in short form. */
export function HeadlineTile({ figure, index }: { figure: DashboardFigure; index: number }) {
  const { accent, Icon } = HEADLINE[figure.key] ?? { accent: 'var(--ui-brand)', Icon: BarChartIcon };
  return (
    <Link
      href={figure.reportPath}
      className="viz-rise group block rounded-ui border border-ui border-t-[3px] bg-surface px-4 py-4 shadow-ui transition-transform hover:-translate-y-px"
      style={{ borderTopColor: accent, animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[.06em] text-muted">{figure.label}</span>
        <span
          className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[6px]"
          style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}
          aria-hidden
        >
          <Icon width={15} height={15} />
        </span>
      </div>
      <div className={`mt-1 font-display text-[26px] font-bold leading-tight tabular-nums ${figure.value.startsWith('-') ? 'text-negative' : 'text-ink'}`} title={formatMoney(figure.value)}>
        {formatMoneyShort(figure.value)}
      </div>
      <Details details={figure.details} />
    </Link>
  );
}

/** One heading style for every group on the Dashboard: small caps in brand, then a rule. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-3 text-[11.5px] font-bold uppercase tracking-[.08em] text-brand">
      {children}
      <span className="h-px flex-1 bg-ui" aria-hidden />
    </h2>
  );
}

/** Money waiting to come back or still to be done is amber; money withheld, cut or late is red. */
const FIGURE_TONE: Record<string, string> = {
  EMD_TO_RECOVER: 'text-warning',
  SD_TO_RECOVER: 'text-warning',
  BILLING_PENDING: 'text-warning',
  HOLD_OUTSTANDING: 'text-negative',
  HOLD_RETENTION: 'text-negative',
  PENALTY_DEDUCTED: 'text-negative',
  PAST_DUE: 'text-negative',
};

/** Every tile below the headline row looks the same, whichever part of the overview it comes from. */
export function FigureTile({ figure, index, hint }: { figure: DashboardFigure; index: number; hint?: string | undefined }) {
  return (
    <Link
      href={figure.reportPath}
      title={hint}
      className="viz-rise group flex flex-col rounded-ui border border-ui bg-surface px-[14px] py-[14px] shadow-ui transition-[border-color] hover:border-brand"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-start justify-between gap-2 text-[12.5px] font-medium text-text">
        <span>{figure.label}</span>
        <span className="shrink-0 text-[11.5px] text-muted group-hover:text-brand">
          {figure.measure === 'AS_OF' ? 'As of' : 'Period'} <span aria-hidden>↗</span>
        </span>
      </div>
      <div
        className={`mt-3 font-display text-[22px] font-bold leading-tight tabular-nums ${figure.value.startsWith('-') ? 'text-negative' : Number(figure.value) === 0 ? 'text-ink' : (FIGURE_TONE[figure.key] ?? 'text-ink')}`}
        title={formatMoney(figure.value)}
      >
        {formatMoneyShort(figure.value)}
      </div>
      <Details details={figure.details} />
    </Link>
  );
}

type Row = DashboardBreakdown['rows'][number];

/** Labelled bars, one hue per row: a dot and the label, the bar, the amount; the share under the label. */
function Bars({ rows, colours, hover, setHover }: { rows: Row[]; colours: Map<string, string>; hover: string | null; setHover: (v: string | null) => void }) {
  const longest = Math.max(0, ...rows.map((r) => Math.abs(Number(r.amount))));
  return (
    <div className="flex flex-col">
      {rows.map((r, index) => {
        const width = longest > 0 ? Math.max(1.5, (Math.abs(Number(r.amount)) / longest) * 100) : 0;
        const colour = colours.get(r.label) ?? OTHER;
        const dim = hover !== null && hover !== r.label;
        return (
          <div
            key={r.label}
            tabIndex={0}
            className="grid grid-cols-[minmax(110px,180px)_1fr_auto] items-center gap-x-4 border-t border-ui-2 py-3 outline-none first:border-t-0 focus-visible:bg-brand-soft"
            title={`${r.label}: ${formatMoney(r.amount)}${r.percent ? ` · ${r.percent}%` : ''}${r.note ? ` · ${r.note}` : ''}`}
            onPointerEnter={() => setHover(r.label)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(r.label)}
            onBlur={() => setHover(null)}
          >
            <div className="min-w-0">
              <div className="flex items-start gap-2 text-[13px] text-ink">
                <span className="mt-[5px] inline-block h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: colour }} aria-hidden />
                <span className={hover === r.label ? 'text-brand' : ''}>{r.label}</span>
              </div>
              <div className="pl-4 text-[11.5px] text-muted">
                {[r.percent ? `${r.percent}%` : null, r.note].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="h-[8px] rounded-[4px] bg-paper">
              <div
                key={r.amount}
                className="viz-grow-x h-full rounded-[4px] transition-opacity"
                style={{ width: `${width}%`, background: colour, opacity: dim ? 0.45 : 1, animationDelay: `${index * 60}ms` }}
              />
            </div>
            <span className="text-right text-[13px] font-medium tabular-nums text-ink">{formatMoneyShort(r.amount)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Part-to-whole as a ring: 2px surface gaps between segments, the legend carries every label and amount. */
function Donut({ rows, colours, hover, setHover }: { rows: Row[]; colours: Map<string, string>; hover: string | null; setHover: (v: string | null) => void }) {
  const total = rows.reduce((s, r) => s + Math.max(0, Number(r.amount)), 0);
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 120 120" className="h-[132px] w-[132px] shrink-0 -rotate-90" role="img" aria-label="Receivable composition">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--ui-line-2)" strokeWidth="16" />
        {total > 0
          ? rows.map((r) => {
              const length = (Math.max(0, Number(r.amount)) / total) * circumference;
              const segment = (
                <circle
                  key={r.label}
                  cx="60"
                  cy="60"
                  r={radius}
                  fill="none"
                  stroke={colours.get(r.label) ?? OTHER}
                  strokeWidth={hover === r.label ? 19 : 16}
                  strokeDasharray={`${Math.max(0, length - 2)} ${circumference}`}
                  strokeDashoffset={-offset}
                  opacity={hover !== null && hover !== r.label ? 0.45 : 1}
                  onPointerEnter={() => setHover(r.label)}
                  onPointerLeave={() => setHover(null)}
                >
                  <title>{`${r.label}: ${formatMoney(r.amount)}${r.percent ? ` · ${r.percent}%` : ''}`}</title>
                </circle>
              );
              offset += length;
              return segment;
            })
          : null}
      </svg>
      <div className="flex min-w-[200px] flex-1 flex-col gap-2.5">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center gap-2.5 text-[13px]"
            onPointerEnter={() => setHover(r.label)}
            onPointerLeave={() => setHover(null)}
          >
            <span className="inline-block h-[10px] w-[10px] shrink-0 rounded-[3px]" style={{ background: colours.get(r.label) ?? OTHER }} aria-hidden />
            <span className={`flex-1 ${hover === r.label ? 'text-brand' : 'text-ink'}`}>{r.label}</span>
            <span className="text-[11.5px] text-muted">{r.percent ? `${r.percent}%` : ''}</span>
            <span className="w-[78px] text-right font-medium tabular-nums text-ink" title={formatMoney(r.amount)}>
              {formatMoneyShort(r.amount)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Up to three of the largest parts as tiles, as the project-type view shows them. */
function TypeTiles({ rows, colours }: { rows: Row[]; colours: Map<string, string> }) {
  return (
    <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {rows.slice(0, 3).map((r) => (
        <div key={r.label} className="rounded-ui border border-ui px-3 py-4 text-center">
          <div className="text-[11.5px] font-bold uppercase tracking-[.06em]" style={{ color: colours.get(r.label) ?? OTHER }}>
            {r.label}
          </div>
          <div className="mt-2 font-display text-[20px] font-bold tabular-nums text-ink" title={formatMoney(r.amount)}>
            {formatMoneyShort(r.amount)}
          </div>
          <div className="mt-1 text-[11.5px] text-muted">{[r.note, r.percent ? `${r.percent}%` : null].filter(Boolean).join(' · ')}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * One breakdown card (ADR-159). Every figure and share is the API's; bar
 * length and ring arcs are geometry only.
 */
export function BreakdownCard({ breakdown }: { breakdown: DashboardBreakdown }) {
  const [hover, setHover] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const isGst = breakdown.key === 'GST_POSITION';
  // GST's last row is the net itself, shown as a total line, not a bar.
  const rows = isGst ? breakdown.rows.slice(0, 2) : breakdown.rows;
  const net = isGst ? breakdown.rows[2] : undefined;
  const colours =
    breakdown.key === 'RECEIVABLE_COMPOSITION'
      ? new Map(rows.map((r) => [r.label, COMPOSITION[r.label] ?? OTHER]))
      : isGst
        ? new Map(rows.map((r, i) => [r.label, i === 0 ? STATUS.critical : STATUS.good]))
        : colourByName(rows.map((r) => r.label));

  return (
    <div className="viz-root flex flex-col rounded-ui border border-ui bg-surface shadow-ui">
      <div className="flex items-center justify-between gap-3 border-b border-ui-2 px-4 py-[13px]">
        <Link href={breakdown.reportPath} className="text-[14px] font-bold text-ink hover:text-brand">
          {breakdown.title}
        </Link>
        <span className="text-[13px] font-semibold tabular-nums text-ink" title={formatMoney(breakdown.total)}>
          {formatMoneyShort(breakdown.total)} <span className="font-normal text-muted">{breakdown.totalLabel}</span>
        </span>
      </div>
      <div className="flex-1 px-4 pb-3 pt-2">
        <div className="mb-1 flex items-center text-[12px] text-muted">
          <span>{breakdown.note ?? (breakdown.measure === 'AS_OF' ? 'As of the end date' : 'In the selected period')}</span>
          {breakdown.rows.length ? (
            <Button size="small" type="link" className="ml-auto px-0" onClick={() => setShowTable((v) => !v)}>
              {showTable ? 'Show chart' : 'Show table'}
            </Button>
          ) : null}
        </div>

        {breakdown.rows.length === 0 ? (
          <p className="m-0 py-3 text-[13px] text-muted">Nothing in this period.</p>
        ) : showTable ? (
          <Table
            rowKey="label"
            size="small"
            pagination={false}
            dataSource={breakdown.rows}
            columns={[
              { title: 'Item', dataIndex: 'label', key: 'label', render: (v: string, r) => (r.note ? `${v} (${r.note})` : v) },
              { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: formatMoney },
              ...(breakdown.rows.some((r) => r.percent !== null) ? [{ title: 'Share', dataIndex: 'percent', key: 'percent', align: 'right' as const, render: (v: string | null) => (v ? `${v}%` : '—') }] : []),
            ]}
          />
        ) : breakdown.key === 'RECEIVABLE_COMPOSITION' ? (
          <div className="py-3">
            <Donut rows={rows} colours={colours} hover={hover} setHover={setHover} />
          </div>
        ) : (
          <>
            {breakdown.key === 'EXPENSE_BY_PROJECT_TYPE' ? <TypeTiles rows={rows} colours={colours} /> : null}
            <Bars rows={rows} colours={colours} hover={hover} setHover={setHover} />
            {net ? (
              <div className="mt-1 flex items-center justify-between border-t border-ui pt-3 text-[13.5px] font-bold text-ink">
                <span>{net.label}</span>
                <span className="tabular-nums" title={formatMoney(net.amount)}>{formatMoneyShort(net.amount)}</span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
