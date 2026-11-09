'use client';

import { useState } from 'react';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import type { GstRegisterLine, GstRegisterTypeTotal, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate } from '@/lib/format';
import { ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultPeriodFilters, signedMoney } from '../shared';
import { GST_DOCUMENT_LABELS, GstDocumentLink } from '../gst-links';

const totalColumns: ColumnsType<GstRegisterTypeTotal> = [
  { title: 'Document Type', dataIndex: 'documentType', key: 'documentType', render: (v: string) => GST_DOCUMENT_LABELS[v] ?? v },
  { title: 'Documents', dataIndex: 'documentCount', key: 'documentCount', align: 'right' },
  { title: 'Lines', dataIndex: 'lineCount', key: 'lineCount', align: 'right' },
  { title: 'Taxable', dataIndex: 'taxable', key: 'taxable', align: 'right', render: signedMoney },
  { title: 'CGST', dataIndex: 'cgst', key: 'cgst', align: 'right', render: signedMoney },
  { title: 'SGST', dataIndex: 'sgst', key: 'sgst', align: 'right', render: signedMoney },
  { title: 'IGST', dataIndex: 'igst', key: 'igst', align: 'right', render: signedMoney },
  { title: 'Total', dataIndex: 'total', key: 'total', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
];

const lineColumns: ColumnsType<GstRegisterLine> = [
  { title: 'Direction', dataIndex: 'direction', key: 'direction', render: (v: string) => (v === 'OUTWARD' ? 'Outward' : 'Inward') },
  { title: 'Date', dataIndex: 'documentDate', key: 'documentDate', render: (v: string) => formatDate(v) },
  { title: 'Type', dataIndex: 'documentType', key: 'documentType', render: (v: string) => GST_DOCUMENT_LABELS[v] ?? v },
  { title: 'Number', key: 'number', render: (_v, r) => <GstDocumentLink documentType={r.documentType} documentId={r.documentId} invoiceId={r.invoiceId} projectId={r.projectId} label={r.number} /> },
  { title: 'Status', dataIndex: 'status', key: 'status', render: (v: string) => <StatusTag status={v} label={v === 'VOID' ? 'Void' : 'Finalized'} tone={v === 'VOID' ? 'neg' : 'pos'} /> },
  { title: 'Counterparty', dataIndex: 'counterpartyName', key: 'counterpartyName', render: (v: string | null) => v ?? '—' },
  { title: 'Counterparty GSTIN', dataIndex: 'counterpartyGstin', key: 'counterpartyGstin', render: (v: string | null) => v ?? '—' },
  { title: 'Place of Supply', dataIndex: 'placeOfSupply', key: 'placeOfSupply', render: (v: string | null) => v ?? '—' },
  { title: 'HSN/SAC', dataIndex: 'hsnSac', key: 'hsnSac', render: (v: string | null) => v ?? '—' },
  { title: 'Rate', dataIndex: 'ratePercent', key: 'ratePercent', align: 'right', render: (v: string) => `${v}%` },
  { title: 'Taxable', dataIndex: 'taxable', key: 'taxable', align: 'right', render: signedMoney },
  { title: 'CGST', dataIndex: 'cgst', key: 'cgst', align: 'right', render: signedMoney },
  { title: 'SGST', dataIndex: 'sgst', key: 'sgst', align: 'right', render: signedMoney },
  { title: 'IGST', dataIndex: 'igst', key: 'igst', align: 'right', render: signedMoney },
  { title: 'Line Total', dataIndex: 'lineTotal', key: 'lineTotal', align: 'right', render: signedMoney },
  { title: 'ITC', dataIndex: 'itcEligible', key: 'itcEligible', render: (v: boolean | null) => (v === null ? '—' : v ? 'Eligible' : 'Ineligible') },
];

/** GST Document Register — docs/04 §16: document tax lines; not a return-filing engine. */
export default function GstRegisterPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultPeriodFilters);
  const report = trpc.reports.gstRegister.useQuery(filters);
  const data = report.data;

  return (
    <>
      <PageHeader title="GST Document Register" description="Every tax line of invoices, credit/debit notes and vendor bills dated in the period." actions={<ExportButtons reportKey="gst-register" filters={filters} />} />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} period />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <UiCard title="Totals by Document Type" flush className="mb-4">
        <Table<GstRegisterTypeTotal> rowKey="documentType" size="small" pagination={false} loading={report.isLoading} columns={totalColumns} dataSource={data?.totals ?? []} tableLayout="auto" scroll={{ x: true }} />
        <p className="m-0 border-t border-ui-2 px-4 py-3 text-[12px] text-muted">Void documents are listed below but left out of these totals. Amounts are as issued, so credit notes are not negative here.</p>
      </UiCard>

      <UiCard title="Tax Lines" flush className="mb-4">
        <Table<GstRegisterLine>
          rowKey={(r) => `${r.documentId}-${r.lineNumber}`}
          size="small"
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          loading={report.isLoading}
          columns={lineColumns}
          dataSource={data?.lines ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No documents dated in this period.' }}
        />
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
