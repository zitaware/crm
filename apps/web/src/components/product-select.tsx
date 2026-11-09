'use client';

import { trpc } from '@/server/trpc';
import { QuickAddSelect } from '@/components/quick-add-select';
import { ProductAddBox, productLabel } from '@/components/product-fields';

/**
 * The product (inventory item) picker on entry forms, line items included.
 * It lists "CODE — Name" of active items, only stock-tracked ones when
 * `stockTrackedOnly`. F2 opens the full Add Product form with what was typed
 * as the name, and selects the new item. Adding is offered only to those who
 * may manage items.
 */
export function ProductSelect({
  value,
  onChange,
  stockTrackedOnly,
  placeholder = 'Select item…',
  allowClear,
  disabled,
}: {
  value?: string | undefined;
  onChange?: (value: string | undefined) => void;
  /** Lists only stock-tracked items; a new one is added as stock tracked. */
  stockTrackedOnly?: boolean;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
}) {
  const items = trpc.inventoryItems.list.useQuery({ page: 1, pageSize: 100, ...(stockTrackedOnly ? { isStockTracked: true } : {}) });
  const canAdd = (trpc.auth.me.useQuery().data?.permissions ?? []).includes('inventory_item.manage');

  return (
    <QuickAddSelect
      value={value}
      {...(onChange ? { onChange } : {})}
      options={(items.data?.rows ?? []).map((i) => ({ value: i.id, label: productLabel(i) }))}
      loading={items.isLoading}
      placeholder={placeholder}
      {...(allowClear ? { allowClear: true } : {})}
      {...(disabled ? { disabled: true } : {})}
      noun="product"
      canAdd={canAdd}
      renderAdd={(box) => <ProductAddBox {...box} stockTrackedOnly={!!stockTrackedOnly} />}
    />
  );
}
