'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, UiCard } from '@zitaware/ui';
import type { ReportFilters, TdsInwardRow, TdsReconciliationTypeSummary, TdsReversedReceiptMatchRow, TdsUnmatchedCreditRow } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultFilters, signedMoney } from '../shared';
import { TDS_TYPE_LABELS, tdsRowColumns } from '../tds-shared';

const summaryColumns: ColumnsType<TdsReconciliationTypeSummary> = [
  { title: 'Type', dataIndex: 'deductionType', key: 'deductionType', render: (v: keyof typeof TDS_TYPE_LABELS) => TDS_TYPE_LABELS[v] },
  { title: 'Deducted on Receipts', dataIndex: 'deducted', key: 'deducted', align: 'right', render: signedMoney },
  { title: 'Certificate Credits', dataIndex: 'certificateCredits', key: 'certificateCredits', align: 'right', render: signedMoney },
  { title: '26AS / Statement Credits', dataIndex: 'statementCredits', key: 'statementCredits', align: 'right', render: signedMoney },
  { title: 'Not Yet in Statement', dataIndex: 'statementDifference', key: 'statementDifference', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
];

const creditColumns: ColumnsType<TdsUnmatchedCreditRow> = [
  { title: 'Credit Date', dataIndex: 'creditDate', key: 'creditDate', render: (v: string) => formatDate(v) },
  { title: 'Reference', dataIndex: 'referenceNumber', key: 'referenceNumber', render: (v: string) => <Link href="/tds-certificates" className="font-semibold text-brand hover:underline">{v}</Link> },
  { title: 'Source', dataIndex: 'source', key: 'source', render: (v: string) => (v === 'CERTIFICATE' ? 'Certificate' : '26AS / Statement') },
  { title: 'Type', dataIndex: 'deductionType', key: 'deductionType', render: (v: keyof typeof TDS_TYPE_LABELS) => TDS_TYPE_LABELS[v] },
  { title: 'Client', dataIndex: 'partyName', key: 'partyName' },
  { title: 'Period', key: 'period', render: (_v, r) => `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}` },
  { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: signedMoney },
  { title: 'Unmatched', dataIndex: 'unmatchedAmount', key: 'unmatchedAmount', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
];

const reversedColumns: ColumnsType<TdsReversedReceiptMatchRow> = [
  { title: 'Certificate', dataIndex: 'referenceNumber', key: 'referenceNumber' },
  { title: 'Type', dataIndex: 'deductionType', key: 'deductionType', render: (v: keyof typeof TDS_TYPE_LABELS) => TDS_TYPE_LABELS[v] },
  { title: 'Receipt', key: 'receipt', render: (_v, r) => <Link href={`/projects/${r.projectId}/receipts/${r.receiptId}`} className="text-brand hover:underline">Reversed receipt</Link> },
  { title: 'Matched', dataIndex: 'amount', key: 'amount', align: 'right', render: signedMoney },
];

/** TDS Certificate/26AS Reconciliation — docs/04 §16: matches and the exception queue (ADR-112). */
export default function TdsReconciliationPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters);
  const report = trpc.reports.tdsReconciliation.useQuery(filters);
  const data = report.data;

  return (
    <>
      <PageHeader
        title="TDS Certificate & 26AS Reconciliation"
        description="Deductions recorded on receipts against certificates and statement credits, with every exception to clear."
        actions={<ExportButtons reportKey="tds-reconciliation" filters={filters} />}
      />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Exceptions" value={data ? String(data.totals.exceptionCount) : '—'} sub="Items that need action" />
        <KpiCard label="Certificates Overdue" value={formatMoney(data?.totals.pendingAmount ?? null)} sub="Deducted, period over, not fully evidenced" />
        <KpiCard label="Credits Unexplained" value={formatMoney(data?.totals.unmatchedCreditAmount ?? null)} sub="Certificate or 26AS amounts matched to no deduction" />
      </div>

      <UiCard title="Deducted against Credits" flush className="mb-4">
        <Table<TdsReconciliationTypeSummary> rowKey="deductionType" size="small" pagination={false} loading={report.isLoading} columns={summaryColumns} dataSource={data?.summary ?? []} tableLayout="auto" scroll={{ x: true }} />
      </UiCard>

      <UiCard title={`Certificates Overdue (${data?.pendingCertificates.length ?? 0})`} flush className="mb-4">
        <Table<TdsInwardRow> rowKey="deductionId" size="small" pagination={{ pageSize: 25, hideOnSinglePage: true }} loading={report.isLoading} columns={tdsRowColumns} dataSource={data?.pendingCertificates ?? []} tableLayout="auto" scroll={{ x: true }} locale={{ emptyText: 'Nothing overdue.' }} />
      </UiCard>

      <UiCard title={`Partially Matched (${data?.partialMatches.length ?? 0})`} flush className="mb-4">
        <Table<TdsInwardRow> rowKey="deductionId" size="small" pagination={false} loading={report.isLoading} columns={tdsRowColumns} dataSource={data?.partialMatches ?? []} tableLayout="auto" scroll={{ x: true }} locale={{ emptyText: 'No partial matches.' }} />
      </UiCard>

      <UiCard title={`Credits No Deduction Explains (${data?.unmatchedCredits.length ?? 0})`} flush className="mb-4">
        <Table<TdsUnmatchedCreditRow> rowKey="certificateId" size="small" pagination={false} loading={report.isLoading} columns={creditColumns} dataSource={data?.unmatchedCredits ?? []} tableLayout="auto" scroll={{ x: true }} locale={{ emptyText: 'Every credit is matched.' }} />
      </UiCard>

      {data && data.reversedReceiptMatches.length ? (
        <UiCard title="Matches on Reversed Receipts" flush className="mb-4">
          <Table<TdsReversedReceiptMatchRow> rowKey="matchId" size="small" pagination={false} columns={reversedColumns} dataSource={data.reversedReceiptMatches} />
        </UiCard>
      ) : null}

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
