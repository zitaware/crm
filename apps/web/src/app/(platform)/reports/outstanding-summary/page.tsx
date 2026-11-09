'use client';

import { useState } from 'react';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, UiCard } from '@zitaware/ui';
import type { OutstandingDeductionRow, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { DEDUCTION_LABELS, ExportButtons, InvoiceLink, ReceiptLink, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultFilters, money } from '../shared';

const deductionColumns: ColumnsType<OutstandingDeductionRow> = [
  { title: 'Type', dataIndex: 'type', key: 'type', render: (_v, r) => DEDUCTION_LABELS[r.type] },
  { title: 'Invoice', key: 'invoice', render: (_v, r) => <InvoiceLink projectId={r.projectId} invoiceId={r.invoiceId} label={r.invoiceNumber} /> },
  { title: 'Client', dataIndex: 'clientName', key: 'clientName' },
  { title: 'Project', dataIndex: 'projectName', key: 'projectName' },
  { title: 'Receipt', key: 'receipt', render: (_v, r) => <ReceiptLink projectId={r.projectId} receiptId={r.receiptId} label={formatDate(r.receiptDate)} /> },
  { title: 'Deducted', dataIndex: 'amount', key: 'amount', align: 'right', render: money },
  { title: 'Released', dataIndex: 'releasedAmount', key: 'releasedAmount', align: 'right', render: money },
  { title: 'Outstanding', dataIndex: 'outstandingAmount', key: 'outstandingAmount', align: 'right', render: (v: string) => <b>{money(v)}</b> },
  { title: 'Note', dataIndex: 'narrative', key: 'narrative', render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
];

/**
 * Outstanding Summary — docs/04 §16: invoice outstanding, TDS/GST-TDS pending
 * reconciliation, hold/retention recoverable and disputed deductions, each kept
 * separate rather than netted into one receivable figure.
 */
export default function OutstandingSummaryPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters);
  const report = trpc.reports.outstandingSummary.useQuery(filters);
  const data = report.data;

  return (
    <>
      <PageHeader
        title="Outstanding Summary"
        description="Everything still to recover from clients, by kind: invoice outstanding, TDS and GST-TDS, hold and retention, disputed deductions."
        actions={<ExportButtons reportKey="outstanding-summary" filters={filters} />}
      />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {(data?.measures ?? []).map((m) => (
          <KpiCard key={m.key} label={m.label} value={formatMoney(m.amount)} sub={`${m.itemCount} ${m.key === 'INVOICE_OUTSTANDING' ? 'invoice(s)' : 'item(s)'}`} />
        ))}
        {report.isLoading ? <KpiCard label="Invoice outstanding" value="—" /> : null}
      </div>

      <UiCard title="Deductions Still to Recover" flush className="mb-4">
        <Table<OutstandingDeductionRow>
          rowKey="deductionId"
          size="small"
          pagination={false}
          loading={report.isLoading}
          columns={deductionColumns}
          dataSource={data?.deductions ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No deduction is outstanding on this date.' }}
        />
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
