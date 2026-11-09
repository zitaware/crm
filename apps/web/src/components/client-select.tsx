'use client';

import { useState } from 'react';
import { App, Form, Input, Modal } from 'antd';
import { trpc } from '@/server/trpc';
import { MasterSelect, GeographySelect } from '@/components/master-select';
import { QuickAddSelect, type QuickAddBoxProps } from '@/components/quick-add-select';

export interface ClientCoreFormValues {
  name: string;
  shortCode: string | undefined;
  clientTypeId: string | undefined;
  department: string | undefined;
  stateId: string | undefined;
  districtId: string | undefined;
  cityId: string | undefined;
  pinCode: string | undefined;
  officeAddress: string | undefined;
  gstin: string | undefined;
}

export const EMPTY_CLIENT: ClientCoreFormValues = {
  name: '',
  shortCode: undefined,
  clientTypeId: undefined,
  department: undefined,
  stateId: undefined,
  districtId: undefined,
  cityId: undefined,
  pinCode: undefined,
  officeAddress: undefined,
  gstin: undefined,
};

/** The clients.create payload, the same from the New Client page and the F2 box. */
export function clientCreateInput(values: ClientCoreFormValues) {
  return {
    name: values.name,
    shortCode: values.shortCode,
    clientTypeId: values.clientTypeId,
    department: values.department,
    stateId: values.stateId,
    districtId: values.districtId,
    cityId: values.cityId,
    pinCode: values.pinCode,
    officeAddress: values.officeAddress,
    gstin: values.gstin,
  };
}

/**
 * The client form's fields, used by the New / Edit Client page and the
 * picker's F2 box so the two can never differ. Must sit inside a
 * `Form<ClientCoreFormValues>`; district and city follow the chosen state.
 */
export function ClientFields({ autoFocus }: { autoFocus?: boolean }) {
  const form = Form.useFormInstance<ClientCoreFormValues>();
  const stateId = Form.useWatch('stateId', form);
  const districtId = Form.useWatch('districtId', form);

  return (
    <>
      <h5 className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Organisation</h5>
      <Form.Item label="Client / Organisation name" name="name" rules={[{ required: true, message: 'Name is required.' }, { max: 200 }]}>
        <Input {...(autoFocus ? { autoFocus: true } : {})} placeholder="e.g. Gujarat State Disaster Management Authority" />
      </Form.Item>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
        <Form.Item label="Short name / Code" name="shortCode" rules={[{ max: 50 }]} extra="Used in grids and the project header badge.">
          <Input placeholder="e.g. GSDMA" />
        </Form.Item>
        <Form.Item label="Client type" name="clientTypeId">
          <MasterSelect type="client_types" allowClear placeholder="Select client type" />
        </Form.Item>
      </div>

      <h5 className="mb-2 mt-4 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Department</h5>
      <Form.Item label="Department" name="department" rules={[{ max: 200 }]}>
        <Input placeholder="e.g. Revenue Department" />
      </Form.Item>

      <h5 className="mb-2 mt-4 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Location</h5>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
        <Form.Item label="State" name="stateId" rules={[{ required: true, message: 'State is required.' }]}>
          <GeographySelect
            kind="state"
            allowClear
            placeholder="Select state"
            onChange={(v) => form.setFieldsValue({ stateId: v, districtId: undefined, cityId: undefined })}
          />
        </Form.Item>
        <Form.Item label="District" name="districtId">
          <GeographySelect
            kind="district"
            {...(stateId ? { parentId: stateId } : {})}
            allowClear
            placeholder={stateId ? 'Select district' : 'Select a state first'}
            onChange={(v) => form.setFieldsValue({ districtId: v, cityId: undefined })}
          />
        </Form.Item>
        <Form.Item label="City" name="cityId">
          <GeographySelect kind="city" {...(districtId ? { parentId: districtId } : {})} allowClear placeholder={districtId ? 'Select city' : 'Select a district first'} />
        </Form.Item>
        <Form.Item label="PIN code" name="pinCode" rules={[{ max: 10 }]}>
          <Input placeholder="e.g. 382010" />
        </Form.Item>
      </div>
      <Form.Item label="Address" name="officeAddress" rules={[{ max: 2000 }]} extra="Printed under Bill to Party on the tax invoice. City and PIN are added when they are not already in this text.">
        <Input.TextArea rows={3} placeholder="Street, area, city, PIN" />
      </Form.Item>

      <h5 className="mb-2 mt-4 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Tax</h5>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
        <Form.Item label="GSTIN" name="gstin" rules={[{ max: 50 }]} extra="Optional — for future invoicing/TDS reporting.">
          <Input placeholder="e.g. 24ABCDE1234F1Z5" />
        </Form.Item>
      </div>
    </>
  );
}

/** The F2 box: the New Client form in a modal. A fresh form each time it opens. */
function ClientAddBox(box: QuickAddBoxProps) {
  const [round, setRound] = useState(0);
  const [wasOpen, setWasOpen] = useState(box.open);
  if (box.open !== wasOpen) {
    setWasOpen(box.open);
    if (box.open) setRound((r) => r + 1);
  }
  return <ClientAddModal key={round} {...box} />;
}

function ClientAddModal({ open, initialText, onClose, onCreated }: QuickAddBoxProps) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const [form] = Form.useForm<ClientCoreFormValues>();

  const create = trpc.clients.create.useMutation({
    onSuccess: async (client) => {
      message.success(`Client ${client.name} added.`);
      await utils.clients.list.invalidate();
      onCreated({ value: client.id, label: client.name });
    },
    onError: (error) => message.error(error.message),
  });

  return (
    <Modal open={open} width={880} title="Add client" okText="Add client" confirmLoading={create.isPending} onCancel={onClose} onOk={() => form.submit()} destroyOnHidden>
      <Form<ClientCoreFormValues>
        form={form}
        layout="vertical"
        requiredMark
        initialValues={{ ...EMPTY_CLIENT, name: initialText }}
        onFinish={(v) => create.mutate(clientCreateInput(v))}
      >
        <ClientFields autoFocus />
        <p className="m-0 text-[12px] text-muted">Contacts and notes can be added later in Clients.</p>
      </Form>
    </Modal>
  );
}

/**
 * The client picker on entry forms. F2 opens the full New Client form, with
 * what was typed as the name, and selects the new client. Adding is offered
 * only to those who may create clients.
 */
export function ClientSelect({
  value,
  onChange,
  includeInactive,
  placeholder = 'Select client',
  disabled,
  allowClear,
}: {
  value?: string | null | undefined;
  onChange?: (value: string | undefined) => void;
  /** Lists inactive clients too. */
  includeInactive?: boolean;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
}) {
  const clients = trpc.clients.list.useQuery({ includeInactive: !!includeInactive });
  const canAdd = (trpc.auth.me.useQuery().data?.permissions ?? []).includes('client.create');

  return (
    <QuickAddSelect
      value={value}
      {...(onChange ? { onChange } : {})}
      options={(clients.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
      loading={clients.isLoading}
      placeholder={placeholder}
      {...(disabled ? { disabled: true } : {})}
      {...(allowClear ? { allowClear: true } : {})}
      noun="client"
      canAdd={canAdd}
      renderAdd={(box) => <ClientAddBox {...box} />}
    />
  );
}
