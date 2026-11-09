'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, UiCard } from '@zitaware/ui';
import type { ExpenseReport, ExpenseRow, ExpenseSourceType, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultPeriodFilters, signedMoney } from '../shared';

const SOURCE_LABELS: Record<ExpenseSourceType, string> = {
  VENDOR_BILL_LINE: 'Vendor Bill',
  VENDOR_BILL_VOID: 'Vendor Bill Void',
  DIRECT_EXPENSE: 'Direct Expense',
  DIRECT_EXPENSE_REVERSAL: 'Direct Expense Reversal',
  EXPENSE_CLAIM: 'Employee Claim',
};

function documentHref(r: ExpenseRow): string {
  if (r.sourceType === 'VENDOR_BILL_LINE' || r.sourceType === 'VENDOR_BILL_VOID') return `/vendor-bills/${r.documentId}`;
  if (r.sourceType === 'EXPENSE_CLAIM') return `/employee-expenses/claims/${r.documentId}`;
  return `/direct-expenses/${r.documentId}`;
}

const rowColumns: ColumnsType<ExpenseRow> = [
  { title: 'Posted', dataIndex: 'ledgerDate', key: 'ledgerDate', render: (v: string) => formatDate(v) },
  { title: 'Source', dataIndex: 'sourceType', key: 'sourceType', render: (v: ExpenseSourceType) => SOURCE_LABELS[v] },
  { title: 'Document', key: 'document', render: (_v, r) => <Link href={documentHref(r)} className="text-brand hover:underline">{r.documentLabel}</Link> },
  { title: 'Category', dataIndex: 'category', key: 'category' },
  { title: 'Project', dataIndex: 'projectName', key: 'projectName', render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
  { title: 'Paid To', dataIndex: 'counterparty', key: 'counterparty', render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
  { title: 'Gross', dataIndex: 'grossAmount', key: 'grossAmount', align: 'right', render: signedMoney },
  { title: 'Recoverable GST', dataIndex: 'eligibleGst', key: 'eligibleGst', align: 'right', render: signedMoney },
  { title: 'Recognized', dataIndex: 'recognizedAmount', key: 'recognizedAmount', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
];

const categoryColumns: ColumnsType<ExpenseReport['byCategory'][number]> = [
  { title: 'Category', dataIndex: 'category', key: 'category' },
  { title: 'Gross', dataIndex: 'grossAmount', key: 'grossAmount', align: 'right', render: signedMoney },
  { title: 'Recognized', dataIndex: 'recognizedAmount', key: 'recognizedAmount', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
];

const projectColumns: ColumnsType<ExpenseReport['byProject'][number]> = [
  { title: 'Project', key: 'projectName', render: (_v, p) => (p.projectId ? <Link href={`/projects/${p.projectId}`} className="text-brand hover:underline">{p.projectName}</Link> : <span className="text-muted">{p.projectName}</span>) },
  { title: 'Recognized', dataIndex: 'recognizedAmount', key: 'recognizedAmount', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
];

/** Expenses — docs/04 §16: posted spend by category and project; requests and forecasts never count (ADR-116). */
export default function ExpensesReportPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultPeriodFilters);
  const report = trpc.reports.expenses.useQuery(filters);
  const data = report.data;

  return (
    <>
      <PageHeader title="Expenses" description="Posted spend — vendor-bill expense lines, direct expenses and approved claims — by category and project." actions={<ExportButtons reportKey="expenses" filters={filters} />} />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} period />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <KpiCard label="Gross Spend" value={formatMoney(data?.totals.grossAmount ?? null)} sub={data ? `${data.rows.length} entr${data.rows.length === 1 ? 'y' : 'ies'}` : undefined} />
        <KpiCard label="Recoverable GST" value={formatMoney(data?.totals.eligibleGst ?? null)} sub="Posted to input GST, not expense" />
        <KpiCard label="Expense Recognized" value={formatMoney(data?.totals.recognizedAmount ?? null)} />
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <UiCard title="By Category" flush>
          <Table<ExpenseReport['byCategory'][number]> rowKey="category" size="small" pagination={false} loading={report.isLoading} columns={categoryColumns} dataSource={data?.byCategory ?? []} tableLayout="auto" scroll={{ x: true }} />
        </UiCard>
        <UiCard title="By Project" flush>
          <Table<ExpenseReport['byProject'][number]> rowKey={(p) => p.projectId ?? 'none'} size="small" pagination={false} loading={report.isLoading} columns={projectColumns} dataSource={data?.byProject ?? []} tableLayout="auto" scroll={{ x: true }} />
        </UiCard>
      </div>

      <UiCard title="Entries" flush className="mb-4">
        <Table<ExpenseRow>
          rowKey={(r) => `${r.journalEntryId}-${r.documentLabel}`}
          size="small"
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          loading={report.isLoading}
          columns={rowColumns}
          dataSource={data?.rows ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No spend posted in this period.' }}
        />
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
