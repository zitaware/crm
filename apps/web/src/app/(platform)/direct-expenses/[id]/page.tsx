'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { App, Button, Form, Input, Modal } from 'antd';
import { PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { DocumentsTab } from '@/components/documents-tab';
import { DirectExpenseStatusTag, newIdempotencyKey, SPEND_TYPE_LABEL, type DirectExpenseRow } from '../shared';
import { DirectExpenseFormFields, type DirectExpenseFormValues } from '../form-fields';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';
import { DateInput } from '@/components/date-input';

function DraftEditor({ expense }: { expense: DirectExpenseRow }) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canEditDraft = permissions.includes('direct_expense.create');
  const canPost = permissions.includes('direct_expense.post');
  const [form] = Form.useForm<DirectExpenseFormValues>();
  const formDraft = useFormDraft(`direct-expense:${expense.id}`);
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef(false);
  useEffect(() => {
    if (appliedDraft.current || formDraft.isLoading || !formDraft.payload) return;
    appliedDraft.current = true;
    form.setFieldsValue(formDraft.payload as Partial<DirectExpenseFormValues>);
  }, [expense.id, form, formDraft.isLoading, formDraft.payload]);

  const [postOpen, setPostOpen] = useState(false);
  const [postKey, setPostKey] = useState(newIdempotencyKey());
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelKey, setCancelKey] = useState(newIdempotencyKey());

  const invalidate = () => utils.directExpenses.getDetail.invalidate({ id: expense.id });

  const updateMutation = trpc.directExpenses.updateDraft.useMutation({
    onSuccess: async () => {
      message.success('Expense saved.');
      clearDraft.mutate({ formKey: `direct-expense:${expense.id}` });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const postMutation = trpc.directExpenses.post.useMutation({
    onSuccess: async () => {
      message.success('Direct expense posted.');
      setPostOpen(false);
      setPostKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const cancelMutation = trpc.directExpenses.cancelDraft.useMutation({
    onSuccess: async () => {
      message.success('Direct expense cancelled.');
      setCancelOpen(false);
      setCancelKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const submitUpdate = (values: DirectExpenseFormValues) => {
    updateMutation.mutate({
      id: expense.id,
      expectedVersion: expense.version,
      expenseCategoryId: values.expenseCategoryId,
      vendorId: values.vendorId || undefined,
      title: values.title,
      projectId: values.projectId || undefined,
      legalEntityId: values.legalEntityId,
      taxableAmount: values.taxableAmount,
      expenseDate: values.expenseDate,
      gstInvoiceAvailable: !!values.gstInvoiceAvailable,
      gstRatePercent: values.gstInvoiceAvailable ? values.gstRatePercent : undefined,
      supplyType: values.gstInvoiceAvailable ? values.supplyType : undefined,
      itcEligible: values.gstInvoiceAvailable ? (values.itcEligible ?? true) : undefined,
      tdsAmount: values.tdsAmount ?? '0',
      tdsRatePercent: values.tdsRatePercent || undefined,
      paymentModeId: values.paymentModeId,
      bankAccountId: values.bankAccountId || undefined,
      cardAccountId: values.cardAccountId || undefined,
      transactionReference: values.transactionReference?.trim() || undefined,
      purchasedByEmployeeId: values.purchasedByEmployeeId || undefined,
      note: values.note?.trim() || undefined,
      spendType: values.spendType ?? null,
      billUrl: values.billUrl?.trim() || null,
    });
  };

  return (
    <>
      <UiCard title="Draft Direct Expense">
        <Form<DirectExpenseFormValues>
          form={form}
          layout="vertical"
          onFinish={submitUpdate}
          initialValues={{
            expenseCategoryId: expense.expenseCategoryId,
            vendorId: expense.vendorId ?? undefined,
            title: expense.title,
            projectId: expense.projectId ?? undefined,
            legalEntityId: expense.legalEntityId,
            taxableAmount: expense.taxableAmount,
            expenseDate: expense.expenseDate,
            gstInvoiceAvailable: expense.gstInvoiceAvailable,
            gstRatePercent: expense.gstRatePercent ?? undefined,
            supplyType: expense.supplyType ?? undefined,
            itcEligible: expense.itcEligible,
            tdsAmount: expense.tdsAmount,
            tdsRatePercent: expense.tdsRatePercent ?? undefined,
            paymentModeId: expense.paymentModeId,
            bankAccountId: expense.bankAccountId ?? undefined,
            cardAccountId: expense.cardAccountId ?? undefined,
            transactionReference: expense.transactionReference ?? undefined,
            purchasedByEmployeeId: expense.purchasedByEmployeeId ?? undefined,
            note: expense.note ?? undefined,
            spendType: expense.spendType ?? undefined,
            billUrl: expense.billUrl ?? undefined,
          }}
        >
          <DirectExpenseFormFields form={form} />

          <div className="flex gap-2">
            {canEditDraft ? (
              <>
                {formDraft.payload ? <DraftFormNote saveLabel="Save" /> : null}
                <Button
                  htmlType="button"
                  loading={formDraft.saving}
                  onClick={() => formDraft.save(form.getFieldsValue(true) as unknown as Record<string, unknown>)}
                >
                  Save as draft
                </Button>
                <Button type="primary" htmlType="submit" loading={updateMutation.isPending}>
                  Save
                </Button>
              </>
            ) : null}
            {canPost ? <Button onClick={() => setPostOpen(true)}>Post…</Button> : null}
            {canEditDraft ? (
              <Button danger onClick={() => setCancelOpen(true)}>
                Cancel…
              </Button>
            ) : null}
          </div>
        </Form>
      </UiCard>

      <UiCard title="Documents" className="mt-4">
        <DocumentsTab entityType="DIRECT_EXPENSE" entityId={expense.id} />
      </UiCard>

      <Modal
        title="Post Direct Expense"
        open={postOpen}
        onCancel={() => setPostOpen(false)}
        onOk={() => postMutation.mutate({ id: expense.id, expectedVersion: expense.version, idempotencyKey: postKey })}
        confirmLoading={postMutation.isPending}
        okText="Post"
      >
        <p className="text-muted">
          This posts Dr {expense.expenseCategoryName} (+ GST, if any) / Cr {expense.cardAccountLabel ?? expense.bankAccountName ?? 'the payment source'} for {formatMoney(expense.amount)}. Once
          posted, it cannot be edited — only reversed.
        </p>
      </Modal>

      <Modal
        title="Cancel Direct Expense"
        open={cancelOpen}
        onCancel={() => setCancelOpen(false)}
        onOk={() => cancelMutation.mutate({ id: expense.id, expectedVersion: expense.version, reason: cancelReason, idempotencyKey: cancelKey })}
        confirmLoading={cancelMutation.isPending}
        okButtonProps={{ disabled: !cancelReason.trim() }}
        okText="Cancel Direct Expense"
      >
        <p className="mb-2 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
      </Modal>
    </>
  );
}

function PostedView({ expense }: { expense: DirectExpenseRow }) {
  const router = useRouter();
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canReverse = permissions.includes('direct_expense.reverse');

  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseAccountingDate, setReverseAccountingDate] = useState('');
  const [reverseKey, setReverseKey] = useState(newIdempotencyKey());

  const invalidate = () => utils.directExpenses.getDetail.invalidate({ id: expense.id });

  const reverseMutation = trpc.directExpenses.reverse.useMutation({
    onSuccess: async () => {
      message.success('Direct expense reversed.');
      setReverseOpen(false);
      setReverseKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  return (
    <>
      <UiCard
        title={expense.title}
        actions={
          <div className="flex gap-2">
            {expense.status === 'POSTED' && canReverse ? (
              <Button
                size="small"
                danger
                onClick={() => {
                  setReverseAccountingDate(new Date().toISOString().slice(0, 10));
                  setReverseOpen(true);
                }}
              >
                Reverse…
              </Button>
            ) : null}
            <Button size="small" onClick={() => router.push('/direct-expenses')}>
              Back to list
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Details</p>
            <div className="text-[12px] text-muted">Category: {expense.expenseCategoryName}</div>
            {expense.spendType ? <div className="text-[12px] text-muted">Type: {SPEND_TYPE_LABEL[expense.spendType]}</div> : null}
            {expense.vendorName ? <div className="text-[12px] text-muted">Vendor: {expense.vendorName}</div> : null}
            <div className="text-[12px] text-muted">Project: {expense.projectName ?? 'Company overhead'}</div>
            <div className="text-[12px] text-muted">Expense date: {formatDate(expense.expenseDate)}</div>
            <div className="text-[12px] text-muted">Payment mode: {expense.paymentModeLabel}</div>
            <div className="text-[12px] text-muted">{expense.cardAccountLabel ? `Card: ${expense.cardAccountLabel}` : `Bank account: ${expense.bankAccountName ?? '—'}`}</div>
            {expense.transactionReference ? <div className="text-[12px] text-muted">Reference: {expense.transactionReference}</div> : null}
            {expense.purchasedByEmployeeName ? <div className="text-[12px] text-muted">Purchased by: {expense.purchasedByEmployeeName}</div> : null}
            {expense.note ? <div className="text-[12px] text-muted">Note: {expense.note}</div> : null}
            {expense.billUrl ? (
              <div className="text-[12px] text-muted">
                Bill:{' '}
                <a href={expense.billUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                  open link
                </a>
              </div>
            ) : null}
          </div>
          <div>
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Amount</p>
            <div className="text-[12px] text-muted">Taxable amount: {formatMoney(expense.taxableAmount)}</div>
            <div className="text-[12px] text-muted">GST invoice available: {expense.gstInvoiceAvailable ? 'Yes' : 'No'}</div>
            {expense.gstInvoiceAvailable ? (
              <>
                <div className="text-[12px] text-muted">
                  GST: {expense.gstRatePercent}% ({expense.supplyType === 'INTRASTATE' ? 'Intrastate' : 'Interstate'})
                </div>
                {Number(expense.cgstAmount) > 0 ? <div className="text-[12px] text-muted">CGST: {formatMoney(expense.cgstAmount)}</div> : null}
                {Number(expense.sgstAmount) > 0 ? <div className="text-[12px] text-muted">SGST: {formatMoney(expense.sgstAmount)}</div> : null}
                {Number(expense.igstAmount) > 0 ? <div className="text-[12px] text-muted">IGST: {formatMoney(expense.igstAmount)}</div> : null}
                <div className="text-[12px] text-muted">ITC eligible: {expense.itcEligible ? 'Yes' : 'No'}</div>
              </>
            ) : null}
            {Number(expense.tdsAmount) > 0 ? <div className="text-[12px] text-muted">TDS: {formatMoney(expense.tdsAmount)}</div> : null}
            <div className="mt-1 text-[13px] font-semibold text-ink">Total: {formatMoney(expense.amount)}</div>
            <div className="text-[12px] text-muted">Posted: {expense.postedAt ? formatDate(expense.postedAt) : '—'}</div>
          </div>
        </div>

        {expense.status === 'REVERSED' ? (
          <div className="mt-4 rounded-ui border border-ui bg-negative-soft p-3 text-[12.5px] text-negative">
            <b>Reversed.</b> Reason: {expense.reversalReason ?? '—'} — {expense.reversedAt ? formatDate(expense.reversedAt) : '—'}
          </div>
        ) : null}
      </UiCard>

      <UiCard title="Documents" className="mt-4">
        <DocumentsTab entityType="DIRECT_EXPENSE" entityId={expense.id} />
      </UiCard>

      <Modal
        title="Reverse Direct Expense"
        open={reverseOpen}
        onCancel={() => setReverseOpen(false)}
        onOk={() => reverseMutation.mutate({ id: expense.id, expectedVersion: expense.version, reason: reverseReason, accountingDate: reverseAccountingDate, idempotencyKey: reverseKey })}
        confirmLoading={reverseMutation.isPending}
        okButtonProps={{ disabled: !reverseReason.trim() || !reverseAccountingDate }}
        okText="Reverse"
      >
        <p className="mb-2 text-muted">This reverses the posting journal for {formatMoney(expense.amount)}.</p>
        <p className="mb-2 text-muted">Reversal accounting date</p>
        <DateInput value={reverseAccountingDate} onChange={setReverseAccountingDate} />
        <p className="mb-2 mt-3 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
      </Modal>
    </>
  );
}

function CancelledView({ expense }: { expense: DirectExpenseRow }) {
  const router = useRouter();
  return (
    <UiCard title={expense.title} actions={<Button size="small" onClick={() => router.push('/direct-expenses')}>Back to list</Button>}>
      <div className="rounded-ui border border-ui bg-ui-2 p-3 text-[12.5px] text-muted">
        <b>Cancelled.</b> Reason: {expense.cancelledReason ?? '—'} — {expense.cancelledAt ? formatDate(expense.cancelledAt) : '—'}
      </div>
    </UiCard>
  );
}

export default function DirectExpenseDetailPage() {
  const params = useParams();
  const id = String(params.id ?? '');

  const detail = trpc.directExpenses.getDetail.useQuery({ id }, { enabled: !!id });

  if (detail.isError) return <PageHeader title="Direct Expense" description="Could not load this direct expense." />;
  if (detail.isLoading || !detail.data) return <PageHeader title="Direct Expense" description="Loading…" />;

  const expense = detail.data as DirectExpenseRow;

  return (
    <>
      <PageHeader title={expense.title} description={expense.expenseCategoryName} actions={<DirectExpenseStatusTag status={expense.status} />} />
      {expense.status === 'DRAFT' ? <DraftEditor expense={expense} /> : expense.status === 'CANCELLED' ? <CancelledView expense={expense} /> : <PostedView expense={expense} />}
    </>
  );
}
