'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import dayjs from 'dayjs';
import { Alert, App, Button, Descriptions, Drawer, Form, Input, Select, Table } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import type { ColumnsType } from 'antd/es/table';
import { MoneyInput, StatusTag, UiCard } from '@zitaware/ui';
import type { TaxDeductionType, TdsDepositAllocationRow, TdsOutwardItem, TdsOutwardSourceKind } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { BankAccountSelect } from '@/components/bank-account-select';
import { LegalEntitySelect } from '@/components/legal-entity-select';
import { formatDate, formatMoney } from '@/lib/format';

export const TYPE_LABELS: Record<TaxDeductionType, string> = { TDS: 'TDS', CGST_TDS: 'CGST-TDS', SGST_TDS: 'SGST-TDS', IGST_TDS: 'IGST-TDS' };
export const SOURCE_LABELS: Record<TdsOutwardSourceKind, string> = {
  VENDOR_PAYMENT_DEDUCTION: 'Vendor payment',
  DIRECT_EXPENSE: 'Direct expense',
  INTRODUCER_PAYMENT: 'Introducer payment',
  SALARY_PAYMENT_LINE: 'Salary payment',
};

/** Where each kind of withholding document opens. */
export function OutwardDocumentLink({ sourceKind, documentId, label }: { sourceKind: TdsOutwardSourceKind; documentId: string; label: string }) {
  const href =
    sourceKind === 'VENDOR_PAYMENT_DEDUCTION'
      ? `/vendor-payments/${documentId}`
      : sourceKind === 'DIRECT_EXPENSE'
        ? `/direct-expenses/${documentId}`
        : sourceKind === 'INTRODUCER_PAYMENT'
          ? '/introducer-fees?tab=payments'
          : '/employee-costing?tab=salary';
  return (
    <Link href={href} className="text-brand hover:underline">
      {label}
    </Link>
  );
}

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** Record a challan: pick what it pays; the server posts exactly the total of those amounts. */
export function PostDepositDrawer({ open, onClose, onPosted }: { open: boolean; onClose: () => void; onPosted: (id: string) => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const legalEntityId = Form.useWatch<string | undefined>('legalEntityId', form);
  const deductionType = Form.useWatch<TaxDeductionType | undefined>('deductionType', form);
  const [amounts, setAmounts] = useState<Record<string, string | undefined>>({});
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  // One stable object: a fresh dayjs() each render makes the form deep-compare its initial values on every render.
  const [initialValues] = useState(() => ({ deductionType: 'TDS' as TaxDeductionType, depositDate: dayjs() }));
  const outstanding = trpc.tdsDeposits.listOutstanding.useQuery({ legalEntityId: legalEntityId ?? '', deductionType: deductionType ?? 'TDS' }, { enabled: Boolean(legalEntityId && deductionType) });
  const post = trpc.tdsDeposits.post.useMutation({
    onSuccess: (d) => {
      message.success(`Challan ${d.challanNumber} posted for ${formatMoney(d.amount)}.`);
      form.resetFields();
      setAmounts({});
      setIdempotencyKey(newKey());
      onPosted(d.id);
      onClose();
    },
    onError: (e) => message.error(e.message),
  });
  const keyOf = (i: TdsOutwardItem) => `${i.sourceKind}|${i.sourceId}`;
  const selected = useMemo(() => (outstanding.data ?? []).filter((i) => amounts[keyOf(i)] && Number(amounts[keyOf(i)]) > 0), [outstanding.data, amounts]);

  const columns: ColumnsType<TdsOutwardItem> = [
    { title: 'Withheld On', dataIndex: 'deductionDate', key: 'deductionDate', render: (v: string) => formatDate(v) },
    { title: 'Document', key: 'document', render: (_v, r) => <OutwardDocumentLink sourceKind={r.sourceKind} documentId={r.documentId} label={r.documentLabel} /> },
    { title: 'Deductee', dataIndex: 'deducteeName', key: 'deducteeName' },
    { title: 'Still Payable', dataIndex: 'remaining', key: 'remaining', align: 'right', render: (v: string) => formatMoney(v) },
    { title: 'Due', dataIndex: 'dueDate', key: 'dueDate', render: (v: string, r) => <span className={r.overdue ? 'font-semibold text-negative' : ''}>{formatDate(v)}</span> },
    {
      title: 'Deposit',
      key: 'deposit',
      width: 170,
      render: (_v, r) => (
        <MoneyInput size="small" className="w-full" min="0" max={r.remaining} placeholder={r.remaining} value={amounts[keyOf(r)] ?? null} onChange={(v) => setAmounts({ ...amounts, [keyOf(r)]: v ?? undefined })} />
      ),
    },
  ];

  return (
    <Drawer
      title="Record TDS Deposit"
      open={open}
      onClose={onClose}
      width={960}
      destroyOnHidden
      extra={
        <Button type="primary" loading={post.isPending} disabled={!selected.length} onClick={() => form.submit()}>
          Post Deposit
        </Button>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onFinish={(v: Record<string, unknown>) =>
          post.mutate({
            legalEntityId: v.legalEntityId as string,
            bankAccountId: v.bankAccountId as string,
            deductionType: v.deductionType as TaxDeductionType,
            challanNumber: v.challanNumber as string,
            depositDate: (v.depositDate as dayjs.Dayjs).format('YYYY-MM-DD'),
            remarks: (v.remarks as string | undefined) || undefined,
            allocations: selected.map((i) => ({ sourceKind: i.sourceKind, sourceId: i.sourceId, amount: amounts[keyOf(i)]! })),
            idempotencyKey,
          })
        }
      >
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
          <Form.Item name="legalEntityId" label="Legal Entity" rules={[{ required: true }]}>
            <LegalEntitySelect
              onUserChange={() => {
                form.resetFields(['bankAccountId']);
                setAmounts({});
              }}
            />
          </Form.Item>
          <Form.Item name="deductionType" label="Type" rules={[{ required: true }]}>
            <Select options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))} onChange={() => setAmounts({})} />
          </Form.Item>
          <Form.Item name="bankAccountId" label="Paid From" rules={[{ required: true }]}>
            <BankAccountSelect legalEntityId={legalEntityId} disabled={!legalEntityId} />
          </Form.Item>
          <Form.Item name="challanNumber" label="Challan / CIN / GST Reference" rules={[{ required: true, whitespace: true }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="depositDate" label="Deposit Date" rules={[{ required: true }]}>
            <DatePicker className="w-full" />
          </Form.Item>
          <Form.Item name="remarks" label="Remarks">
            <Input maxLength={1000} />
          </Form.Item>
        </div>
      </Form>
      <Alert type="info" showIcon className="mb-3" message="Enter what this challan pays against each withheld amount. The deposit posts for exactly their total: Dr TDS Payable, Cr the bank account." />
      <UiCard title={`Still to Deposit${deductionType ? ` — ${TYPE_LABELS[deductionType]}` : ''}`} flush>
        <Table<TdsOutwardItem>
          rowKey={keyOf}
          size="small"
          pagination={false}
          loading={outstanding.isFetching}
          columns={columns}
          dataSource={outstanding.data ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: legalEntityId ? 'Nothing withheld is waiting to be deposited.' : 'Choose the legal entity first.' }}
        />
      </UiCard>
    </Drawer>
  );
}

