'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, App, Button, Form, Input, InputNumber, Select, Table } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, MoneyText, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { IntroducerSelect } from '@/components/introducer-select';
import { LegalEntitySelect } from '@/components/legal-entity-select';
import { BankAccountSelect } from '@/components/bank-account-select';
import { formatDate, formatMoney } from '@/lib/format';
import { newIdempotencyKey, type IntroducerAccrualRow } from '../../shared';
import { isoDate } from '@/lib/dates';

interface FormValues {
  introducerId: string;
  legalEntityId: string;
  bankAccountId: string;
  paymentDate: string;
  paymentModeId?: string;
  referenceNumber?: string;
  grossAmount: number;
  tdsAmount: number;
  narrative?: string;
}

export default function NewIntroducerPaymentPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [idempotencyKey] = useState(newIdempotencyKey());
  const [allocations, setAllocations] = useState<Record<string, number>>({});

  const paymentModes = trpc.documentSupport.listPaymentModes.useQuery({ includeInactive: false });

  const introducerId = Form.useWatch('introducerId', form) as string | undefined;
  const [allocationsFor, setAllocationsFor] = useState(introducerId);
  if (allocationsFor !== introducerId) {
    setAllocationsFor(introducerId);
    setAllocations({});
  }
  const legalEntityId = Form.useWatch('legalEntityId', form) as string | undefined;
  const grossAmount = (Form.useWatch('grossAmount', form) as number | undefined) ?? 0;
  const tdsAmount = (Form.useWatch('tdsAmount', form) as number | undefined) ?? 0;

  // Only this introducer's still-outstanding accruals can be settled here.
  const accrualsQuery = trpc.introducerFees.listAccruals.useQuery(
    { introducerId: introducerId!, status: 'POSTED' },
    { enabled: Boolean(introducerId) },
  );
  const outstanding = ((accrualsQuery.data?.rows ?? []) as IntroducerAccrualRow[]).filter((a) => Number(a.outstandingAmount) > 0);

  const allocatedTotal = useMemo(
    () => Object.values(allocations).reduce((sum, v) => sum + (v || 0), 0),
    [allocations],
  );
  /**
   * The excess over what is allocated becomes an advance receivable — never a
   * negative payable (docs/04 §15). Shown here as its own figure so the
   * accountant sees, before posting, exactly how much of this payment is not
   * settling anything yet.
   */
  const advance = Math.max(0, grossAmount - allocatedTotal);
  const net = Math.max(0, grossAmount - tdsAmount);
  const overAllocated = allocatedTotal > grossAmount;

  const postMutation = trpc.introducerFees.postPayment.useMutation({
    onSuccess: (payment) => {
      message.success(`${payment.paymentNumber} posted.`);
      router.push('/introducer-fees');
    },
    onError: (error) => message.error(error.message),
  });

  const columns: ColumnsType<IntroducerAccrualRow> = [
    { title: 'Accrual', dataIndex: 'accrualNumber', key: 'accrualNumber', render: (v: string) => <span className="font-mono text-[12px]">{v}</span> },
    { title: 'Date', dataIndex: 'accrualDate', key: 'accrualDate', render: (v: string) => formatDate(v) },
    { title: 'Project', dataIndex: 'projectName', key: 'projectName' },
    { title: 'Outstanding', dataIndex: 'outstandingAmount', key: 'outstandingAmount', align: 'right', render: (v: string) => <MoneyText tone="negative">{formatMoney(v)}</MoneyText> },
    {
      title: 'Allocate',
      key: 'allocate',
      align: 'right',
      render: (_: unknown, row) => (
        <InputNumber
          className="w-[150px]"
          min={0}
          max={Number(row.outstandingAmount)}
          precision={2}
          value={allocations[row.id] ?? null}
          onChange={(value) => setAllocations((prev) => ({ ...prev, [row.id]: Number(value ?? 0) }))}
          placeholder="0.00"
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Record Introducer Payment"
        description="Settles accrued commission with TDS where applicable. Anything paid beyond what is accrued becomes an introducer advance, not a negative payable."
        actions={
          <Button size="small" onClick={() => router.push('/introducer-fees')}>
            Back to Introducer Fees
          </Button>
        }
      />

      <UiCard className="mb-4">
        <Form<FormValues>
          form={form}
          layout="vertical"
          initialValues={{ tdsAmount: 0 }}
          onFinish={(values) =>
            postMutation.mutate({
              introducerId: values.introducerId,
              legalEntityId: values.legalEntityId,
              bankAccountId: values.bankAccountId,
              paymentDate: values.paymentDate,
              paymentModeId: values.paymentModeId,
              referenceNumber: values.referenceNumber?.trim() || undefined,
              grossAmount: String(values.grossAmount),
              tdsAmount: String(values.tdsAmount ?? 0),
              narrative: values.narrative?.trim() || undefined,
              allocations: Object.entries(allocations)
                .filter(([, amount]) => amount > 0)
                .map(([introducerAccrualId, amount]) => ({ introducerAccrualId, allocatedAmount: String(amount) })),
              idempotencyKey,
            })
          }
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Form.Item label="Introducer" name="introducerId" rules={[{ required: true, message: 'Introducer is required.' }]}>
              <IntroducerSelect placeholder="Select introducer…" />
            </Form.Item>
            <Form.Item label="Legal entity" name="legalEntityId" rules={[{ required: true, message: 'Legal entity is required.' }]}>
              <LegalEntitySelect onUserChange={() => form.setFieldValue('bankAccountId', undefined)} />
            </Form.Item>
            <Form.Item label="Bank account" name="bankAccountId" rules={[{ required: true, message: 'Bank account is required.' }]}>
              <BankAccountSelect
                legalEntityId={legalEntityId}
                disabled={!legalEntityId}
                placeholder={legalEntityId ? 'Select bank account…' : 'Select a legal entity first'}
              />
            </Form.Item>
            <Form.Item label="Payment date" name="paymentDate" rules={[{ required: true, message: 'Date is required.' }]} getValueProps={() => ({})}>
              <DatePicker className="w-full" onChange={(picked) => form.setFieldValue('paymentDate', isoDate(picked))} />
            </Form.Item>
            <Form.Item label="Payment mode" name="paymentModeId">
              <Select allowClear showSearch optionFilterProp="label" placeholder="Optional" options={(paymentModes.data ?? []).map((m) => ({ value: m.id, label: m.label }))} />
            </Form.Item>
            <Form.Item label="Reference" name="referenceNumber">
              <Input placeholder="e.g. NEFT-88213" />
            </Form.Item>
            <Form.Item label="Gross amount" name="grossAmount" rules={[{ required: true, message: 'Gross amount is required.' }]} tooltip="The full amount being settled, before TDS.">
              <InputNumber className="w-full" min={0.01} precision={2} placeholder="0.00" />
            </Form.Item>
            <Form.Item label="TDS withheld" name="tdsAmount" tooltip="Withheld from the introducer and owed to the government — it never reaches their bank.">
              <InputNumber className="w-full" min={0} precision={2} placeholder="0.00" />
            </Form.Item>
            <Form.Item label="Narrative" name="narrative">
              <Input placeholder="Optional" />
            </Form.Item>
          </div>
        </Form>
      </UiCard>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <KpiCard label="Gross" value={<MoneyText tone="neutral">{formatMoney(grossAmount.toFixed(2))}</MoneyText>} />
        <KpiCard label="Allocated" value={<MoneyText tone="positive">{formatMoney(allocatedTotal.toFixed(2))}</MoneyText>} sub="Clears the payable" />
        <KpiCard label="Advance" value={<MoneyText tone="warning">{formatMoney(advance.toFixed(2))}</MoneyText>} sub="Becomes a receivable" />
        <KpiCard label="Net to bank" value={<MoneyText tone="negative">{formatMoney(net.toFixed(2))}</MoneyText>} sub="Gross less TDS" />
      </div>

      {overAllocated ? (
        <Alert
          className="mb-4"
          type="error"
          showIcon
          message="Allocated more than you are paying"
          description="Reduce the allocations, or raise the gross amount. The server refuses a payment whose allocations exceed it."
        />
      ) : null}

      <UiCard flush>
        <div className="p-3 text-[13px] font-semibold text-ink">Outstanding accruals</div>
        <Table<IntroducerAccrualRow>
          rowKey="id"
          columns={columns}
          dataSource={outstanding}
          loading={accrualsQuery.isLoading}
          pagination={false}
          size="small"
          locale={{
            emptyText: introducerId
              ? 'This introducer has no outstanding accruals — the whole payment will become an advance.'
              : 'Select an introducer to see their outstanding accruals.',
          }}
        />
      </UiCard>

      <div className="mt-4 flex items-center justify-between border-t border-ui pt-3">
        <div className="text-[13px] text-muted">
          Posts Dr Introducer Payable and Dr Introducer Advance Receivable against Cr TDS Payable and Cr Bank.
        </div>
        <div className="flex gap-2">
          <Button onClick={() => router.push('/introducer-fees')}>Cancel</Button>
          <Button type="primary" loading={postMutation.isPending} disabled={overAllocated || grossAmount <= 0} onClick={() => form.submit()}>
            Post Payment
          </Button>
        </div>
      </div>
    </>
  );
}
