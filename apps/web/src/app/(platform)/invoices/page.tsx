'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { InvoiceStatusTag, collectionColumns, servicePeriodLabel, RaiseInvoiceModal, invoiceListNumber, type InvoiceRow } from './shared';

interface Filters {
  projectId?: string | undefined;
  status?: 'DRAFT' | 'ISSUED' | 'FINALIZED' | 'VOID' | 'CONVERTED' | undefined;
  legalEntityId?: string | undefined;
}

const PAGE_SIZE = 25;

export default function InvoicesPage() {
  const router = useRouter();
  const projects = trpc.projects.list.useQuery();
  const legalEntities = trpc.legalEntities.list.useQuery();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canRaiseInvoice = permissions.includes('invoice.create');

  const [draftProjectId, setDraftProjectId] = useState<string | undefined>(undefined);
  const [draftStatus, setDraftStatus] = useState<Filters['status']>(undefined);
  const [draftLegalEntityId, setDraftLegalEntityId] = useState<string | undefined>(undefined);
  const [appliedFilters, setAppliedFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [raiseOpen, setRaiseOpen] = useState(false);

  const list = trpc.invoices.list.useQuery({ page, pageSize: PAGE_SIZE, filters: appliedFilters });

  const applyFilters = () => {
    setAppliedFilters({ projectId: draftProjectId, status: draftStatus, legalEntityId: draftLegalEntityId });
    setPage(1);
  };
  const resetFilters = () => {
    setDraftProjectId(undefined);
    setDraftStatus(undefined);
    setDraftLegalEntityId(undefined);
    setAppliedFilters({});
    setPage(1);
  };

  const rows = (list.data?.rows ?? []) as InvoiceRow[];
  const total = list.data?.total ?? 0;

  const columns: ColumnsType<InvoiceRow> = [
    {
      title: 'Invoice',
      key: 'invoiceNumber',
      render: (_v, row) => (
        <div>
          <div className="font-mono">{invoiceListNumber(row) ?? <span className="font-sans text-muted-2">Draft</span>}</div>
          <div className="text-[11.5px] text-muted">{row.invoiceDate ? formatDate(row.invoiceDate) : '—'}</div>
          {servicePeriodLabel(row) ? <div className="text-[11.5px] text-muted">{servicePeriodLabel(row)}</div> : null}
        </div>
      ),
    },
    {
      title: 'Project',
      key: 'project',
      render: (_v, row) => (
        <div>
          <div>{row.projectName}</div>
          <div className="text-[11.5px] text-muted">{row.sourceTitle}</div>
        </div>
      ),
    },
    {
      title: 'Amount',
      key: 'amount',
      align: 'right',
      render: (_v, row) => (
        <div>
          <div className="font-medium">{formatMoney(row.totalAmount)}</div>
          <div className="text-[11.5px] text-muted">Taxable {formatMoney(row.taxableAmount)}</div>
          <div className="text-[11.5px] text-muted">
            GST {formatMoney(String((Number(row.cgstAmount ?? 0) + Number(row.sgstAmount ?? 0) + Number(row.igstAmount ?? 0)).toFixed(2)))}
          </div>
        </div>
      ),
    },
    ...collectionColumns<InvoiceRow>((row) => row.collection),
    {
      title: 'Status',
      key: 'status',
      render: (_v, row) => (
        <div>
          <InvoiceStatusTag status={row.status} />
          {row.hasInwardCopy ? <div className="mt-0.5 text-[11.5px] font-semibold text-positive">Inward copy attached</div> : null}
        </div>
      ),
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      // Not pinned: the compact columns fit the page, so nothing scrolls under it.
      fixed: false,
      render: (_v, row) => (
        <Button size="small" onClick={() => router.push(`/projects/${row.projectId}/invoices/${row.id}`)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Every tax invoice raised across all projects. Every invoice originates from a payment alert — raise from the Payment Alert tab on a project."
        actions={
          canRaiseInvoice ? (
            <Button type="primary" onClick={() => setRaiseOpen(true)}>
              Add Invoice
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
          <FilterField label="Status">
            <Select
              allowClear
              placeholder="All"
              value={draftStatus}
              onChange={setDraftStatus}
              className="w-[140px]"
              options={[
                { value: 'DRAFT', label: 'Draft' },
                { value: 'ISSUED', label: 'Proforma issued' },
                { value: 'FINALIZED', label: 'Tax invoice' },
                { value: 'CONVERTED', label: 'Proforma kept' },
                { value: 'VOID', label: 'Void' },
              ]}
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
        </FilterCard>

        <EntityTable<InvoiceRow>
          rowKey="id"
          tableLayout="auto"
          scroll={{ x: true }}
          columns={columns}
          dataSource={rows}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load invoices. Please retry.' : undefined}
          emptyTitle="No invoices found"
          emptyDescription="Invoices raised against payment alerts will appear here."
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>

      <RaiseInvoiceModal open={raiseOpen} onClose={() => setRaiseOpen(false)} />
    </>
  );
}
