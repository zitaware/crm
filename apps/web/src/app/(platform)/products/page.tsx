'use client';

import { useEffect, useRef, useState } from 'react';
import { App, Button, Form, Input, Popconfirm, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { useRouter } from 'next/navigation';
import { trpc } from '@/server/trpc';
import { MasterSelect } from '@/components/master-select';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';
import { EMPTY_PRODUCT, ProductFields, newIdempotencyKey, productCreateInput, type ProductFormValues } from '@/components/product-fields';
import { formatMoney } from '@/lib/format';

interface ProductRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  unitOfMeasureId: string;
  unitOfMeasureName: string;
  productCategoryId: string | null;
  productCategoryName: string | null;
  hsnSac: string | null;
  defaultRateAmount: string | null;
  isStockTracked: boolean;
  isActive: boolean;
  version: number;
}

type FormValues = ProductFormValues;

const EMPTY_FORM = EMPTY_PRODUCT;
const PAGE_SIZE = 25;

export default function ProductsPage() {
  const { message } = App.useApp();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canManage = permissions.includes('inventory_item.manage');

  const utils = trpc.useUtils();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);
  const [stockFilter, setStockFilter] = useState<'all' | 'stocked' | 'non_stocked'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [page, setPage] = useState(1);

  const list = trpc.inventoryItems.list.useQuery({
    page,
    pageSize: PAGE_SIZE,
    search: search.trim() || undefined,
    productCategoryId: categoryFilter,
    isStockTracked: stockFilter === 'all' ? undefined : stockFilter === 'stocked',
    includeInactive: statusFilter !== 'ACTIVE',
  });

  const [addForm] = Form.useForm<FormValues>();
  const addDraft = useFormDraft('product:new');
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedAdd = useRef(false);
  useEffect(() => {
    if (appliedAdd.current || addDraft.isLoading || !addDraft.payload) return;
    appliedAdd.current = true;
    addForm.setFieldsValue(addDraft.payload as Partial<FormValues>);
  }, [addDraft.isLoading, addDraft.payload, addForm]);
  const [addKey, setAddKey] = useState(newIdempotencyKey());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm] = Form.useForm<FormValues>();
  const editDetail = trpc.inventoryItems.getDetail.useQuery({ id: editingId ?? '' }, { enabled: !!editingId });

  const invalidate = () => utils.inventoryItems.list.invalidate();

  const createMutation = trpc.inventoryItems.create.useMutation({
    onSuccess: async (created) => {
      message.success(`${created.code} added.`);
      addForm.resetFields();
      clearDraft.mutate({ formKey: 'product:new' });
      setAddKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const updateMutation = trpc.inventoryItems.update.useMutation({
    onSuccess: async () => {
      message.success('Item updated.');
      setEditingId(null);
      await invalidate();
      await utils.inventoryItems.getDetail.invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const setActiveMutation = trpc.inventoryItems.setActive.useMutation({
    onSuccess: async () => await invalidate(),
    onError: (error) => message.error(error.message),
  });

  const handleAdd = (values: FormValues) => {
    createMutation.mutate(productCreateInput(values, addKey));
  };

  const handleEditSubmit = (values: FormValues) => {
    if (!editDetail.data) return;
    updateMutation.mutate({
      id: editDetail.data.id,
      name: values.name,
      description: values.description,
      unitOfMeasureId: values.unitOfMeasureId,
      productCategoryId: values.productCategoryId,
      hsnSac: values.hsnSac,
      defaultRateAmount: values.defaultRateAmount === undefined ? undefined : values.defaultRateAmount.toFixed(2),
      isStockTracked: values.isStockTracked,
      expectedVersion: editDetail.data.version,
    });
  };

  const rows = (list.data?.rows ?? []) as ProductRow[];
  const visibleRows = statusFilter === 'INACTIVE' ? rows.filter((row) => !row.isActive) : rows;

  const router = useRouter();

  const columns: ColumnsType<ProductRow> = [
    { title: 'Code', dataIndex: 'code', key: 'code', render: (v: string) => <span className="font-mono text-[12px] text-muted">{v}</span> },
    {
      title: 'Product',
      dataIndex: 'name',
      key: 'name',
      render: (v: string, row) => (
        <button type="button" className="text-left font-semibold text-ink hover:text-brand" onClick={() => setEditingId(row.id)}>
          {v}
        </button>
      ),
    },
    { title: 'Unit', dataIndex: 'unitOfMeasureName', key: 'unitOfMeasureName' },
    { title: 'Category', dataIndex: 'productCategoryName', key: 'productCategoryName', render: (v: string | null) => v ?? '—' },
    { title: 'HSN / SAC', dataIndex: 'hsnSac', key: 'hsnSac', render: (v: string | null) => v ?? '—' },
    {
      title: 'Default rate',
      dataIndex: 'defaultRateAmount',
      key: 'defaultRateAmount',
      align: 'right',
      render: (v: string | null) => formatMoney(v),
    },
    {
      title: 'Stock',
      dataIndex: 'isStockTracked',
      key: 'isStockTracked',
      render: (v: boolean) => <StatusTag status={v ? 'TRACKED' : 'NON_STOCK'} label={v ? 'Tracked' : 'Non-stock'} tone={v ? 'pos' : 'mut'} />,
    },
    { title: 'Status', dataIndex: 'isActive', key: 'isActive', render: (v: boolean) => <StatusTag status={v ? 'ACTIVE' : 'INACTIVE'} /> },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_v, row) => (
        <div className="flex justify-end gap-2">
          {/* The stock side of the same item. These two screens are one
              domain seen from two angles; before ADR-097 neither linked to
              the other at all. */}
          {row.isStockTracked ? (
            <Button size="small" onClick={() => router.push(`/inventory/${row.id}`)}>
              Stock
            </Button>
          ) : null}
          <Button size="small" onClick={() => setEditingId(row.id)}>
            Edit
          </Button>
          {canManage ? (
            <Popconfirm
              title={row.isActive ? 'Deactivate this item?' : 'Reactivate this item?'}
              description={row.isActive ? 'It stays on existing records but can no longer be selected.' : undefined}
              onConfirm={() => setActiveMutation.mutate({ id: row.id, isActive: !row.isActive, expectedVersion: row.version })}
            >
              <Button size="small" danger={row.isActive}>
                {row.isActive ? 'Deactivate' : 'Reactivate'}
              </Button>
            </Popconfirm>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Products & Items"
        description="Stock-tracked items and non-stock goods and services — unit, HSN/SAC, category and default rate."
      />

      {canManage ? (
        <UiCard title="Add Product" className="mb-4">
          <Form<FormValues> form={addForm} layout="vertical" initialValues={EMPTY_FORM} onFinish={handleAdd}>
            <ProductFields />
            <div className="flex justify-end gap-2">
              <Button onClick={() => addForm.resetFields()}>Clear</Button>
              {addDraft.payload ? <DraftFormNote saveLabel="Save" /> : null}
              <Button
                htmlType="button"
                loading={addDraft.saving}
                onClick={() => addDraft.save(addForm.getFieldsValue(true) as unknown as Record<string, unknown>)}
              >
                Save as draft
              </Button>
              <Button type="primary" htmlType="submit" loading={createMutation.isPending}>
                Save
              </Button>
            </div>
          </Form>
        </UiCard>
      ) : null}

      {editingId && editDetail.data ? (
        <UiCard title={`Editing ${editDetail.data.code} — ${editDetail.data.name}`} className="mb-4">
          <Form<FormValues>
            key={editDetail.data.id}
            form={editForm}
            layout="vertical"
            initialValues={{
              name: editDetail.data.name,
              description: editDetail.data.description ?? undefined,
              unitOfMeasureId: editDetail.data.unitOfMeasureId,
              productCategoryId: editDetail.data.productCategoryId ?? undefined,
              hsnSac: editDetail.data.hsnSac ?? undefined,
              defaultRateAmount: editDetail.data.defaultRateAmount === null ? undefined : Number(editDetail.data.defaultRateAmount),
              isStockTracked: editDetail.data.isStockTracked,
            }}
            onFinish={handleEditSubmit}
          >
            <ProductFields />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setEditingId(null)}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={updateMutation.isPending} disabled={!canManage}>
                Save changes
              </Button>
            </div>
          </Form>
        </UiCard>
      ) : null}

      <UiCard flush>
        <FilterCard
          actions={
            <Button
              onClick={() => {
                setSearch('');
                setCategoryFilter(undefined);
                setStockFilter('all');
                setStatusFilter('ACTIVE');
                setPage(1);
              }}
            >
              Reset
            </Button>
          }
        >
          <FilterField label="Search">
            <Input
              allowClear
              placeholder="Product, code or HSN…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-[220px]"
            />
          </FilterField>
          <FilterField label="Category">
            <MasterSelect
              type="product_categories"
              includeInactive
              allowClear
              placeholder="All categories"
              value={categoryFilter}
              onChange={(v) => {
                setCategoryFilter(v);
                setPage(1);
              }}
              className="w-[180px]"
            />
          </FilterField>
          <FilterField label="Stock">
            <Select
              value={stockFilter}
              onChange={(v) => {
                setStockFilter(v);
                setPage(1);
              }}
              className="w-[150px]"
              options={[
                { value: 'all', label: 'All' },
                { value: 'stocked', label: 'Stock tracked' },
                { value: 'non_stocked', label: 'Non-stock' },
              ]}
            />
          </FilterField>
          <FilterField label="Status">
            <Select
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              className="w-[140px]"
              options={[
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Inactive' },
                { value: 'all', label: 'All' },
              ]}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<ProductRow>
          rowKey="id"
          columns={columns}
          dataSource={visibleRows}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load products. Please retry.' : undefined}
          emptyTitle="No products found"
          emptyDescription={canManage ? 'Use "Add Product" above to add one.' : undefined}
          page={page}
          pageSize={PAGE_SIZE}
          total={list.data?.total ?? 0}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>
    </>
  );
}
