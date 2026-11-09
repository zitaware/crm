'use client';

import { useState } from 'react';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, UiCard } from '@zitaware/ui';
import type { GstInputPeriodRow, GstInputRow, GstPendingInputRow, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultPeriodFilters, signedMoney } from '../shared';
import { GST_DOCUMENT_LABELS, GstDocumentLink, JournalLink, taxPeriodLabel } from '../gst-links';

const periodColumns: ColumnsType<GstInputPeriodRow> = [
  { title: 'GSTIN', dataIndex: 'gstin', key: 'gstin', render: (v: string | null) => (v ? <span className="font-mono text-[12px]">{v}</span> : <span className="text-muted">No registration on document</span>) },
  { title: 'Tax Period', dataIndex: 'taxPeriod', key: 'taxPeriod', render: taxPeriodLabel },
  { title: 'Documents', dataIndex: 'documentCount', key: 'documentCount', align: 'right' },
  { title: 'Taxable', dataIndex: 'taxable', key: 'taxable', align: 'right', render: signedMoney },
  { title: 'Eligible CGST', key: 'ec', align: 'right', render: (_v, r) => signedMoney(r.eligible.cgst) },
  { title: 'Eligible SGST', key: 'es', align: 'right', render: (_v, r) => signedMoney(r.eligible.sgst) },
  { title: 'Eligible IGST', key: 'ei', align: 'right', render: (_v, r) => signedMoney(r.eligible.igst) },
  { title: 'Claim Credit', key: 'en', align: 'right', render: (_v, r) => signedMoney(r.eligible.notSplit) },
  { title: 'Eligible Total', key: 'et', align: 'right', render: (_v, r) => <b>{signedMoney(r.eligible.total)}</b> },
  { title: 'Ineligible Total', key: 'it', align: 'right', render: (_v, r) => signedMoney(r.ineligible.total) },
];

const documentColumns: ColumnsType<GstInputRow> = [
  { title: 'Date', dataIndex: 'ledgerDate', key: 'ledgerDate', render: (v: string) => formatDate(v) },
  { title: 'Type', dataIndex: 'documentType', key: 'documentType', render: (v: string) => GST_DOCUMENT_LABELS[v] ?? v },
  { title: 'Document', key: 'number', render: (_v, r) => <GstDocumentLink documentType={r.documentType} documentId={r.documentId} projectId={r.projectId} label={r.number} /> },
  { title: 'Supplier', dataIndex: 'supplierName', key: 'supplierName', render: (v: string | null) => v ?? '—' },
  { title: 'Supplier GSTIN', dataIndex: 'supplierGstin', key: 'supplierGstin', render: (v: string | null) => v ?? '—' },
  { title: 'Taxable', dataIndex: 'taxable', key: 'taxable', align: 'right', render: signedMoney },
  { title: 'Eligible', key: 'eligible', align: 'right', render: (_v, r) => <b>{signedMoney(r.eligible.total)}</b> },
  { title: 'Ineligible', key: 'ineligible', align: 'right', render: (_v, r) => signedMoney(r.ineligible.total) },
  { title: '', key: 'journal', render: (_v, r) => <JournalLink journalEntryId={r.journalEntryId} /> },
];

const pendingColumns: ColumnsType<GstPendingInputRow> = [
  { title: 'Date', dataIndex: 'documentDate', key: 'documentDate', render: (v: string) => formatDate(v) },
  { title: 'Type', dataIndex: 'documentType', key: 'documentType', render: (v: string) => GST_DOCUMENT_LABELS[v] ?? v },
  { title: 'Document', key: 'number', render: (_v, r) => <GstDocumentLink documentType={r.documentType} documentId={r.documentId} projectId={r.projectId} label={r.number} /> },
  { title: 'Supplier', dataIndex: 'supplierName', key: 'supplierName', render: (v: string | null) => v ?? '—' },
  { title: 'Taxable', dataIndex: 'taxable', key: 'taxable', align: 'right', render: signedMoney },
  { title: 'GST if Approved', key: 'eligible', align: 'right', render: (_v, r) => signedMoney(r.eligible.total) },
];

/** GST Input — docs/04 §16: eligible, ineligible and pending input GST, separate. */
export default function GstInputPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultPeriodFilters);
  const report = trpc.reports.gstInput.useQuery(filters);
  const data = report.data;

  return (
    <>
      <PageHeader title="GST Input" description="Input GST on vendor bills, direct expenses and expense claims — eligible, ineligible and pending." actions={<ExportButtons reportKey="gst-input" filters={filters} />} />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} period />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Taxable Value" value={formatMoney(data?.totals.taxable ?? null)} />
        <KpiCard label="Eligible Input GST" value={formatMoney(data?.totals.eligible.total ?? null)} sub="Posted to Input GST receivable" />
        <KpiCard label="Ineligible GST" value={formatMoney(data?.totals.ineligible.total ?? null)} sub="Kept in cost or inventory" />
        <KpiCard label="Pending Approval" value={formatMoney(data?.pendingTotals.eligible.total ?? null)} sub="Not claimable until approved" />
      </div>

      <UiCard title="By Registration and Tax Period" flush className="mb-4">
        <Table<GstInputPeriodRow> rowKey={(r) => `${r.gstRegistrationId ?? 'none'}-${r.taxPeriod}`} size="small" pagination={false} loading={report.isLoading} columns={periodColumns} dataSource={data?.periods ?? []} tableLayout="auto" scroll={{ x: true }} locale={{ emptyText: 'No input GST in this period.' }} />
      </UiCard>

      <UiCard title="Documents" flush className="mb-4">
        <Table<GstInputRow> rowKey={(r) => `${r.documentId}-${r.documentType}`} size="small" pagination={{ pageSize: 50, hideOnSinglePage: true }} loading={report.isLoading} columns={documentColumns} dataSource={data?.documents ?? []} tableLayout="auto" scroll={{ x: true }} locale={{ emptyText: 'No documents in this period.' }} />
        <p className="m-0 border-t border-ui-2 px-4 py-3 text-[12px] text-muted">
          An expense claim&apos;s GST credit is recorded as one figure, so it is shown as &ldquo;claim credit&rdquo; rather than split into CGST, SGST and IGST.
        </p>
      </UiCard>

      <UiCard title="Pending Approval" flush className="mb-4">
        <Table<GstPendingInputRow> rowKey="documentId" size="small" pagination={false} loading={report.isLoading} columns={pendingColumns} dataSource={data?.pending ?? []} tableLayout="auto" scroll={{ x: true }} locale={{ emptyText: 'Nothing awaiting approval.' }} />
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
