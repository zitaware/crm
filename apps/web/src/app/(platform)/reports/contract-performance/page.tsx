'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import type { ContractPerformanceRow, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatMoney } from '@/lib/format';
import { ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultFilters, percent, signedMoney } from '../shared';

const columns: ColumnsType<ContractPerformanceRow> = [
  {
    title: 'Project',
    key: 'project',
    fixed: 'left',
    render: (_v, r) => (
      <Link href={`/projects/${r.projectId}`} className="font-semibold text-brand hover:underline">
        {r.projectName}
      </Link>
    ),
  },
  { title: 'Client', dataIndex: 'clientName', key: 'clientName', render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
  { title: 'Contract Value', dataIndex: 'contractValue', key: 'contractValue', align: 'right', render: signedMoney },
  { title: 'Billed to Date', dataIndex: 'billedToDate', key: 'billedToDate', align: 'right', render: signedMoney },
  { title: 'Billed %', dataIndex: 'billedPercent', key: 'billedPercent', align: 'right', render: percent },
  { title: 'Remaining to Bill', dataIndex: 'remainingToBill', key: 'remainingToBill', align: 'right', render: signedMoney },
  { title: 'Budget', dataIndex: 'budget', key: 'budget', align: 'right', render: signedMoney },
  { title: 'Posted Cost', dataIndex: 'postedCostToDate', key: 'postedCostToDate', align: 'right', render: signedMoney },
  { title: 'Manpower', dataIndex: 'manpowerToDate', key: 'manpowerToDate', align: 'right', render: signedMoney },
  { title: 'Cost to Date', dataIndex: 'costToDate', key: 'costToDate', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
  { title: 'Budget Used', dataIndex: 'budgetUsedPercent', key: 'budgetUsedPercent', align: 'right', render: percent },
  { title: 'Budget Remaining', dataIndex: 'budgetRemaining', key: 'budgetRemaining', align: 'right', render: signedMoney },
  {
    title: 'Status',
    key: 'status',
    render: (_v, r) =>
      r.budget === null ? (
        <StatusTag status="NO_BUDGET" label="No budget" tone="mut" />
      ) : r.overBudget ? (
        <StatusTag status="OVER_BUDGET" label="Over budget" tone="neg" />
      ) : (
        <StatusTag status="WITHIN_BUDGET" label="Within budget" tone="pos" />
      ),
  },
];

/** Contract & Budget Performance — contract/budget basis (docs/06 "Reports"), as of a date. */
export default function ContractPerformancePage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters);
  const report = trpc.reports.contractPerformance.useQuery(filters);
  const data = report.data;
  const t = data?.totals;

  return (
    <>
      <PageHeader
        title="Contract & Budget Performance"
        description="How much of each contract is billed and how much of each budget is used."
        actions={<ExportButtons reportKey="contract-performance" filters={filters} />}
      />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Contract Value" value={formatMoney(t?.contractValue ?? null)} sub={t?.projectsWithoutValue ? `${t.projectsWithoutValue} project(s) without a value` : 'Excluding GST'} />
        <KpiCard label="Billed to Date" value={formatMoney(t?.billedToDate ?? null)} sub={t?.billedPercent ? `${t.billedPercent}% of contract value` : undefined} />
        <KpiCard label="Budget" value={formatMoney(t?.budget ?? null)} sub={t?.projectsWithoutBudget ? `${t.projectsWithoutBudget} project(s) without a budget` : undefined} />
        <KpiCard label="Cost to Date" value={formatMoney(t?.costToDate ?? null)} sub={t?.budgetUsedPercent ? `${t.budgetUsedPercent}% of budget used` : 'Posted cost plus manpower'} />
      </div>

      <UiCard title="Projects" flush className="mb-4">
        <Table<ContractPerformanceRow>
          rowKey="projectId"
          size="small"
          pagination={false}
          loading={report.isLoading}
          columns={columns}
          dataSource={data?.rows ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No projects to show.' }}
          summary={() =>
            t ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={2}>
                  <b>Total</b>
                </Table.Summary.Cell>
                {[t.contractValue, t.billedToDate].map((v, i) => (
                  <Table.Summary.Cell key={`a${i}`} index={2 + i} align="right">
                    <b>{signedMoney(v)}</b>
                  </Table.Summary.Cell>
                ))}
                <Table.Summary.Cell index={4} align="right">
                  <b>{percent(t.billedPercent)}</b>
                </Table.Summary.Cell>
                {[t.remainingToBill, t.budget, t.postedCostToDate, t.manpowerToDate, t.costToDate].map((v, i) => (
                  <Table.Summary.Cell key={`b${i}`} index={5 + i} align="right">
                    <b>{signedMoney(v)}</b>
                  </Table.Summary.Cell>
                ))}
                <Table.Summary.Cell index={10} align="right">
                  <b>{percent(t.budgetUsedPercent)}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={11} align="right">
                  <b>{signedMoney(t.budgetRemaining)}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={12} />
              </Table.Summary.Row>
            ) : null
          }
        />
        <p className="m-0 border-t border-ui-2 px-4 py-3 text-[12px] text-muted">
          Billed is revenue posted to the project (the Accrual Project P&amp;L income); cost to date is the Cost to Company total. Total percentages and remaining
          amounts count only projects that have a contract value or budget.
        </p>
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
