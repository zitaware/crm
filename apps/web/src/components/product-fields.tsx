'use client';

import { useState } from 'react';
import { App, Form, Input, InputNumber, Modal, Switch } from 'antd';
import { trpc } from '@/server/trpc';
import { MasterSelect } from '@/components/master-select';
import type { QuickAddBoxProps } from '@/components/quick-add-select';

export interface ProductFormValues {
  name: string;
  description?: string;
  unitOfMeasureId: string;
  productCategoryId?: string;
  hsnSac?: string;
  defaultRateAmount?: number;
  isStockTracked: boolean;
}

export const EMPTY_PRODUCT: ProductFormValues = { name: '', unitOfMeasureId: '', isStockTracked: true };

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random()}`;
}

/** Matches master-product.html's own field set: product, unit, HSN/SAC,
 * category, default rate and the stock-tracked flag (docs/04 §8 —
 * "Add is_stock_tracked; no fixed-asset classification/depreciation
 * workflow"). Deliberately no fixed-asset or depreciation fields, ever.
 *
 * Only ACTIVE masters are offered in the pickers — a deactivated unit or
 * category stays visible on existing rows but can never be selected on a
 * new or edited item, the project-wide deactivated-master rule.
 *
 * The Products page and the F2 box both render these, inside a
 * `Form<ProductFormValues>`, so they always match. `compact` lays them out
 * in two columns for a box; `stockTrackedLocked` keeps the item stock
 * tracked when only stock items can be picked. */
export function ProductFields({ compact, stockTrackedLocked, autoFocus }: { compact?: boolean; stockTrackedLocked?: boolean; autoFocus?: boolean }) {
  return (
    <div className={compact ? 'grid grid-cols-1 gap-x-3 sm:grid-cols-2' : 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4'}>
      <Form.Item
        label="Product / item"
        name="name"
        className={compact ? 'sm:col-span-2' : 'lg:col-span-2'}
        rules={[{ required: true, message: 'Product name is required.' }, { max: 200 }]}
      >
        <Input {...(autoFocus ? { autoFocus: true } : {})} placeholder="e.g. HP LaserJet Toner 26A" />
      </Form.Item>
      <Form.Item label="Unit" name="unitOfMeasureId" rules={[{ required: true, message: 'Unit is required.' }]}>
        <MasterSelect type="units_of_measure" placeholder="Select unit" />
      </Form.Item>
      <Form.Item label="Category" name="productCategoryId">
        <MasterSelect type="product_categories" allowClear placeholder="Select category" />
      </Form.Item>
      <Form.Item label="HSN / SAC" name="hsnSac" rules={[{ max: 20 }]}>
        <Input placeholder="84439959" />
      </Form.Item>
      <Form.Item
        label="Default rate"
        name="defaultRateAmount"
        tooltip="A data-entry convenience only. Stock is always valued at its weighted-average cost from posted movements, never this rate."
      >
        <InputNumber className="w-full" min={0} precision={2} placeholder="0.00" />
      </Form.Item>
      <Form.Item
        label="Stock tracked"
        name="isStockTracked"
        valuePropName="checked"
        tooltip="Stock-tracked items move through Inventory. Non-stock goods and services are recorded as Expense instead."
        {...(stockTrackedLocked ? { extra: 'Only stock items can be picked here.' } : {})}
      >
        <Switch disabled={!!stockTrackedLocked} />
      </Form.Item>
      <Form.Item label="Description" name="description" className={compact ? 'sm:col-span-2' : 'lg:col-span-4'} rules={[{ max: 1000 }]}>
        <Input.TextArea rows={2} placeholder="Optional notes about this item" />
      </Form.Item>
    </div>
  );
}

/** What `inventoryItems.create` is sent, from the page and the F2 box alike. */
export function productCreateInput(values: ProductFormValues, idempotencyKey: string) {
  return {
    name: values.name,
    description: values.description,
    unitOfMeasureId: values.unitOfMeasureId,
    productCategoryId: values.productCategoryId,
    hsnSac: values.hsnSac,
    defaultRateAmount: values.defaultRateAmount === undefined || values.defaultRateAmount === null ? undefined : values.defaultRateAmount.toFixed(2),
    isStockTracked: values.isStockTracked,
    idempotencyKey,
  };
}

const ADD_FORM_ID = 'product-quick-add';

/** Mounted afresh each time the box opens (the box is destroyed when hidden), so each opening is one new item. */
function ProductAddForm({
  initialText,
  stockTrackedOnly,
  onSubmit,
}: {
  initialText: string;
  stockTrackedOnly: boolean;
  onSubmit: (input: ReturnType<typeof productCreateInput>) => void;
}) {
  const [form] = Form.useForm<ProductFormValues>();
  const [idempotencyKey] = useState(newIdempotencyKey);
  return (
    <Form<ProductFormValues>
      form={form}
      name={ADD_FORM_ID}
      layout="vertical"
      requiredMark
      initialValues={{ ...EMPTY_PRODUCT, name: initialText }}
      onFinish={(values) => onSubmit(productCreateInput({ ...values, isStockTracked: stockTrackedOnly ? true : !!values.isStockTracked }, idempotencyKey))}
    >
      <ProductFields compact stockTrackedLocked={stockTrackedOnly} autoFocus />
    </Form>
  );
}

/** The F2 box of the product picker: the full Add Product form, with what was typed as the name. */
export function ProductAddBox({ open, initialText, onClose, onCreated, stockTrackedOnly = false }: QuickAddBoxProps & { stockTrackedOnly?: boolean }) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const create = trpc.inventoryItems.create.useMutation({
    onSuccess: async (created) => {
      message.success(`${created.code} added.`);
      onCreated({ value: created.id, label: productLabel(created) });
      await utils.inventoryItems.list.invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  return (
    <Modal
      open={open}
      width={640}
      title="Add product"
      okText="Add product"
      okButtonProps={{ htmlType: 'submit', form: ADD_FORM_ID }}
      confirmLoading={create.isPending}
      onCancel={onClose}
      destroyOnHidden
    >
      <ProductAddForm initialText={initialText} stockTrackedOnly={stockTrackedOnly} onSubmit={(input) => create.mutate(input)} />
    </Modal>
  );
}

/** "CODE — Name", as every item picker shows it. */
export function productLabel(item: { code: string; name: string }): string {
  return `${item.code} — ${item.name}`;
}
