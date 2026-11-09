'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, UiCard } from '@zitaware/ui';
import { CASH_CATEGORIES, CASH_CATEGORY_LABELS } from '@zitaware/contracts/reports';
import type { CashProfitabilityRow, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatMoney } from '@/lib/format';
import { ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultPeriodFilters, percent, signedMoney } from '../shared';

function projectCell(r: CashProfitabilityRow) {
  return r.projectId ? (
    <Link href={`/projects/${r.projectId}`} className="font-semibold text-brand hover:underline">
      {r.projectName}
    </Link>
  ) : (
    <span className="italic text-muted">{r.projectName}</span>
  );
}

const summaryColumns: ColumnsType<CashProfitabilityRow> = [
  { title: 'Project', key: 'project', render: (_v, r) => projectCell(r) },
  { title: 'Client', dataIndex: 'clientName', key: 'clientName', render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
  { title: 'Contract Value', dataIndex: 'contractValue', key: 'contractValue', align: 'right', render: signedMoney },
  { title: 'Cash In', dataIndex: 'cashIn', key: 'cashIn', align: 'right', render: signedMoney },
  { title: 'Cash Out', dataIndex: 'cashOut', key: 'cashOut', align: 'right', render: signedMoney },
  { title: 'Net Cash', dataIndex: 'netCash', key: 'netCash', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
  { title: 'Cash Margin', dataIndex: 'cashMarginPercent', key: 'cashMarginPercent', align: 'right', render: percent },
];

const detailColumns: ColumnsType<CashProfitabilityRow> = [
  { title: 'Project', key: 'project', fixed: 'left', render: (_v, r) => projectCell(r) },
  ...CASH_CATEGORIES.map((c) => ({ title: CASH_CATEGORY_LABELS[c], key: c, align: 'right' as const, render: (_v: unknown, r: CashProfitabilityRow) => signedMoney(r.amounts[c]) })),
];

/** Cash Profitability (renamed from Earning) — docs/04 §16: states its formula and is not accrual P&L. */
export default function CashProfitabilityPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultPeriodFilters);
  const report = trpc.reports.cashProfitability.useQuery(filters);
  const data = report.data;
  const rows = data ? [...data.projects, ...(data.unassigned ? [data.unassigned] : [])] : [];

  return (
    <>
      <PageHeader
        title="Cash Profitability"
        description="Cash received and paid for each project, from bank movements — not accrual P&L."
        actions={<ExportButtons reportKey="cash-profitability" filters={filters} />}
      />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} period />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Cash In" value={formatMoney(data?.totals.cashIn ?? null)} sub="Client receipts and releases" />
        <KpiCard label="Cash Out" value={formatMoney(data?.totals.cashOut ?? null)} />
        <KpiCard label="Net Cash" value={formatMoney(data?.totals.netCash ?? null)} sub="Cash in − cash out" />
        <KpiCard label="Cash Margin" value={data?.totals.cashMarginPercent ? `${data.totals.cashMarginPercent}%` : '—'} sub="Net cash ÷ cash in" />
      </div>

      <UiCard title="Projects" flush className="mb-4">
        <Table<CashProfitabilityRow>
          rowKey={(r) => r.projectId ?? 'unassigned'}
          size="small"
          pagination={false}
          loading={report.isLoading}
          columns={summaryColumns}
          dataSource={rows}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No projects to show.' }}
          summary={() =>
            data ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={3}>
                  <b>Total</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right">
                  <b>{signedMoney(data.totals.cashIn)}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right">
                  <b>{signedMoney(data.totals.cashOut)}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">
                  <b>{signedMoney(data.totals.netCash)}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="right">
                  <b>{percent(data.totals.cashMarginPercent)}</b>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            ) : null
          }
        />
        <p className="m-0 border-t border-ui-2 px-4 py-3 text-[12px] text-muted">
          Cash is attributed through the document that moved it: a receipt by the invoices it settled, a vendor payment by the bills it paid, an introducer
          payment by the accruals it settled (net of TDS, shared by gross amount). Salary payments, card settlements and unallocated cash belong to no project.
        </p>
      </UiCard>

      <UiCard title="By Kind of Movement" flush className="mb-4">
        <Table<CashProfitabilityRow>
          rowKey={(r) => r.projectId ?? 'unassigned'}
          size="small"
          pagination={false}
          loading={report.isLoading}
          columns={detailColumns}
          dataSource={rows}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No bank movement in this period.' }}
          summary={() =>
            data ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}>
                  <b>Total</b>
                </Table.Summary.Cell>
                {CASH_CATEGORIES.map((c, i) => (
                  <Table.Summary.Cell key={c} index={i + 1} align="right">
                    <b>{signedMoney(data.totals.amounts[c])}</b>
                  </Table.Summary.Cell>
                ))}
              </Table.Summary.Row>
            ) : null
          }
        />
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
