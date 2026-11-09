'use client';

import { Suspense, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { App, Button, Checkbox, Form, Input, Radio, Select } from 'antd';
import { PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { gstRegistrationSelectOptions, CopyPreviousOpexLines, LineItemsEditor, newIdempotencyKey, type LineItemFormValue } from '../../../../invoices/shared';
import { DraftFormNote, useApplyFormDraft, useFormDraft } from '@/components/form-draft';
import { DateInput } from '@/components/date-input';

interface DraftFormValues {
  kind: 'REGULAR' | 'PROFORMA';
  gstRegistrationId: string;
  bankAccountId?: string;
  dueDate: string;
  paymentTermsDays?: string;
  narrative?: string;
  lines: LineItemFormValue[];
}

function NewInvoiceForm() {
  const params = useParams();
  const projectId = String(params.id ?? '');
  const paymentAlertId = useSearchParams().get('paymentAlertId') ?? '';
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<DraftFormValues>();
  const formDraft = useFormDraft(paymentAlertId ? `invoice:new:${paymentAlertId}` : 'invoice:new:missing');
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const [extraAlertIds, setExtraAlertIds] = useState<string[]>([]);
  const [idempotencyKey] = useState(newIdempotencyKey());

  const defaults = trpc.invoices.getDraftDefaults.useQuery({ paymentAlertId }, { enabled: !!paymentAlertId });
  useApplyFormDraft(form, defaults.isSuccess ? formDraft.payload : null);

  const createMutation = trpc.invoices.createDraftFromAlert.useMutation({
    onSuccess: (invoice) => {
      message.success('Invoice saved.');
      clearDraft.mutate({ formKey: `invoice:new:${paymentAlertId}` });
      router.push(`/projects/${projectId}/invoices/${invoice.id}`);
    },
    onError: (error) => message.error(error.message),
  });

  if (!paymentAlertId) {
    return <PageHeader title="Add Invoice" description="Missing payment alert reference — raise an invoice from the Payment Alert tab." />;
  }
  if (defaults.isLoading) {
    return <PageHeader title="Add Invoice" description="Loading…" />;
  }
  if (defaults.isError || !defaults.data) {
    return <PageHeader title="Add Invoice" description="Could not load this alert's billing details." />;
  }

  const d = defaults.data;

  const submit = (values: DraftFormValues) => {
    if (extraAlertIds.length > 0 && values.lines.some((line) => !line.sourceEventId)) {
      message.error('Each line must belong to one of the selected CAPEX events.');
      return;
    }
    createMutation.mutate({
      paymentAlertId,
      kind: values.kind,
      gstRegistrationId: values.gstRegistrationId,
      ...(values.bankAccountId ? { bankAccountId: values.bankAccountId } : {}),
      dueDate: values.dueDate,
      paymentTermsDays: values.paymentTermsDays ? Number(values.paymentTermsDays) : undefined,
      narrative: values.narrative?.trim() || undefined,
      lines: values.lines.map((l) => ({
        description: l.description,
        hsnSac: l.hsnSac?.trim() || undefined,
        quantity: '1',
        unitPrice: l.unitPrice,
        gstRatePercent: l.gstRatePercent,
        ...(l.sourceEventId ? { sourceEventId: l.sourceEventId } : {}),
      })),
      ...(extraAlertIds.length > 0 ? { additionalPaymentAlertIds: extraAlertIds } : {}),
      idempotencyKey,
    });
  };

  return (
    <>
      <PageHeader
        title="Add Invoice"
        description={`Against ${d.milestoneType === 'CAPEX' ? 'Capex event' : 'Opex installment'} — ${d.legalEntityName} billing ${d.buyerName}.`}
        actions={<Button onClick={() => router.push(`/projects/${projectId}`)}>Back to Project</Button>}
      />

      {/^0+(\.0+)?$/.test(d.invoicedAmount) ? null : (
        <p className="mb-3 text-[12.5px] text-muted">
          Already invoiced {formatMoney(d.invoicedAmount)} of {formatMoney(d.sourceAmount)}. This invoice can bill up to the{' '}
          <b className="text-text">{formatMoney(d.suggestedTaxableAmount)}</b> left.
        </p>
      )}

      {d.servicePeriodStart && d.servicePeriodEnd ? (
        <p className="mb-3 text-[12.5px] text-muted">
          Service period: {formatDate(d.servicePeriodStart)} – {formatDate(d.servicePeriodEnd)}
        </p>
      ) : null}

      <UiCard title="Invoice Details">
        <Form<DraftFormValues>
          form={form}
          layout="vertical"
          onFinish={submit}
          initialValues={{
            kind: 'REGULAR',
            lines: [
              {
                description: d.suggestedDescription,
                unitPrice: d.suggestedTaxableAmount,
                gstRatePercent: '9',
                ...(d.sourceEventId ? { sourceEventId: d.sourceEventId } : {}),
              },
            ],
            ...(formDraft.payload ?? {}),
          }}
        >
          <Form.Item label="Invoice type" name="kind" rules={[{ required: true, message: 'Choose an invoice type.' }]}>
            <Radio.Group>
              <Radio value="REGULAR">Regular invoice</Radio>
              <Radio value="PROFORMA">Proforma invoice</Radio>
            </Radio.Group>
          </Form.Item>
          <p className="mb-3 text-[12.5px] text-muted">A regular invoice posts the receivable and GST. A proforma is the document only, until you convert it.</p>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Form.Item
              label="Billing GST registration"
              name="gstRegistrationId"
              rules={[{ required: true, message: 'GST registration is required.' }]}
>
              <Select placeholder="Select GST registration…" options={gstRegistrationSelectOptions(d.gstRegistrationOptions)} />
            </Form.Item>
            <Form.Item label="Due date" name="dueDate" rules={[{ required: true, message: 'Due date is required.' }]}>
              <DateInput />
            </Form.Item>
            {d.bankAccountOptions.length > 1 ? (
              <Form.Item
                label="Bank account"
                name="bankAccountId"
                rules={[{ required: true, message: 'Choose the bank account for this invoice.' }]}
              >
                <Select
                  placeholder="Choose the account printed on the invoice…"
                  options={d.bankAccountOptions.map((account) => ({
                    value: account.id,
                    label: [account.invoiceAccountNumber || account.maskedAccountNumber, account.accountName, account.bankName].filter(Boolean).join(' — '),
                  }))}
                />
              </Form.Item>
            ) : null}
            {d.bankAccountOptions.length === 1 ? (
              <p className="mb-3 text-[12.5px] text-muted">
                Bank account on the invoice: {[d.bankAccountOptions[0]?.invoiceAccountNumber || d.bankAccountOptions[0]?.maskedAccountNumber, d.bankAccountOptions[0]?.accountName, d.bankAccountOptions[0]?.bankName].filter(Boolean).join(' — ')}
              </p>
            ) : null}
            <Form.Item label="Payment terms (days)" name="paymentTermsDays">
              <Input placeholder="e.g. 30" />
            </Form.Item>
          </div>

          {d.capexChoices.length > 0 ? (
            <div className="mb-3 mt-2">
              <p className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Other CAPEX events</p>
              <p className="mb-2 text-[12.5px] text-muted">Add other open CAPEX events from this project onto this invoice. An OPEX installment stays on its own invoice.</p>
              <Checkbox.Group
                className="flex flex-col gap-2"
                value={extraAlertIds}
                onChange={(ids) => {
                  const next = ids.map(String);
                  setExtraAlertIds(next);
                  const current = (form.getFieldValue('lines') ?? []) as LineItemFormValue[];
                  const byEvent = new Map(current.filter((line) => line.sourceEventId).map((line) => [line.sourceEventId, line]));
                  const primary = (d.sourceEventId ? byEvent.get(d.sourceEventId) : undefined) ?? current[0] ?? {
                    description: d.suggestedDescription,
                    unitPrice: d.suggestedTaxableAmount,
                    gstRatePercent: '9',
                    ...(d.sourceEventId ? { sourceEventId: d.sourceEventId } : {}),
                  };
                  const extras = d.capexChoices.filter((choice) => next.includes(choice.paymentAlertId)).map((choice) => byEvent.get(choice.sourceEventId) ?? {
                    description: choice.description,
                    unitPrice: choice.taxableAmount,
                    gstRatePercent: '9',
                    sourceEventId: choice.sourceEventId,
                  });
                  const manual = current.filter((line) => !line.sourceEventId);
                  form.setFieldValue('lines', [primary, ...extras, ...manual]);
                }}
                options={d.capexChoices.map((choice) => ({
                  value: choice.paymentAlertId,
                  label: `${choice.description} — ${formatMoney(choice.taxableAmount)}`,
                }))}
              />
            </div>
          ) : null}

          <p className="mb-2 mt-1 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Line Items</p>
          {d.milestoneType === 'OPEX' ? (
            <CopyPreviousOpexLines
              label={d.previousOpexLabel}
              lines={d.previousOpexLines}
              onCopy={(lines) => form.setFieldValue('lines', lines)}
            />
          ) : null}
          <LineItemsEditor />

          <Form.Item label="Heading on invoice" name="narrative" className="mt-4" extra="Printed in the centre, under the buyer. Example: IT Manpower April Month Billing For 01/04/2026 to 30/04/2026.">
            <Input.TextArea rows={2} placeholder="Optional — reference numbers, submission details…" />
          </Form.Item>

          <div className="flex flex-wrap justify-end gap-2">
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

export default function NewInvoicePage() {
  return (
    <Suspense fallback={null}>
      <NewInvoiceForm />
    </Suspense>
  );
}
