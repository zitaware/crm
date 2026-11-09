'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import type { ReportFilters, TdsOutwardItem, TdsOutwardTypeSummary } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultFilters, signedMoney } from '../shared';
import { TDS_TYPE_LABELS } from '../tds-shared';
import { OutwardDocumentLink, SOURCE_LABELS } from '../../tds-deposits/shared';

const summaryColumns: ColumnsType<TdsOutwardTypeSummary> = [
  { title: 'Type', dataIndex: 'deductionType', key: 'deductionType', render: (v: keyof typeof TDS_TYPE_LABELS) => TDS_TYPE_LABELS[v] },
  { title: 'Items', dataIndex: 'count', key: 'count', align: 'right' },
  { title: 'Withheld', dataIndex: 'deducted', key: 'deducted', align: 'right', render: signedMoney },
  { title: 'Deposited', dataIndex: 'deposited', key: 'deposited', align: 'right', render: signedMoney },
  { title: 'Payable', dataIndex: 'payable', key: 'payable', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
  { title: 'Overdue', key: 'overdue', align: 'right', render: (_v, s) => (s.overdueCount ? <span className="font-semibold text-negative">{formatMoney(s.overdueAmount)} ({s.overdueCount})</span> : signedMoney('0.00')) },
];

const rowColumns: ColumnsType<TdsOutwardItem> = [
  { title: 'Withheld On', dataIndex: 'deductionDate', key: 'deductionDate', render: (v: string) => formatDate(v) },
  { title: 'Type', dataIndex: 'deductionType', key: 'deductionType', render: (v: keyof typeof TDS_TYPE_LABELS) => TDS_TYPE_LABELS[v] },
  { title: 'Source', dataIndex: 'sourceKind', key: 'sourceKind', render: (v: keyof typeof SOURCE_LABELS) => SOURCE_LABELS[v] },
  { title: 'Document', key: 'document', render: (_v, r) => <OutwardDocumentLink sourceKind={r.sourceKind} documentId={r.documentId} label={r.documentLabel} /> },
  { title: 'Deductee', dataIndex: 'deducteeName', key: 'deducteeName' },
  { title: 'Withheld', dataIndex: 'amount', key: 'amount', align: 'right', render: signedMoney },
  { title: 'Deposited', dataIndex: 'deposited', key: 'deposited', align: 'right', render: signedMoney },
  { title: 'Payable', dataIndex: 'remaining', key: 'remaining', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
  { title: 'Challans', key: 'challans', render: (_v, r) => (r.challanNumbers.length ? <span className="text-[12px]">{r.challanNumbers.join(', ')}</span> : <span className="text-muted-2">—</span>) },
  { title: 'Due', dataIndex: 'dueDate', key: 'dueDate', render: (v: string) => formatDate(v) },
  {
    title: 'Status',
    key: 'status',
    render: (_v, r) =>
      r.remaining === '0.00' ? <StatusTag status="DEPOSITED" label="Deposited" tone="pos" /> : r.overdue ? <StatusTag status="OVERDUE" label="Overdue" tone="neg" /> : <StatusTag status="PAYABLE" label="Payable" tone="warn" />,
  },
];

/** TDS Outward — docs/04 §16: vendor/introducer TDS payable, deposited and challan status (ADR-113). */
export default function TdsOutwardPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters);
  const report = trpc.reports.tdsOutward.useQuery(filters);
  const data = report.data;
  const tds = data?.summary.find((s) => s.deductionType === 'TDS');

  return (
    <>
      <PageHeader title="TDS Outward" description="Tax withheld from payments, the challans that deposited it, and what is still payable." actions={<ExportButtons reportKey="tds-outward" filters={filters} />} />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="TDS Withheld" value={formatMoney(tds?.deducted ?? null)} />
        <KpiCard label="TDS Deposited" value={formatMoney(tds?.deposited ?? null)} />
        <KpiCard label="TDS Payable" value={formatMoney(tds?.payable ?? null)} />
        <KpiCard label="Overdue" value={formatMoney(tds?.overdueAmount ?? null)} sub={tds ? `${tds.overdueCount} item(s) past the due date` : undefined} />
      </div>

      <UiCard title="By Type" flush className="mb-4">
        <Table<TdsOutwardTypeSummary> rowKey="deductionType" size="small" pagination={false} loading={report.isLoading} columns={summaryColumns} dataSource={data?.summary ?? []} tableLayout="auto" scroll={{ x: true }} />
      </UiCard>

      <UiCard title="Withheld Amounts" flush className="mb-4">
        <Table<TdsOutwardItem>
          rowKey={(r) => `${r.sourceKind}-${r.sourceId}`}
          size="small"
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          loading={report.isLoading}
          columns={rowColumns}
          dataSource={data?.rows ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No tax withheld by this date.' }}
        />
        <p className="m-0 border-t border-ui-2 px-4 py-3 text-[12px] text-muted">
          Due by the 7th of the next month for TDS (30 April for March) and the 10th for GST-TDS. Record challans on{' '}
          <Link href="/tds-deposits" className="text-brand hover:underline">TDS Deposits</Link>.
        </p>
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
