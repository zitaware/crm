'use client';

import type { ReactNode } from 'react';
import { UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { absMoney, formatMoney } from '../shared';

type Tone = 'ink' | 'positive' | 'negative' | 'warning';
const TONE_CLASS: Record<Tone, string> = { ink: 'text-ink', positive: 'text-positive', negative: 'text-negative', warning: 'text-warning' };

/** A thin progress bar; the width is geometry only, the figure is printed beside it. */
function Bar({ percent, colour }: { percent: number; colour: string }) {
  return (
    <div className="mt-2 h-[6px] rounded-full bg-paper" aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, percent))}%`, background: colour }} />
    </div>
  );
}

function StripCell({ label, value, tone = 'ink', sub, bar }: { label: string; value: ReactNode; tone?: Tone; sub?: ReactNode; bar?: ReactNode }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-3">
      {/* Labels and notes wrap rather than cut off; amounts stay on one line. */}
      <div className="text-[11px] font-semibold uppercase leading-snug tracking-[.06em] text-muted">{label}</div>
      <div className={`mt-1 whitespace-nowrap text-[16px] font-semibold tabular-nums ${TONE_CLASS[tone]}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{sub}</div> : null}
      {bar}
    </div>
  );
}

const profitTone = (v: string): Tone => (v.startsWith('-') ? 'negative' : 'positive');

/**
 * The figures every project tab shares (ADR-166): what the contract is
 * worth and how much of it is billed, what came in, what it cost, what it
 * made, the security money out, and how far the work is. Every amount is
 * the API's; nothing is added up here.
 */
export function ProjectKpiStrip({ projectId, physicalPercent }: { projectId: string; physicalPercent: number }) {
  const summary = trpc.projects.getFinancialSummary.useQuery({ projectId });
  const d = summary.data;
  if (!d) return null;
  const billed = d.billedPercent !== null ? Number(d.billedPercent) : null;
  return (
    <div className="mb-4 overflow-hidden rounded-ui border border-ui shadow-ui">
      <div className="grid grid-cols-2 gap-px bg-ui sm:grid-cols-3 xl:grid-cols-6">
        <StripCell label="Contract value" value={formatMoney(d.contractValueExclGst)} sub="Excl. GST" />
        <StripCell
          label="Billed (excl. GST)"
          value={formatMoney(d.billedExclGst)}
          sub={
            d.billedOverContract ? (
              <span className="font-semibold text-warning">{formatMoney(d.billedOverContract)} over contract</span>
            ) : billed !== null ? (
              `${d.billedPercent}% of contract`
            ) : undefined
          }
          bar={billed !== null ? <Bar percent={billed} colour="var(--ui-positive)" /> : undefined}
        />
        <StripCell label="Received in bank" value={formatMoney(d.cashReceived)} tone="positive" sub="After client deductions" />
        <StripCell label="Expense" value={formatMoney(d.recognizedProjectExpense)} tone="negative" sub="Excl. GST credit" />
        <StripCell
          label="Profit (excl. GST)"
          value={formatMoney(d.profit)}
          tone={profitTone(d.profit)}
          sub={d.profitMarginPercent !== null ? `${d.profitMarginPercent}% of billed` : 'Billed less expense'}
        />
        <StripCell label="Physical progress" value={`${physicalPercent}%`} bar={<Bar percent={physicalPercent} colour="var(--ui-brand)" />} />
      </div>
    </div>
  );
}

function Figure({ label, value, tone = 'ink', sub }: { label: string; value: ReactNode; tone?: Tone; sub?: ReactNode }) {
  return (
    <div className="border-b border-ui-2 px-4 py-3 last:border-b-0">
      <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{label}</div>
      <div className={`mt-0.5 text-[18px] font-semibold tabular-nums ${TONE_CLASS[tone]}`}>{value}</div>
      {sub ? <div className="text-[11.5px] text-muted">{sub}</div> : null}
    </div>
  );
}

