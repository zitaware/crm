'use client';

import { App, Form, Input, Modal } from 'antd';
import { trpc } from '@/server/trpc';
import { GeographySelect } from '@/components/master-select';
import type { QuickAddBoxProps } from '@/components/quick-add-select';

export interface GstRegistrationFormValues {
  stateId: string;
  gstin: string;
  tradeName?: string;
}

/** What Add GST Registration sends, from Legal Entities and from the F2 box alike. */
export function gstRegistrationCreateInput(legalEntityId: string, values: GstRegistrationFormValues) {
  return {
    legalEntityId,
    stateId: values.stateId,
    gstin: values.gstin,
    tradeName: values.tradeName,
  };
}

/** "27AAACA1234A1Z5 — Acme Mumbai", as the bill and invoice forms list them. */
export function gstRegistrationLabel(registration: { gstin: string; tradeName: string | null }) {
  return `${registration.gstin}${registration.tradeName ? ` — ${registration.tradeName}` : ''}`;
}

/**
 * The fields of the GST registration form, inside a `Form<GstRegistrationFormValues>`.
 * Legal Entities' GST section and the F2 box both render these, so they never
 * differ. The legal entity is not asked for: it is the one the form is for.
 */
export function GstRegistrationFields({ autoFocus }: { autoFocus?: boolean }) {
  return (
    <>
      <Form.Item label="State" name="stateId" rules={[{ required: true, message: 'State is required.' }]}>
        <GeographySelect kind="state" placeholder="Select state" />
      </Form.Item>
      <Form.Item
        label="GSTIN"
        name="gstin"
        rules={[
          { required: true, message: 'GSTIN is required.' },
          { len: 15, message: 'GSTIN must be exactly 15 characters.' },
        ]}
      >
        <Input {...(autoFocus ? { autoFocus: true } : {})} placeholder="e.g. 27AAACA1234A1Z5" maxLength={15} style={{ textTransform: 'uppercase' }} />
      </Form.Item>
      <Form.Item label="Trade name" name="tradeName" rules={[{ max: 200 }]}>
        <Input placeholder="Optional" />
      </Form.Item>
    </>
  );
}

/** What was typed into the picker: a GSTIN when it reads like one, else the trade name. */
function initialValuesFrom(text: string): Partial<GstRegistrationFormValues> {
  if (!text) return {};
  return /^\d{2}[A-Za-z0-9]{0,13}$/.test(text) ? { gstin: text.toUpperCase() } : { tradeName: text };
}

type GstRegistrationBoxProps = QuickAddBoxProps & { legalEntityId: string };

/**
 * Add GST Registration as a box, for GstRegistrationSelect's F2: the same
 * fields and payload as Legal Entities, for the form's legal entity, which
 * cannot be changed here.
 */
export function GstRegistrationAddBox(props: GstRegistrationBoxProps) {
  // Mounted only while open, so every opening starts from a fresh form.
  return props.open ? <GstRegistrationAddModal {...props} /> : null;
}

function GstRegistrationAddModal({ initialText, onClose, onCreated, legalEntityId }: GstRegistrationBoxProps) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const [form] = Form.useForm<GstRegistrationFormValues>();
  const legalEntities = trpc.legalEntities.list.useQuery({ includeInactive: true });
  const legalEntityName = (legalEntities.data ?? []).find((l) => l.id === legalEntityId)?.legalName;

  const create = trpc.legalEntities.createGstRegistration.useMutation({
    onSuccess: async (registration) => {
      message.success('GST registration added.');
      onCreated({ value: registration.id, label: gstRegistrationLabel(registration) });
      await utils.legalEntities.listGstRegistrations.invalidate({ legalEntityId });
    },
    onError: (error) => message.error(error.message),
  });

  return (
    <Modal open title="Add GST registration" okText="Add GST registration" confirmLoading={create.isPending} onCancel={onClose} onOk={() => form.submit()}>
      <p className="mb-3 text-[12.5px] text-muted">
        For <b className="text-text">{legalEntityName ?? 'the legal entity chosen on this form'}</b>.
      </p>
      <Form<GstRegistrationFormValues>
        form={form}
        layout="vertical"
        requiredMark
        initialValues={initialValuesFrom(initialText)}
        onFinish={(values) => create.mutate(gstRegistrationCreateInput(legalEntityId, values))}
      >
        <GstRegistrationFields autoFocus />
      </Form>
    </Modal>
  );
}
