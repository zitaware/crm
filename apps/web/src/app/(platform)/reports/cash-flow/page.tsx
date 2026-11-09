'use client';

import { useState } from 'react';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, UiCard } from '@zitaware/ui';
import type { CashFlowMonthRow, CashFlowReport, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatMoney } from '@/lib/format';
import { ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultPeriodFilters, signedMoney } from '../shared';
import { PeriodStatusTag } from '../../bank-reconciliation/period-card';

const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });

const monthColumns: ColumnsType<CashFlowMonthRow> = [
  { title: 'Bank Account', dataIndex: 'bankAccountName', key: 'bankAccountName' },
  { title: 'Month', dataIndex: 'month', key: 'month', render: monthLabel },
  { title: 'Opening', dataIndex: 'opening', key: 'opening', align: 'right', render: signedMoney },
  { title: 'Money In', dataIndex: 'inflow', key: 'inflow', align: 'right', render: signedMoney },
  { title: 'Money Out', dataIndex: 'outflow', key: 'outflow', align: 'right', render: signedMoney },
  { title: 'Closing', dataIndex: 'closing', key: 'closing', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
  { title: 'In Matched', dataIndex: 'matchedInflow', key: 'matchedInflow', align: 'right', render: signedMoney },
  { title: 'Out Matched', dataIndex: 'matchedOutflow', key: 'matchedOutflow', align: 'right', render: signedMoney },
  { title: 'Reconciliation', dataIndex: 'reconciliationStatus', key: 'reconciliationStatus', render: (v: CashFlowMonthRow['reconciliationStatus']) => <PeriodStatusTag status={v} /> },
];

const accountColumns: ColumnsType<CashFlowReport['accounts'][number]> = [
  { title: 'Bank Account', dataIndex: 'bankAccountName', key: 'bankAccountName' },
  { title: 'Opening', dataIndex: 'opening', key: 'opening', align: 'right', render: signedMoney },
  { title: 'Money In', dataIndex: 'inflow', key: 'inflow', align: 'right', render: signedMoney },
  { title: 'Money Out', dataIndex: 'outflow', key: 'outflow', align: 'right', render: signedMoney },
  { title: 'Closing', dataIndex: 'closing', key: 'closing', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
];

const categoryColumns: ColumnsType<CashFlowReport['byCategory'][number]> = [
  { title: 'Kind', dataIndex: 'label', key: 'label' },
  { title: 'Net (in +, out −)', dataIndex: 'amount', key: 'amount', align: 'right', render: signedMoney },
];

/** Cash Flow — docs/04 §16: bank transactions by period/account; opening + movement = closing (ADR-115). */
export default function CashFlowPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultPeriodFilters);
  const report = trpc.reports.cashFlow.useQuery(filters);
  const data = report.data;

  return (
    <>
      <PageHeader title="Cash Flow" description="Money in and out of every bank account by month, with what the bank's statement has confirmed." actions={<ExportButtons reportKey="cash-flow" filters={filters} />} />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} period />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Opening" value={formatMoney(data?.totals.opening ?? null)} />
        <KpiCard label="Money In" value={formatMoney(data?.totals.inflow ?? null)} />
        <KpiCard label="Money Out" value={formatMoney(data?.totals.outflow ?? null)} />
        <KpiCard label="Closing" value={formatMoney(data?.totals.closing ?? null)} sub="Opening + in − out" />
      </div>

      <UiCard title="By Month" flush className="mb-4">
        <Table<CashFlowMonthRow> rowKey={(r) => `${r.bankAccountId}-${r.month}`} size="small" pagination={false} loading={report.isLoading} columns={monthColumns} dataSource={data?.months ?? []} tableLayout="auto" scroll={{ x: true }} locale={{ emptyText: 'No bank movement in this period.' }} />
      </UiCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <UiCard title="By Bank Account" flush className="mb-4">
          <Table rowKey="bankAccountId" size="small" pagination={false} loading={report.isLoading} columns={accountColumns} dataSource={data?.accounts ?? []} tableLayout="auto" scroll={{ x: true }} />
        </UiCard>
        <UiCard title="Net Movement by Kind" flush className="mb-4">
          <Table rowKey="category" size="small" pagination={false} loading={report.isLoading} columns={categoryColumns} dataSource={data?.byCategory ?? []} />
        </UiCard>
      </div>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
