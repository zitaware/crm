'use client';

import { useState } from 'react';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import type { ClientPaymentAllocationLine, ClientPaymentReport, ClientPaymentRow, ReceiptDeductionType, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { ExportButtons, InvoiceLink, ReceiptLink, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultPeriodFilters, signedMoney } from '../shared';

const DEDUCTIONS: Array<{ key: ReceiptDeductionType; label: string }> = [
  { key: 'TDS', label: 'TDS' },
  { key: 'CGST_TDS', label: 'CGST-TDS' },
  { key: 'SGST_TDS', label: 'SGST-TDS' },
  { key: 'IGST_TDS', label: 'IGST-TDS' },
  { key: 'HOLD', label: 'Hold' },
  { key: 'RETENTION', label: 'Retention' },
  { key: 'ACCEPTED_PENALTY', label: 'Penalty' },
  { key: 'DISPUTED_PENALTY', label: 'Disputed Penalty' },
  { key: 'OTHER', label: 'Other' },
];

const deductionColumns = <T extends { deductions: Record<ReceiptDeductionType, string> }>(): ColumnsType<T> =>
  DEDUCTIONS.map((d) => ({ title: d.label, key: d.key, align: 'right' as const, render: (_v: unknown, r: T) => signedMoney(r.deductions[d.key]) }));

const firstProjectId = (r: ClientPaymentRow) => r.allocations[0]?.projectId;

const rowColumns: ColumnsType<ClientPaymentRow> = [
  { title: 'Posted', dataIndex: 'ledgerDate', key: 'ledgerDate', render: (v: string) => formatDate(v) },
  { title: 'Receipt', key: 'receipt', render: (_v, r) => (firstProjectId(r) ? <ReceiptLink projectId={firstProjectId(r)!} receiptId={r.receiptId} label={r.utrReference ?? formatDate(r.receiptDate)} /> : (r.utrReference ?? '—')) },
  { title: 'Entry', dataIndex: 'entryType', key: 'entryType', render: (v: ClientPaymentRow['entryType']) => (v === 'RECEIPT' ? <StatusTag status={v} label="Receipt" tone="pos" /> : <StatusTag status={v} label="Reversal" tone="neg" />) },
  { title: 'Client', key: 'clients', render: (_v, r) => r.clientNames.join(', ') },
  { title: 'Mode', dataIndex: 'paymentModeName', key: 'paymentModeName' },
  { title: 'Cash Received', dataIndex: 'actualAmount', key: 'actualAmount', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
  { title: 'Invoice Settled', dataIndex: 'invoiceSettled', key: 'invoiceSettled', align: 'right', render: signedMoney },
  ...deductionColumns<ClientPaymentRow>(),
  { title: 'Unallocated', dataIndex: 'unallocatedCash', key: 'unallocatedCash', align: 'right', render: signedMoney },
];

const allocationColumns: ColumnsType<ClientPaymentAllocationLine> = [
  { title: 'Invoice', key: 'invoice', render: (_v, a) => <InvoiceLink projectId={a.projectId} invoiceId={a.invoiceId} label={a.invoiceNumber} /> },
  { title: 'Project', dataIndex: 'projectName', key: 'projectName' },
  { title: 'Cash', dataIndex: 'cashAllocated', key: 'cashAllocated', align: 'right', render: signedMoney },
  ...deductionColumns<ClientPaymentAllocationLine>(),
  { title: 'Settled', dataIndex: 'settledAmount', key: 'settledAmount', align: 'right', render: signedMoney },
];

const clientColumns: ColumnsType<ClientPaymentReport['byClient'][number]> = [
  { title: 'Client', dataIndex: 'clientName', key: 'clientName' },
  { title: 'Cash Received', dataIndex: 'actualAmount', key: 'actualAmount', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
  { title: 'Deductions', dataIndex: 'deductionTotal', key: 'deductionTotal', align: 'right', render: signedMoney },
  { title: 'Invoice Settled', dataIndex: 'invoiceSettled', key: 'invoiceSettled', align: 'right', render: signedMoney },
];

/** Client Payments — docs/04 §16: actual cash received, invoice settled, deductions and unallocated cash kept separate (ADR-118). */
export default function ClientPaymentsPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultPeriodFilters);
  const report = trpc.reports.clientPayments.useQuery(filters);
  const data = report.data;

  return (
    <>
      <PageHeader title="Client Payments" description="Every client receipt: cash that reached the bank, invoices settled and each deduction taken — kept apart." actions={<ExportButtons reportKey="client-payments" filters={filters} />} />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} period />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Cash Received" value={formatMoney(data?.totals.actualAmount ?? null)} sub={data ? `${data.rows.length} entr${data.rows.length === 1 ? 'y' : 'ies'}` : undefined} />
        <KpiCard label="Deductions" value={formatMoney(data?.totals.deductionTotal ?? null)} sub={data ? `TDS ${formatMoney(data.totals.deductions.TDS)}` : undefined} />
        <KpiCard label="Invoice Settled" value={formatMoney(data?.totals.invoiceSettled ?? null)} />
        <KpiCard label="Unallocated Cash" value={formatMoney(data?.totals.unallocatedCash ?? null)} />
      </div>

      <UiCard title="Receipts" flush className="mb-4">
        <Table<ClientPaymentRow>
          rowKey={(r) => `${r.receiptId}-${r.entryType}`}
          size="small"
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          loading={report.isLoading}
          columns={rowColumns}
          dataSource={data?.rows ?? []}
          tableLayout="auto" scroll={{ x: true }}
          expandable={{ expandedRowRender: (r) => <Table<ClientPaymentAllocationLine> rowKey="invoiceId" size="small" pagination={false} columns={allocationColumns} dataSource={r.allocations} tableLayout="auto" scroll={{ x: true }} /> }}
          locale={{ emptyText: 'No client receipts posted in this period.' }}
        />
      </UiCard>

      <UiCard title="By Client" flush className="mb-4">
        <Table<ClientPaymentReport['byClient'][number]> rowKey="clientName" size="small" pagination={false} loading={report.isLoading} columns={clientColumns} dataSource={data?.byClient ?? []} tableLayout="auto" scroll={{ x: true }} />
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
