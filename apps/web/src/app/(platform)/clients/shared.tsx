'use client';

import { Form } from 'antd';
import { FormSaveButtons, useApplyFormDraft, useFormDraft } from '@/components/form-draft';
import { ClientFields, type ClientCoreFormValues } from '@/components/client-select';

export type { ClientCoreFormValues } from '@/components/client-select';

export { formatDate, formatMoney, isCreditBalance, absMoney } from '@/lib/format';

export function ClientFormBody({
  mode,
  formKey,
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  mode: 'create' | 'edit';
  formKey: string;
  initial: ClientCoreFormValues;
  onSubmit: (values: ClientCoreFormValues) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const formDraft = useFormDraft(formKey);
  return (
    <ClientFormFields
      mode={mode}
      formDraft={formDraft}
      initial={initial}
      onSubmit={onSubmit}
      onCancel={onCancel}
      submitting={submitting}
    />
  );
}

function ClientFormFields({
  mode,
  formDraft,
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  mode: 'create' | 'edit';
  formDraft: ReturnType<typeof useFormDraft>;
  initial: ClientCoreFormValues;
  onSubmit: (values: ClientCoreFormValues) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [form] = Form.useForm<ClientCoreFormValues>();
  useApplyFormDraft(form, formDraft.payload);
  return (
    <Form<ClientCoreFormValues> form={form} layout="vertical" requiredMark initialValues={initial} onFinish={onSubmit}>
      <ClientFields />

      <Form.Item className="mt-2 mb-0">
        <FormSaveButtons
          onCancel={onCancel}
          submitting={submitting || formDraft.saving}
          saveLabel={mode === 'create' ? 'Save' : 'Save changes'}
          drafted={formDraft.payload != null}
          onDraft={() => formDraft.save(form.getFieldsValue(true) as unknown as Record<string, unknown>)}
        />
      </Form.Item>
    </Form>
  );
}
