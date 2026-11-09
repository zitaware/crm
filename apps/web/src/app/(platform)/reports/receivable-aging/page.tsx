'use client';

import { useState } from 'react';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, UiCard } from '@zitaware/ui';
import type { HeldDeductionAgingRow, ReceivableAgingInvoiceRow, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { AGING_LABELS, AgingTag, ExportButtons, InvoiceLink, ReceiptLink, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultFilters, money } from '../shared';

function daysPastDue(days: number) {
  return days < 0 ? <span className="text-muted">Due in {-days}</span> : <span className="tabular-nums">{days}</span>;
}

const invoiceColumns: ColumnsType<ReceivableAgingInvoiceRow> = [
  { title: 'Invoice', key: 'invoice', render: (_v, r) => <InvoiceLink projectId={r.projectId} invoiceId={r.invoiceId} label={r.invoiceNumber} /> },
  { title: 'Client', dataIndex: 'clientName', key: 'clientName' },
  { title: 'Project', dataIndex: 'projectName', key: 'projectName' },
  { title: 'Invoice Date', dataIndex: 'invoiceDate', key: 'invoiceDate', render: formatDate },
  { title: 'Due Date', dataIndex: 'dueDate', key: 'dueDate', render: formatDate },
  { title: 'Invoice Total', dataIndex: 'totalAmount', key: 'totalAmount', align: 'right', render: money },
  { title: 'Settled', dataIndex: 'settledAmount', key: 'settledAmount', align: 'right', render: money },
  { title: 'Notes', dataIndex: 'noteAdjustmentAmount', key: 'noteAdjustmentAmount', align: 'right', render: money },
  { title: 'Outstanding', dataIndex: 'outstandingAmount', key: 'outstandingAmount', align: 'right', render: (v: string) => <b>{money(v)}</b> },
  { title: 'Days Past Due', dataIndex: 'daysPastDue', key: 'daysPastDue', align: 'right', render: daysPastDue },
  { title: 'Age', dataIndex: 'bucket', key: 'bucket', render: (_v, r) => <AgingTag bucket={r.bucket} /> },
];

const heldColumns: ColumnsType<HeldDeductionAgingRow> = [
  { title: 'Type', dataIndex: 'type', key: 'type', render: (v: string) => (v === 'HOLD' ? 'Hold' : 'Retention') },
  { title: 'Invoice', key: 'invoice', render: (_v, r) => <InvoiceLink projectId={r.projectId} invoiceId={r.invoiceId} label={r.invoiceNumber} /> },
  { title: 'Client', dataIndex: 'clientName', key: 'clientName' },
  { title: 'Project', dataIndex: 'projectName', key: 'projectName' },
  { title: 'Withheld On', key: 'receiptDate', render: (_v, r) => <ReceiptLink projectId={r.projectId} receiptId={r.receiptId} label={formatDate(r.receiptDate)} /> },
  { title: 'Withheld', dataIndex: 'amount', key: 'amount', align: 'right', render: money },
  { title: 'Released', dataIndex: 'releasedAmount', key: 'releasedAmount', align: 'right', render: money },
  { title: 'Outstanding', dataIndex: 'outstandingAmount', key: 'outstandingAmount', align: 'right', render: (v: string) => <b>{money(v)}</b> },
  { title: 'Days Held', dataIndex: 'daysHeld', key: 'daysHeld', align: 'right' },
  { title: 'Age', dataIndex: 'bucket', key: 'bucket', render: (_v, r) => <AgingTag bucket={r.bucket} /> },
];

/** Receivable Aging — docs/04 §16: by invoice due date, with hold/retention aged separately. */
export default function ReceivableAgingPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters);
  const report = trpc.reports.receivableAging.useQuery(filters);
  const data = report.data;

  return (
    <>
      <PageHeader
        title="Receivable Aging"
        description="Invoice outstanding by days past the due date, with hold and retention aged separately."
        actions={<ExportButtons reportKey="receivable-aging" filters={filters} />}
      />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Total Outstanding" value={formatMoney(data?.invoiceTotal ?? null)} sub={data ? `${data.invoices.length} invoice(s)` : undefined} />
        {(data?.invoiceBuckets ?? []).map((b) => (
          <KpiCard key={b.bucket} label={AGING_LABELS[b.bucket]} value={formatMoney(b.amount)} sub={`${b.count} invoice(s)`} />
        ))}
      </div>

      <UiCard title="Invoices" flush className="mb-4">
        <Table<ReceivableAgingInvoiceRow>
          rowKey="invoiceId"
          size="small"
          pagination={false}
          loading={report.isLoading}
          columns={invoiceColumns}
          dataSource={data?.invoices ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'Nothing outstanding on this date.' }}
          summary={() =>
            data && data.invoices.length > 0 ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={8}>
                  <b>Total</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={8} align="right">
                  <b>{money(data.invoiceTotal)}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={9} colSpan={2} />
              </Table.Summary.Row>
            ) : null
          }
        />
      </UiCard>

      <UiCard title="Hold and Retention" flush className="mb-4">
        <Table<HeldDeductionAgingRow>
          rowKey="deductionId"
          size="small"
          pagination={false}
          loading={report.isLoading}
          columns={heldColumns}
          dataSource={data?.heldDeductions ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No hold or retention outstanding on this date.' }}
          summary={() =>
            data && data.heldDeductions.length > 0 ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={7}>
                  <b>Total</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={7} align="right">
                  <b>{money(data.heldTotal)}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={8} colSpan={2} />
              </Table.Summary.Row>
            ) : null
          }
        />
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
