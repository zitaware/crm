'use client';

import { useState } from 'react';
import { App, Button, Form, Input, Modal, Select } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, MoneyText, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { IntroducerStatusTag, newIdempotencyKey, type IntroducerAccrualRow } from './shared';
import { isoDate } from '@/lib/dates';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AccrualsTab({ canCreate }: { canCreate: boolean }) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState<'POSTED' | 'REVERSED' | undefined>('POSTED');
  const [reversing, setReversing] = useState<IntroducerAccrualRow | null>(null);
  const [reverseForm] = Form.useForm<{ reason: string; accountingDate: string }>();

  const accruals = trpc.introducerFees.listAccruals.useQuery({ status: statusFilter });
  const rows = (accruals.data?.rows ?? []) as IntroducerAccrualRow[];

  const reverseMutation = trpc.introducerFees.reverseAccrual.useMutation({
    onSuccess: () => {
      message.success('Accrual reversed.');
      setReversing(null);
      reverseForm.resetFields();
      void utils.introducerFees.listAccruals.invalidate();
      void utils.introducerFees.listAgreements.invalidate();
      void utils.introducerFees.listBalances.invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const columns: ColumnsType<IntroducerAccrualRow> = [
    { title: 'Accrual', dataIndex: 'accrualNumber', key: 'accrualNumber', render: (v: string) => <span className="font-mono text-[12px]">{v}</span> },
    { title: 'Date', dataIndex: 'accrualDate', key: 'accrualDate', render: (v: string) => formatDate(v) },
    { title: 'Introducer', dataIndex: 'introducerName', key: 'introducerName' },
    { title: 'Project', dataIndex: 'projectName', key: 'projectName' },
    { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: (v: string) => <MoneyText tone="neutral">{formatMoney(v)}</MoneyText> },
    { title: 'Settled', dataIndex: 'allocatedAmount', key: 'allocatedAmount', align: 'right', render: (v: string) => formatMoney(v) },
    {
      title: 'Outstanding',
      dataIndex: 'outstandingAmount',
      key: 'outstandingAmount',
      align: 'right',
      render: (v: string) => <MoneyText tone={Number(v)> 0 ? 'negative' : 'neutral'}>{formatMoney(v)}</MoneyText>,
    },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (v: IntroducerAccrualRow['status']) => <IntroducerStatusTag status={v} /> },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_: unknown, row) =>
        canCreate && row.status === 'POSTED' ? (
          <Button size="small" danger onClick={() => setReversing(row)}>
            Reverse
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <UiCard flush>
        <FilterCard actions={<Button onClick={() => setStatusFilter('POSTED')}>Reset</Button>}>
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

        <EntityTable<IntroducerAccrualRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={accruals.isLoading}
          errorMessage={accruals.isError ? 'Could not load accruals. Please retry.' : undefined}
          emptyTitle="No accruals"
          emptyDescription="Accrue commission from the Agreements tab when it is earned."
          page={1}
          pageSize={rows.length || 1}
          total={rows.length}
          onPageChange={() => undefined}
        />
      </UiCard>

      <Modal
        open={reversing !== null}
        title={reversing ? `Reverse ${reversing.accrualNumber}` : 'Reverse accrual'}
        okText="Reverse"
        okButtonProps={{ danger: true, loading: reverseMutation.isPending }}
        onCancel={() => {
          setReversing(null);
          reverseForm.resetFields();
        }}
        onOk={() => reverseForm.submit()}
      >
        <p className="mb-3 text-[13px] text-muted">
          The posted journal is reversed. An accrual that has already been paid cannot be reversed — reverse the payment
          first, or the settlement would be left clearing a liability that no longer exists.
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
