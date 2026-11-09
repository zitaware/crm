import type { ReactNode } from 'react';

export interface FilterCardProps {
  /** Labeled filter fields — each typically an AntD Select/Input/DatePicker wrapped with a label. */
  children: ReactNode;
  /** Apply/Reset (and optionally an in-grid Export) — rendered right-aligned after the fields. */
  actions?: ReactNode;
}

/**
 * Filter bar — docs/15-ui-design-system.md §13.2. Lives inside a table
 * card above the header row (compose it as the first child of `UiCard`
 * with `flush`, followed by `EntityTable`), not as its own bordered card.
 */
export function FilterCard({ children, actions }: FilterCardProps) {
  return (
    <div className="flex flex-wrap items-end gap-[9px] border-b border-ui-2 bg-surface px-4 py-3">
      {children}
      {actions ? <div className="ml-auto flex items-end gap-[9px]">{actions}</div> : null}
    </div>
  );
}

export interface FilterFieldProps {
  label: string;
  children: ReactNode;
}

/** One labeled filter field — uppercase `10.5px/600` muted label per §13.2. */
export function FilterField({ label, children }: FilterFieldProps) {
  return (
    <label className="flex flex-col gap-[3px]">
      <span className="text-[10.5px] font-semibold uppercase tracking-[.04em] text-muted">{label}</span>
      {children}
    </label>
  );
}
