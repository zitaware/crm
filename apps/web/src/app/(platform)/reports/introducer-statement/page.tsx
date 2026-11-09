'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, StatusTag, UiCard, type StatusTagTone } from '@zitaware/ui';
import type { IntroducerStatementAccount, IntroducerStatementEntryType, IntroducerStatementLine, IntroducerStatementPayment, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultPeriodFilters, signedMoney } from '../shared';

const ENTRY: Record<IntroducerStatementEntryType, { label: string; tone: StatusTagTone }> = {
  ACCRUAL: { label: 'Accrual', tone: 'info' },
  ACCRUAL_REVERSAL: { label: 'Accrual Reversal', tone: 'neg' },
  PAYMENT: { label: 'Payment', tone: 'pos' },
  PAYMENT_REVERSAL: { label: 'Payment Reversal', tone: 'neg' },
};

const accountColumns: ColumnsType<IntroducerStatementAccount> = [
  { title: 'Introducer', dataIndex: 'introducerName', key: 'introducerName', render: (v: string) => <b>{v}</b> },
  { title: 'Project', key: 'project', render: (_v, a) => <Link href={`/projects/${a.projectId}`} className="text-brand hover:underline">{a.projectName}</Link> },
  { title: 'Basis', dataIndex: 'basisDescription', key: 'basisDescription' },
  { title: 'Entitlement', dataIndex: 'entitlement', key: 'entitlement', align: 'right', render: signedMoney },
  { title: 'Not Yet Accrued', dataIndex: 'notYetAccrued', key: 'notYetAccrued', align: 'right', render: signedMoney },
  { title: 'Opening', dataIndex: 'opening', key: 'opening', align: 'right', render: signedMoney },
  { title: 'Accrued', dataIndex: 'accrued', key: 'accrued', align: 'right', render: signedMoney },
  { title: 'Paid', dataIndex: 'paid', key: 'paid', align: 'right', render: signedMoney },
  { title: 'Closing', dataIndex: 'closing', key: 'closing', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
];

const lineColumns: ColumnsType<IntroducerStatementLine> = [
  { title: 'Date', dataIndex: 'ledgerDate', key: 'ledgerDate', render: (v: string) => formatDate(v) },
  { title: 'Entry', dataIndex: 'entryType', key: 'entryType', render: (v: IntroducerStatementEntryType) => <StatusTag status={v} label={ENTRY[v].label} tone={ENTRY[v].tone} /> },
  { title: 'Document', dataIndex: 'documentNumber', key: 'documentNumber' },
  { title: 'Particulars', dataIndex: 'narrative', key: 'narrative', render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
  { title: 'Accrued', dataIndex: 'accrued', key: 'accrued', align: 'right', render: signedMoney },
  { title: 'Paid', dataIndex: 'paid', key: 'paid', align: 'right', render: signedMoney },
  { title: 'Balance', dataIndex: 'balance', key: 'balance', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
];

const paymentColumns: ColumnsType<IntroducerStatementPayment> = [
  { title: 'Date', dataIndex: 'ledgerDate', key: 'ledgerDate', render: (v: string) => formatDate(v) },
  { title: 'Payment', dataIndex: 'paymentNumber', key: 'paymentNumber', render: (v: string) => <b>{v}</b> },
  { title: 'Entry', dataIndex: 'entryType', key: 'entryType', render: (v: IntroducerStatementPayment['entryType']) => (v === 'PAYMENT' ? <StatusTag status={v} label="Payment" tone="pos" /> : <StatusTag status={v} label="Reversal" tone="neg" />) },
  { title: 'Introducer', dataIndex: 'introducerName', key: 'introducerName' },
  { title: 'Reference', dataIndex: 'referenceNumber', key: 'referenceNumber', render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
  { title: 'Allocated', dataIndex: 'allocatedAmount', key: 'allocatedAmount', align: 'right', render: signedMoney },
  { title: 'Advance', dataIndex: 'advanceAmount', key: 'advanceAmount', align: 'right', render: signedMoney },
  { title: 'Gross', dataIndex: 'grossAmount', key: 'grossAmount', align: 'right', render: signedMoney },
  { title: 'TDS', dataIndex: 'tdsAmount', key: 'tdsAmount', align: 'right', render: signedMoney },
  { title: 'Net Paid', dataIndex: 'netAmount', key: 'netAmount', align: 'right', render: signedMoney },
];

/** Introducer Statement — docs/04 §16: accrual, TDS, payment allocation, advance and balance by introducer/project (ADR-117). */
export default function IntroducerStatementPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultPeriodFilters);
  const report = trpc.reports.introducerStatement.useQuery(filters);
  const data = report.data;

  return (
    <>
      <PageHeader title="Introducer Statement" description="Each introducer's commission by project: entitlement, accruals, payments, TDS and the balance still payable." actions={<ExportButtons reportKey="introducer-statement" filters={filters} />} />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} period />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard label="Opening Payable" value={formatMoney(data?.totals.opening ?? null)} />
        <KpiCard label="Accrued" value={formatMoney(data?.totals.accrued ?? null)} />
        <KpiCard label="Paid" value={formatMoney(data?.totals.paid ?? null)} />
        <KpiCard label="Closing Payable" value={formatMoney(data?.totals.closing ?? null)} sub={data ? `Not yet accrued ${formatMoney(data.totals.notYetAccrued)}` : undefined} />
        <KpiCard label="Unallocated Advance" value={data?.advanceOutstanding ? formatMoney(data.advanceOutstanding) : '—'} sub={data && data.advanceOutstanding === null ? 'Not shown on a filtered view' : undefined} />
      </div>

      <UiCard title="By Introducer and Project" flush className="mb-4">
        <Table<IntroducerStatementAccount>
          rowKey={(a) => `${a.introducerId}-${a.projectId}`}
          size="small"
          pagination={false}
          loading={report.isLoading}
          columns={accountColumns}
          dataSource={data?.accounts ?? []}
          tableLayout="auto" scroll={{ x: true }}
          expandable={{ expandedRowRender: (a) => <Table<IntroducerStatementLine> rowKey={(l) => `${l.entryType}-${l.documentId}`} size="small" pagination={false} columns={lineColumns} dataSource={a.lines} tableLayout="auto" scroll={{ x: true }} locale={{ emptyText: 'No movement in this period.' }} /> }}
          locale={{ emptyText: 'No introducer agreements on these projects.' }}
        />
      </UiCard>

      <UiCard title="Payments" flush className="mb-4">
        <Table<IntroducerStatementPayment>
          rowKey={(p) => `${p.paymentId}-${p.entryType}`}
          size="small"
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          loading={report.isLoading}
          columns={paymentColumns}
          dataSource={data?.payments ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No introducer payments in this period.' }}
        />
        <p className="m-0 border-t border-ui-2 px-4 py-3 text-[12px] text-muted">
          Accrue commission and record payments on <Link href="/introducer-fees" className="text-brand hover:underline">Introducer Fees</Link>.
        </p>
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
