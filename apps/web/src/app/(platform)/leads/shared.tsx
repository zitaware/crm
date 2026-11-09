'use client';

import { Form, Input, Select } from 'antd';
import { IntroducerSelect } from '@/components/introducer-select';
import { ClientSelect } from '@/components/client-select';
import { MasterSelect } from '@/components/master-select';
import { FormSaveButtons, useApplyFormDraft, useFormDraft } from '@/components/form-draft';
import type { StatusTagTone } from '@zitaware/ui';
import { MoneyInput, StatusTag } from '@zitaware/ui';
import { EmployeeSelect } from '@/components/employee-select';
import { DateInput } from '@/components/date-input';

export { formatDate, formatMoney } from '@/lib/format';

export const STAGE_META: Record<string, { label: string; tone: StatusTagTone }> = {
  PROPOSAL_SENT: { label: 'Proposal Sent', tone: 'mut' },
  PRESENTATION_DONE: { label: 'Presentation Done', tone: 'info' },
  SOW_PREPARATION: { label: 'Preparing', tone: 'brand' },
  TENDER_LIVE: { label: 'Open', tone: 'warn' },
  TENDER_FILLED: { label: 'Submitted', tone: 'warn' },
  TENDER_WON: { label: 'Won', tone: 'pos' },
  TENDER_LOST: { label: 'Lost', tone: 'neg' },
};

export const STAGE_OPTIONS = Object.entries(STAGE_META).map(([value, meta]) => ({ value, label: meta.label }));

export const PIPELINE_STAGES = [
  'PROPOSAL_SENT',
  'PRESENTATION_DONE',
  'SOW_PREPARATION',
  'TENDER_LIVE',
  'TENDER_FILLED',
] as const;

export function StageBadge({ stage }: { stage: string }) {
  const meta = STAGE_META[stage];
  return <StatusTag status={stage} label={meta?.label ?? stage} tone={meta?.tone ?? 'mut'} />;
}

/** Clickable 7-segment stage strip (lead-add.html's "Current Stage" widget).
 * Clicking one of the 5 pipeline stages marks it active and earlier ones
 * done; clicking Won/Lost marks all 5 pipeline stages done and highlights
 * the outcome. `value`/`onChange` match AntD Form.Item's implicit contract
 * for a custom-controlled field. */
export function StagePicker({ value, onChange }: { value?: string; onChange?: (next: string) => void }) {
  const current = value ?? 'PROPOSAL_SENT';
  const isWon = current === 'TENDER_WON';
  const isLost = current === 'TENDER_LOST';
  const currentIndex = PIPELINE_STAGES.indexOf(current as (typeof PIPELINE_STAGES)[number]);

  const pillClass = (state: 'active' | 'done' | 'idle') =>
    'cursor-pointer select-none rounded-full px-3 py-1 text-[12px] font-medium transition-colors ' +
    (state === 'active' ? 'bg-ink text-white' : state === 'done' ? 'bg-brand-soft text-brand' : 'bg-ui text-muted hover:bg-ui-2');

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-ui border border-ui bg-ui-2 p-3">
      {PIPELINE_STAGES.map((stage, index) => {
        const done = !isWon && !isLost && index < currentIndex;
        const active = !isWon && !isLost && index === currentIndex;
        return (
          <div
            key={stage}
            role="button"
            tabIndex={0}
            className={pillClass(active ? 'active' : done ? 'done' : 'idle')}
            onClick={() => onChange?.(stage)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onChange?.(stage);
            }}
          >
            {index + 1} {STAGE_META[stage]!.label}
          </div>
        );
      })}
      <div
        role="button"
        tabIndex={0}
        className={pillClass(isWon ? 'active' : 'idle') + (isWon ? ' !bg-positive !text-white' : '')}
        onClick={() => onChange?.('TENDER_WON')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onChange?.('TENDER_WON');
        }}
      >
        ✓ Won
      </div>
      <div
        role="button"
        tabIndex={0}
        className={pillClass(isLost ? 'active' : 'idle') + (isLost ? ' !bg-negative !text-white' : '')}
        onClick={() => onChange?.('TENDER_LOST')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onChange?.('TENDER_LOST');
        }}
      >
        ✕ Lost
      </div>
    </div>
  );
}


export interface LeadCoreFormValues {
  clientId: string;
  leadTypeId: string;
  leadSourceId: string;
  introducerId: string | undefined;
  assignedToEmployeeId: string | undefined;
  title: string;
  description: string | undefined;
  stage: string;
  estimatedValue: string | undefined;
  leadDate: string;
  expectedCloseDate: string | undefined;
  expectedTenderDate: string | undefined;
  tenderNumber: string | undefined;
  tenderDate: string | undefined;
  submissionDeadline: string | undefined;
  reminderOffset: string | undefined;
  internalNote: string | undefined;
}

