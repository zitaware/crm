'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '../shared';
import {
  DEDUCTION_TYPE_LABEL,
  ReceiptStatusTag,
  RecordPaymentModal,
  ReleaseModal,
  type ClientReceiptRow,
  type ReleaseDeductionTarget,
} from '../../payment-integration/shared';
import type { OutstandingDeduction } from '@zitaware/contracts';

export function PaymentTab({ projectId }: { projectId: string }) {
  const router = useRouter();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canRelease = permissions.includes('deduction.release');
  const canRecordPayment = permissions.includes('receipt.post');
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const list = trpc.receipts.list.useQuery({ page: 1, pageSize: 100, filters: { projectId } });
  const rows = (list.data?.rows ?? []) as ClientReceiptRow[];

  const outstanding = trpc.receipts.getOutstandingDeductions.useQuery({ projectId });
  const outstandingRows = outstanding.data ?? [];
  const [releasingDeduction, setReleasingDeduction] = useState<ReleaseDeductionTarget | null>(null);

  const outstandingColumns: ColumnsType<OutstandingDeduction> = [
    { title: 'Invoice', dataIndex: 'invoiceNumber', key: 'invoiceNumber', render: (v: string | null) => v ?? '—' },
    { title: 'Type', key: 'type', render: (_v, row) => DEDUCTION_TYPE_LABEL[row.type] ?? row.type },
    { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: (v: string) => formatMoney(v) },
    { title: 'Outstanding', dataIndex: 'outstandingAmount', key: 'outstandingAmount', align: 'right', render: (v: string) => formatMoney(v) },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_v, row) =>
        canRelease ? (
          <Button size="small" onClick={() => setReleasingDeduction(row)}>
            Release…
          </Button>
        ) : null,
    },
  ];

  const columns: ColumnsType<ClientReceiptRow> = [
    {
      title: 'Receipt',
      key: 'receipt',
      render: (_v, row) => (
        <div>
          <div>{formatDate(row.receiptDate)}</div>
          <div className="text-[11.5px] text-muted">Against {row.invoiceNumbers.join(', ') || '—'}</div>
        </div>
      ),
    },
    {
      title: 'Bank / Mode',
      key: 'bank',
      render: (_v, row) => (
        <div>
          <div>{row.bankAccountName}</div>
          <div className="text-[11.5px] text-muted">{row.paymentModeLabel}</div>
        </div>
      ),
    },
    { title: 'Amount', dataIndex: 'actualAmount', key: 'actualAmount', align: 'right', render: (v: string) => formatMoney(v) },
    { title: 'Status', key: 'status', render: (_v, row) => <ReceiptStatusTag status={row.status} /> },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_v, row) => (
        <Button size="small" onClick={() => router.push(`/projects/${projectId}/receipts/${row.id}`)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <UiCard
        title="Payments — this project"
        actions={
          canRecordPayment ? (
            <Button type="primary" size="small" onClick={() => setRecordPaymentOpen(true)}>
              Record Payment
            </Button>
          ) : undefined
        }
      >
        <Table<ClientReceiptRow>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={rows}
          loading={list.isLoading}
          pagination={false}
          tableLayout="auto"
          scroll={{ x: true }}
          locale={{ emptyText: 'No payments recorded for this project yet.' }}
        />
      </UiCard>

      <div className="flex items-start gap-2 rounded-ui border border-ui bg-paper p-3 text-[12.5px] text-muted">
        <span>
          Payments are always recorded against a specific finalized invoice — use <b>Record Payment</b> here or on the
          invoice&apos;s own detail page. There is no free-standing payment entry.
        </span>
      </div>

      <UiCard title="Outstanding Holds & Retentions — this project">
        <Table<OutstandingDeduction>
          rowKey="id"
          size="small"
          columns={outstandingColumns}
          dataSource={outstandingRows}
          loading={outstanding.isLoading}
          pagination={false}
          tableLayout="auto"
          scroll={{ x: true }}
          locale={{ emptyText: 'No outstanding holds or retentions for this project.' }}
        />
      </UiCard>

      <ReleaseModal
        deduction={releasingDeduction}
        onClose={() => setReleasingDeduction(null)}
        onSuccess={() => {
          setReleasingDeduction(null);
          void outstanding.refetch();
        }}
      />

      <RecordPaymentModal open={recordPaymentOpen} onClose={() => setRecordPaymentOpen(false)} defaultProjectId={projectId} />
    </div>
  );
}
