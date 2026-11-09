'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, StatusTag, UiCard, type StatusTagTone } from '@zitaware/ui';
import type { ManpowerAllocationState, ManpowerUtilizationReport, ManpowerUtilizationRow, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatMoney } from '@/lib/format';
import { ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultPeriodFilters, signedMoney } from '../shared';

const STATE: Record<ManpowerAllocationState, { label: string; tone: StatusTagTone }> = {
  SUBMITTED: { label: 'Submitted', tone: 'pos' },
  DRAFT: { label: 'Draft', tone: 'warn' },
  NOT_STARTED: { label: 'Not Started', tone: 'mut' },
};

const monthLabel = (month: string) => new Date(`${month}T00:00:00Z`).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
// Percentages are server-computed strings; only the trailing zeros are trimmed for display.
const pct = (v: string | null) => (v === null ? <span className="text-muted-2">—</span> : <span className="tabular-nums">{v.replace(/\.?0+$/, '')}%</span>);

const rowColumns: ColumnsType<ManpowerUtilizationRow> = [
  { title: 'Month', dataIndex: 'month', key: 'month', render: monthLabel },
  { title: 'Employee', key: 'employee', render: (_v, r) => <span><b>{r.employeeName}</b><span className="block text-[12px] text-muted">{r.employeeCode}{r.departmentName ? ` · ${r.departmentName}` : ''}</span></span> },
  { title: 'State', dataIndex: 'state', key: 'state', render: (v: ManpowerAllocationState) => <StatusTag status={v} label={STATE[v].label} tone={STATE[v].tone} /> },
  { title: 'Project %', dataIndex: 'projectPercentage', key: 'projectPercentage', align: 'right', render: pct },
  { title: 'Non-Project %', dataIndex: 'nonProjectPercentage', key: 'nonProjectPercentage', align: 'right', render: pct },
  { title: 'Total %', dataIndex: 'totalPercentage', key: 'totalPercentage', align: 'right', render: pct },
  {
    title: 'Vs Capacity',
    dataIndex: 'variancePercentage',
    key: 'variancePercentage',
    align: 'right',
    render: (v: string | null) => (v === null ? <span className="text-muted-2">—</span> : /^-?0(\.0+)?$/.test(v) ? <span className="text-muted">At 100%</span> : <span className="font-semibold text-negative">{v.startsWith('-') ? '' : '+'}{pct(v)}</span>),
  },
  { title: 'Gross Salary', dataIndex: 'grossSalary', key: 'grossSalary', align: 'right', render: signedMoney },
  { title: 'Project Cost', dataIndex: 'projectCost', key: 'projectCost', align: 'right', render: (v: string | null) => <b>{signedMoney(v)}</b> },
  { title: 'Non-Project Cost', dataIndex: 'nonProjectCost', key: 'nonProjectCost', align: 'right', render: signedMoney },
  { title: 'Allocation', key: 'shares', render: (_v, r) => (r.shares.length ? <span className="text-[12px]">{r.shares.map((s) => `${s.targetName} ${s.percentage.replace(/\.?0+$/, '')}%`).join(' · ')}</span> : <span className="text-muted-2">—</span>) },
];

const monthColumns: ColumnsType<ManpowerUtilizationReport['byMonth'][number]> = [
  { title: 'Month', dataIndex: 'month', key: 'month', render: monthLabel },
  { title: 'Employees', dataIndex: 'employees', key: 'employees', align: 'right' },
  { title: 'Submitted', dataIndex: 'submitted', key: 'submitted', align: 'right' },
  { title: 'Draft', dataIndex: 'draft', key: 'draft', align: 'right' },
  { title: 'Not Started', dataIndex: 'notStarted', key: 'notStarted', align: 'right' },
  { title: 'Gross Salary', dataIndex: 'grossSalary', key: 'grossSalary', align: 'right', render: signedMoney },
  { title: 'Project Cost', dataIndex: 'projectCost', key: 'projectCost', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
  { title: 'Non-Project Cost', dataIndex: 'nonProjectCost', key: 'nonProjectCost', align: 'right', render: signedMoney },
  { title: 'Not Yet Attributed', dataIndex: 'unallocatedSalary', key: 'unallocatedSalary', align: 'right', render: signedMoney },
];

/** Manpower Utilization — docs/04 §16: submitted/draft monthly allocation percentages and salary cost (ADR-118). */
export default function ManpowerUtilizationPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultPeriodFilters);
  const report = trpc.reports.manpowerUtilization.useQuery(filters);
  const data = report.data;

  return (
    <>
      <PageHeader title="Manpower Utilization" description="Each employee's monthly allocation against 100% capacity, and the salary cost it attributes to projects." actions={<ExportButtons reportKey="manpower-utilization" filters={filters} />} />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} period />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Gross Salary" value={formatMoney(data?.totals.grossSalary ?? null)} />
        <KpiCard label="Project Cost" value={formatMoney(data?.totals.projectCost ?? null)} />
        <KpiCard label="Non-Project Cost" value={formatMoney(data?.totals.nonProjectCost ?? null)} />
        <KpiCard label="Not Yet Attributed" value={formatMoney(data?.totals.unallocatedSalary ?? null)} sub="Draft or missing allocations" />
      </div>

      <UiCard title="By Month" flush className="mb-4">
        <Table<ManpowerUtilizationReport['byMonth'][number]> rowKey="month" size="small" pagination={false} loading={report.isLoading} columns={monthColumns} dataSource={data?.byMonth ?? []} tableLayout="auto" scroll={{ x: true }} />
      </UiCard>

      <UiCard title="Employees" flush className="mb-4">
        <Table<ManpowerUtilizationRow>
          rowKey={(r) => `${r.month}-${r.employeeId}`}
          size="small"
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          loading={report.isLoading}
          columns={rowColumns}
          dataSource={data?.rows ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No employees in these months.' }}
        />
        <p className="m-0 border-t border-ui-2 px-4 py-3 text-[12px] text-muted">
          Enter and submit allocations on <Link href="/employee-costing?tab=allocation" className="text-brand hover:underline">Employee Costing</Link>. Only submitted months carry cost.
        </p>
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