export const REMINDER_OPTIONS = [
  { value: 'NONE', label: 'No reminder' },
  { value: 'ONE_DAY', label: '1 day before' },
  { value: 'THREE_DAYS', label: '3 days before' },
  { value: 'ONE_WEEK', label: '1 week before' },
];

export function LeadFormBody({
  mode,
  formKey,
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  mode: 'create' | 'edit';
  formKey: string;
  initial: LeadCoreFormValues;
  onSubmit: (values: LeadCoreFormValues) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [form] = Form.useForm<LeadCoreFormValues>();
  const formDraft = useFormDraft(formKey);
  useApplyFormDraft(form, formDraft.payload);
  const stage = Form.useWatch('stage', form) ?? initial.stage;
  const outcome = stage === 'TENDER_WON' || stage === 'TENDER_LOST';
  const tenderStage = stage === 'TENDER_LIVE' || stage === 'TENDER_FILLED' || outcome;

  return (
    <Form<LeadCoreFormValues>
      form={form}
      layout="vertical"
      requiredMark
      initialValues={initial}
      onFinish={(values) => onSubmit({ ...values, leadDate: values.leadDate || initial.leadDate })}
    >
      <h5 className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Details</h5>
      <Form.Item label="Title" name="title" rules={[{ required: true, message: 'Title is required.' }, { max: 300 }]}>
        <Input placeholder="e.g. CRM implementation for Acme Ltd" />
      </Form.Item>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
        <Form.Item
          label="Client"
          name="clientId"
          rules={[{ required: true, message: 'Client is required.' }]}
          extra="One client can have several leads."
>
          <ClientSelect disabled={mode === 'edit'} />
        </Form.Item>
        <Form.Item label="Type" name="leadTypeId" rules={[{ required: true, message: 'Type is required.' }]}>
          <MasterSelect type="lead_types" placeholder="Select type" />
        </Form.Item>
      </div>
      <Form.Item label="Short description" name="description" rules={[{ max: 2000 }]}>
        <Input.TextArea rows={2} placeholder="What the opportunity is about…" />
      </Form.Item>

      <h5 className="mb-2 mt-4 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Current Stage</h5>
      <Form.Item
        name="stage"
        rules={[{ required: true, message: 'Stage is required.' }]}
        extra="Click a stage. Won asks you to confirm every project detail, then creates the project."
>
        <StagePicker />
      </Form.Item>

      <h5 className="mb-2 mt-4 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Value &amp; Introducer</h5>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
        <Form.Item label="Contract value (excl. GST)" name="estimatedValue" extra="Expected contract value before GST, for pipeline reporting.">
          <MoneyInput placeholder="e.g. 6200000" prefix="₹" showInWords />
        </Form.Item>
        <Form.Item label="Introducer" name="introducerId" extra="Who introduced this work. Commission accrues if it is won.">
          <IntroducerSelect allowClear placeholder="— Direct (no introducer)" />
        </Form.Item>
        <Form.Item label="Source" name="leadSourceId" rules={[{ required: true, message: 'Source is required.' }]}>
          <MasterSelect type="lead_sources" placeholder="Select source" />
        </Form.Item>
        {mode === 'edit' ? (
          <Form.Item label="Assigned To" name="assignedToEmployeeId" extra="Who owns this internally.">
            <EmployeeSelect allowClear placeholder="Unassigned" />
          </Form.Item>
        ) : null}
      </div>

      {outcome ? null : (
        <>
          <h5 className="mb-2 mt-4 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Key Dates</h5>
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
            <Form.Item label="Opened on" name="leadDate" rules={[{ required: true, message: 'Opened on is required.' }]}>
              <DateInput />
            </Form.Item>
            <Form.Item label="Expected close date" name="expectedCloseDate">
              <DateInput />
            </Form.Item>
            <Form.Item label="Reminder" name="reminderOffset">
              <Select options={REMINDER_OPTIONS} />
            </Form.Item>
          </div>
        </>
      )}

      {tenderStage ? (
        <>
          <h5 className="mb-2 mt-4 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Reference</h5>
          <div className="mb-3 rounded-ui border border-brand bg-brand-soft px-4 py-3 text-[13.5px] font-semibold text-ink">
            Enter the client&apos;s reference number and dates. Leave a field blank when there is none.
          </div>
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
            <Form.Item label="Reference number" name="tenderNumber" rules={[{ max: 100 }]}>
              <Input placeholder="Client or proposal reference" />
            </Form.Item>
            <Form.Item label="Reference date" name="tenderDate">
              <DateInput />
            </Form.Item>
            {outcome ? null : (
              <Form.Item label="Submission deadline" name="submissionDeadline" extra="The date the proposal is due.">
                <DateInput />
              </Form.Item>
            )}
          </div>
        </>
      ) : null}

      <h5 className="mb-2 mt-4 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Notes</h5>
      <Form.Item name="internalNote" rules={[{ max: 2000 }]}>
        <Input.TextArea rows={3} placeholder="Context, competitors, decision-makers, anything useful…" />
      </Form.Item>

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
