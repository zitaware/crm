'use client';

import { useState } from 'react';
import { Button, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import type { TaxDeductionType, TdsDepositStatus, TdsDepositSummary } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { DepositDetailDrawer, PostDepositDrawer, TYPE_LABELS } from './shared';

const PAGE_SIZE = 25;

/** TDS deposits (challans) — posts docs/06 "TDS deposited" against specific withheld amounts (ADR-113). */
export default function TdsDepositsPage() {
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canPost = permissions.includes('tds_deposit.post');
  const [status, setStatus] = useState<TdsDepositStatus | undefined>();
  const [deductionType, setDeductionType] = useState<TaxDeductionType | undefined>();
  const [page, setPage] = useState(1);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const utils = trpc.useUtils();
  const list = trpc.tdsDeposits.list.useQuery({ status, deductionType });
  const refresh = () => {
    void utils.tdsDeposits.list.invalidate();
    void utils.tdsDeposits.listOutstanding.invalidate();
  };
  const rows = list.data ?? [];

  const columns: ColumnsType<TdsDepositSummary> = [
    { title: 'Deposit Date', dataIndex: 'depositDate', key: 'depositDate', render: (v: string) => formatDate(v) },
    {
      title: 'Challan',
      key: 'challanNumber',
      render: (_v, r) => (
        <button type="button" className="text-left font-semibold text-brand hover:underline" onClick={() => setViewingId(r.id)}>
          {r.challanNumber}
        </button>
      ),
    },
    { title: 'Type', dataIndex: 'deductionType', key: 'deductionType', render: (v: TaxDeductionType) => TYPE_LABELS[v] },
    { title: 'Legal Entity', dataIndex: 'legalEntityName', key: 'legalEntityName' },
    { title: 'Paid From', dataIndex: 'bankAccountName', key: 'bankAccountName' },
    { title: 'Items Paid', dataIndex: 'allocationCount', key: 'allocationCount', align: 'right' },
    { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: (v: string) => formatMoney(v) },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (v: TdsDepositStatus) => <StatusTag status={v} label={v === 'POSTED' ? 'Posted' : 'Reversed'} tone={v === 'POSTED' ? 'pos' : 'neg'} /> },
  ];

  return (
    <>
      <PageHeader
        title="TDS Deposits"
        description="Challans paying TDS and GST-TDS withheld from vendor, direct-expense, introducer and salary payments."
        actions={canPost ? <Button type="primary" onClick={() => setPostOpen(true)}>Record Deposit</Button> : null}
      />

      <UiCard flush className="mb-4">
        <FilterCard>
          <FilterField label="Status">
            <Select allowClear placeholder="All" className="w-[160px]" value={status} onChange={(v?: TdsDepositStatus) => { setStatus(v); setPage(1); }} options={[{ value: 'POSTED', label: 'Posted' }, { value: 'REVERSED', label: 'Reversed' }]} />
          </FilterField>
          <FilterField label="Type">
            <Select allowClear placeholder="All" className="w-[160px]" value={deductionType} onChange={(v?: TaxDeductionType) => { setDeductionType(v); setPage(1); }} options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
          </FilterField>
        </FilterCard>
      </UiCard>

      <UiCard flush>
        <EntityTable<TdsDepositSummary>
          rowKey="id"
          loading={list.isLoading}
          errorMessage={list.isError ? list.error.message : undefined}
          emptyTitle="No deposits"
          emptyDescription="Record a challan to pay tax withheld from payments."
          columns={columns}
          dataSource={rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
          page={page}
          pageSize={PAGE_SIZE}
          total={rows.length}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>

      <PostDepositDrawer open={postOpen} onClose={() => setPostOpen(false)} onPosted={(id) => { refresh(); setViewingId(id); }} />
      <DepositDetailDrawer id={viewingId} onClose={() => setViewingId(null)} canPost={canPost} onChanged={refresh} />
    </>
  );
}
