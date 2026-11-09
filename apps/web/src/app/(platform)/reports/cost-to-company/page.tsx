'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, UiCard } from '@zitaware/ui';
import { COST_CATEGORIES, COST_CATEGORY_LABELS } from '@zitaware/contracts/reports';
import type { CostToCompanyRow, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatMoney } from '@/lib/format';
import { ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultPeriodFilters, money } from '../shared';

const columns: ColumnsType<CostToCompanyRow> = [
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
  ...COST_CATEGORIES.map((c) => ({ title: COST_CATEGORY_LABELS[c], key: c, align: 'right' as const, render: (_v: unknown, r: CostToCompanyRow) => money(r.amounts[c]) })),
  { title: 'Posted Total', dataIndex: 'postedTotal', key: 'postedTotal', align: 'right', render: money },
  { title: 'Total', dataIndex: 'total', key: 'total', align: 'right', render: (v: string) => <b>{money(v)}</b> },
];

/** Cost to Company — docs/04 §16: posted cost plus analytical allocations; summary equals the detail table. */
export default function CostToCompanyPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultPeriodFilters);
  const report = trpc.reports.costToCompany.useQuery(filters);
  const data = report.data;

  return (
    <>
      <PageHeader
        title="Cost to Company"
        description="Each project's cost by kind — posted costs from the ledger plus the analytical manpower allocation."
        actions={<ExportButtons reportKey="cost-to-company" filters={filters} />}
      />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} period />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Total Cost" value={formatMoney(data?.totals.total ?? null)} sub="Posted plus manpower" />
        <KpiCard label="Posted Cost" value={formatMoney(data?.totals.postedTotal ?? null)} />
        <KpiCard label="Manpower (analytical)" value={formatMoney(data?.totals.amounts.MANPOWER ?? null)} />
        <KpiCard label="Not Assigned to a Project" value={data?.unassignedPostedCost !== null ? formatMoney(data?.unassignedPostedCost ?? null) : '—'} sub="Posted overheads and salary" />
      </div>

      <UiCard title="Projects" flush className="mb-4">
        <Table<CostToCompanyRow>
          rowKey="projectId"
          size="small"
          pagination={false}
          loading={report.isLoading}
          columns={columns}
          dataSource={data?.rows ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No projects to show.' }}
          summary={() =>
            data ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={2}>
                  <b>Total</b>
                </Table.Summary.Cell>
                {COST_CATEGORIES.map((c, i) => (
                  <Table.Summary.Cell key={c} index={i + 2} align="right">
                    <b>{money(data.totals.amounts[c])}</b>
                  </Table.Summary.Cell>
                ))}
                <Table.Summary.Cell index={COST_CATEGORIES.length + 2} align="right">
                  <b>{money(data.totals.postedTotal)}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={COST_CATEGORIES.length + 3} align="right">
                  <b>{money(data.totals.total)}</b>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            ) : null
          }
        />
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
