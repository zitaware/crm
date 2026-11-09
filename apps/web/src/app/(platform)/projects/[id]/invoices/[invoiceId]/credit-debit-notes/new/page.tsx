'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { App, Button, Form, Input } from 'antd';
import { PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';
import { formatMoney } from '@/lib/format';
import { LineItemsEditor, type LineItemFormValue } from '../../../../../../invoices/shared';
import { newIdempotencyKey } from '../../../../../../credit-debit-notes/shared';

interface DraftFormValues {
  reason: string;
  lines: LineItemFormValue[];
}

function NewCreditDebitNoteForm() {
  const params = useParams();
  const projectId = String(params.id ?? '');
  const invoiceId = String(params.invoiceId ?? '');
  const typeParam = useSearchParams().get('type');
  const type = typeParam === 'CREDIT' || typeParam === 'DEBIT' ? typeParam : undefined;
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<DraftFormValues>();
  const formKey = `credit-note:new:${invoiceId}:${(type ?? 'unset').toLowerCase()}`;
  const formDraft = useFormDraft(formKey);
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef(false);
  useEffect(() => {
    if (appliedDraft.current || formDraft.isLoading || !formDraft.payload) return;
    appliedDraft.current = true;
    form.setFieldsValue(formDraft.payload as Partial<DraftFormValues>);
  }, [form, formDraft.isLoading, formDraft.payload]);
  const [idempotencyKey] = useState(newIdempotencyKey());

  const invoice = trpc.invoices.getDetail.useQuery({ id: invoiceId }, { enabled: !!invoiceId });

  const createMutation = trpc.creditDebitNotes.createDraft.useMutation({
    onSuccess: (note) => {
      message.success('Note saved.');
      clearDraft.mutate({ formKey });
      router.push(`/projects/${projectId}/invoices/${invoiceId}/credit-debit-notes/${note.id}`);
    },
    onError: (error) => message.error(error.message),
  });

  if (!type) {
    return <PageHeader title="Add Credit / Debit Note" description="Missing or invalid type — issue from the invoice's own page." />;
  }
  if (invoice.isLoading) {
    return <PageHeader title="Add Credit / Debit Note" description="Loading…" />;
  }
  if (invoice.isError || !invoice.data) {
    return <PageHeader title="Add Credit / Debit Note" description="Could not load the source invoice." />;
  }
  if (invoice.data.status !== 'FINALIZED') {
    return <PageHeader title="Add Credit / Debit Note" description="A credit/debit note can only be raised against a finalized invoice." />;
  }

  const d = invoice.data;
  const title = type === 'CREDIT' ? 'Issue Credit Note' : 'Issue Debit Note';

  const submit = (values: DraftFormValues) => {
    createMutation.mutate({
      invoiceId,
      type,
      reason: values.reason,
      lines: values.lines.map((l) => ({
        description: l.description,
        hsnSac: l.hsnSac?.trim() || undefined,
        quantity: '1',
        unitPrice: l.unitPrice,
        gstRatePercent: l.gstRatePercent,
      })),
      idempotencyKey,
    });
  };

  return (
    <>
      <PageHeader
        title={title}
        description={`Against invoice ${d.invoiceNumber ?? ''} — ${d.sourceTitle} — Total ${formatMoney(d.totalAmount)}.`}
        actions={<Button onClick={() => router.push(`/projects/${projectId}/invoices/${invoiceId}`)}>Back to Invoice</Button>}
      />

      <UiCard title={type === 'CREDIT' ? 'Credit Note Details' : 'Debit Note Details'}>
        <Form<DraftFormValues> form={form} layout="vertical" onFinish={submit}>
          <Form.Item label="Reason" name="reason" rules={[{ required: true, message: 'A reason is required.' }]}>
            <Input.TextArea rows={2} placeholder="e.g. Quantity correction on line 2, agreed with client on 12 Aug 2026" />
          </Form.Item>

          <p className="mb-2 mt-1 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">
            {type === 'CREDIT' ? 'Amount to Credit' : 'Amount to Debit'}
          </p>
          <LineItemsEditor />

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {formDraft.payload ? <DraftFormNote saveLabel="Save" /> : null}
            <Button
              htmlType="button"
              loading={formDraft.saving}
              onClick={() => formDraft.save(form.getFieldsValue(true) as unknown as Record<string, unknown>)}
            >
              Save as draft
            </Button>
            <Button type="primary" htmlType="submit" loading={createMutation.isPending}>
              Save
            </Button>
          </div>
        </Form>
      </UiCard>
    </>
  );
}

export default function NewCreditDebitNotePage() {
  return (
    <Suspense fallback={null}>
      <NewCreditDebitNoteForm />
    </Suspense>
  );
}
