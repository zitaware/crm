import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

/** Shared page header — docs/15-ui-design-system.md §9.1. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-[18px] flex flex-wrap items-start gap-4">
      <div>
        <h1 className="font-display text-[23px] font-bold tracking-[.2px] text-ink">{title}</h1>
        {description ? <p className="mt-[3px] text-[13px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="ml-auto flex flex-wrap items-center gap-[9px]">{actions}</div> : null}
    </div>
  );
}
