'use client';

import { Suspense, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { App, Button, Input, Modal, Select, Table } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { MoneyInput, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import type { LedgerLinkedAccount } from '@zitaware/contracts';
import { formatDate, formatMoney } from '@/lib/format';
import { DateInput } from '@/components/date-input';
import { completeIsoRange } from '@/lib/dates';

const { RangePicker } = DatePicker;

interface AccountRow {
  id: string;
  code: string;
  name: string;
  normalBalance: string;
  accountGroupName: string;
  linkedAccounts: LedgerLinkedAccount[];
}

interface LedgerActivityRow {
  id: string;
  journalEntryId: string;
  accountingDate: string;
  postingEvent: string;
  sourceType: string;
  sourceId: string;
  debitAmount: string;
  creditAmount: string;
  runningBalance: string;
  narrative: string | null;
}

function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/** getLedgerActivity signs every balance so a positive number always means
 * "in this account's own normal direction" (Dr for a debit-normal account
 * like Bank, Cr for a credit-normal account) and negative means the
 * opposite — standard accounting Dr/Cr notation reads that sign, it never
 * shows a bare positive/negative number to the viewer. */
function formatDrCr(value: string, normalBalance: string): string {
  const amount = Number(value);
  const isNormalSide = amount >= 0;
  const suffix = normalBalance === 'DEBIT' ? (isNormalSide ? 'Dr' : 'Cr') : isNormalSide ? 'Cr' : 'Dr';
  return `${formatMoney(Math.abs(amount).toFixed(2))} ${suffix}`;
}

function LedgerActivityPageInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const accountId = String(params.accountId ?? '');
  const { message } = App.useApp();

  const utils = trpc.useUtils();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canSetOpeningBalance = permissions.includes('ledger_opening_balance.set');

  const accountsList = trpc.chartOfAccounts.listAccounts.useQuery({ includeInactive: true });
  const accounts = (accountsList.data ?? []) as AccountRow[];
  const account = accounts.find((row) => row.id === accountId);

  const [range, setRange] = useState<[string, string] | null>(null);
  const legalEntities = trpc.legalEntities.list.useQuery();
  // Carried over from the URL when arriving via the ledger switcher below,
  // so switching accounts doesn't silently reset back to the default legal
  // entity.
  const [legalEntityId, setLegalEntityId] = useState<string | undefined>(searchParams.get('legalEntityId') ?? undefined);
  const effectiveLegalEntityId = legalEntityId ?? legalEntities.data?.[0]?.id;

  const switchLedger = (nextAccountId: string) => {
    const query = effectiveLegalEntityId ? `?legalEntityId=${effectiveLegalEntityId}` : '';
    router.push(`/chart-of-accounts/ledger/${nextAccountId}${query}`);
  };

  const activity = trpc.journal.getLedgerActivity.useQuery(
    { ledgerAccountId: accountId, legalEntityId: effectiveLegalEntityId, dateFrom: range?.[0], dateTo: range?.[1] },
    { enabled: !!effectiveLegalEntityId && !!accountId },
  );
  const openingBalance = trpc.ledgerOpeningBalances.getForAccount.useQuery(
    { legalEntityId: effectiveLegalEntityId ?? '', ledgerAccountId: accountId },
    { enabled: !!effectiveLegalEntityId && !!accountId },
  );
  const rows = (activity.data?.rows ?? []) as LedgerActivityRow[];

  const invalidate = () =>
    Promise.all([utils.journal.getLedgerActivity.invalidate(), utils.ledgerOpeningBalances.getForAccount.invalidate()]);

  const [setModalOpen, setSetModalOpen] = useState(false);
  const [setAsOfDate, setSetAsOfDate] = useState('');
  const [setAmount, setSetAmount] = useState('');
  const [setKey, setSetKey] = useState(newIdempotencyKey());

  const setMutation = trpc.ledgerOpeningBalances.set.useMutation({
    onSuccess: async () => {
      message.success('Opening balance set.');
      setSetModalOpen(false);
      setSetAsOfDate('');
      setSetAmount('');
      setSetKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidAccountingDate, setVoidAccountingDate] = useState('');
  const [voidKey, setVoidKey] = useState(newIdempotencyKey());

  const voidMutation = trpc.ledgerOpeningBalances.void.useMutation({
    onSuccess: async () => {
      message.success('Opening balance voided.');
      setVoidModalOpen(false);
      setVoidReason('');
      setVoidKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  if (accountsList.isLoading) {
    return (
      <>
        <PageHeader title="Ledger" description="Loading…" />
      </>
    );
  }
  if (!account) {
    return (
      <>
        <PageHeader title="Ledger" description="Could not find this ledger account." />
      </>
    );
  }

  const columns: ColumnsType<LedgerActivityRow> = [
    { title: 'Date', dataIndex: 'accountingDate', key: 'accountingDate', width: 120, render: (v: string) => formatDate(v) },
    {
      title: 'Source',
      key: 'source',
      render: (_v, row) => (
        <div>
          <div className="text-ink">{row.postingEvent}</div>
          <div className="text-[11.5px] text-muted">
            {row.sourceType} · {row.sourceId.slice(0, 8)}…
          </div>
        </div>
      ),
    },
    { title: 'Debit', dataIndex: 'debitAmount', key: 'debitAmount', align: 'right', render: (v: string) => (Number(v) > 0 ? formatMoney(v) : '—') },
    { title: 'Credit', dataIndex: 'creditAmount', key: 'creditAmount', align: 'right', render: (v: string) => (Number(v) > 0 ? formatMoney(v) : '—') },
    {
      title: 'Balance',
      dataIndex: 'runningBalance',
      key: 'runningBalance',
      align: 'right',
      render: (v: string) => formatDrCr(v, account.normalBalance),
    },
  ];

  return (
    <>
      <PageHeader
        title={`Ledger — ${account.code} ${account.name}`}
        actions={
          <div className="flex items-center gap-2">
            <Select
              showSearch
              optionFilterProp="label"
              className="w-[260px]"
              placeholder="Switch ledger…"
              value={accountId}
              onChange={switchLedger}
              options={accounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }))}
            />
            <Button onClick={() => router.push('/chart-of-accounts')}>Back to Chart of Accounts</Button>
          </div>
        }
      />

      {account.linkedAccounts.map((a) => (
        <UiCard key={a.id} className="mb-4" title={a.kind === 'CREDIT_CARD' ? 'Credit card details' : 'Bank account details'}>
          <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                [a.kind === 'CREDIT_CARD' ? 'Card' : 'Account name', a.name],
                [a.kind === 'CREDIT_CARD' ? 'Issuer' : 'Bank', a.bankName],
                [a.kind === 'CREDIT_CARD' ? 'Card number' : 'Account number', a.number],
                ...(a.kind === 'BANK_ACCOUNT' ? ([['IFSC', a.ifsc]] as const) : []),
                ['Legal entity', a.legalEntityName],
                ['Group', account.accountGroupName],
                ['Status', a.isActive ? 'Active' : 'Inactive'],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <dt className="w-[120px] shrink-0 text-muted">{label}</dt>
                <dd className="m-0 font-medium text-ink">{value ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </UiCard>
      ))}

      <UiCard flush>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ui-2 p-4">
          <div className="flex items-center gap-2">
            <Select
              className="w-[200px]"
              placeholder="Legal entity"
              value={effectiveLegalEntityId}
              onChange={setLegalEntityId}
              loading={legalEntities.isLoading}
              options={(legalEntities.data ?? []).map((e) => ({ value: e.id, label: e.legalName }))}
            />
            <RangePicker
              value={range ? [dayjs(range[0]), dayjs(range[1])] : null}
              onChange={(picked) => setRange(completeIsoRange(picked))}
            />
          </div>
          {activity.data ? (
            <div className="text-[13px]">
              <span className="text-muted">Opening: </span>
              <span className="text-ink">{formatDrCr(activity.data.openingBalance, account.normalBalance)}</span>
              <span className="ml-3 text-muted">Closing: </span>
              <span className="font-semibold text-ink">{formatDrCr(activity.data.closingBalance, account.normalBalance)}</span>
            </div>
          ) : null}
        </div>

        <div className="p-4 pb-0">
          <div className="mb-3 rounded-ui border border-ui bg-paper p-3 text-[12.5px]">
            {openingBalance.data ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-ink">
                  Opening balance: <b>{formatDrCr(openingBalance.data.amount, account.normalBalance)}</b> as of{' '}
                  {formatDate(openingBalance.data.asOfDate)}
                </span>
                {canSetOpeningBalance ? (
                  <Button
                    size="small"
                    danger
                    onClick={() => {
                      setVoidAccountingDate(new Date().toISOString().slice(0, 10));
                      setVoidModalOpen(true);
                    }}
                  >
                    Void…
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted">
                  No opening balance has been entered for this account/legal entity yet — its balance reflects only postings
                  recorded in this system.
                </span>
                {canSetOpeningBalance ? (
                  <Button
                    size="small"
                    onClick={() => {
                      setSetAsOfDate('');
                      setSetAmount('');
                      setSetModalOpen(true);
                    }}
                  >
                    Set Opening Balance…
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <Table<LedgerActivityRow>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={rows}
          loading={activity.isLoading}
          pagination={false}
          tableLayout="auto"
          scroll={{ x: true }}
          locale={{ emptyText: 'No postings yet for this account.' }}
        />
      </UiCard>

      <Modal
        title="Set Opening Balance"
        open={setModalOpen}
        onCancel={() => setSetModalOpen(false)}
        onOk={() =>
          effectiveLegalEntityId &&
          setMutation.mutate({
            legalEntityId: effectiveLegalEntityId,
            ledgerAccountId: accountId,
            asOfDate: setAsOfDate,
            amount: setAmount,
            idempotencyKey: setKey,
          })
        }
        confirmLoading={setMutation.isPending}
        okButtonProps={{ disabled: !setAsOfDate || !setAmount }}
        okText="Set Opening Balance"
      >
        <p className="mb-3 text-muted">
          Posts a normal Dr/Cr journal entry dated the day you choose — the standard way to bring in a balance that already
          existed before this system went live. Enter the amount as it sits on this account&apos;s own{' '}
          {account.normalBalance === 'DEBIT' ? 'debit (Dr)' : 'credit (Cr)'} side; enter a negative number if it&apos;s
          sitting on the opposite side instead.
        </p>
        <label className="flex flex-col gap-[3px]">
          <span className="text-[12.5px] font-semibold text-text">As of date</span>
          <DateInput value={setAsOfDate} onChange={setSetAsOfDate} />
        </label>
        <label className="mt-3 flex flex-col gap-[3px]">
          <span className="text-[12.5px] font-semibold text-text">Amount</span>
          <MoneyInput value={setAmount} onChange={(value) => setSetAmount(value ?? '')} placeholder="0.00" />
        </label>
      </Modal>

      <Modal
        title="Void Opening Balance"
        open={voidModalOpen}
        onCancel={() => setVoidModalOpen(false)}
        onOk={() =>
          openingBalance.data &&
          voidMutation.mutate({
            id: openingBalance.data.id,
            reason: voidReason,
            accountingDate: voidAccountingDate,
            idempotencyKey: voidKey,
          })
        }
        confirmLoading={voidMutation.isPending}
        okButtonProps={{ disabled: !voidReason.trim() || !voidAccountingDate }}
        okText="Void Opening Balance"
      >
        <p className="mb-2 text-muted">This reverses the opening-balance journal entry. Set a fresh one afterward if needed.</p>
        <p className="mb-2 text-muted">Reversal accounting date</p>
        <DateInput value={voidAccountingDate} onChange={setVoidAccountingDate} />
        <p className="mb-2 mt-3 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
      </Modal>
    </>
  );
}

export default function LedgerActivityPage() {
  return (
    <Suspense fallback={null}>
      <LedgerActivityPageInner />
    </Suspense>
  );
}
