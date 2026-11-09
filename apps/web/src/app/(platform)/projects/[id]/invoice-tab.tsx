'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '../shared';
import { InvoiceStatusTag, collectionColumns, servicePeriodLabel, RaiseInvoiceModal, invoiceListNumber, type InvoiceRow } from '../../invoices/shared';

export function InvoiceTab({ projectId }: { projectId: string }) {
  const router = useRouter();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canRaiseInvoice = permissions.includes('invoice.create');
  const [raiseOpen, setRaiseOpen] = useState(false);
  const list = trpc.invoices.list.useQuery({ page: 1, pageSize: 100, filters: { projectId } });
  const rows = (list.data?.rows ?? []) as InvoiceRow[];

  const columns: ColumnsType<InvoiceRow> = [
    {
      title: 'Invoice',
      key: 'invoiceNumber',
      render: (_v, row) => (
        <div>
          <div className="font-mono">{invoiceListNumber(row) ?? <span className="font-sans text-muted-2">Draft</span>}</div>
          <div className="text-[11.5px] text-muted">{row.invoiceDate ? formatDate(row.invoiceDate) : '—'}</div>
          {servicePeriodLabel(row) ? <div className="text-[11.5px] text-muted">{servicePeriodLabel(row)}</div> : null}
        </div>
      ),
    },
    { title: 'Against', dataIndex: 'sourceTitle', key: 'sourceTitle' },
    {
      title: 'Amount',
      key: 'amount',
      align: 'right',
      render: (_v, row) => (
        <div>
          <div className="font-medium">{formatMoney(row.totalAmount)}</div>
          <div className="text-[11.5px] text-muted">Taxable {formatMoney(row.taxableAmount)}</div>
        </div>
      ),
    },
    ...collectionColumns<InvoiceRow>((row) => row.collection),
    {
      title: 'Status',
      key: 'status',
      render: (_v, row) => (
        <div>
          <InvoiceStatusTag status={row.status} />
          {row.hasInwardCopy ? <div className="mt-0.5 text-[11.5px] font-semibold text-positive">Inward copy attached</div> : null}
        </div>
      ),
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_v, row) => (
        <Button size="small" onClick={() => router.push(`/projects/${projectId}/invoices/${row.id}`)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <UiCard
        title="Invoices — this project"
        actions={
          canRaiseInvoice ? (
            <Button type="primary" size="small" onClick={() => setRaiseOpen(true)}>
              Add Invoice
            </Button>
          ) : undefined
        }
      >
        <Table<InvoiceRow>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={rows}
          loading={list.isLoading}
          pagination={false}
          tableLayout="auto"
          scroll={{ x: true }}
          locale={{ emptyText: 'No invoices raised for this project yet.' }}
        />
      </UiCard>

      <div className="flex items-start gap-2 rounded-ui border border-ui bg-paper p-3 text-[12.5px] text-muted">
        <span>
          Invoices are always raised from a payment alert — use <b>Add Invoice</b> here or <b>Raise Invoice</b> on the
          Payment Alert tab. There is no free-standing invoice creation.
        </span>
      </div>

      <RaiseInvoiceModal open={raiseOpen} onClose={() => setRaiseOpen(false)} defaultProjectId={projectId} />
    </div>
  );
}
