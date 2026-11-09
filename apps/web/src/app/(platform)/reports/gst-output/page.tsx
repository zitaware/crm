'use client';

import { useState } from 'react';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, UiCard } from '@zitaware/ui';
import type { GstOutputRow, GstPeriodSummaryRow, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultPeriodFilters, signedMoney } from '../shared';
import { GST_DOCUMENT_LABELS, GstDocumentLink, JournalLink, taxPeriodLabel } from '../gst-links';

const amountColumns = <T extends { taxable: string; cgst: string; sgst: string; igst: string; total: string }>(): ColumnsType<T> => [
  { title: 'Taxable', dataIndex: 'taxable', key: 'taxable', align: 'right', render: signedMoney },
  { title: 'CGST', dataIndex: 'cgst', key: 'cgst', align: 'right', render: signedMoney },
  { title: 'SGST', dataIndex: 'sgst', key: 'sgst', align: 'right', render: signedMoney },
  { title: 'IGST', dataIndex: 'igst', key: 'igst', align: 'right', render: signedMoney },
  { title: 'Total', dataIndex: 'total', key: 'total', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
];

const periodColumns: ColumnsType<GstPeriodSummaryRow> = [
  { title: 'GSTIN', dataIndex: 'gstin', key: 'gstin', render: (v: string | null) => <span className="font-mono text-[12px]">{v ?? '—'}</span> },
  { title: 'Tax Period', dataIndex: 'taxPeriod', key: 'taxPeriod', render: taxPeriodLabel },
  { title: 'Documents', dataIndex: 'documentCount', key: 'documentCount', align: 'right' },
  ...amountColumns<GstPeriodSummaryRow>(),
];

const documentColumns: ColumnsType<GstOutputRow> = [
  { title: 'Date', dataIndex: 'ledgerDate', key: 'ledgerDate', render: (v: string) => formatDate(v) },
  { title: 'Type', dataIndex: 'documentType', key: 'documentType', render: (v: string) => GST_DOCUMENT_LABELS[v] ?? v },
  { title: 'Number', key: 'number', render: (_v, r) => <GstDocumentLink documentType={r.documentType} documentId={r.documentId} invoiceId={r.invoiceId} projectId={r.projectId} label={r.number} /> },
  { title: 'Buyer', dataIndex: 'buyerName', key: 'buyerName', render: (v: string | null) => v ?? '—' },
  { title: 'Buyer GSTIN', dataIndex: 'buyerGstin', key: 'buyerGstin', render: (v: string | null) => v ?? <span className="text-muted-2">Unregistered</span> },
  { title: 'Place of Supply', dataIndex: 'placeOfSupply', key: 'placeOfSupply', render: (v: string | null) => v ?? '—' },
  ...amountColumns<GstOutputRow>(),
  { title: '', key: 'journal', render: (_v, r) => <JournalLink journalEntryId={r.journalEntryId} /> },
];

/** GST Output — docs/04 §16: finalized invoices and notes by registration and tax period, reconciled to output GST. */
export default function GstOutputPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultPeriodFilters);
  const report = trpc.reports.gstOutput.useQuery(filters);
  const data = report.data;

  return (
    <>
      <PageHeader title="GST Output" description="Output GST on finalized invoices and credit/debit notes, by registration and month." actions={<ExportButtons reportKey="gst-output" filters={filters} />} />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} period />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Taxable Value" value={formatMoney(data?.totals.taxable ?? null)} />
        <KpiCard label="Output CGST" value={formatMoney(data?.totals.cgst ?? null)} />
        <KpiCard label="Output SGST" value={formatMoney(data?.totals.sgst ?? null)} />
        <KpiCard label="Output IGST" value={formatMoney(data?.totals.igst ?? null)} />
      </div>

      <UiCard title="By Registration and Tax Period" flush className="mb-4">
        <Table<GstPeriodSummaryRow> rowKey={(r) => `${r.gstRegistrationId}-${r.taxPeriod}`} size="small" pagination={false} loading={report.isLoading} columns={periodColumns} dataSource={data?.periods ?? []} tableLayout="auto" scroll={{ x: true }} locale={{ emptyText: 'No output GST in this period.' }} />
      </UiCard>

      <UiCard title="Documents" flush className="mb-4">
        <Table<GstOutputRow>
          rowKey={(r) => `${r.documentId}-${r.documentType}`}
          size="small"
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          loading={report.isLoading}
          columns={documentColumns}
          dataSource={data?.documents ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No documents in this period.' }}
        />
        <p className="m-0 border-t border-ui-2 px-4 py-3 text-[12px] text-muted">Credit notes and voids are negative. A void counts in the month it was voided, so its invoice&apos;s month is unchanged.</p>
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
