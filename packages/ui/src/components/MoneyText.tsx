import type { ReactNode } from 'react';

export type MoneyTone = 'positive' | 'negative' | 'warning' | 'neutral';

const TONE_TEXT_CLASSES: Record<MoneyTone, string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  warning: 'text-warning',
  neutral: 'text-ink',
};

export interface MoneyTextProps {
  /** docs/15-ui-design-system.md §16.1 — positive (received/credit/profit),
   * negative (deduction/debit/loss), warning (pending/held/outstanding),
   * neutral (standard/contract amounts). Defaults to neutral. */
  tone?: MoneyTone | undefined;
  className?: string | undefined;
  children: ReactNode;
}

/** Thin, tone-aware wrapper around an already-formatted money string —
 * docs/15-ui-design-system.md §21's "safe amount display, alignment and
 * semantic tone" component. Formatting itself (currency symbol, grouping)
 * stays with the caller (e.g. apps/web's `formatMoney`) — this component
 * never touches the raw numeric value. */
export function MoneyText({ tone = 'neutral', className, children }: MoneyTextProps) {
  return <span className={`tabular-nums font-medium ${TONE_TEXT_CLASSES[tone]} ${className ?? ''}`}>{children}</span>;
}
