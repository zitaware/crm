'use client';

import { useState } from 'react';
import { Alert, App, Button, Descriptions, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { MoneyInput, StatusTag, UiCard, type StatusTagTone } from '@zitaware/ui';
import type { BankReconciliationPeriodRow, BankReconciliationPeriodStatus } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDateTime, formatMoney } from '@/lib/format';

const PERIOD_STATUS: Record<BankReconciliationPeriodStatus, { label: string; tone: StatusTagTone }> = {
  OPEN: { label: 'Open', tone: 'mut' },
  IN_PROGRESS: { label: 'In Progress', tone: 'warn' },
  RECONCILED: { label: 'Reconciled', tone: 'info' },
  LOCKED: { label: 'Locked', tone: 'pos' },
};
export function PeriodStatusTag({ status }: { status: BankReconciliationPeriodStatus }) {
  return <StatusTag status={status} label={PERIOD_STATUS[status].label} tone={PERIOD_STATUS[status].tone} />;
}

const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * docs/05 bank reconciliation period for the chosen month: the server computes
 * the reconciliation statement for the balances entered; nothing is summed here.
 */
export function MonthReconciliationCard({ bankAccountId, month, canManage, canApprove, onChanged }: { bankAccountId: string; month: string; canManage: boolean; canApprove: boolean; onChanged: () => void }) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const [opening, setOpening] = useState<string | undefined>();
  const [closing, setClosing] = useState<string | undefined>();
  const [applied, setApplied] = useState<{ opening: string | undefined; closing: string | undefined }>({ opening: undefined, closing: undefined });
  // The page remounts this card per account and month (its key), so the entered balances start empty.

  const statement = trpc.bankReconciliation.getStatement.useQuery({ bankAccountId, month, statementOpeningBalance: applied.opening, statementClosingBalance: applied.closing });
  const periods = trpc.bankReconciliation.listPeriods.useQuery({ bankAccountId });
  const refresh = () => {
    void utils.bankReconciliation.getStatement.invalidate();
    void utils.bankReconciliation.listPeriods.invalidate();
    onChanged();
  };
  const onError = (e: { message: string }) => message.error(e.message);
  const reconcile = trpc.bankReconciliation.markReconciled.useMutation({ onSuccess: () => { message.success(`${monthLabel(month)} reconciled.`); refresh(); }, onError });
  const lock = trpc.bankReconciliation.lockPeriod.useMutation({ onSuccess: () => { message.success(`${monthLabel(month)} locked.`); refresh(); }, onError });
  const s = statement.data;
  const editable = s && (s.status === 'OPEN' || s.status === 'IN_PROGRESS');

  const periodColumns: ColumnsType<BankReconciliationPeriodRow> = [
    { title: 'Month', dataIndex: 'month', key: 'month', render: monthLabel },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (v: BankReconciliationPeriodStatus) => <PeriodStatusTag status={v} /> },
    { title: 'Statement Closing', dataIndex: 'statementClosingBalance', key: 'statementClosingBalance', align: 'right', render: (v: string | null) => (v ? formatMoney(v) : '—') },
    { title: 'Reconciled', dataIndex: 'preparedAt', key: 'preparedAt', render: (v: string | null) => (v ? formatDateTime(v) : '—') },
    { title: 'Locked', dataIndex: 'lockedAt', key: 'lockedAt', render: (v: string | null) => (v ? formatDateTime(v) : '—') },
  ];

  return (
    <UiCard
      title={
        <span className="flex items-center gap-2">
          Month Reconciliation — {monthLabel(month)} {s ? <PeriodStatusTag status={s.status} /> : null}
        </span>
      }
      className="mb-4"
      actions={
        s ? (
          <>
            {canManage && editable ? (
              <Button type="primary" disabled={s.blockers.length > 0} loading={reconcile.isPending} onClick={() => reconcile.mutate({ bankAccountId, month, statementOpeningBalance: applied.opening, statementClosingBalance: applied.closing! })}>
                Mark Reconciled
              </Button>
            ) : null}
            {canApprove && s.status === 'RECONCILED' ? (
              <Button loading={lock.isPending} onClick={() => lock.mutate({ bankAccountId, month, expectedVersion: s.version! })}>
                Lock Month
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {statement.isError ? <Alert type="error" showIcon className="mb-3" message={statement.error.message} /> : null}
      {s && editable && canManage ? (
        <div className="mb-3 flex flex-wrap items-end gap-3">
          {s.isFirstPeriod ? (
            <label className="flex flex-col gap-1 text-[12px] font-semibold uppercase text-muted">
              Statement opening balance
              <MoneyInput className="w-[200px]" value={opening ?? null} onChange={(v) => setOpening(v ?? undefined)} placeholder="From the bank statement" />
            </label>
          ) : null}
          <label className="flex flex-col gap-1 text-[12px] font-semibold uppercase text-muted">
            Statement closing balance
            <MoneyInput className="w-[200px]" value={closing ?? null} onChange={(v) => setClosing(v ?? undefined)} placeholder="From the bank statement" />
          </label>
          <Button onClick={() => setApplied({ opening, closing })}>Check</Button>
        </div>
      ) : null}
      {s ? (
        <>
          <Descriptions size="small" column={{ xs: 1, md: 2, xl: 4 }} bordered className="mb-3">
            <Descriptions.Item label="Statement opening">{s.statementOpeningBalance ? formatMoney(s.statementOpeningBalance) : '—'}</Descriptions.Item>
            <Descriptions.Item label="Statement lines in month">{formatMoney(s.statementLinesTotal)}</Descriptions.Item>
            <Descriptions.Item label="Statement closing">{s.statementClosingBalance ? formatMoney(s.statementClosingBalance) : '—'}</Descriptions.Item>
            <Descriptions.Item label="Book closing">{formatMoney(s.bookClosingBalance)}</Descriptions.Item>
            <Descriptions.Item label={`Uncleared book entries (${s.unclearedBookCount})`}>{formatMoney(s.unclearedBookAmount)}</Descriptions.Item>
            <Descriptions.Item label="Bank-only items">{formatMoney(s.bankOnlyAmount)}</Descriptions.Item>
            <Descriptions.Item label="Adjusted book balance">{s.adjustedBookBalance ? formatMoney(s.adjustedBookBalance) : '—'}</Descriptions.Item>
            <Descriptions.Item label="Unexplained difference">
              {s.unexplainedDifference === null ? '—' : <b className={s.unexplainedDifference === '0.00' ? 'text-positive' : 'text-negative'}>{formatMoney(s.unexplainedDifference)}</b>}
            </Descriptions.Item>
          </Descriptions>
          {s.blockers.length && editable ? <Alert type="warning" showIcon className="mb-3" message="Not ready to reconcile" description={<ul className="m-0 pl-4">{s.blockers.map((b) => <li key={b}>{b}</li>)}</ul>} /> : null}
          <p className="mt-0 text-[12px] text-muted">
            Adjusted book balance = book closing − book opening at {s.reconciliationStart} + statement opening then − uncleared book entries + bank-only items. A month is reconciled when it
            equals the statement&apos;s closing balance and every statement line is matched or explained; it is locked by someone other than the person who reconciled it.
          </p>
        </>
      ) : null}
      <Table<BankReconciliationPeriodRow> rowKey="month" size="small" pagination={false} loading={periods.isLoading} columns={periodColumns} dataSource={periods.data ?? []} tableLayout="auto" scroll={{ x: true }} locale={{ emptyText: 'No statement months yet.' }} />
    </UiCard>
  );
}
