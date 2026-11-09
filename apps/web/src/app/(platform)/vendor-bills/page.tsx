'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { VendorBillStatusTag, type VendorBillRow, type VendorBillStatus } from './shared';

interface Filters {
  projectId?: string | undefined;
  vendorId?: string | undefined;
  status?: VendorBillStatus | undefined;
}

const PAGE_SIZE = 25;

export default function VendorBillsPage() {
  const router = useRouter();
  const projects = trpc.projects.list.useQuery();
  const vendors = trpc.vendors.list.useQuery({ includeInactive: false });
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canCreate = permissions.includes('vendor_bill.create');

  const [draftProjectId, setDraftProjectId] = useState<string | undefined>(undefined);
  const [draftVendorId, setDraftVendorId] = useState<string | undefined>(undefined);
  const [draftStatus, setDraftStatus] = useState<VendorBillStatus | undefined>(undefined);
  const [appliedFilters, setAppliedFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);

  const list = trpc.vendorBills.list.useQuery({ page, pageSize: PAGE_SIZE, filters: appliedFilters });

  const applyFilters = () => {
    setAppliedFilters({ projectId: draftProjectId, vendorId: draftVendorId, status: draftStatus });
    setPage(1);
  };
  const resetFilters = () => {
    setDraftProjectId(undefined);
    setDraftVendorId(undefined);
    setDraftStatus(undefined);
    setAppliedFilters({});
    setPage(1);
  };

  const rows = (list.data?.rows ?? []) as VendorBillRow[];
  const total = list.data?.total ?? 0;

  const columns: ColumnsType<VendorBillRow> = [
    {
      title: 'Bill',
      key: 'vendorBillNumber',
      render: (_v, row) => (
        <div>
          <div className="font-semibold text-ink">{row.vendorBillNumber}</div>
          <div className="text-[11.5px] text-muted">{formatDate(row.vendorBillDate)}</div>
        </div>
      ),
    },
    { title: 'Vendor', dataIndex: 'vendorName', key: 'vendorName' },
    { title: 'Project', dataIndex: 'projectName', key: 'projectName', render: (v: string | null) => v ?? 'Company overhead' },
    {
      title: 'Amount',
      key: 'amount',
      align: 'right',
      render: (_v, row) => formatMoney(row.totalAmount ?? '0'),
    },
    { title: 'Status', key: 'status', render: (_v, row) => <VendorBillStatusTag status={row.status} /> },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_v, row) => (
        <Button size="small" onClick={() => router.push(`/vendor-bills/${row.id}`)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Vendor Bills"
        description="Supplier invoices raised against a vendor and project, with GST/payable posting on approval."
        actions={
          canCreate ? (
            <Button type="primary" onClick={() => router.push('/vendor-bills/new')}>
              New Vendor Bill
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
          <FilterField label="Vendor">
            <Select
              allowClear
              placeholder="All vendors"
              value={draftVendorId}
              onChange={setDraftVendorId}
              className="w-[200px]"
              options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
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
                { value: 'DRAFT', label: 'Draft' },
                { value: 'SUBMITTED', label: 'Submitted' },
                { value: 'FINALIZED', label: 'Finalized' },
                { value: 'REJECTED', label: 'Rejected' },
                { value: 'CANCELLED', label: 'Cancelled' },
                { value: 'VOID', label: 'Void' },
              ]}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<VendorBillRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load vendor bills. Please retry.' : undefined}
          emptyTitle="No vendor bills found"
          emptyDescription={canCreate ? 'Use "New Vendor Bill" to raise one.' : undefined}
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>
    </>
  );
}
