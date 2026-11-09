'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Form } from 'antd';
import { PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { newIdempotencyKey } from '../shared';
import { DirectExpenseFormFields, type DirectExpenseFormValues } from '../form-fields';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';

export default function NewDirectExpensePage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<DirectExpenseFormValues>();
  const formDraft = useFormDraft('direct-expense:new');
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef(false);
  useEffect(() => {
    if (appliedDraft.current || formDraft.isLoading || !formDraft.payload) return;
    appliedDraft.current = true;
    form.setFieldsValue(formDraft.payload as Partial<DirectExpenseFormValues>);
  }, [form, formDraft.isLoading, formDraft.payload]);

  const [createKey] = useState(newIdempotencyKey());
  const [postKey] = useState(newIdempotencyKey());
  const createMutation = trpc.directExpenses.createDraft.useMutation();
  const postMutation = trpc.directExpenses.post.useMutation();
  const [submitting, setSubmitting] = useState(false);

  const pendingActionRef = useRef<'draft' | 'post'>('draft');

  const handleFinish = async (values: DirectExpenseFormValues) => {
    setSubmitting(true);
    try {
      const draft = await createMutation.mutateAsync({
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
        tdsAmount: values.tdsAmount || undefined,
        tdsRatePercent: values.tdsRatePercent || undefined,
        paymentModeId: values.paymentModeId,
        bankAccountId: values.bankAccountId || undefined,
        cardAccountId: values.cardAccountId || undefined,
        transactionReference: values.transactionReference?.trim() || undefined,
        purchasedByEmployeeId: values.purchasedByEmployeeId || undefined,
        note: values.note?.trim() || undefined,
        spendType: values.spendType || undefined,
        billUrl: values.billUrl?.trim() || undefined,
        idempotencyKey: createKey,
      });
      if (pendingActionRef.current === 'draft') {
        message.success('Draft saved.');
        clearDraft.mutate({ formKey: 'direct-expense:new' });
        router.push(`/direct-expenses/${draft.id}`);
        return;
      }
      const posted = await postMutation.mutateAsync({ id: draft.id, expectedVersion: draft.version, idempotencyKey: postKey });
      message.success('Direct expense posted.');
      clearDraft.mutate({ formKey: 'direct-expense:new' });
      router.push(`/direct-expenses/${posted.id}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not save this direct expense.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Add Direct Expense"
        description="Record a company-paid bill — no employee or wallet involved. Link it to a project, or leave it as company overhead."
        actions={<Button onClick={() => router.push('/direct-expenses')}>Back to Direct Expenses</Button>}
      />

      <UiCard>
        <Form<DirectExpenseFormValues>
          id="direct-expense-form"
          form={form}
          layout="vertical"
          onFinish={handleFinish}
          initialValues={{ gstInvoiceAvailable: false, itcEligible: true }}
        >
          <DirectExpenseFormFields form={form} />
        </Form>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ui-2 pt-4">
          {formDraft.payload ? <DraftFormNote saveLabel="Save" /> : null}
          <Button
            htmlType="button"
            loading={formDraft.saving || submitting}
            onClick={() => formDraft.save(form.getFieldsValue(true) as unknown as Record<string, unknown>)}
          >
            Save as draft
          </Button>
          <Button type="primary" htmlType="submit" form="direct-expense-form" loading={submitting} onClick={() => (pendingActionRef.current = 'post')}>
            Post
          </Button>
          <Button onClick={() => router.push('/direct-expenses')}>Cancel</Button>
        </div>
      </UiCard>
    </>
  );
}
