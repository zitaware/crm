'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { PaymentRequestStatusTag, type PaymentRequestRow, type PaymentRequestStatus } from './shared';

interface Filters {
  vendorId?: string | undefined;
  legalEntityId?: string | undefined;
  status?: PaymentRequestStatus | undefined;
}

const PAGE_SIZE = 25;

export default function PaymentRequestsPage() {
  const router = useRouter();
  const vendors = trpc.vendors.list.useQuery({ includeInactive: false });
  const legalEntities = trpc.legalEntities.list.useQuery({ includeInactive: false });
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canCreate = permissions.includes('payment_request.create');

  const [draftVendorId, setDraftVendorId] = useState<string | undefined>(undefined);
  const [draftLegalEntityId, setDraftLegalEntityId] = useState<string | undefined>(undefined);
  const [draftStatus, setDraftStatus] = useState<PaymentRequestStatus | undefined>(undefined);
  const [appliedFilters, setAppliedFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);

  const list = trpc.paymentRequests.list.useQuery({ page, pageSize: PAGE_SIZE, filters: appliedFilters });

  const applyFilters = () => {
    setAppliedFilters({ vendorId: draftVendorId, legalEntityId: draftLegalEntityId, status: draftStatus });
    setPage(1);
  };
  const resetFilters = () => {
    setDraftVendorId(undefined);
    setDraftLegalEntityId(undefined);
    setDraftStatus(undefined);
    setAppliedFilters({});
    setPage(1);
  };

  const rows = (list.data?.rows ?? []) as PaymentRequestRow[];
  const total = list.data?.total ?? 0;

  const columns: ColumnsType<PaymentRequestRow> = [
    {
      title: 'Request',
      key: 'requestNumber',
      render: (_v, row) => (
        <div>
          <div className="font-semibold text-ink">{row.requestNumber ?? 'Draft'}</div>
          <div className="text-[11.5px] text-muted">{formatDate(row.createdAt)}</div>
        </div>
      ),
    },
    { title: 'Vendor', dataIndex: 'vendorName', key: 'vendorName' },
    { title: 'Legal Entity', dataIndex: 'legalEntityName', key: 'legalEntityName' },
    { title: 'Requested Payment Date', key: 'requestedPaymentDate', render: (_v, row) => formatDate(row.requestedPaymentDate) },
    {
      title: 'Amount',
      key: 'totalRequestedAmount',
      align: 'right',
      render: (_v, row) => formatMoney(row.totalRequestedAmount),
    },
    { title: 'Status', key: 'status', render: (_v, row) => <PaymentRequestStatusTag status={row.status} /> },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_v, row) => (
        <Button size="small" onClick={() => router.push(`/payment-requests/${row.id}`)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Payment Requests"
        description="Authorization/reservation gate before a vendor bill is paid. Raising a request does not create any bank transaction."
        actions={
          canCreate ? (
            <Button type="primary" onClick={() => router.push('/payment-requests/new')}>
              New Payment Request
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
                { value: 'DRAFT', label: 'Draft' },
                { value: 'SUBMITTED', label: 'Submitted' },
                { value: 'APPROVED', label: 'Approved' },
                { value: 'REJECTED', label: 'Rejected' },
                { value: 'CANCELLED', label: 'Cancelled' },
                { value: 'REVOKED', label: 'Revoked' },
              ]}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<PaymentRequestRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load payment requests. Please retry.' : undefined}
          emptyTitle="No payment requests found"
          emptyDescription={canCreate ? 'Use "New Payment Request" to raise one.' : undefined}
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>
    </>
  );
}
