import type { ReactNode } from 'react';

export interface UiCardProps {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Removes the body's default padding — for content (e.g. a table) that manages its own spacing. */
  flush?: boolean;
  className?: string;
}

/** Canonical card — docs/15-ui-design-system.md §11.1. */
export function UiCard({ title, actions, children, flush, className }: UiCardProps) {
  return (
    <div className={`rounded-ui border border-ui bg-surface shadow-ui ${className ?? ''}`}>
      {title ? (
        <div className="flex items-center gap-[10px] border-b border-ui-2 px-4 py-[13px]">
          <h3 className="text-[14px] font-bold text-ink">{title}</h3>
          {actions ? <div className="ml-auto flex gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </div>
  );
}