export function DepositDetailDrawer({ id, onClose, canPost, onChanged }: { id: string | null; onClose: () => void; canPost: boolean; onChanged: () => void }) {
  const { message, modal } = App.useApp();
  const utils = trpc.useUtils();
  const detail = trpc.tdsDeposits.getDetail.useQuery({ id: id ?? '' }, { enabled: Boolean(id) });
  const reverse = trpc.tdsDeposits.reverse.useMutation({
    onSuccess: () => {
      message.success('Deposit reversed.');
      void utils.tdsDeposits.getDetail.invalidate();
      onChanged();
    },
    onError: (e) => message.error(e.message),
  });
  const d = detail.data;
  const columns: ColumnsType<TdsDepositAllocationRow> = [
    { title: 'Withheld On', dataIndex: 'deductionDate', key: 'deductionDate', render: (v: string) => (v ? formatDate(v) : '—') },
    { title: 'Source', dataIndex: 'sourceKind', key: 'sourceKind', render: (v: TdsOutwardSourceKind) => SOURCE_LABELS[v] },
    { title: 'Document', key: 'document', render: (_v, r) => <OutwardDocumentLink sourceKind={r.sourceKind} documentId={r.documentId} label={r.documentLabel} /> },
    { title: 'Deductee', dataIndex: 'deducteeName', key: 'deducteeName' },
    { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: (v: string) => formatMoney(v) },
  ];

  const askReverse = () => {
    if (!d) return;
    let reason = '';
    let date = dayjs().format('YYYY-MM-DD');
    modal.confirm({
      title: `Reverse challan ${d.challanNumber}?`,
      content: (
        <div className="flex flex-col gap-2">
          <span className="text-muted">The payable is restored and the bank credited back by a reversing journal.</span>
          <DatePicker defaultValue={dayjs()} onChange={(v) => (date = v ? v.format('YYYY-MM-DD') : date)} />
          <Input.TextArea rows={3} placeholder="Reason (required)" onChange={(e) => (reason = e.target.value)} />
        </div>
      ),
      okText: 'Reverse',
      okButtonProps: { danger: true },
      onOk: () => {
        if (reason.trim().length < 3) {
          message.error('Give a reason.');
          return Promise.reject(new Error('reason required'));
        }
        reverse.mutate({ id: d.id, reason: reason.trim(), accountingDate: date, expectedVersion: d.version, idempotencyKey: newKey() });
        return undefined;
      },
    });
  };

  return (
    <Drawer title={d ? `${TYPE_LABELS[d.deductionType]} Challan ${d.challanNumber}` : 'TDS Deposit'} open={Boolean(id)} onClose={onClose} width={860} destroyOnHidden>
      {detail.isError ? <Alert type="error" showIcon message={detail.error.message} /> : null}
      {d ? (
        <>
          <div className="mb-4">
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="Legal Entity">{d.legalEntityName}</Descriptions.Item>
              <Descriptions.Item label="Paid From">{d.bankAccountName}</Descriptions.Item>
              <Descriptions.Item label="Deposit Date">{formatDate(d.depositDate)}</Descriptions.Item>
              <Descriptions.Item label="Amount">{formatMoney(d.amount)}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <StatusTag status={d.status} label={d.status === 'POSTED' ? 'Posted' : 'Reversed'} tone={d.status === 'POSTED' ? 'pos' : 'neg'} />
              </Descriptions.Item>
              <Descriptions.Item label="Journal">
                <Link href={`/journal-entries/${d.journalEntryId}`} className="text-brand hover:underline">Posting</Link>
                {d.reversalJournalEntryId ? (
                  <>
                    {' · '}
                    <Link href={`/journal-entries/${d.reversalJournalEntryId}`} className="text-brand hover:underline">Reversal</Link>
                  </>
                ) : null}
              </Descriptions.Item>
              {d.reversalReason ? <Descriptions.Item label="Reversal Reason" span={2}>{d.reversalReason}</Descriptions.Item> : null}
              {d.remarks ? <Descriptions.Item label="Remarks" span={2}>{d.remarks}</Descriptions.Item> : null}
            </Descriptions>
          </div>
          <UiCard title="What This Challan Paid" flush className="mb-4">
            <Table<TdsDepositAllocationRow> rowKey="id" size="small" pagination={false} columns={columns} dataSource={d.allocations} tableLayout="auto" scroll={{ x: true }} />
          </UiCard>
          {canPost && d.status === 'POSTED' ? (
            <Button danger loading={reverse.isPending} onClick={askReverse}>
              Reverse Deposit
            </Button>
          ) : null}
        </>
      ) : null}
    </Drawer>
  );
}
