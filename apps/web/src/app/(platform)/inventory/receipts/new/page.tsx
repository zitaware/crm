'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Form, Input, InputNumber, Select } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import { PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { VendorSelect } from '@/components/vendor-select';
import { LegalEntitySelect } from '@/components/legal-entity-select';
import { ProductSelect } from '@/components/product-select';
import { formatMoney } from '@/lib/format';
import { newIdempotencyKey } from '../../shared';
import { isoDate } from '@/lib/dates';

interface LineValue {
  inventoryItemId?: string;
  quantity?: number;
  unitCostAmount?: number;
}

interface FormValues {
  receiptType: 'OPENING' | 'DIRECT';
  legalEntityId: string;
  partyId?: string;
  receivedDate: string;
  invoiceChallanNumber?: string;
  note?: string;
  lines: LineValue[];
}

export default function NewStockReceiptPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [idempotencyKey] = useState(newIdempotencyKey());


  const receiptType = (Form.useWatch('receiptType', form) ?? 'DIRECT') as 'OPENING' | 'DIRECT';
  const lines = (Form.useWatch('lines', form) ?? []) as LineValue[];

  // The only client-side arithmetic here is a data-entry preview of what the
  // user just typed — the posted figures are always recomputed server-side
  // from the submitted lines, never taken from this.
  const previewTotal = lines.reduce((sum, l) => sum + (l?.quantity ?? 0) * (l?.unitCostAmount ?? 0), 0);

  const recordMutation = trpc.inventory.recordReceipt.useMutation({
    onSuccess: (receipt) => {
      message.success(`${receipt.receiptNumber} posted.`);
      router.push('/inventory');
    },
    onError: (error) => message.error(error.message),
  });

  const handleFinish = (values: FormValues) => {
    recordMutation.mutate({
      legalEntityId: values.legalEntityId,
      receiptType: values.receiptType,
      // An opening receipt is credited to opening balance equity and has no
      // counterparty — the server rejects a vendor on one, so never send it.
      partyId: values.receiptType === 'OPENING' ? undefined : values.partyId,
      receivedDate: values.receivedDate,
      invoiceChallanNumber: values.invoiceChallanNumber?.trim() || undefined,
      note: values.note?.trim() || undefined,
      lines: (values.lines ?? [])
        .filter((l) => l?.inventoryItemId && l?.quantity && l?.unitCostAmount !== undefined)
        .map((l) => ({
          inventoryItemId: l.inventoryItemId!,
          quantity: String(l.quantity),
          unitCostAmount: l.unitCostAmount!.toFixed(4),
        })),
      idempotencyKey,
    });
  };

  return (
    <>
      <PageHeader
        title="Add Stock"
        description="For stock received without a vendor bill, and for opening stock at cutover. Stock bought on a vendor bill is received by approving that bill."
        actions={
          <Button size="small" onClick={() => router.push('/inventory')}>
            Back to Inventory
          </Button>
        }
      />

      <UiCard>
        <Form<FormValues>
          form={form}
          layout="vertical"
          initialValues={{ receiptType: 'DIRECT', lines: [{}] }}
          onFinish={handleFinish}
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Form.Item
              label="Receipt type"
              name="receiptType"
              rules={[{ required: true }]}
              tooltip="Opening Stock is cutover stock credited to opening balance equity. Direct Receipt credits the vendor's payable."
>
              <Select
                options={[
                  { value: 'DIRECT', label: 'Direct Receipt' },
                  { value: 'OPENING', label: 'Opening Stock' },
                ]}
                onChange={() => form.setFieldValue('partyId', undefined)}
              />
            </Form.Item>
            <Form.Item label="Legal entity" name="legalEntityId" rules={[{ required: true, message: 'Legal entity is required.' }]}>
              <LegalEntitySelect />
            </Form.Item>
            <Form.Item label="Received date" name="receivedDate" rules={[{ required: true, message: 'Received date is required.' }]} getValueProps={() => ({})}>
              <DatePicker className="w-full" onChange={(picked) => form.setFieldValue('receivedDate', isoDate(picked))} />
            </Form.Item>

            {receiptType === 'DIRECT' ? (
              <Form.Item label="Vendor" name="partyId" rules={[{ required: true, message: 'Vendor is required for a direct receipt.' }]}>
                <VendorSelect />
              </Form.Item>
            ) : null}
            <Form.Item label="Invoice / challan no." name="invoiceChallanNumber">
              <Input placeholder="e.g. CH-2291" />
            </Form.Item>
            <Form.Item label="Note" name="note" className="md:col-span-3">
              <Input.TextArea rows={2} placeholder="Optional" />
            </Form.Item>
          </div>

          <div className="mb-2 text-[13px] font-semibold text-ink">Items</div>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <div className="flex flex-col gap-3">
                {fields.map(({ key, ...field }) => (
                  <div key={key} className="rounded-ui border border-ui p-3">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                      <Form.Item
                        {...field}
                        label="Item"
                        name={[field.name, 'inventoryItemId']}
                        className="md:col-span-2"
                        rules={[{ required: true, message: 'Item is required.' }]}
>
                        <ProductSelect stockTrackedOnly />
                      </Form.Item>
                      <Form.Item {...field} label="Quantity" name={[field.name, 'quantity']} rules={[{ required: true, message: 'Quantity is required.' }]}>
                        <InputNumber className="w-full" min={0.0001} precision={4} placeholder="0" />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        label="Unit cost"
                        name={[field.name, 'unitCostAmount']}
                        rules={[{ required: true, message: 'Unit cost is required.' }]}
                        tooltip="Landed cost per unit. Zero is allowed for free replacement stock."
>
                        <InputNumber className="w-full" min={0} precision={4} placeholder="0.00" />
                      </Form.Item>
                    </div>
                    {fields.length > 1 ? (
                      <div className="flex justify-end">
                        <Button size="small" danger onClick={() => remove(field.name)}>
                          Remove line
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
                <div>
                  <Button onClick={() => add({})}>Add line</Button>
                </div>
              </div>
            )}
          </Form.List>

          <div className="mt-4 flex items-center justify-between border-t border-ui pt-3">
            <div className="text-[13px] text-muted">
              Estimated value: <span className="font-semibold text-ink">{formatMoney(previewTotal.toFixed(2))}</span>
              <span className="ml-2 text-[12px]">(confirmed on the server when posted)</span>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => router.push('/inventory')}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={recordMutation.isPending}>
                Post Receipt
              </Button>
            </div>
          </div>
        </Form>
      </UiCard>
    </>
  );
}
