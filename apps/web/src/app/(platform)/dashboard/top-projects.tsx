'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Table } from 'antd';
import { formatMoney, isCreditBalance } from '@/lib/format';

export interface TopProject {
  projectId: string;
  projectName: string;
  income: string;
  contribution: string;
}

/** Project P&L's own rows, the most income first: one series, so no legend box — the title names it. */
export function TopProjectsChart({ projects }: { projects: TopProject[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  // Bar length only — geometry, never an accounting figure.
  const longest = Math.max(0, ...projects.map((p) => Number(p.income)));

  return (
    <div className="viz-root">
      <div className="mb-3 flex items-center text-[12px] text-muted">
        <span className="inline-flex items-center gap-[6px]">
          <span className="inline-block h-[10px] w-[10px] rounded-[2px]" style={{ background: 'var(--viz-income)' }} aria-hidden />
          Income in the period · contribution after direct cost
        </span>
        <Button size="small" type="link" className="ml-auto px-0" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Show chart' : 'Show table'}
        </Button>
      </div>

      {showTable ? (
        <Table<TopProject>
          rowKey="projectId"
          size="small"
          pagination={false}
          dataSource={projects}
          columns={[
            { title: 'Project', dataIndex: 'projectName', key: 'projectName' },
            { title: 'Income', dataIndex: 'income', key: 'income', align: 'right', render: formatMoney },
            { title: 'Contribution', dataIndex: 'contribution', key: 'contribution', align: 'right', render: formatMoney },
          ]}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {projects.map((p, index) => {
            const width = longest > 0 ? Math.max(1.5, (Number(p.income) / longest) * 100) : 0;
            const active = hover === p.projectId;
            return (
              <Link
                key={p.projectId}
                href={`/projects/${p.projectId}`}
                className="block rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-brand-soft"
                onPointerEnter={() => setHover(p.projectId)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(p.projectId)}
                onBlur={() => setHover(null)}
              >
                <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className={`min-w-0 truncate ${active ? 'text-brand' : 'text-ink'}`}>{p.projectName}</span>
                  <span className="shrink-0 tabular-nums text-muted">
                    Contribution{' '}
                    <b className={isCreditBalance(p.contribution) ? 'text-negative' : 'text-ink-2'}>{formatMoney(p.contribution)}</b>
                  </span>
                </div>
                <div className="relative h-[20px] rounded-[4px] bg-paper">
                  <div
                    key={p.income}
                    className="viz-grow-x absolute inset-y-0 left-0 flex items-center justify-end rounded-[4px] pr-2 transition-opacity"
                    style={{ width: `${width}%`, background: 'var(--viz-income)', opacity: hover && !active ? 0.55 : 1, animationDelay: `${index * 90}ms` }}
                  />
                  <span className="absolute inset-y-0 left-2 flex items-center text-[11.5px] font-semibold tabular-nums text-ink">{formatMoney(p.income)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
