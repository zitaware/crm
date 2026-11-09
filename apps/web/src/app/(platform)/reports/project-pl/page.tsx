'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, UiCard } from '@zitaware/ui';
import type { ProjectPlAccountLine, ProjectPlRow, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatMoney } from '@/lib/format';
import { ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultPeriodFilters, money } from '../shared';

function signed(value: string | null) {
  if (value === null) return <span className="text-muted-2">—</span>;
  return <span className={`tabular-nums ${value.startsWith('-') ? 'text-negative' : ''}`}>{formatMoney(value)}</span>;
}

const projectColumns: ColumnsType<ProjectPlRow> = [
  {
    title: 'Project',
    key: 'project',
    render: (_v, r) =>
      r.projectId ? (
        <Link href={`/projects/${r.projectId}`} className="font-semibold text-brand hover:underline">
          {r.projectName}
        </Link>
      ) : (
        <span className="italic text-muted">{r.projectName}</span>
      ),
  },
  { title: 'Client', dataIndex: 'clientName', key: 'clientName', render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
  { title: 'Income', dataIndex: 'income', key: 'income', align: 'right', render: signed },
  { title: 'Expense', dataIndex: 'expense', key: 'expense', align: 'right', render: signed },
  { title: 'Contribution', dataIndex: 'contribution', key: 'contribution', align: 'right', render: (v: string) => <b>{signed(v)}</b> },
  { title: 'Manpower (analytical)', dataIndex: 'manpower', key: 'manpower', align: 'right', render: signed },
  { title: 'After Manpower', dataIndex: 'contributionAfterManpower', key: 'contributionAfterManpower', align: 'right', render: signed },
];

const accountColumns: ColumnsType<ProjectPlAccountLine> = [
  { title: 'Type', dataIndex: 'accountType', key: 'accountType', render: (v: string) => (v === 'INCOME' ? 'Income' : 'Expense') },
  {
    title: 'Ledger Account',
    key: 'account',
    render: (_v, a) => (
      <Link href={`/chart-of-accounts/ledger/${a.ledgerAccountId}`} className="text-brand hover:underline">
        {a.name}
      </Link>
    ),
  },
  { title: 'On Projects', dataIndex: 'assignedAmount', key: 'assignedAmount', align: 'right', render: money },
  { title: 'Not Assigned', dataIndex: 'unassignedAmount', key: 'unassignedAmount', align: 'right', render: money },
  { title: 'Total', dataIndex: 'totalAmount', key: 'totalAmount', align: 'right', render: (v: string) => <b>{money(v)}</b> },
];

/** Accrual Project P&L — docs/04 §16: from posted revenue/cost journal dimensions. */
export default function ProjectPlPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultPeriodFilters);
  const report = trpc.reports.projectPl.useQuery(filters);
  const data = report.data;
  const rows = data ? [...data.projects, ...(data.unassigned ? [data.unassigned] : [])] : [];

  return (
    <>
      <PageHeader
        title="Accrual Project P&L"
        description="Income, expense and contribution for each project, from posted journal lines."
        actions={<ExportButtons reportKey="project-pl" filters={filters} />}
      />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} period />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Income" value={formatMoney(data?.totals.income ?? null)} />
        <KpiCard label="Expense" value={formatMoney(data?.totals.expense ?? null)} />
        <KpiCard label="Contribution" value={formatMoney(data?.totals.contribution ?? null)} sub="Income − expense, including cost not assigned to a project" />
      </div>

      <UiCard title="Projects" flush className="mb-4">
        <Table<ProjectPlRow>
          rowKey={(r) => r.projectId ?? 'unassigned'}
          size="small"
          pagination={false}
          loading={report.isLoading}
          columns={projectColumns}
          dataSource={rows}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No projects to show.' }}
          summary={() =>
            data ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={2}>
                  <b>Total</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right">
                  <b>{signed(data.totals.income)}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right">
                  <b>{signed(data.totals.expense)}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right">
                  <b>{signed(data.totals.contribution)}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} colSpan={2} />
              </Table.Summary.Row>
            ) : null
          }
        />
        <p className="m-0 border-t border-ui-2 px-4 py-3 text-[12px] text-muted">
          Manpower is each project&apos;s share of salary by monthly allocation. Salary is posted company-wide, so it already sits in &ldquo;Not assigned to a
          project&rdquo; and is not added again to the totals.
        </p>
      </UiCard>

      <UiCard title="By Ledger Account" flush className="mb-4">
        <Table<ProjectPlAccountLine>
          rowKey="ledgerAccountId"
          size="small"
          pagination={false}
          loading={report.isLoading}
          columns={accountColumns}
          dataSource={data?.accounts ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'Nothing posted in this period.' }}
        />
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
