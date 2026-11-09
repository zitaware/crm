'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import {
  DEDUCTION_TYPE_LABEL,
  ReceiptStatusTag,
  RecordPaymentModal,
  ReleaseModal,
  type ClientReceiptRow,
  type ReleaseDeductionTarget,
} from './shared';
import type { OutstandingDeduction } from '@zitaware/contracts';

interface Filters {
  projectId?: string | undefined;
  legalEntityId?: string | undefined;
  status?: 'POSTED' | 'REVERSED' | undefined;
}

const PAGE_SIZE = 25;

export default function PaymentIntegrationPage() {
  const router = useRouter();
  const projects = trpc.projects.list.useQuery();
  const legalEntities = trpc.legalEntities.list.useQuery();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canRelease = permissions.includes('deduction.release');
  const canRecordPayment = permissions.includes('receipt.post');
  const outstanding = trpc.receipts.getOutstandingDeductions.useQuery({ projectId: undefined });
  const outstandingRows = outstanding.data ?? [];
  const [releasingDeduction, setReleasingDeduction] = useState<ReleaseDeductionTarget | null>(null);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);

  const outstandingColumns: ColumnsType<OutstandingDeduction> = [
    { title: 'Invoice', dataIndex: 'invoiceNumber', key: 'invoiceNumber', render: (v: string | null) => v ?? '—' },
    { title: 'Type', key: 'type', render: (_v, row) => DEDUCTION_TYPE_LABEL[row.type] ?? row.type },
    { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: (v: string) => formatMoney(v) },
    { title: 'Outstanding', dataIndex: 'outstandingAmount', key: 'outstandingAmount', align: 'right', render: (v: string) => formatMoney(v) },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_v, row) =>
        canRelease ? (
          <Button size="small" onClick={() => setReleasingDeduction(row)}>
            Release…
          </Button>
        ) : null,
    },
  ];

  const [draftProjectId, setDraftProjectId] = useState<string | undefined>(undefined);
  const [draftLegalEntityId, setDraftLegalEntityId] = useState<string | undefined>(undefined);
  const [draftStatus, setDraftStatus] = useState<Filters['status']>(undefined);
  const [appliedFilters, setAppliedFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);

  const list = trpc.receipts.list.useQuery({ page, pageSize: PAGE_SIZE, filters: appliedFilters });

  const applyFilters = () => {
    setAppliedFilters({ projectId: draftProjectId, legalEntityId: draftLegalEntityId, status: draftStatus });
    setPage(1);
  };
  const resetFilters = () => {
    setDraftProjectId(undefined);
    setDraftLegalEntityId(undefined);
    setDraftStatus(undefined);
    setAppliedFilters({});
    setPage(1);
  };

  const rows = (list.data?.rows ?? []) as ClientReceiptRow[];
  const total = list.data?.total ?? 0;

  const columns: ColumnsType<ClientReceiptRow> = [
    {
      title: 'Project / Client',
      key: 'project',
      render: (_v, row) => (
        <div>
          <div>{row.projectNames.join(', ') || '—'}</div>
          <div className="text-[11.5px] text-muted">{row.clientName}</div>
        </div>
      ),
    },
    { title: 'Against', key: 'invoiceNumbers', render: (_v, row) => row.invoiceNumbers.join(', ') || '—' },
    { title: 'Date', dataIndex: 'receiptDate', key: 'receiptDate', render: (v: string) => formatDate(v) },
    { title: 'Bank Account', dataIndex: 'bankAccountName', key: 'bankAccountName' },
    { title: 'Mode', dataIndex: 'paymentModeLabel', key: 'paymentModeLabel' },
    { title: 'Amount', dataIndex: 'actualAmount', key: 'actualAmount', align: 'right', render: (v: string) => formatMoney(v) },
    { title: 'Status', key: 'status', render: (_v, row) => <ReceiptStatusTag status={row.status} /> },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_v, row) =>
        row.projectIds[0] ? (
          <Button size="small" onClick={() => router.push(`/projects/${row.projectIds[0]}/receipts/${row.id}`)}>
            View
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Payment Integration"
        description="Every client receipt recorded across all projects. Payments are recorded from a finalized invoice's Record Payment action."
        actions={
          canRecordPayment ? (
            <Button type="primary" onClick={() => setRecordPaymentOpen(true)}>
              Record Payment
            </Button>
          ) : undefined
        }
      />

      <UiCard flush>
        <FilterCard
          actions={
            <>
              <Button onClick={resetFilters}>Reset</Button>
              <Button type="primary" onClick={applyFilters}>
                Apply
              </Button>
            </>
          }
        >
          <FilterField label="Project">
            <Select
              allowClear
              placeholder="All projects"
              value={draftProjectId}
              onChange={setDraftProjectId}
              className="w-[220px]"
              options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          </FilterField>
          <FilterField label="Legal entity">
            <Select
              allowClear
              placeholder="All"
              value={draftLegalEntityId}
              onChange={setDraftLegalEntityId}
              className="w-[200px]"
              options={(legalEntities.data ?? []).map((e) => ({ value: e.id, label: e.legalName }))}
            />
          </FilterField>
          <FilterField label="Status">
            <Select
              allowClear
              placeholder="All"
              value={draftStatus}
              onChange={setDraftStatus}
              className="w-[140px]"
              options={[
                { value: 'POSTED', label: 'Posted' },
                { value: 'REVERSED', label: 'Reversed' },
              ]}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<ClientReceiptRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load payments. Please retry.' : undefined}
          emptyTitle="No payments found"
          emptyDescription="Payments recorded against finalized invoices will appear here."
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>

      <UiCard title="Outstanding Holds & Retentions — all projects" className="mt-4">
        <Table<OutstandingDeduction>
          rowKey="id"
          size="small"
          columns={outstandingColumns}
          dataSource={outstandingRows}
          loading={outstanding.isLoading}
          pagination={false}
          tableLayout="auto"
          scroll={{ x: true }}
          locale={{ emptyText: 'No outstanding holds or retentions.' }}
        />
      </UiCard>

      <ReleaseModal
        deduction={releasingDeduction}
        onClose={() => setReleasingDeduction(null)}
        onSuccess={() => {
          setReleasingDeduction(null);
          void outstanding.refetch();
        }}
      />

      <RecordPaymentModal open={recordPaymentOpen} onClose={() => setRecordPaymentOpen(false)} />
    </>
  );
}
