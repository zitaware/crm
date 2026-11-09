'use client';

import { useState } from 'react';
import { Button, Table } from 'antd';
import { AGING_BUCKET_LABELS } from '@zitaware/contracts/reports';
import type { AgingBucketTotal } from '@zitaware/contracts';
import { formatMoney } from '@/lib/format';

// Ordinal: the buckets are ordered by age, so one hue runs light (not due)
// to dark (90+ days). Both ramps pass the dataviz validator's --ordinal checks.
const RAMPS = {
  blue: ['--viz-age-blue-1', '--viz-age-blue-2', '--viz-age-blue-3', '--viz-age-blue-4', '--viz-age-blue-5'],
  orange: ['--viz-age-orange-1', '--viz-age-orange-2', '--viz-age-orange-3', '--viz-age-orange-4', '--viz-age-orange-5'],
} as const;

/** An ageing report's own bucket totals as horizontal bars, oldest darkest. */
export function AgingChart({ buckets, ramp, countLabel }: { buckets: AgingBucketTotal[]; ramp: keyof typeof RAMPS; countLabel: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  // Bar length only — geometry, never an accounting figure.
  const longest = Math.max(0, ...buckets.map((b) => Number(b.amount)));

  return (
    <div className="viz-root">
      <div className="mb-3 flex items-center text-[12px] text-muted">
        <span>Lighter is newer, darker is older.</span>
        <Button size="small" type="link" className="ml-auto px-0" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Show chart' : 'Show table'}
        </Button>
      </div>

      {showTable ? (
        <Table<AgingBucketTotal>
          rowKey="bucket"
          size="small"
          pagination={false}
          dataSource={buckets}
          columns={[
            { title: 'Age', dataIndex: 'bucket', key: 'bucket', render: (v: AgingBucketTotal['bucket']) => AGING_BUCKET_LABELS[v] },
            { title: countLabel, dataIndex: 'count', key: 'count', align: 'right' },
            { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: formatMoney },
          ]}
        />
      ) : (
        <div className="flex flex-col gap-[10px]">
          {buckets.map((b, index) => {
            const width = longest > 0 ? Math.max(Number(b.amount) > 0 ? 1.5 : 0, (Number(b.amount) / longest) * 100) : 0;
            const active = hover === b.bucket;
            return (
              <button
                key={b.bucket}
                type="button"
                className="grid cursor-default grid-cols-[86px_1fr_auto] items-center gap-3 rounded-[6px] border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-soft"
                onPointerEnter={() => setHover(b.bucket)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(b.bucket)}
                onBlur={() => setHover(null)}
                aria-label={`${AGING_BUCKET_LABELS[b.bucket]}: ${formatMoney(b.amount)}, ${b.count} ${countLabel.toLowerCase()}`}
              >
                <span className="text-[12px] text-muted">{AGING_BUCKET_LABELS[b.bucket]}</span>
                <span className="relative h-[18px] rounded-[4px] bg-paper">
                  <span
                    key={b.amount}
                    className="viz-grow-x absolute inset-y-0 left-0 rounded-[4px] transition-opacity"
                    style={{
                      width: `${width}%`,
                      background: `var(${RAMPS[ramp][index] ?? RAMPS[ramp][4]})`,
                      opacity: hover && !active ? 0.55 : 1,
                      animationDelay: `${index * 90}ms`,
                    }}
                  />
                </span>
                <span className="min-w-[96px] text-right text-[12.5px] tabular-nums">
                  <b className="text-ink">{formatMoney(b.amount)}</b>
                  <span className={`block text-[11px] text-muted transition-opacity ${active ? 'opacity-100' : 'opacity-70'}`}>
                    {b.count} {countLabel.toLowerCase()}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
