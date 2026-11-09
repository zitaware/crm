'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, UiCard } from '@zitaware/ui';
import type { EmployeeAdvanceRow, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatMoney } from '@/lib/format';
import { ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultPeriodFilters, signedMoney } from '../shared';

const columns: ColumnsType<EmployeeAdvanceRow> = [
  { title: 'Employee', dataIndex: 'employeeName', key: 'employeeName' },
  { title: 'Opening', dataIndex: 'opening', key: 'opening', align: 'right', render: signedMoney },
  { title: 'Advances Issued', dataIndex: 'advances', key: 'advances', align: 'right', render: signedMoney },
  { title: 'Claims Adjusted', dataIndex: 'claimsAdjusted', key: 'claimsAdjusted', align: 'right', render: signedMoney },
  { title: 'Reimbursements Paid', dataIndex: 'reimbursements', key: 'reimbursements', align: 'right', render: signedMoney },
  { title: 'Other', dataIndex: 'other', key: 'other', align: 'right', render: signedMoney },
  { title: 'Closing', dataIndex: 'closing', key: 'closing', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
];

/** Employee Advances — docs/04 §16: opening + advances − approved adjustments ± settlements = closing (ADR-116). */
export default function EmployeeAdvancesReportPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultPeriodFilters);
  const report = trpc.reports.employeeAdvances.useQuery(filters);
  const data = report.data;

  return (
    <>
      <PageHeader title="Employee Advances" description="Each employee's advance balance: advances issued, claims adjusted against them, reimbursements paid." actions={<ExportButtons reportKey="employee-advances" filters={filters} />} />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} period />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Opening" value={formatMoney(data?.totals.opening ?? null)} />
        <KpiCard label="Advances Issued" value={formatMoney(data?.totals.advances ?? null)} />
        <KpiCard label="Claims Adjusted" value={formatMoney(data?.totals.claimsAdjusted ?? null)} />
        <KpiCard label="Closing" value={formatMoney(data?.totals.closing ?? null)} sub="Positive: held by employees · negative: owed to them" />
      </div>

      <UiCard title="By Employee" flush className="mb-4">
        <Table<EmployeeAdvanceRow>
          rowKey={(r) => r.employeeId ?? 'none'}
          size="small"
          pagination={false}
          loading={report.isLoading}
          columns={columns}
          dataSource={data?.rows ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No advance activity for any employee.' }}
          summary={() =>
            data && data.rows.length > 1 ? (
              <Table.Summary.Row className="font-semibold">
                <Table.Summary.Cell index={0}>Total</Table.Summary.Cell>
                {(['opening', 'advances', 'claimsAdjusted', 'reimbursements', 'other', 'closing'] as const).map((k, i) => (
                  <Table.Summary.Cell key={k} index={i + 1} align="right">{signedMoney(data.totals[k])}</Table.Summary.Cell>
                ))}
              </Table.Summary.Row>
            ) : null
          }
        />
        <p className="m-0 border-t border-ui-2 px-4 py-3 text-[12px] text-muted">
          Company-level: client and project filters do not apply. Give advances and settle claims on{' '}
          <Link href="/employee-expenses" className="text-brand hover:underline">Employee Expenses</Link>.
        </p>
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
