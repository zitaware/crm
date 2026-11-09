'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, UiCard } from '@zitaware/ui';
import type { AgingBucket, AgingBucketTotal, PayablesAgingReport, PayablesAgingRow, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { AGING_LABELS, AgingTag, ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultFilters, signedMoney } from '../shared';

// Vendor bills carry no due date, so nothing is "not due": ages start at the document date.
const PAYABLE_BUCKETS: AgingBucket[] = ['DAYS_0_30', 'DAYS_31_60', 'DAYS_61_90', 'DAYS_90_PLUS'];

const rowColumns: ColumnsType<PayablesAgingRow> = [
  {
    title: 'Document',
    key: 'number',
    render: (_v, r) =>
      r.documentType === 'VENDOR_BILL' ? (
        <Link href={`/vendor-bills/${r.documentId}`} className="font-semibold text-brand hover:underline">{r.number}</Link>
      ) : (
        <span className="whitespace-nowrap font-semibold">{r.number}</span>
      ),
  },
  { title: 'Type', dataIndex: 'documentType', key: 'documentType', render: (v: PayablesAgingRow['documentType']) => (v === 'VENDOR_BILL' ? 'Vendor Bill' : 'Stock Receipt') },
  { title: 'Vendor', dataIndex: 'vendorName', key: 'vendorName' },
  { title: 'Project', dataIndex: 'projectName', key: 'projectName', render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
  { title: 'Date', dataIndex: 'documentDate', key: 'documentDate', render: (v: string) => formatDate(v) },
  { title: 'Total', dataIndex: 'totalAmount', key: 'totalAmount', align: 'right', render: signedMoney },
  { title: 'Settled', dataIndex: 'settledAmount', key: 'settledAmount', align: 'right', render: signedMoney },
  { title: 'Outstanding', dataIndex: 'outstandingAmount', key: 'outstandingAmount', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
  { title: 'Approved for Payment', dataIndex: 'approvedForPayment', key: 'approvedForPayment', align: 'right', render: signedMoney },
  { title: 'Age (Days)', dataIndex: 'ageDays', key: 'ageDays', align: 'right' },
  { title: 'Age', dataIndex: 'bucket', key: 'bucket', render: (v: AgingBucket) => <AgingTag bucket={v} /> },
];

type VendorRow = PayablesAgingReport['vendors'][number];
const vendorColumns: ColumnsType<VendorRow> = [
  { title: 'Vendor', dataIndex: 'vendorName', key: 'vendorName' },
  ...PAYABLE_BUCKETS.map((bucket) => ({ title: AGING_LABELS[bucket], key: bucket, align: 'right' as const, render: (_v: unknown, v: VendorRow) => signedMoney(v.byBucket[bucket]) })),
  { title: 'Outstanding', dataIndex: 'outstanding', key: 'outstanding', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
];

/** Payables Aging — docs/04 §16: vendor outstanding by age, with what is already approved for payment (ADR-116). */
export default function PayablesAgingPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters);
  const report = trpc.reports.payablesAging.useQuery(filters);
  const data = report.data;
  const bucket = (b: AgingBucket): AgingBucketTotal | undefined => data?.buckets.find((x) => x.bucket === b);

  return (
    <>
      <PageHeader title="Payables Aging" description="What is owed to each vendor on the date, by age, and how much is already on an approved payment request." actions={<ExportButtons reportKey="payables-aging" filters={filters} />} />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Total Outstanding" value={formatMoney(data?.total ?? null)} sub={data ? `${data.rows.length} document(s)` : undefined} />
        <KpiCard label="Approved for Payment" value={formatMoney(data?.approvedForPaymentTotal ?? null)} />
        {PAYABLE_BUCKETS.map((b) => (
          <KpiCard key={b} label={AGING_LABELS[b]} value={formatMoney(bucket(b)?.amount ?? null)} sub={bucket(b) ? `${bucket(b)!.count} document(s)` : undefined} />
        ))}
      </div>

      <UiCard title="By Vendor" flush className="mb-4">
        <Table<VendorRow> rowKey={(v) => v.vendorId ?? v.vendorName} size="small" pagination={false} loading={report.isLoading} columns={vendorColumns} dataSource={data?.vendors ?? []} tableLayout="auto" scroll={{ x: true }} locale={{ emptyText: 'Nothing owed to vendors on this date.' }} />
      </UiCard>

      <UiCard title="Documents" flush className="mb-4">
        <Table<PayablesAgingRow>
          rowKey="documentId"
          size="small"
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          loading={report.isLoading}
          columns={rowColumns}
          dataSource={data?.rows ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'Nothing owed to vendors on this date.' }}
        />
        <p className="m-0 border-t border-ui-2 px-4 py-3 text-[12px] text-muted">
          Settle bills through{' '}
          <Link href="/payment-requests" className="text-brand hover:underline">Payment Requests</Link> and{' '}
          <Link href="/vendor-payments" className="text-brand hover:underline">Vendor Payments</Link>. &ldquo;Approved for payment&rdquo; reflects today&rsquo;s request status.
        </p>
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
