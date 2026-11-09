'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, StatusTag, UiCard, type StatusTagTone } from '@zitaware/ui';
import type { ReimbursementReport, ReimbursementRow, ReimbursementStatus, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultPeriodFilters, signedMoney } from '../shared';

const STATUS: Record<ReimbursementStatus, { label: string; tone: StatusTagTone }> = {
  SUBMITTED: { label: 'Awaiting Approval', tone: 'warn' },
  APPROVED: { label: 'Awaiting Payment', tone: 'info' },
  REIMBURSED: { label: 'Reimbursed', tone: 'pos' },
  REJECTED: { label: 'Rejected', tone: 'neg' },
  CANCELLED: { label: 'Cancelled', tone: 'mut' },
};

const dateOrDash = (v: string | null) => (v ? formatDate(v) : <span className="text-muted-2">—</span>);

const rowColumns: ColumnsType<ReimbursementRow> = [
  { title: 'Expense Date', dataIndex: 'expenseDate', key: 'expenseDate', render: (v: string) => formatDate(v) },
  { title: 'Employee', dataIndex: 'employeeName', key: 'employeeName' },
  { title: 'Claim', key: 'title', render: (_v, r) => <Link href={`/employee-expenses/claims/${r.claimId}`} className="font-semibold text-brand hover:underline">{r.title}</Link> },
  { title: 'Category', dataIndex: 'category', key: 'category' },
  { title: 'Project', dataIndex: 'projectName', key: 'projectName', render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
  { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: signedMoney },
  { title: 'GST Credit', dataIndex: 'gstCreditAmount', key: 'gstCreditAmount', align: 'right', render: signedMoney },
  { title: 'Status', dataIndex: 'status', key: 'status', render: (v: ReimbursementStatus) => <StatusTag status={v} label={STATUS[v].label} tone={STATUS[v].tone} /> },
  { title: 'Approved', dataIndex: 'approvedOn', key: 'approvedOn', render: dateOrDash },
  { title: 'Reimbursed', dataIndex: 'reimbursedOn', key: 'reimbursedOn', render: dateOrDash },
];

const employeeColumns: ColumnsType<ReimbursementReport['byEmployee'][number]> = [
  { title: 'Employee', dataIndex: 'employeeName', key: 'employeeName' },
  { title: 'Approved', dataIndex: 'approved', key: 'approved', align: 'right', render: signedMoney },
  { title: 'Reimbursed', dataIndex: 'reimbursed', key: 'reimbursed', align: 'right', render: signedMoney },
  { title: 'Awaiting Payment', dataIndex: 'awaitingReimbursement', key: 'awaitingReimbursement', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
];

/** Reimbursements — docs/04 §16: claims approved, reimbursed and pending, by employee (ADR-116). */
export default function ReimbursementsReportPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultPeriodFilters);
  const report = trpc.reports.reimbursements.useQuery(filters);
  const data = report.data;
  const t = data?.totals;
  const sub = (x: { count: number } | undefined) => (x ? `${x.count} claim(s)` : undefined);

  return (
    <>
      <PageHeader title="Reimbursements" description="Employee claims approved and reimbursed in the period, and what is still awaiting approval or payment." actions={<ExportButtons reportKey="reimbursements" filters={filters} />} />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} period />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard label="Approved" value={formatMoney(t?.approvedInPeriod.amount ?? null)} sub={sub(t?.approvedInPeriod)} />
        <KpiCard label="Reimbursed" value={formatMoney(t?.reimbursedInPeriod.amount ?? null)} sub={sub(t?.reimbursedInPeriod)} />
        <KpiCard label="Awaiting Payment" value={formatMoney(t?.awaitingReimbursement.amount ?? null)} sub={sub(t?.awaitingReimbursement)} />
        <KpiCard label="Awaiting Approval" value={formatMoney(t?.awaitingApproval.amount ?? null)} sub={sub(t?.awaitingApproval)} />
        <KpiCard label="Rejected" value={formatMoney(t?.rejected.amount ?? null)} sub={sub(t?.rejected)} />
      </div>

      <UiCard title="By Employee" flush className="mb-4">
        <Table<ReimbursementReport['byEmployee'][number]> rowKey="employeeId" size="small" pagination={false} loading={report.isLoading} columns={employeeColumns} dataSource={data?.byEmployee ?? []} tableLayout="auto" scroll={{ x: true }} />
      </UiCard>

      <UiCard title="Claims" flush className="mb-4">
        <Table<ReimbursementRow>
          rowKey="claimId"
          size="small"
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          loading={report.isLoading}
          columns={rowColumns}
          dataSource={data?.rows ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No claims in this period.' }}
        />
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
