'use client';

import { useState } from 'react';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import type { PenaltyReport, PenaltyRow, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { ExportButtons, InvoiceLink, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultPeriodFilters, signedMoney } from '../shared';

const rowColumns: ColumnsType<PenaltyRow> = [
  { title: 'Posted', dataIndex: 'ledgerDate', key: 'ledgerDate', render: (v: string) => formatDate(v) },
  { title: 'State', dataIndex: 'status', key: 'status', render: (v: PenaltyRow['status']) => (v === 'ACCEPTED' ? <StatusTag status={v} label="Accepted" tone="warn" /> : <StatusTag status={v} label="Disputed" tone="neg" />) },
  { title: 'Entry', dataIndex: 'entryType', key: 'entryType', render: (v: PenaltyRow['entryType']) => (v === 'DEDUCTION' ? 'Deduction' : <span className="text-negative">Receipt reversed</span>) },
  { title: 'Category', dataIndex: 'categoryName', key: 'categoryName', render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
  { title: 'Invoice', key: 'invoice', render: (_v, r) => <InvoiceLink projectId={r.projectId} invoiceId={r.invoiceId} label={r.invoiceNumber} /> },
  { title: 'Client', dataIndex: 'clientName', key: 'clientName' },
  { title: 'Project', dataIndex: 'projectName', key: 'projectName' },
  { title: 'Reason', dataIndex: 'narrative', key: 'narrative', render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
  { title: 'Posted To', dataIndex: 'ledgerAccountName', key: 'ledgerAccountName' },
  { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
];

const categoryColumns: ColumnsType<PenaltyReport['byCategory'][number]> = [
  { title: 'Category', dataIndex: 'categoryName', key: 'categoryName' },
  { title: 'Accepted', dataIndex: 'accepted', key: 'accepted', align: 'right', render: signedMoney },
  { title: 'Disputed', dataIndex: 'disputed', key: 'disputed', align: 'right', render: signedMoney },
];

/** Penalties — docs/04 §16: typed penalties with accepted/disputed state and accounting treatment (ADR-117). */
export default function PenaltiesReportPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultPeriodFilters);
  const report = trpc.reports.penalties.useQuery(filters);
  const data = report.data;

  return (
    <>
      <PageHeader title="Penalties" description="Penalties clients deducted from receipts, with whether each was accepted or disputed and where it was posted." actions={<ExportButtons reportKey="penalties" filters={filters} />} />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} period />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-2">
        <KpiCard label="Accepted" value={formatMoney(data?.totals.accepted ?? null)} sub={data ? `${data.totals.acceptedCount} deduction(s) · reduces revenue` : undefined} />
        <KpiCard label="Disputed" value={formatMoney(data?.totals.disputed ?? null)} sub={data ? `${data.totals.disputedCount} deduction(s) · still recoverable` : undefined} />
      </div>

      <UiCard title="By Category" flush className="mb-4">
        <Table<PenaltyReport['byCategory'][number]> rowKey="categoryName" size="small" pagination={false} loading={report.isLoading} columns={categoryColumns} dataSource={data?.byCategory ?? []} tableLayout="auto" scroll={{ x: true }} />
      </UiCard>

      <UiCard title="Penalties" flush className="mb-4">
        <Table<PenaltyRow>
          rowKey={(r) => `${r.deductionId}-${r.entryType}`}
          size="small"
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          loading={report.isLoading}
          columns={rowColumns}
          dataSource={data?.rows ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No penalties deducted in this period.' }}
        />
        <p className="m-0 border-t border-ui-2 px-4 py-3 text-[12px] text-muted">Resolving a disputed penalty (accepted or reversed) is not recorded yet; a disputed amount stays recoverable until then.</p>
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
