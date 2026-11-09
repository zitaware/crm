'use client';

import { useState } from 'react';
import { App, Form, Input, Modal, Select } from 'antd';
import { trpc } from '@/server/trpc';
import { GeographySelect } from '@/components/master-select';

interface QuickVendor {
  name: string;
  gstin?: string;
  panNumber?: string;
  stateId: string;
}

/**
 * The vendor picker every purchase form uses. F2 adds a vendor on the spot,
 * with what was typed as its name, and selects it; the vendor's state is
 * asked for because a bill's GST split needs it. Shown only to those who
 * may add vendors.
 */
export function VendorSelect({
  value,
  onChange,
  placeholder = 'Select vendor…',
  disabled,
  allowClear,
}: {
  value?: string | undefined;
  onChange?: (value: string | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
}) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const vendors = trpc.vendors.list.useQuery({ includeInactive: false });
  const canAdd = (trpc.auth.me.useQuery().data?.permissions ?? []).includes('vendor.manage');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [form] = Form.useForm<QuickVendor>();

  const create = trpc.vendors.create.useMutation({
    onSuccess: async (vendor) => {
      message.success(`Vendor ${vendor.name} added.`);
      await utils.vendors.list.invalidate();
      onChange?.(vendor.id);
      setAdding(null);
    },
    onError: (error) => message.error(error.message),
  });

  const openAdd = () => {
    if (!canAdd || disabled) return;
    form.resetFields();
    form.setFieldsValue({ name: search.trim() });
    setAdding(search.trim());
  };
  const onF2 = (event: { key: string; preventDefault: () => void; stopPropagation: () => void }) => {
    // F2 inside the open box belongs to its own pickers (state).
    if (event.key !== 'F2' || adding !== null) return;
    event.preventDefault();
    event.stopPropagation();
    openAdd();
  };

  return (
    <div className="w-full" onKeyDownCapture={onF2}>
      <Select
        className="w-full"
        showSearch
        optionFilterProp="label"
        placeholder={placeholder}
        loading={vendors.isLoading}
        value={value ?? null}
        onChange={(next: string | null | undefined) => onChange?.(next ?? undefined)}
        onSearch={setSearch}
        {...(disabled ? { disabled: true } : {})}
        {...(allowClear ? { allowClear: true } : {})}
        options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
        dropdownRender={(menu) => (
          <>
            {menu}
            {canAdd ? (
              <button type="button" className="w-full border-t border-ui px-3 py-1.5 text-left text-[11px] text-muted hover:text-brand" onMouseDown={(e) => e.preventDefault()} onClick={openAdd}>
                Press F2 (or click here) to add a new vendor{search.trim() ? ` “${search.trim()}”` : ''}
              </button>
            ) : null}
          </>
        )}
      />
      <Modal
        open={adding !== null}
        title="Add vendor"
        okText="Add vendor"
        confirmLoading={create.isPending}
        onCancel={() => setAdding(null)}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        <Form<QuickVendor>
          form={form}
          layout="vertical"
          requiredMark
          onFinish={(v) =>
            create.mutate({
              existingPartyId: undefined,
              name: v.name.trim(),
              shortCode: undefined,
              gstin: v.gstin?.trim().toUpperCase() || undefined,
              panNumber: v.panNumber?.trim().toUpperCase() || undefined,
              paymentTerms: undefined,
              stateId: v.stateId,
              cityId: undefined,
              pinCode: undefined,
              officeAddress: undefined,
              internalNote: undefined,
            })
          }
        >
          <Form.Item label="Vendor name" name="name" rules={[{ required: true, whitespace: true, message: 'Vendor name is required.' }, { max: 200 }]}>
            <Input autoFocus placeholder="e.g. Dell India" />
          </Form.Item>
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Form.Item label="GSTIN" name="gstin" rules={[{ max: 20 }]}>
              <Input placeholder="24ABCDE1234F1Z5" style={{ textTransform: 'uppercase' }} />
            </Form.Item>
            <Form.Item label="PAN" name="panNumber" rules={[{ max: 15 }]}>
              <Input placeholder="ABCDE1234F" style={{ textTransform: 'uppercase' }} />
            </Form.Item>
          </div>
          <Form.Item label="State" name="stateId" rules={[{ required: true, message: 'State is required for the GST split.' }]} extra="Needed to split GST into CGST+SGST or IGST.">
            <GeographySelect kind="state" placeholder="Select state" />
          </Form.Item>
          <p className="m-0 text-[12px] text-muted">More details (address, payment terms) can be added later in Vendors.</p>
        </Form>
      </Modal>
    </div>
  );
}
