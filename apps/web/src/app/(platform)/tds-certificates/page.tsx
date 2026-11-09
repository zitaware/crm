'use client';

import { useState } from 'react';
import { Button, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import type { TdsCertificateSource, TdsCertificateStatus, TdsCertificateSummary } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { CertificateDrawer, ImportCertificatesModal, RecordCertificateModal, SOURCE_LABELS, TYPE_LABELS } from './shared';

const PAGE_SIZE = 25;

/** TDS Certificate/26AS Reconciliation — docs/04 §18: record or import credits and match them to deductions (ADR-112). */
export default function TdsCertificatesPage() {
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canManage = permissions.includes('tds_certificate.manage');
  const clients = trpc.clients.list.useQuery({ includeInactive: true });
  const [status, setStatus] = useState<TdsCertificateStatus | undefined>('ACTIVE');
  const [source, setSource] = useState<TdsCertificateSource | undefined>();
  const [partyId, setPartyId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const utils = trpc.useUtils();
  const list = trpc.tdsCertificates.list.useQuery({ status, source, partyId });
  const refresh = () => void utils.tdsCertificates.list.invalidate();
  const rows = list.data ?? [];

  const columns: ColumnsType<TdsCertificateSummary> = [
    { title: 'Credit Date', dataIndex: 'creditDate', key: 'creditDate', render: (v: string) => formatDate(v) },
    {
      title: 'Reference',
      key: 'referenceNumber',
      render: (_v, r) => (
        <button type="button" className="text-left font-semibold text-brand hover:underline" onClick={() => setViewingId(r.id)}>
          {r.referenceNumber}
        </button>
      ),
    },
    { title: 'Client', dataIndex: 'partyName', key: 'partyName' },
    { title: 'Source', dataIndex: 'source', key: 'source', render: (v: TdsCertificateSource) => SOURCE_LABELS[v] },
    { title: 'Type', dataIndex: 'deductionType', key: 'deductionType', render: (v: keyof typeof TYPE_LABELS) => TYPE_LABELS[v] },
    { title: 'Period', key: 'period', render: (_v, r) => `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}` },
    { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: (v: string) => formatMoney(v) },
    { title: 'Matched', dataIndex: 'matchedAmount', key: 'matchedAmount', align: 'right', render: (v: string) => formatMoney(v) },
    {
      title: 'Unmatched',
      dataIndex: 'unmatchedAmount',
      key: 'unmatchedAmount',
      align: 'right',
      render: (v: string, r) => <span className={r.status === 'ACTIVE' && v !== '0.00' ? 'font-semibold text-warning' : ''}>{formatMoney(v)}</span>,
    },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (v: TdsCertificateStatus) => <StatusTag status={v} label={v === 'ACTIVE' ? 'Active' : 'Cancelled'} tone={v === 'ACTIVE' ? 'pos' : 'mut'} /> },
  ];

  return (
    <>
      <PageHeader
        title="TDS Certificates"
        description="Certificates and 26AS/GST statement credits from clients, matched to the TDS and GST-TDS they deducted from receipts."
        actions={
          canManage ? (
            <>
              <Button onClick={() => setImportOpen(true)}>Import CSV</Button>
              <Button type="primary" onClick={() => setRecordOpen(true)}>
                Record Certificate
              </Button>
            </>
          ) : null
        }
      />

      <UiCard flush className="mb-4">
        <FilterCard>
          <FilterField label="Status">
            <Select allowClear placeholder="All" className="w-[160px]" value={status} onChange={(v?: TdsCertificateStatus) => { setStatus(v); setPage(1); }} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'CANCELLED', label: 'Cancelled' }]} />
          </FilterField>
          <FilterField label="Source">
            <Select allowClear placeholder="All" className="w-[240px]" value={source} onChange={(v?: TdsCertificateSource) => { setSource(v); setPage(1); }} options={Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))} />
          </FilterField>
          <FilterField label="Client">
            <Select allowClear showSearch optionFilterProp="label" placeholder="All clients" className="w-[240px]" value={partyId} onChange={(v?: string) => { setPartyId(v); setPage(1); }} options={(clients.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          </FilterField>
        </FilterCard>
      </UiCard>

      <UiCard flush>
        <EntityTable<TdsCertificateSummary>
          rowKey="id"
          loading={list.isLoading}
          errorMessage={list.isError ? list.error.message : undefined}
          emptyTitle="No certificates"
          emptyDescription="Record a certificate or import a 26AS statement to start matching client deductions."
          columns={columns}
          dataSource={rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
          page={page}
          pageSize={PAGE_SIZE}
          total={rows.length}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>

      <RecordCertificateModal open={recordOpen} onClose={() => setRecordOpen(false)} onRecorded={refresh} />
      <ImportCertificatesModal open={importOpen} onClose={() => setImportOpen(false)} onImported={refresh} />
      <CertificateDrawer id={viewingId} onClose={() => setViewingId(null)} canManage={canManage} onChanged={refresh} />
    </>
  );
}
