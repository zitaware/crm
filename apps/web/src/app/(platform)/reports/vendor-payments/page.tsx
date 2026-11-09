'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import type { ReportFilters, TaxDeductionAmounts, VendorPaymentAllocationLine, VendorPaymentReport, VendorPaymentRow } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultPeriodFilters, signedMoney } from '../shared';

const deductionColumns = <T extends { deductions: TaxDeductionAmounts }>(): ColumnsType<T> =>
  (['TDS', 'CGST_TDS', 'SGST_TDS', 'IGST_TDS'] as const).map((type) => ({
    title: type.replace('_', '-'),
    key: type,
    align: 'right' as const,
    render: (_v: unknown, r: T) => signedMoney(r.deductions[type]),
  }));

const paymentColumns: ColumnsType<VendorPaymentRow> = [
  { title: 'Posted', dataIndex: 'ledgerDate', key: 'ledgerDate', render: (v: string) => formatDate(v) },
  {
    title: 'Payment',
    key: 'payment',
    render: (_v, r) => (
      <Link href={`/vendor-payments/${r.paymentId}`} className="font-semibold text-brand hover:underline">
        {r.utrReference ?? formatDate(r.paymentDate)}
      </Link>
    ),
  },
  { title: 'Entry', dataIndex: 'entryType', key: 'entryType', render: (v: VendorPaymentRow['entryType']) => (v === 'PAYMENT' ? <StatusTag status={v} label="Payment" tone="pos" /> : <StatusTag status={v} label="Reversal" tone="neg" />) },
  { title: 'Vendors', key: 'vendors', render: (_v, r) => r.vendorNames.join(', ') },
  { title: 'Bank Account', dataIndex: 'bankAccountName', key: 'bankAccountName' },
  { title: 'Cash Paid', dataIndex: 'cashPaid', key: 'cashPaid', align: 'right', render: signedMoney },
  ...deductionColumns<VendorPaymentRow>(),
  { title: 'Settled', dataIndex: 'settledAmount', key: 'settledAmount', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
];

const allocationColumns: ColumnsType<VendorPaymentAllocationLine> = [
  { title: 'Vendor Bill', key: 'bill', render: (_v, a) => <Link href={`/vendor-bills/${a.vendorBillId}`} className="text-brand hover:underline">{a.vendorBillNumber}</Link> },
  { title: 'Vendor', dataIndex: 'vendorName', key: 'vendorName' },
  { title: 'Project', dataIndex: 'projectName', key: 'projectName' },
  { title: 'Requested', dataIndex: 'requestedAmount', key: 'requestedAmount', align: 'right', render: signedMoney },
  { title: 'Cash Paid', dataIndex: 'cashPaid', key: 'cashPaid', align: 'right', render: signedMoney },
  ...deductionColumns<VendorPaymentAllocationLine>(),
  { title: 'Settled', dataIndex: 'settledAmount', key: 'settledAmount', align: 'right', render: signedMoney },
];

const vendorColumns: ColumnsType<VendorPaymentReport['byVendor'][number]> = [
  { title: 'Vendor', dataIndex: 'vendorName', key: 'vendorName' },
  { title: 'Cash Paid', dataIndex: 'cashPaid', key: 'cashPaid', align: 'right', render: signedMoney },
  { title: 'Tax Withheld', dataIndex: 'deducted', key: 'deducted', align: 'right', render: signedMoney },
  { title: 'Settled', dataIndex: 'settledAmount', key: 'settledAmount', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
];

/** Vendor Payments — docs/04 §16: payments with the bills they settled, cash paid and tax withheld (ADR-116). */
export default function VendorPaymentsReportPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultPeriodFilters);
  const report = trpc.reports.vendorPayments.useQuery(filters);
  const data = report.data;

  return (
    <>
      <PageHeader title="Vendor Payments" description="Every vendor payment in the period with the bills it settled, cash paid and tax withheld." actions={<ExportButtons reportKey="vendor-payments" filters={filters} />} />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} period />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Cash Paid" value={formatMoney(data?.totals.cashPaid ?? null)} sub={data ? `${data.rows.length} entr${data.rows.length === 1 ? 'y' : 'ies'}` : undefined} />
        <KpiCard label="TDS Withheld" value={formatMoney(data?.totals.deductions.TDS ?? null)} />
        <KpiCard label="IGST-TDS Withheld" value={formatMoney(data?.totals.deductions.IGST_TDS ?? null)} sub={data ? `CGST-TDS ${formatMoney(data.totals.deductions.CGST_TDS)} · SGST-TDS ${formatMoney(data.totals.deductions.SGST_TDS)}` : undefined} />
        <KpiCard label="Payables Settled" value={formatMoney(data?.totals.settledAmount ?? null)} />
      </div>

      <UiCard title="Payments" flush className="mb-4">
        <Table<VendorPaymentRow>
          rowKey={(r) => `${r.paymentId}-${r.entryType}`}
          size="small"
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          loading={report.isLoading}
          columns={paymentColumns}
          dataSource={data?.rows ?? []}
          tableLayout="auto" scroll={{ x: true }}
          expandable={{ expandedRowRender: (r) => <Table<VendorPaymentAllocationLine> rowKey="vendorBillId" size="small" pagination={false} columns={allocationColumns} dataSource={r.allocations} tableLayout="auto" scroll={{ x: true }} /> }}
          locale={{ emptyText: 'No vendor payments posted in this period.' }}
        />
      </UiCard>

      <UiCard title="By Vendor" flush className="mb-4">
        <Table<VendorPaymentReport['byVendor'][number]> rowKey="vendorName" size="small" pagination={false} loading={report.isLoading} columns={vendorColumns} dataSource={data?.byVendor ?? []} tableLayout="auto" scroll={{ x: true }} />
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
