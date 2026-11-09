'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { VendorPaymentStatusTag, type VendorPaymentRow, type VendorPaymentStatus } from './shared';

interface Filters {
  legalEntityId?: string | undefined;
  status?: VendorPaymentStatus | undefined;
}

const PAGE_SIZE = 25;

export default function VendorPaymentsPage() {
  const router = useRouter();
  const legalEntities = trpc.legalEntities.list.useQuery({ includeInactive: false });

  const [draftLegalEntityId, setDraftLegalEntityId] = useState<string | undefined>(undefined);
  const [draftStatus, setDraftStatus] = useState<VendorPaymentStatus | undefined>(undefined);
  const [appliedFilters, setAppliedFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);

  const list = trpc.vendorPayments.list.useQuery({ page, pageSize: PAGE_SIZE, filters: appliedFilters });

  const applyFilters = () => {
    setAppliedFilters({ legalEntityId: draftLegalEntityId, status: draftStatus });
    setPage(1);
  };
  const resetFilters = () => {
    setDraftLegalEntityId(undefined);
    setDraftStatus(undefined);
    setAppliedFilters({});
    setPage(1);
  };

  const rows = (list.data?.rows ?? []) as VendorPaymentRow[];
  const total = list.data?.total ?? 0;

  const columns: ColumnsType<VendorPaymentRow> = [
    {
      title: 'Vendor',
      key: 'vendorName',
      render: (_v, row) => (
        <div>
          <div className="font-semibold text-ink">{row.vendorName}</div>
          <div className="text-[11.5px] text-muted">{row.vendorBillNumbers.join(', ')}</div>
        </div>
      ),
    },
    { title: 'Legal Entity', dataIndex: 'legalEntityName', key: 'legalEntityName' },
    { title: 'Paid from', key: 'bankAccountName', render: (_v, row) => row.bankAccountName ?? (row.cardAccountLabel ? `Credit card ${row.cardAccountLabel}` : '—') },
    { title: 'Payment Date', key: 'paymentDate', render: (_v, row) => formatDate(row.paymentDate) },
    { title: 'Amount', key: 'actualAmount', align: 'right', render: (_v, row) => formatMoney(row.actualAmount) },
    { title: 'Status', key: 'status', render: (_v, row) => <VendorPaymentStatusTag status={row.status} /> },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_v, row) => (
        <Button size="small" onClick={() => router.push(`/vendor-payments/${row.id}`)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Vendor Payments" description="The final step of the procurement chain — posts Dr Accounts Payable / Cr Bank / Cr TDS & GST-TDS Payable." />

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
          <FilterField label="Legal Entity">
            <Select
              allowClear
              placeholder="All legal entities"
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
              className="w-[160px]"
              options={[
                { value: 'POSTED', label: 'Posted' },
                { value: 'REVERSED', label: 'Reversed' },
              ]}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<VendorPaymentRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load vendor payments. Please retry.' : undefined}
          emptyTitle="No vendor payments found"
          emptyDescription="Record a payment from an approved Payment Request's own page."
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>
    </>
  );
}
