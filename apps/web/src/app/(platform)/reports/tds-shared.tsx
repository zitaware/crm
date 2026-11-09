'use client';

import Link from 'next/link';
import type { ColumnsType } from 'antd/es/table';
import { StatusTag, type StatusTagTone } from '@zitaware/ui';
import type { TaxDeductionType, TdsDeductionLifecycle, TdsInwardRow } from '@zitaware/contracts';
import { formatDate } from '@/lib/format';
import { InvoiceLink, ReceiptLink, signedMoney } from './shared';

export const TDS_TYPE_LABELS: Record<TaxDeductionType, string> = { TDS: 'TDS', CGST_TDS: 'CGST-TDS', SGST_TDS: 'SGST-TDS', IGST_TDS: 'IGST-TDS' };
const LIFECYCLE: Record<TdsDeductionLifecycle, { label: string; tone: StatusTagTone }> = {
  RECORDED: { label: 'Recorded', tone: 'mut' },
  CERTIFICATE_PENDING: { label: 'Certificate Pending', tone: 'warn' },
  CERTIFICATE_RECEIVED: { label: 'Certificate Received', tone: 'info' },
  RECONCILED: { label: 'Reconciled', tone: 'pos' },
};

export function LifecycleTag({ lifecycle, partial }: { lifecycle: TdsDeductionLifecycle; partial?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <StatusTag status={lifecycle} label={LIFECYCLE[lifecycle].label} tone={LIFECYCLE[lifecycle].tone} />
      {partial ? <StatusTag status="PARTIAL" label="Partial" tone="neg" /> : null}
    </span>
  );
}

/** The deduction table both TDS reports share; every amount is the server's. */
export const tdsRowColumns: ColumnsType<TdsInwardRow> = [
  { title: 'Receipt', dataIndex: 'receiptDate', key: 'receiptDate', render: (v: string, r) => <ReceiptLink projectId={r.projectId} receiptId={r.receiptId} label={formatDate(v)} /> },
  { title: 'Type', dataIndex: 'deductionType', key: 'deductionType', render: (v: TaxDeductionType) => TDS_TYPE_LABELS[v] },
  { title: 'Client', dataIndex: 'clientName', key: 'clientName' },
  {
    title: 'Project / Invoice',
    key: 'invoice',
    render: (_v, r) => (
      <div>
        <Link href={`/projects/${r.projectId}`} className="text-ink hover:underline">{r.projectName}</Link>
        <div className="text-[12px]">
          <InvoiceLink projectId={r.projectId} invoiceId={r.invoiceId} label={r.invoiceNumber ?? '—'} />
        </div>
      </div>
    ),
  },
  { title: 'Deducted', dataIndex: 'amount', key: 'amount', align: 'right', render: signedMoney },
  { title: 'Certificates', dataIndex: 'certificateMatched', key: 'certificateMatched', align: 'right', render: signedMoney },
  { title: '26AS / Statement', dataIndex: 'statementMatched', key: 'statementMatched', align: 'right', render: signedMoney },
  {
    title: 'References',
    key: 'refs',
    render: (_v, r) => {
      const refs = [...r.certificateReferences, ...r.statementReferences];
      return refs.length ? <span className="text-[12px]">{refs.join(', ')}</span> : <span className="text-muted-2">—</span>;
    },
  },
  { title: 'Period End', dataIndex: 'periodEnd', key: 'periodEnd', render: (v: string) => formatDate(v) },
  { title: 'Status', key: 'lifecycle', render: (_v, r) => <LifecycleTag lifecycle={r.lifecycle} partial={r.partiallyMatched} /> },
];
