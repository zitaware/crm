'use client';

import { useState } from 'react';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, StatusTag, UiCard, type StatusTagTone } from '@zitaware/ui';
import type { HoldReportStatus, PaymentHoldRow, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { ExportButtons, InvoiceLink, ReceiptLink, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultFilters, signedMoney } from '../shared';

const STATUS: Record<HoldReportStatus, { label: string; tone: StatusTagTone }> = {
  OUTSTANDING: { label: 'Outstanding', tone: 'warn' },
  PARTIALLY_RELEASED: { label: 'Partially Released', tone: 'info' },
  RELEASED: { label: 'Released', tone: 'pos' },
};

type Release = PaymentHoldRow['releases'][number];

const rowColumns: ColumnsType<PaymentHoldRow> = [
  { title: 'Type', dataIndex: 'type', key: 'type', render: (v: PaymentHoldRow['type']) => (v === 'HOLD' ? 'Hold' : 'Retention') },
  { title: 'Invoice', key: 'invoice', render: (_v, r) => <InvoiceLink projectId={r.projectId} invoiceId={r.invoiceId} label={r.invoiceNumber} /> },
  { title: 'Client', dataIndex: 'clientName', key: 'clientName' },
  { title: 'Project', dataIndex: 'projectName', key: 'projectName' },
  { title: 'Withheld On', key: 'receipt', render: (_v, r) => <ReceiptLink projectId={r.projectId} receiptId={r.receiptId} label={formatDate(r.receiptDate)} /> },
  { title: 'Withheld', dataIndex: 'amount', key: 'amount', align: 'right', render: signedMoney },
  { title: 'Released', dataIndex: 'releasedAmount', key: 'releasedAmount', align: 'right', render: signedMoney },
  { title: 'Still to Recover', dataIndex: 'outstandingAmount', key: 'outstandingAmount', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
  { title: 'Status', dataIndex: 'status', key: 'status', render: (v: HoldReportStatus) => <StatusTag status={v} label={STATUS[v].label} tone={STATUS[v].tone} /> },
  { title: 'Last Release', dataIndex: 'lastReleasedOn', key: 'lastReleasedOn', render: (v: string | null) => (v ? formatDate(v) : <span className="text-muted-2">—</span>) },
];

const releaseColumns: ColumnsType<Release> = [
  { title: 'Released On', dataIndex: 'releasedOn', key: 'releasedOn', render: (v: string) => formatDate(v) },
  { title: 'UTR', dataIndex: 'utrReference', key: 'utrReference', render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
  { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: signedMoney },
];

/** Payment Holds — docs/04 §16: hold/retention deduction and release ledger with the original deduction and outstanding balance (ADR-117). */
export default function PaymentHoldsPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters);
  const report = trpc.reports.paymentHolds.useQuery(filters);
  const data = report.data;
  const t = data?.totals;

  return (
    <>
      <PageHeader title="Payment Holds" description="Hold and retention clients withheld, each release against it, and what is still to recover." actions={<ExportButtons reportKey="payment-holds" filters={filters} />} />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Hold Withheld" value={formatMoney(t?.HOLD.withheld ?? null)} sub={t ? `Released ${formatMoney(t.HOLD.released)}` : undefined} />
        <KpiCard label="Hold to Recover" value={formatMoney(t?.HOLD.outstanding ?? null)} />
        <KpiCard label="Retention Withheld" value={formatMoney(t?.RETENTION.withheld ?? null)} sub={t ? `Released ${formatMoney(t.RETENTION.released)}` : undefined} />
        <KpiCard label="Retention to Recover" value={formatMoney(t?.RETENTION.outstanding ?? null)} />
      </div>

      <UiCard title="Deductions" flush className="mb-4">
        <Table<PaymentHoldRow>
          rowKey="deductionId"
          size="small"
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          loading={report.isLoading}
          columns={rowColumns}
          dataSource={data?.rows ?? []}
          tableLayout="auto" scroll={{ x: true }}
          expandable={{ rowExpandable: (r) => r.releases.length > 0, expandedRowRender: (r) => <Table<Release> rowKey={(x) => `${x.releasedOn}-${x.amount}`} size="small" pagination={false} columns={releaseColumns} dataSource={r.releases} /> }}
          locale={{ emptyText: 'No hold or retention withheld by this date.' }}
        />
        <p className="m-0 border-t border-ui-2 px-4 py-3 text-[12px] text-muted">Release hold and retention from the receipt. Forfeiture is not recorded yet.</p>
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
