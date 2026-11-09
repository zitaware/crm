'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import dayjs from 'dayjs';
import { Alert, App, Button, Dropdown, Input, Select, Table } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import type { ColumnsType } from 'antd/es/table';
import { FilterCard, FilterField, KpiCard, PageHeader, UiCard } from '@zitaware/ui';
import type { BankBookLineRow, BankStatementLineRow } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { ImportStatementModal, LineStatusTag, signed } from './shared';
import { MonthReconciliationCard } from './period-card';
import { bankAccountLabel } from '@/components/bank-account-fields';

/** Bank Transaction Import and Reconciliation — docs/04 §18 (ADR-114). */
export default function BankReconciliationPage() {
  const { message, modal } = App.useApp();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canManage = permissions.includes('bank_reconciliation.manage');
  const canApprove = permissions.includes('bank_reconciliation.approve');
  const bankAccounts = trpc.legalEntities.listBankAccounts.useQuery({ includeInactive: false });
  const [bankAccountId, setBankAccountId] = useState<string | undefined>();
  const [range, setRange] = useState<[string, string]>(() => [dayjs().startOf('month').format('YYYY-MM-DD'), dayjs().endOf('month').format('YYYY-MM-DD')]);
  const accountId = bankAccountId ?? bankAccounts.data?.[0]?.id;
  const utils = trpc.useUtils();
  const workspace = trpc.bankReconciliation.getWorkspace.useQuery({ bankAccountId: accountId ?? '', from: range[0], to: range[1] }, { enabled: Boolean(accountId) });
  const [importOpen, setImportOpen] = useState(false);
  const [selectedStatement, setSelectedStatement] = useState<string[]>([]);
  const [selectedBook, setSelectedBook] = useState<string[]>([]);
  const refresh = () => {
    setSelectedStatement([]);
    setSelectedBook([]);
    void utils.bankReconciliation.getWorkspace.invalidate();
    void utils.bankReconciliation.getStatement.invalidate();
    void utils.bankReconciliation.listPeriods.invalidate();
  };
  const onError = (e: { message: string }) => message.error(e.message);
  const autoMatch = trpc.bankReconciliation.autoMatch.useMutation({ onSuccess: (r) => { message.success(r.matchCount ? `${r.matchCount} line(s) matched.` : 'No unique matches found.'); refresh(); }, onError });
  const matchSelected = trpc.bankReconciliation.matchSelected.useMutation({ onSuccess: (r) => { message.success(`Matched (${r.matchCount} pair${r.matchCount === 1 ? '' : 's'}).`); refresh(); }, onError });
  const unmatch = trpc.bankReconciliation.unmatchStatementLine.useMutation({ onSuccess: refresh, onError });
  const markException = trpc.bankReconciliation.markException.useMutation({ onSuccess: refresh, onError });
  const approveException = trpc.bankReconciliation.approveException.useMutation({ onSuccess: refresh, onError });
  const clearException = trpc.bankReconciliation.clearException.useMutation({ onSuccess: refresh, onError });
  const data = workspace.data;

  const askReason = (title: string, onReason: (reason: string) => void) => {
    let reason = '';
    modal.confirm({
      title,
      content: <Input.TextArea rows={3} placeholder="Reason (required)" onChange={(e) => (reason = e.target.value)} />,
      okText: 'Confirm',
      onOk: () => {
        if (reason.trim().length < 3) {
          message.error('Give a reason.');
          return Promise.reject(new Error('reason required'));
        }
        onReason(reason.trim());
        return undefined;
      },
    });
  };

  const statementColumns: ColumnsType<BankStatementLineRow> = useMemo(
    () => [
      { title: 'Date', dataIndex: 'transactionDate', key: 'transactionDate', width: 110, render: (v: string) => formatDate(v) },
      { title: 'Description', key: 'description', render: (_v, r) => <div><div>{r.description}</div>{r.reference ? <div className="text-[12px] text-muted">{r.reference}</div> : null}{r.exceptionReason ? <div className="text-[12px] text-muted">Exception: {r.exceptionReason}</div> : null}</div> },
      { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: signed },
      { title: 'Open', dataIndex: 'remaining', key: 'remaining', align: 'right', render: (v: string) => (v === '0.00' ? '—' : formatMoney(v)) },
      { title: 'Status', key: 'status', render: (_v, r) => <LineStatusTag status={r.status} exception={r.exception} /> },
      {
        title: '',
        key: 'actions',
        width: 60,
        render: (_v, r) => {
          const items = [
            ...(canManage && r.status !== 'UNMATCHED' ? [{ key: 'unmatch', label: 'Unmatch', onClick: () => askReason('Unmatch this statement line?', (reason) => unmatch.mutate({ statementLineId: r.id, reason })) }] : []),
            ...(canManage && r.status === 'UNMATCHED' && r.exception === 'NONE' ? [{ key: 'exception', label: 'Mark as exception', onClick: () => askReason('Why will no book entry match this line?', (reason) => markException.mutate({ statementLineId: r.id, reason })) }] : []),
            ...(canApprove && r.exception === 'PENDING_APPROVAL' ? [{ key: 'approve', label: 'Approve exception', onClick: () => approveException.mutate({ statementLineId: r.id }) }] : []),
            ...(canManage && r.exception !== 'NONE' && (r.exception === 'PENDING_APPROVAL' || canApprove) ? [{ key: 'clear', label: 'Clear exception', onClick: () => askReason('Clear this exception?', (reason) => clearException.mutate({ statementLineId: r.id, reason })) }] : []),
          ];
          return items.length ? (
            <Dropdown menu={{ items }} trigger={['click']}>
              <Button size="small">⋯</Button>
            </Dropdown>
          ) : null;
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canManage, canApprove],
  );

  const bookColumns: ColumnsType<BankBookLineRow> = [
    { title: 'Date', dataIndex: 'accountingDate', key: 'accountingDate', width: 110, render: (v: string) => formatDate(v) },
    { title: 'Entry', key: 'description', render: (_v, r) => <Link href={`/journal-entries/${r.journalEntryId}`} className="text-brand hover:underline">{r.description}</Link> },
    { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: signed },
    { title: 'Open', dataIndex: 'remaining', key: 'remaining', align: 'right', render: (v: string) => (v === '0.00' ? '—' : formatMoney(v)) },
    { title: 'Status', key: 'status', render: (_v, r) => <LineStatusTag status={r.status} /> },
  ];

  const s = data?.summary;
  return (
    <>
      <PageHeader
        title="Bank Reconciliation"
        description="Import the bank's statement and match it, month by month, to what the books recorded."
        actions={
          canManage && accountId ? (
            <>
              <Button onClick={() => setImportOpen(true)}>Import Statement</Button>
              <Button loading={autoMatch.isPending} onClick={() => autoMatch.mutate({ bankAccountId: accountId, from: range[0], to: range[1] })}>
                Auto-match
              </Button>
              <Button
                type="primary"
                disabled={!selectedStatement.length || !selectedBook.length}
                loading={matchSelected.isPending}
                onClick={() => matchSelected.mutate({ bankAccountId: accountId, statementLineIds: selectedStatement, journalLineIds: selectedBook })}
              >
                Match Selected ({selectedStatement.length} ↔ {selectedBook.length})
              </Button>
            </>
          ) : null
        }
      />

      <UiCard flush className="mb-4">
        <FilterCard>
          <FilterField label="Bank Account">
            <Select className="w-[280px]" loading={bankAccounts.isLoading} value={accountId ?? null} onChange={(v: string) => { setBankAccountId(v); refresh(); }} options={(bankAccounts.data ?? []).map((b) => ({ value: b.id, label: bankAccountLabel(b) }))} />
          </FilterField>
          <FilterField label="Month">
            <DatePicker
              picker="month"
              allowClear={false}
              format="MMM YYYY"
              className="w-[160px]"
              value={dayjs(range[0])}
              onChange={(v) => {
                if (!v) return;
                setRange([v.startOf('month').format('YYYY-MM-DD'), v.endOf('month').format('YYYY-MM-DD')]);
                refresh();
              }}
            />
          </FilterField>
        </FilterCard>
      </UiCard>

      {workspace.isError ? <Alert type="error" showIcon className="mb-4" message={workspace.error.message} /> : null}
      {!bankAccounts.isLoading && !bankAccounts.data?.length ? <Alert type="info" showIcon className="mb-4" message="No bank accounts yet. Add one under Legal Entities." /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Statement In / Out" value={s ? `${formatMoney(s.statementIn)} / ${formatMoney(s.statementOut)}` : '—'} sub="Lines dated in the period" />
        <KpiCard label="Books In / Out" value={s ? `${formatMoney(s.bookIn)} / ${formatMoney(s.bookOut)}` : '—'} sub="Bank journal lines in the period" />
        <KpiCard label="Statement Not Explained" value={s ? formatMoney(s.unmatchedStatementAmount) : '—'} sub={s ? `${s.unmatchedStatementCount} line(s) unmatched · ${s.pendingExceptionCount} exception(s) awaiting approval` : undefined} />
        <KpiCard label="Books Not Yet in Bank" value={s ? formatMoney(s.unmatchedBookAmount) : '—'} sub={s ? `${s.unmatchedBookCount} entr${s.unmatchedBookCount === 1 ? 'y' : 'ies'} uncleared` : undefined} />
      </div>

      {accountId ? <MonthReconciliationCard key={`${accountId}-${range[0]}`} bankAccountId={accountId} month={range[0].slice(0, 7)} canManage={canManage} canApprove={canApprove} onChanged={refresh} /> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <UiCard title="Bank Statement" flush>
          <Table<BankStatementLineRow>
            rowKey="id"
            size="small"
            pagination={{ pageSize: 50, hideOnSinglePage: true }}
            loading={workspace.isLoading}
            columns={statementColumns}
            dataSource={data?.statementLines ?? []}
            tableLayout="auto" scroll={{ x: true }}
            {...(canManage ? { rowSelection: { selectedRowKeys: selectedStatement, onChange: (keys: React.Key[]) => setSelectedStatement(keys as string[]), getCheckboxProps: (r: BankStatementLineRow) => ({ disabled: r.status === 'MATCHED' || r.exception !== 'NONE' }) } } : {})}
            locale={{ emptyText: 'No statement lines in this period. Import the bank statement.' }}
          />
        </UiCard>
        <UiCard title="Books (Bank Ledger)" flush>
          <Table<BankBookLineRow>
            rowKey="journalLineId"
            size="small"
            pagination={{ pageSize: 50, hideOnSinglePage: true }}
            loading={workspace.isLoading}
            columns={bookColumns}
            dataSource={data?.bookLines ?? []}
            tableLayout="auto" scroll={{ x: true }}
            {...(canManage ? { rowSelection: { selectedRowKeys: selectedBook, onChange: (keys: React.Key[]) => setSelectedBook(keys as string[]), getCheckboxProps: (r: BankBookLineRow) => ({ disabled: r.status === 'MATCHED' }) } } : {})}
            locale={{ emptyText: 'Nothing posted to this bank account in the period.' }}
          />
        </UiCard>
      </div>
      <p className="mt-3 text-[12px] text-muted">
        Older lines still open carry forward into every later period. Select lines on both sides whose open amounts add up to the same total to match them; a statement line
        nothing in the books will match is marked as an exception, which someone else approves.
      </p>

      {accountId ? <ImportStatementModal bankAccountId={accountId} profile={data?.profile ?? null} open={importOpen} onClose={() => setImportOpen(false)} onImported={refresh} /> : null}
    </>
  );
}