/** Expense heads in a fixed order, each with its own colour (validated categorical slots), so a head keeps its colour across projects. */
const EXPENSE_HEADS: Array<{ key: 'purchaseExpense' | 'manpowerExpense' | 'serverExpense' | 'subscriptionExpense' | 'otherDirectExpense' | 'employeeClaimExpense' | 'materialExpense' | 'introducerExpense'; label: string; colour: string }> = [
  { key: 'purchaseExpense', label: 'Purchase', colour: '#2a78d6' },
  { key: 'manpowerExpense', label: 'Manpower', colour: '#1baf7a' },
  { key: 'serverExpense', label: 'Server', colour: '#eb6834' },
  { key: 'subscriptionExpense', label: 'Subscription', colour: '#eda100' },
  { key: 'otherDirectExpense', label: 'Other direct expense', colour: '#6250d6' },
  { key: 'employeeClaimExpense', label: 'Expense claims', colour: '#e87ba4' },
  { key: 'materialExpense', label: 'Material', colour: '#008300' },
  { key: 'introducerExpense', label: 'Introducer fee', colour: '#b9b7ae' },
];

/** The Detail tab's right column: the money summary, where the expense went, and the security money out. */
export function ProjectMoneyPanel({ projectId }: { projectId: string }) {
  const summary = trpc.projects.getFinancialSummary.useQuery({ projectId });
  const d = summary.data;
  if (!d) return summary.isLoading ? <UiCard>Loading…</UiCard> : null;
  const heads = EXPENSE_HEADS.filter((h) => Number(d[h.key]) !== 0);
  const credit = d.clientReceivable.startsWith('-');

  return (
    <>
      <UiCard flush>
        <Figure label="Contract value (excl. GST)" value={formatMoney(d.contractValueExclGst)} />
        <Figure
          label="Billed (excl. GST)"
          value={formatMoney(d.billedExclGst)}
          sub={`${d.billedPercent !== null ? `${d.billedPercent}% of contract value · ` : ''}${formatMoney(d.netBilled)} incl. GST`}
        />
        {d.billedOverContract ? (
          <div className="border-b border-ui-2 bg-warning-soft px-4 py-2.5 text-[12.5px] text-ink">
            Billed <b>{formatMoney(d.billedOverContract)}</b> more than the contract value. If the contract has grown, update the contract value on the project.
          </div>
        ) : null}
        <Figure
          label="Received in bank"
          value={formatMoney(d.cashReceived)}
          tone="positive"
          sub={credit ? `Overpaid by ${formatMoney(absMoney(d.clientReceivable))}` : `${formatMoney(d.clientReceivable)} still to collect`}
        />
        <Figure label="Total expense (excl. GST credit)" value={formatMoney(d.recognizedProjectExpense)} tone="negative" />
        <Figure
          label="Profit (excl. GST)"
          value={formatMoney(d.profit)}
          tone={profitTone(d.profit)}
          sub={d.profitMarginPercent !== null ? `Billed (excl. GST) less expense · ${d.profitMarginPercent}% of billed` : 'Nothing billed yet'}
        />
      </UiCard>

      <UiCard
        flush
        title="Expense breakdown"
        actions={<span className="text-[12.5px] font-semibold tabular-nums text-ink">{formatMoney(d.recognizedProjectExpense)}</span>}
      >
        {heads.length === 0 ? (
          <p className="m-0 px-4 py-3 text-[12.5px] text-muted">No expense booked to this project yet.</p>
        ) : (
          heads.map((h) => (
            <div key={h.key} className="flex items-center gap-2.5 border-b border-ui-2 px-4 py-2 text-[13px] last:border-b-0">
              <span className="inline-block h-[10px] w-[10px] shrink-0 rounded-[3px]" style={{ background: h.colour }} aria-hidden />
              <span className="flex-1 text-ink">{h.label}</span>
              <span className="tabular-nums text-ink">{formatMoney(d[h.key])}</span>
            </div>
          ))
        )}
      </UiCard>

      <UiCard flush>
        <Figure label="Hold & retention outstanding" value={formatMoney(d.unreleasedRetentionAndHold)} tone={Number(d.unreleasedRetentionAndHold) > 0 ? 'negative' : 'ink'} />
      </UiCard>
    </>
  );
}
