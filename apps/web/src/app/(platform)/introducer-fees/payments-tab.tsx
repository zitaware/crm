'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Form, Input, Modal, Select } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, MoneyText, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { IntroducerStatusTag, newIdempotencyKey, type IntroducerPaymentRow } from './shared';
import { isoDate } from '@/lib/dates';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PaymentsTab({ canPay }: { canPay: boolean }) {
  const router = useRouter();
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState<'POSTED' | 'REVERSED' | undefined>(undefined);
  const [reversing, setReversing] = useState<IntroducerPaymentRow | null>(null);
  const [reverseForm] = Form.useForm<{ reason: string; accountingDate: string }>();

  const payments = trpc.introducerFees.listPayments.useQuery({ status: statusFilter });
  const rows = (payments.data?.rows ?? []) as IntroducerPaymentRow[];

  const reverseMutation = trpc.introducerFees.reversePayment.useMutation({
    onSuccess: () => {
      message.success('Payment reversed.');
      setReversing(null);
      reverseForm.resetFields();
      void utils.introducerFees.listPayments.invalidate();
      void utils.introducerFees.listAccruals.invalidate();
      void utils.introducerFees.listBalances.invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const columns: ColumnsType<IntroducerPaymentRow> = [
    { title: 'Payment', dataIndex: 'paymentNumber', key: 'paymentNumber', render: (v: string) => <span className="font-mono text-[12px]">{v}</span> },
    { title: 'Date', dataIndex: 'paymentDate', key: 'paymentDate', render: (v: string) => formatDate(v) },
    { title: 'Introducer', dataIndex: 'introducerName', key: 'introducerName' },
    { title: 'Bank', dataIndex: 'bankAccountName', key: 'bankAccountName' },
    { title: 'Gross', dataIndex: 'grossAmount', key: 'grossAmount', align: 'right', render: (v: string) => <MoneyText tone="neutral">{formatMoney(v)}</MoneyText> },
    { title: 'TDS', dataIndex: 'tdsAmount', key: 'tdsAmount', align: 'right', render: (v: string) => formatMoney(v) },
    { title: 'Net Paid', dataIndex: 'netAmount', key: 'netAmount', align: 'right', render: (v: string) => formatMoney(v) },
    {
      title: 'Advance',
      dataIndex: 'advanceAmount',
      key: 'advanceAmount',
      align: 'right',
      render: (v: string) => (Number(v) > 0 ? <MoneyText tone="warning">{formatMoney(v)}</MoneyText> : '—'),
    },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (v: IntroducerPaymentRow['status']) => <IntroducerStatusTag status={v} /> },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_: unknown, row) =>
        canPay && row.status === 'POSTED' ? (
          <Button size="small" danger onClick={() => setReversing(row)}>
            Reverse
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <UiCard flush>
        <FilterCard
          actions={canPay ? <Button type="primary" onClick={() => router.push('/introducer-fees/payments/new')}>Record Payment</Button> : undefined}
        >
          <FilterField label="Status">
            <Select
              allowClear
              placeholder="All statuses"
              value={statusFilter}
              onChange={setStatusFilter}
              className="w-[150px]"
              options={[
                { value: 'POSTED', label: 'Posted' },
                { value: 'REVERSED', label: 'Reversed' },
              ]}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<IntroducerPaymentRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={payments.isLoading}
          errorMessage={payments.isError ? 'Could not load payments. Please retry.' : undefined}
          emptyTitle="No payments yet"
          emptyDescription="Record a payment to settle accrued commission. Paying ahead of accrual is allowed — the excess becomes an advance."
          page={1}
          pageSize={rows.length || 1}
          total={rows.length}
          onPageChange={() => undefined}
        />
      </UiCard>

      <Modal
        open={reversing !== null}
        title={reversing ? `Reverse ${reversing.paymentNumber}` : 'Reverse payment'}
        okText="Reverse"
        okButtonProps={{ danger: true, loading: reverseMutation.isPending }}
        onCancel={() => {
          setReversing(null);
          reverseForm.resetFields();
        }}
        onOk={() => reverseForm.submit()}
      >
        <p className="mb-3 text-[13px] text-muted">
          The journal is reversed and every accrual this payment settled goes back to outstanding. The allocation records
          themselves are kept — they simply stop counting.
        </p>
        <Form
          form={reverseForm}
          layout="vertical"
          initialValues={{ accountingDate: today() }}
          onFinish={(values) => {
            if (!reversing) return;
            reverseMutation.mutate({
              id: reversing.id,
              expectedVersion: reversing.version,
              reason: values.reason,
              accountingDate: values.accountingDate,
              idempotencyKey: newIdempotencyKey(),
            });
          }}
        >
          <Form.Item label="Reason" name="reason" rules={[{ required: true, message: 'A reason is required.' }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label="Reversal accounting date" name="accountingDate" rules={[{ required: true }]} getValueProps={() => ({})}>
            <DatePicker className="w-full" onChange={(picked) => reverseForm.setFieldValue('accountingDate', isoDate(picked))} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
