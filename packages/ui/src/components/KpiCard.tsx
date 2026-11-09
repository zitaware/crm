import type { ReactNode } from 'react';

export interface KpiCardProps {
  label: string;
  /** Icon rendered in the top-right tile chip (e.g. an @ant-design/icons element). */
  icon?: ReactNode;
  iconClassName?: string;
  value: ReactNode;
  /** Supporting line below the value — e.g. a trend or a count. */
  sub?: ReactNode;
}

/** Dashboard/report statistic tile — docs/15-ui-design-system.md §11.2/§9.4. */
export function KpiCard({ label, icon, iconClassName, value, sub }: KpiCardProps) {
  return (
    <div className="rounded-ui border border-ui bg-surface p-4 shadow-ui">
      <div className="flex items-center gap-[6px] text-[11.5px] font-semibold uppercase tracking-[.05em] text-muted">
        {label}
        {icon ? (
          <span
            className={`ml-auto grid h-[26px] w-[26px] place-items-center rounded-[6px] ${iconClassName ?? 'bg-brand-soft text-brand'}`}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <div className="mt-2 font-display text-[26px] font-bold leading-none tabular-nums text-ink">{value}</div>
      {sub ? <div className="mt-[6px] text-[12px] text-muted">{sub}</div> : null}
    </div>
  );
}
