'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { COST_CATEGORIES, COST_CATEGORY_LABELS, REPORT_BASIS_LABELS } from '@zitaware/contracts/reports';
import type { BusinessOverviewCard, BusinessOverviewProjectRow, ReportBasis, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatMoney } from '@/lib/format';
import { ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultPeriodFilters, signedMoney } from '../shared';

const BASES: Array<Exclude<ReportBasis, 'MULTIPLE'>> = ['ACCRUAL', 'CASH', 'CONTRACT_BUDGET', 'BANK'];
const POSTED_CATEGORIES = COST_CATEGORIES.filter((c) => c !== 'MANPOWER');

const columns: ColumnsType<BusinessOverviewProjectRow> = [
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
  { title: 'Income (Accrual)', dataIndex: 'income', key: 'income', align: 'right', render: signedMoney },
  ...POSTED_CATEGORIES.map((c) => ({ title: COST_CATEGORY_LABELS[c], key: c, align: 'right' as const, render: (_v: unknown, r: BusinessOverviewProjectRow) => signedMoney(r.costs[c]) })),
  { title: 'Posted Cost (Accrual)', dataIndex: 'postedCost', key: 'postedCost', align: 'right', render: signedMoney },
  { title: 'Accrual Contribution', dataIndex: 'accrualContribution', key: 'accrualContribution', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
  { title: 'Manpower (Analytical)', dataIndex: 'manpower', key: 'manpower', align: 'right', render: signedMoney },
  { title: 'Cash In', dataIndex: 'cashIn', key: 'cashIn', align: 'right', render: signedMoney },
  { title: 'Cash Out', dataIndex: 'cashOut', key: 'cashOut', align: 'right', render: signedMoney },
  { title: 'Net Cash', dataIndex: 'netCash', key: 'netCash', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
];

function BasisGroup({ basis, cards }: { basis: Exclude<ReportBasis, 'MULTIPLE'>; cards: BusinessOverviewCard[] }) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center gap-2">
        <StatusTag status={basis} label={`${REPORT_BASIS_LABELS[basis]} basis`} tone="info" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((c) => (
          <KpiCard key={c.key} label={c.label} value={c.amount === null ? '—' : formatMoney(c.amount)} sub={c.note} />
        ))}
      </div>
    </div>
  );
}

/** Business Overview — docs/04 §16: every card labelled accrual, cash, contract/budget or bank; no blended profit. */
export default function BusinessOverviewPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultPeriodFilters);
  const report = trpc.reports.businessOverview.useQuery(filters);
  const data = report.data;

  return (
    <>
      <PageHeader
        title="Business Overview"
        description="Accrual, cash, contract/budget and bank figures side by side — each under its own basis."
        actions={<ExportButtons reportKey="business-overview" filters={filters} />}
      />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} period />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      {data ? BASES.map((basis) => <BasisGroup key={basis} basis={basis} cards={data.cards.filter((c) => c.basis === basis)} />) : null}

      <UiCard title="Projects" flush className="mb-4">
        <Table<BusinessOverviewProjectRow>
          rowKey="projectId"
          size="small"
          pagination={false}
          loading={report.isLoading}
          columns={columns}
          dataSource={data?.projects ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No projects to show.' }}
        />
        <p className="m-0 border-t border-ui-2 px-4 py-3 text-[12px] text-muted">
          Accrual contribution and net cash are different measures and are never added together. Manpower is an analytical salary allocation shown for context.
        </p>
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
