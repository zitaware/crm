'use client';

import { Form } from 'antd';
import { FormSaveButtons, useApplyFormDraft, useFormDraft } from '@/components/form-draft';
import { ProjectFields, type ProjectCoreFormValues } from '@/components/project-select';
import type { StatusTagTone } from '@zitaware/ui';
import { StatusTag } from '@zitaware/ui';

export { formatDate, formatMoney, isCreditBalance, absMoney } from '@/lib/format';

export const STAGE_META: Record<string, { label: string; tone: StatusTagTone }> = {
  WON: { label: 'Won', tone: 'pos' },
  WORK_ORDER_RECEIVED: { label: 'Work Order Received', tone: 'info' },
  WAITING_FOR_PERMISSIONS: { label: 'Waiting for Permissions', tone: 'warn' },
  WORK_STARTED: { label: 'Work Started', tone: 'brand' },
  WORK_DONE: { label: 'Work Done', tone: 'brand' },
  SUCCESSFULLY_COMPLETED: { label: 'Successfully Completed', tone: 'pos' },
};

export const STAGE_ORDER = [
  'WON',
  'WORK_ORDER_RECEIVED',
  'WAITING_FOR_PERMISSIONS',
  'WORK_STARTED',
  'WORK_DONE',
  'SUCCESSFULLY_COMPLETED',
] as const;

export const STAGE_OPTIONS = STAGE_ORDER.map((value) => ({ value, label: STAGE_META[value]!.label }));

export const STATUS_META: Record<string, { label: string; tone: StatusTagTone }> = {
  ACTIVE: { label: 'Active', tone: 'pos' },
  ON_HOLD: { label: 'On Hold', tone: 'warn' },
  CANCELLED: { label: 'Cancelled', tone: 'neg' },
  CLOSED: { label: 'Closed', tone: 'mut' },
};

export const STATUS_OPTIONS = Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label }));

export function StageBadge({ stage }: { stage: string }) {
  const meta = STAGE_META[stage];
  return <StatusTag status={stage} label={meta?.label ?? stage} tone={meta?.tone ?? 'mut'} />;
}

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status];
  return <StatusTag status={status} label={meta?.label ?? status} tone={meta?.tone ?? 'mut'} />;
}

export type { ProjectCoreFormValues } from '@/components/project-select';

export function ProjectFormBody({
  mode,
  formKey,
  initial,
  onSubmit,
  onCancel,
  submitting,
  originLocked = false,
}: {
  mode: 'create' | 'edit';
  formKey: string;
  initial: ProjectCoreFormValues;
  onSubmit: (values: ProjectCoreFormValues) => void;
  onCancel: () => void;
  submitting: boolean;
  /** Client and originating lead are already known, as when a lead is won. */
  originLocked?: boolean;
}) {
  const [form] = Form.useForm<ProjectCoreFormValues>();
  const formDraft = useFormDraft(formKey);
  useApplyFormDraft(form, formDraft.payload);

  return (
    <Form<ProjectCoreFormValues> form={form} layout="vertical" requiredMark initialValues={initial} onFinish={onSubmit}>
      <ProjectFields mode={mode} initial={initial} originLocked={originLocked} />

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
