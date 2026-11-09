'use client';

import { Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { KpiCard, MoneyText, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { absMoney, formatMoney, isCreditBalance } from '../shared';

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip title={text}>
      <InfoCircleOutlined className="ml-1 text-muted" />
    </Tooltip>
  );
}

function BreakdownRow({
  label,
  value,
  tone,
  tip,
  total,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'warning' | 'neutral';
  tip?: string;
  /** A result line: bold, with a rule above it. */
  total?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between py-1.5 text-[13px] ${total ? 'mt-1 border-t border-ui font-semibold' : 'border-b border-ui-2 last:border-b-0'}`}>
      <span className={total ? 'text-ink' : 'text-muted'}>
        {label}
        {tip ? <InfoTip text={tip} /> : null}
      </span>
      <MoneyText tone={tone}>{formatMoney(value)}</MoneyText>
    </div>
  );
}

/** A small heading inside a card, for a group of rows. */
function GroupLabel({ children }: { children: string }) {
  return <div className="mt-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted-2">{children}</div>;
}

/** Project-scoped financial rollup (ADR-089, extended by ADR-097 and ADR-166).
 * Every figure is labelled with its basis: including GST (billing and
 * collection), excluding GST (contract value, billed taxable value, profit),
 * or excluding recoverable GST credit (expense).
 * Recognized Expense now covers all six cost streams, including material,
 * manpower and introducer commission. Profit is shown with its basis named:
 * accrual, GST-exclusive (ADR-166). All figures are server-computed Decimal strings —
 * this component never adds/subtracts money client-side. */
export function FinancialsTab({ projectId }: { projectId: string }) {
  const summary = trpc.projects.getFinancialSummary.useQuery({ projectId });
  const data = summary.data;

  const receivableIsCredit = data ? isCreditBalance(data.clientReceivable) : false;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <UiCard title="Income">
          <BreakdownRow
            label="Billed (excl. GST)"
            value={data?.billedExclGst ?? '0'}
            total
            tip="Invoices plus debit notes less credit notes, before GST. This is the project's income."
          />
          <BreakdownRow label="Billed (incl. GST)" value={data?.netBilled ?? '0'} tip="The same invoices with GST: what the client has to pay." />
          <GroupLabel>Collected</GroupLabel>
          <BreakdownRow label="Received in bank" value={data?.cashReceived ?? '0'} tone="positive" />
          <BreakdownRow label="TDS deducted by client" value={data?.tdsDeducted ?? '0'} />
          <BreakdownRow label="GST-TDS deducted by client" value={data?.gstTdsDeducted ?? '0'} />
          <BreakdownRow label="Retention" value={data?.retentionHeld ?? '0'} />
          <BreakdownRow label="Hold" value={data?.otherHoldAmount ?? '0'} />
          <BreakdownRow label="Penalty" value={data?.penaltyOrWriteOff ?? '0'} />
          <BreakdownRow label="Other deductions" value={data?.otherDeductions ?? '0'} />
          <BreakdownRow
            label={receivableIsCredit ? 'Overpaid by client' : 'Still to collect'}
            value={data ? absMoney(data.clientReceivable) : '0'}
            tone={receivableIsCredit ? 'positive' : 'warning'}
            total
            tip="Unpaid invoices plus hold and retention not yet released."
          />
        </UiCard>

        <UiCard title="Expense">
          <BreakdownRow label="Purchases" value={data?.purchaseExpense ?? '0'} tone="negative" />
          <BreakdownRow label="Material (stock issued)" value={data?.materialExpense ?? '0'} tone="negative" />
          <BreakdownRow label="Server" value={data?.serverExpense ?? '0'} tone="negative" />
          <BreakdownRow label="Subscription" value={data?.subscriptionExpense ?? '0'} tone="negative" />
          <BreakdownRow label="Other direct expenses" value={data?.otherDirectExpense ?? '0'} tone="negative" />
          <BreakdownRow label="Employee expense claims" value={data?.employeeClaimExpense ?? '0'} tone="negative" />
          {/* Shown only when it is non-zero: a permanent "Manpower ₹0.00" row
              reads as an unfinished step, and per-project salary allocation is
              not something this business does (ADR-099). The rollup still
              counts it if anyone ever allocates. */}
          {Number(data?.manpowerExpense ?? '0') !== 0 ? (
            <BreakdownRow label="Manpower (allocated salary)" value={data?.manpowerExpense ?? '0'} tone="negative" />
          ) : null}
          <BreakdownRow label="Introducer commission" value={data?.introducerExpense ?? '0'} tone="negative" />
          <BreakdownRow
            label="Total expense"
            value={data?.recognizedProjectExpense ?? '0'}
            tone="negative"
            total
            tip="Before GST: input GST you can claim back is left out. The Spend tab shows each bill in full."
          />
        </UiCard>
      </div>

      <UiCard title="Summary">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Contract value (excl. GST)"
            value={formatMoney(data?.contractValueExclGst ?? null)}
            sub={
              data?.billedOverContract ? (
                <span className="font-semibold text-warning">Billed {formatMoney(data.billedOverContract)} over it</span>
              ) : data?.billedPercent ? (
                `${data.billedPercent}% billed so far`
              ) : undefined
            }
          />
          <KpiCard label="Income (excl. GST)" value={formatMoney(data?.billedExclGst ?? '0')} />
          <KpiCard label="Expense" value={<MoneyText tone="negative">{formatMoney(data?.recognizedProjectExpense ?? '0')}</MoneyText>} />
          <KpiCard
            label="Profit"
            value={<MoneyText tone={data?.profit.startsWith('-') ? 'negative' : 'positive'}>{formatMoney(data?.profit ?? '0')}</MoneyText>}
            sub={data?.profitMarginPercent ? `Income less expense · ${data.profitMarginPercent}% of income` : 'Income less expense'}
          />
        </div>
        <p className="m-0 mt-3 text-[12px] text-muted">
          Income and expense are both before GST. Work done but not yet billed is not counted as income.
        </p>
      </UiCard>
    </div>
  );
}
