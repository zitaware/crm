'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, UiCard } from '@zitaware/ui';
import type { ReportFilters, TdsInwardRow, TdsInwardTypeSummary } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatMoney } from '@/lib/format';
import { ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultFilters, signedMoney } from '../shared';
import { TDS_TYPE_LABELS, tdsRowColumns } from '../tds-shared';

const summaryColumns: ColumnsType<TdsInwardTypeSummary> = [
  { title: 'Type', dataIndex: 'deductionType', key: 'deductionType', render: (v: keyof typeof TDS_TYPE_LABELS) => TDS_TYPE_LABELS[v] },
  { title: 'Deductions', dataIndex: 'count', key: 'count', align: 'right' },
  { title: 'Deducted', dataIndex: 'amount', key: 'amount', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
  { title: 'Recorded', key: 'recorded', align: 'right', render: (_v, s) => signedMoney(s.byLifecycle.RECORDED.amount) },
  { title: 'Certificate Pending', key: 'pending', align: 'right', render: (_v, s) => signedMoney(s.byLifecycle.CERTIFICATE_PENDING.amount) },
  { title: 'Certificate Received', key: 'received', align: 'right', render: (_v, s) => signedMoney(s.byLifecycle.CERTIFICATE_RECEIVED.amount) },
  { title: 'Reconciled', key: 'reconciled', align: 'right', render: (_v, s) => signedMoney(s.byLifecycle.RECONCILED.amount) },
];

/** TDS Inward — docs/04 §16: client TDS/GST-TDS deductions, certificate status and receivable reconciliation. */
export default function TdsInwardPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters);
  const report = trpc.reports.tdsInward.useQuery(filters);
  const data = report.data;

  return (
    <>
      <PageHeader
        title="TDS Inward"
        description="TDS and GST-TDS clients deducted from receipts, and how far each is evidenced by certificates and 26AS."
        actions={<ExportButtons reportKey="tds-inward" filters={filters} />}
      />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {(data?.summary ?? []).map((s) => (
          <KpiCard key={s.deductionType} label={`${TDS_TYPE_LABELS[s.deductionType]} Deducted`} value={formatMoney(s.amount)} sub={`${s.byLifecycle.CERTIFICATE_PENDING.count} certificate(s) pending`} />
        ))}
      </div>

      <UiCard title="By Type and Status" flush className="mb-4">
        <Table<TdsInwardTypeSummary> rowKey="deductionType" size="small" pagination={false} loading={report.isLoading} columns={summaryColumns} dataSource={data?.summary ?? []} tableLayout="auto" scroll={{ x: true }} />
      </UiCard>

      <UiCard title="Deductions" flush className="mb-4">
        <Table<TdsInwardRow>
          rowKey="deductionId"
          size="small"
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          loading={report.isLoading}
          columns={tdsRowColumns}
          dataSource={data?.rows ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No TDS or GST-TDS deducted by this date.' }}
        />
        <p className="m-0 border-t border-ui-2 px-4 py-3 text-[12px] text-muted">
          Recorded → Certificate Pending once the quarter (TDS) or month (GST-TDS) is over without a full certificate → Certificate Received when certificates cover it →
          Reconciled when 26AS or the GST portal credits it. Match certificates on{' '}
          <Link href="/tds-certificates" className="text-brand hover:underline">TDS Certificates</Link>.
        </p>
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
