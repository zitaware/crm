'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import type { ExceptionArea, ExceptionItem, LedgerCheckRow, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate } from '@/lib/format';
import { ExportButtons, ReportBasisNote, ReportFilterBar, defaultFilters, signedMoney } from '../shared';

const AREA_LABELS: Record<ExceptionArea, string> = {
  LEDGER: 'Ledger',
  BANK: 'Bank',
  TDS: 'TDS',
  APPROVALS: 'Approvals',
  BILLING: 'Billing',
  ALLOCATIONS: 'Allocations',
};

const itemColumns: ColumnsType<ExceptionItem> = [
  { title: 'Area', dataIndex: 'area', key: 'area', render: (v: ExceptionArea) => AREA_LABELS[v] },
  { title: 'Item', key: 'label', render: (_v, i) => <Link href={i.href} className="font-semibold text-brand hover:underline">{i.label}</Link> },
  { title: 'Open', dataIndex: 'count', key: 'count', align: 'right', render: (v: number) => (v ? <b className="text-negative">{v}</b> : <span className="text-muted">0</span>) },
  { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: signedMoney },
  { title: 'Oldest', dataIndex: 'oldestDate', key: 'oldestDate', render: (v: string | null) => (v ? formatDate(v) : <span className="text-muted-2">—</span>) },
  { title: 'Status', key: 'status', render: (_v, i) => (i.count ? <StatusTag status="OPEN" label="Open" tone="warn" /> : <StatusTag status="CLEAR" label="Clear" tone="pos" />) },
];

type CheckLine = LedgerCheckRow['lines'][number];
const checkColumns: ColumnsType<LedgerCheckRow> = [
  { title: 'Report', key: 'title', render: (_v, c) => <Link href={c.path} className="font-semibold text-brand hover:underline">{c.title}</Link> },
  { title: 'Figures Checked', key: 'lines', align: 'right', render: (_v, c) => c.lines.length },
  { title: 'Status', key: 'status', render: (_v, c) => (c.allReconciled ? <StatusTag status="AGREES" label="Agrees" tone="pos" /> : <StatusTag status="DIFFERS" label="Differs" tone="neg" />) },
];
const lineColumns: ColumnsType<CheckLine> = [
  { title: 'Figure', dataIndex: 'label', key: 'label' },
  { title: 'Report Total', dataIndex: 'reportAmount', key: 'reportAmount', align: 'right', render: signedMoney },
  { title: 'Ledger', dataIndex: 'ledgerAmount', key: 'ledgerAmount', align: 'right', render: signedMoney },
  { title: 'Difference', dataIndex: 'difference', key: 'difference', align: 'right', render: signedMoney },
];

/** Exceptions — Phase 8 controls: ledger checks and every open queue in one place (ADR-120). */
export default function ExceptionsPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters);
  const report = trpc.reports.exceptions.useQuery(filters);
  const data = report.data;
  const differing = data?.ledgerChecks.filter((c) => !c.allReconciled).length ?? 0;
  const openIn = (area: ExceptionArea) => data?.items.filter((i) => i.area === area && i.count > 0).length ?? 0;

  return (
    <>
      <PageHeader title="Exceptions" description="What is left open: reports that differ from the ledger, unexplained bank lines, TDS exceptions, approvals waiting, unbilled milestones and unallocated salary." actions={<ExportButtons reportKey="exceptions" filters={filters} />} />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Open" value={data ? String(data.openCount) : '—'} sub="Checks and queues needing action" />
        <KpiCard label="Ledger Checks" value={data ? `${data.ledgerChecks.length - differing}/${data.ledgerChecks.length}` : '—'} sub={data ? (differing ? `${differing} differ` : 'All agree') : undefined} />
        <KpiCard label="Bank & TDS" value={data ? String(openIn('BANK') + openIn('TDS')) : '—'} sub="Open item types" />
        <KpiCard label="Approvals & Other" value={data ? String(openIn('APPROVALS') + openIn('BILLING') + openIn('ALLOCATIONS')) : '—'} sub="Open item types" />
      </div>

      <UiCard title="Open Items" flush className="mb-4">
        <Table<ExceptionItem> rowKey="key" size="small" pagination={false} loading={report.isLoading} columns={itemColumns} dataSource={data?.items ?? []} tableLayout="auto" scroll={{ x: true }} />
        <p className="m-0 border-t border-ui-2 px-4 py-3 text-[12px] text-muted">Approval and alert queues show today&rsquo;s state; the rest are as of the date above.</p>
      </UiCard>

      <UiCard title="Ledger Checks" flush className="mb-4">
        <Table<LedgerCheckRow>
          rowKey="reportKey"
          size="small"
          pagination={false}
          loading={report.isLoading}
          columns={checkColumns}
          dataSource={data?.ledgerChecks ?? []}
          expandable={{ expandedRowRender: (c) => <Table<CheckLine> rowKey="label" size="small" pagination={false} columns={lineColumns} dataSource={c.lines} /> }}
        />
      </UiCard>
    </>
  );
}
