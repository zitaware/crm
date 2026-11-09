'use client';

import { useState } from 'react';
import { Button, Table } from 'antd';
import { formatMoney } from '@/lib/format';

export interface CashTrendPoint {
  month: string;
  inflow: string;
  outflow: string;
}

// Categorical slots 1 and 2, validated as a pair on the white card surface
// (dataviz validator: CVD ΔE 24.7, all checks pass). Defined in globals.css.
const SERIES = [
  { key: 'inflow', label: 'Money in', color: 'var(--viz-in)' },
  { key: 'outflow', label: 'Money out', color: 'var(--viz-out)' },
] as const;

const PLOT_HEIGHT = 180;

const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });

/** Axis ticks only: 1/2/5 × 10ⁿ steps above the largest value. Geometry, never an accounting figure. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max / 4));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s * 4 >= max) ?? 10 * magnitude;
  return step * 4;
}

function compactInr(value: number): string {
  if (value >= 1e7) return `₹${(value / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 1 })}Cr`;
  if (value >= 1e5) return `₹${(value / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 1 })}L`;
  if (value >= 1e3) return `₹${(value / 1e3).toLocaleString('en-IN', { maximumFractionDigits: 1 })}K`;
  return `₹${value}`;
}

/** Money in and out of all bank accounts by month — the Cash Flow report's months, drawn as grouped columns. */
export function CashTrendChart({ points }: { points: CashTrendPoint[] }) {
  const [hover, setHover] = useState<{ month: string; series: (typeof SERIES)[number] } | null>(null);
  const [showTable, setShowTable] = useState(false);
  const top = niceMax(Math.max(0, ...points.flatMap((p) => [Number(p.inflow), Number(p.outflow)])));
  const ticks = [0, 1, 2, 3, 4].map((i) => (top / 4) * i);
  const hovered = hover ? points.find((p) => p.month === hover.month) : undefined;

  return (
    <div className="viz-root">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-[12px] text-muted">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-[6px]">
            <span className="inline-block h-[10px] w-[10px] rounded-[2px]" style={{ background: s.color }} aria-hidden />
            {s.label}
          </span>
        ))}
        <Button size="small" type="link" className="ml-auto px-0" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Show chart' : 'Show table'}
        </Button>
      </div>

      {showTable ? (
        <Table<CashTrendPoint>
          rowKey="month"
          size="small"
          pagination={false}
          dataSource={points}
          columns={[
            { title: 'Month', dataIndex: 'month', key: 'month', render: monthLabel },
            { title: 'Money In', dataIndex: 'inflow', key: 'inflow', align: 'right', render: formatMoney },
            { title: 'Money Out', dataIndex: 'outflow', key: 'outflow', align: 'right', render: formatMoney },
          ]}
        />
      ) : (
        <div className="relative overflow-x-auto">
          <div className="flex min-w-[360px] pt-3">
            <div className="relative mr-2 w-[48px] shrink-0" style={{ height: PLOT_HEIGHT }}>
              {ticks.map((t) => (
                <span key={t} className="absolute right-0 translate-y-1/2 text-[11px] tabular-nums text-muted" style={{ bottom: (t / top) * PLOT_HEIGHT }}>
                  {compactInr(t)}
                </span>
              ))}
            </div>
            <div className="relative flex-1">
              <div className="relative" style={{ height: PLOT_HEIGHT }}>
                {ticks.map((t) => (
                  <div key={t} className="absolute inset-x-0 border-t border-ui-2" style={{ bottom: (t / top) * PLOT_HEIGHT }} aria-hidden />
                ))}
                <div className="absolute inset-0 flex items-end justify-around">
                  {points.map((p, monthIndex) => (
                    <div key={p.month} className="flex items-end gap-[2px]" role="group" aria-label={monthLabel(p.month)}>
                      {SERIES.map((s) => {
                        const value = p[s.key];
                        const height = Math.max(Number(value) > 0 ? 2 : 0, (Number(value) / top) * PLOT_HEIGHT);
                        const active = hover?.month === p.month && hover.series.key === s.key;
                        return (
                          <button
                            key={s.key}
                            type="button"
                            className="flex h-full w-[22px] cursor-default items-end border-0 bg-transparent p-0 outline-none"
                            onPointerEnter={() => setHover({ month: p.month, series: s })}
                            onPointerLeave={() => setHover(null)}
                            onFocus={() => setHover({ month: p.month, series: s })}
                            onBlur={() => setHover(null)}
                            aria-label={`${s.label}, ${monthLabel(p.month)}: ${formatMoney(value)}`}
                          >
                            {/* Keyed on the value so new filters replay the rise. */}
                            <span
                              key={value}
                              className="viz-grow-y block w-full rounded-t-[4px] transition-opacity"
                              style={{ height, background: s.color, opacity: hover && !active ? 0.55 : 1, animationDelay: `${monthIndex * 70}ms` }}
                            />
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-2 flex justify-around text-[11px] text-muted">
                {points.map((p) => (
                  <span key={p.month}>{monthLabel(p.month)}</span>
                ))}
              </div>
              {hover && hovered ? (
                <div className="pointer-events-none absolute right-0 top-0 rounded-ui border border-ui bg-surface px-3 py-2 text-[12px] shadow-ui">
                  <div className="mb-1 text-muted">{monthLabel(hovered.month)}</div>
                  {SERIES.map((s) => (
                    <div key={s.key} className="flex items-center gap-2">
                      <span className="inline-block h-[2px] w-[10px]" style={{ background: s.color }} aria-hidden />
                      <b className="tabular-nums text-ink">{formatMoney(hovered[s.key])}</b>
                      <span className="text-muted">{s.label}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
