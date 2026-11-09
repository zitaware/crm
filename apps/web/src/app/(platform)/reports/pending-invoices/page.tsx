'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import type { AgingBucket, BillingPendingRow, PendingInvoiceRow, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { AgingTag, ExportButtons, InvoiceLink, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultFilters, signedMoney } from '../shared';

const invoiceColumns: ColumnsType<PendingInvoiceRow> = [
  { title: 'Invoice', key: 'invoice', render: (_v, r) => <InvoiceLink projectId={r.projectId} invoiceId={r.invoiceId} label={r.invoiceNumber} /> },
  { title: 'Client', dataIndex: 'clientName', key: 'clientName' },
  { title: 'Project', dataIndex: 'projectName', key: 'projectName' },
  { title: 'Invoice Date', dataIndex: 'invoiceDate', key: 'invoiceDate', render: (v: string) => formatDate(v) },
  { title: 'Due Date', dataIndex: 'dueDate', key: 'dueDate', render: (v: string) => formatDate(v) },
  { title: 'Total', dataIndex: 'totalAmount', key: 'totalAmount', align: 'right', render: signedMoney },
  { title: 'Received', dataIndex: 'settledAmount', key: 'settledAmount', align: 'right', render: signedMoney },
  { title: 'Notes', dataIndex: 'noteAdjustmentAmount', key: 'noteAdjustmentAmount', align: 'right', render: signedMoney },
  { title: 'Outstanding', dataIndex: 'outstandingAmount', key: 'outstandingAmount', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
  { title: 'Days Past Due', dataIndex: 'daysPastDue', key: 'daysPastDue', align: 'right' },
  { title: 'Age', dataIndex: 'bucket', key: 'bucket', render: (v: AgingBucket) => <AgingTag bucket={v} /> },
  { title: 'State', dataIndex: 'settlementState', key: 'settlementState', render: (v: PendingInvoiceRow['settlementState']) => (v === 'UNSETTLED' ? <StatusTag status={v} label="Unpaid" tone="warn" /> : <StatusTag status={v} label="Part Paid" tone="info" />) },
];

const billingColumns: ColumnsType<BillingPendingRow> = [
  { title: 'Project', key: 'project', render: (_v, b) => <Link href={`/projects/${b.projectId}`} className="text-brand hover:underline">{b.projectName}</Link> },
  { title: 'Client', dataIndex: 'clientName', key: 'clientName', render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
  { title: 'Milestone', key: 'source', render: (_v, b) => <span>{b.sourceLabel}<span className="block text-[12px] text-muted">{b.sourceType === 'CAPEX_EVENT' ? 'CAPEX event' : 'OPEX installment'}</span></span> },
  { title: 'Due', dataIndex: 'dueDate', key: 'dueDate', render: (v: string) => formatDate(v) },
  { title: 'Amount (before GST)', dataIndex: 'amount', key: 'amount', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
  { title: 'Alert', key: 'alert', render: (_v, b) => (b.alertStatus === 'OPEN' ? <StatusTag status="OPEN" label="Open" tone="warn" /> : <StatusTag status="SNOOZED" label={`Snoozed to ${b.snoozedUntil ? formatDate(b.snoozedUntil) : '—'}`} tone="mut" />) },
  { title: 'Draft Invoice', key: 'draft', render: (_v, b) => (b.draftInvoiceId ? <InvoiceLink projectId={b.projectId} invoiceId={b.draftInvoiceId} label="Open draft" /> : <span className="text-muted-2">Not started</span>) },
];

/** Pending Invoices — docs/04 §16: finalized invoice outstanding only; alert/draft backlog as a separate billing-pending measure (ADR-118). */
export default function PendingInvoicesPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters);
  const report = trpc.reports.pendingInvoices.useQuery(filters);
  const data = report.data;

  return (
    <>
      <PageHeader title="Pending Invoices" description="Finalized invoices still to be paid — and, kept apart, billing that has not been invoiced yet." actions={<ExportButtons reportKey="pending-invoices" filters={filters} />} />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Invoice Outstanding" value={formatMoney(data?.invoiceTotal ?? null)} sub={data ? `${data.invoices.length} invoice(s)` : undefined} />
        <KpiCard label="Past Due" value={formatMoney(data?.overdueTotal ?? null)} />
        <KpiCard label="Billing Pending" value={formatMoney(data?.billingPendingTotal ?? null)} sub={data ? `${data.billingPending.length} milestone(s), before GST` : undefined} />
        <KpiCard label="Draft Invoices" value={data ? String(data.draftInvoiceCount) : '—'} sub="Being prepared from alerts" />
      </div>

      <UiCard title="Pending Invoices" flush className="mb-4">
        <Table<PendingInvoiceRow>
          rowKey="invoiceId"
          size="small"
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          loading={report.isLoading}
          columns={invoiceColumns}
          dataSource={data?.invoices ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No finalized invoice outstanding on this date.' }}
        />
      </UiCard>

      <UiCard title="Billing Pending" flush className="mb-4">
        <Table<BillingPendingRow> rowKey="alertId" size="small" pagination={{ pageSize: 50, hideOnSinglePage: true }} loading={report.isLoading} columns={billingColumns} dataSource={data?.billingPending ?? []} tableLayout="auto" scroll={{ x: true }} locale={{ emptyText: 'No open or snoozed payment alerts.' }} />
        <p className="m-0 border-t border-ui-2 px-4 py-3 text-[12px] text-muted">
          Today&rsquo;s open and snoozed <Link href="/payment-integration" className="text-brand hover:underline">payment alerts</Link>. Not part of the outstanding above and not a receivable until an invoice is finalized.
        </p>
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
