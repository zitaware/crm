'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select, Tabs } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, KpiCard, MoneyText, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { MasterSelect } from '@/components/master-select';
import { formatDate, formatMoney } from '@/lib/format';
import {
  ConsumptionStatusTag,
  formatQuantity,
  ReceiptStatusTag,
  type InventoryConsumptionRow,
  type InventoryReceiptRow,
  type InventoryStockRow,
} from './shared';

const PAGE_SIZE = 25;

function StockTab() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [page, setPage] = useState(1);

  const list = trpc.inventory.listStock.useQuery({
    page,
    pageSize: PAGE_SIZE,
    search: search.trim() || undefined,
    productCategoryId: categoryFilter,
    inStockOnly: inStockOnly || undefined,
  });

  const rows = (list.data?.rows ?? []) as InventoryStockRow[];

  const columns: ColumnsType<InventoryStockRow> = [
    { title: 'Code', dataIndex: 'code', key: 'code', render: (v: string) => <span className="font-mono text-[12px] text-muted">{v}</span> },
    {
      title: 'Product',
      dataIndex: 'name',
      key: 'name',
      render: (v: string, row) => (
        <button type="button" className="text-left font-semibold text-ink hover:text-brand" onClick={() => router.push(`/inventory/${row.inventoryItemId}`)}>
          {v}
        </button>
      ),
    },
    {
      title: 'Category',
      dataIndex: 'productCategoryName',
      key: 'productCategoryName',
      render: (v: string | null) => v ?? '—',
    },
    { title: 'Unit', dataIndex: 'unitOfMeasureName', key: 'unitOfMeasureName' },
    { title: 'Total In', dataIndex: 'totalQuantityIn', key: 'totalQuantityIn', align: 'right', render: formatQuantity },
    { title: 'Total Out', dataIndex: 'totalQuantityOut', key: 'totalQuantityOut', align: 'right', render: formatQuantity },
    {
      title: 'On Hand',
      dataIndex: 'quantityOnHand',
      key: 'quantityOnHand',
      align: 'right',
      render: (v: string) => <span className="font-semibold text-ink">{formatQuantity(v)}</span>,
    },
    { title: 'Avg Rate', dataIndex: 'weightedAverageRate', key: 'weightedAverageRate', align: 'right', render: (v: string) => formatMoney(v) },
    {
      title: 'Stock Value',
      dataIndex: 'stockValueAmount',
      key: 'stockValueAmount',
      align: 'right',
      render: (v: string) => <MoneyText tone="neutral">{formatMoney(v)}</MoneyText>,
    },
  ];

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Items Tracked" value={list.data?.total ?? 0} />
        <KpiCard
          label="Total Stock Value"
          value={<MoneyText tone="neutral">{formatMoney(list.data?.totalStockValueAmount ?? '0')}</MoneyText>}
          sub="Valued at weighted average"
        />
        <KpiCard
          label="Items In Stock"
          value={rows.filter((r) => Number(r.quantityOnHand) > 0).length}
          sub="Of the items matching these filters"
        />
      </div>

      <UiCard flush>
        <FilterCard
          actions={
            <Button
              onClick={() => {
                setSearch('');
                setCategoryFilter(undefined);
                setInStockOnly(false);
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
              placeholder="Product or code…"
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
              value={inStockOnly ? 'in_stock' : 'all'}
              onChange={(v) => {
                setInStockOnly(v === 'in_stock');
                setPage(1);
              }}
              className="w-[150px]"
              options={[
                { value: 'all', label: 'All items' },
                { value: 'in_stock', label: 'In stock only' },
              ]}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<InventoryStockRow>
          rowKey="inventoryItemId"
          columns={columns}
          dataSource={rows}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load stock. Please retry.' : undefined}
          emptyTitle="No stock items"
          emptyDescription="Stock appears here once a vendor bill with a stock line is approved, or a stock receipt is recorded."
          page={page}
          pageSize={PAGE_SIZE}
          total={list.data?.total ?? 0}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>
    </>
  );
}

function ReceiptsTab() {
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<'OPENING' | 'DIRECT' | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<'POSTED' | 'REVERSED' | undefined>(undefined);

  const list = trpc.inventory.listReceipts.useQuery({
    page,
    pageSize: PAGE_SIZE,
    receiptType: typeFilter,
    status: statusFilter,
  });
  const rows = (list.data?.rows ?? []) as InventoryReceiptRow[];

  const columns: ColumnsType<InventoryReceiptRow> = [
    { title: 'Receipt', dataIndex: 'receiptNumber', key: 'receiptNumber', render: (v: string) => <span className="font-mono text-[12px]">{v}</span> },
    { title: 'Type', dataIndex: 'receiptType', key: 'receiptType', render: (v: string) => (v === 'OPENING' ? 'Opening Stock' : 'Direct Receipt') },
    { title: 'Date', dataIndex: 'receivedDate', key: 'receivedDate', render: (v: string) => formatDate(v) },
    { title: 'Vendor', dataIndex: 'partyName', key: 'partyName', render: (v: string | null) => v ?? '—' },
    { title: 'Challan / Invoice', dataIndex: 'invoiceChallanNumber', key: 'invoiceChallanNumber', render: (v: string | null) => v ?? '—' },
    {
      title: 'Value',
      dataIndex: 'totalValueAmount',
      key: 'totalValueAmount',
      align: 'right',
      render: (v: string) => <MoneyText tone="neutral">{formatMoney(v)}</MoneyText>,
    },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (v: InventoryReceiptRow['status']) => <ReceiptStatusTag status={v} /> },
  ];

  return (
    <UiCard flush>
      <FilterCard
        actions={
          <Button
            onClick={() => {
              setTypeFilter(undefined);
              setStatusFilter(undefined);
              setPage(1);
            }}
          >
            Reset
          </Button>
        }
      >
        <FilterField label="Type">
          <Select
            allowClear
            placeholder="All types"
            value={typeFilter}
            onChange={(v) => {
              setTypeFilter(v);
              setPage(1);
            }}
            className="w-[170px]"
            options={[
              { value: 'DIRECT', label: 'Direct Receipt' },
              { value: 'OPENING', label: 'Opening Stock' },
            ]}
          />
        </FilterField>
        <FilterField label="Status">
          <Select
            allowClear
            placeholder="All statuses"
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
            className="w-[150px]"
            options={[
              { value: 'POSTED', label: 'Posted' },
              { value: 'REVERSED', label: 'Reversed' },
            ]}
          />
        </FilterField>
      </FilterCard>

      <EntityTable<InventoryReceiptRow>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={list.isLoading}
        errorMessage={list.isError ? 'Could not load stock receipts. Please retry.' : undefined}
        emptyTitle="No stock receipts"
        emptyDescription="Stock received against a vendor bill does not appear here — it is recorded on the bill itself."
        page={page}
        pageSize={PAGE_SIZE}
        total={list.data?.total ?? 0}
        onPageChange={(p) => setPage(p)}
      />
    </UiCard>
  );
}

function ConsumptionsTab() {
  const [page, setPage] = useState(1);
  const [projectFilter, setProjectFilter] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<'POSTED' | 'REVERSED' | undefined>(undefined);

  const projects = trpc.projects.list.useQuery();
  const list = trpc.inventory.listConsumptions.useQuery({
    page,
    pageSize: PAGE_SIZE,
    projectId: projectFilter,
    status: statusFilter,
  });
  const rows = (list.data?.rows ?? []) as InventoryConsumptionRow[];

  const columns: ColumnsType<InventoryConsumptionRow> = [
    { title: 'Issue', dataIndex: 'consumptionNumber', key: 'consumptionNumber', render: (v: string) => <span className="font-mono text-[12px]">{v}</span> },
    { title: 'Date', dataIndex: 'consumedDate', key: 'consumedDate', render: (v: string) => formatDate(v) },
    { title: 'Project', dataIndex: 'projectName', key: 'projectName', render: (v: string) => <span className="font-semibold text-ink">{v}</span> },
    { title: 'Legal Entity', dataIndex: 'legalEntityName', key: 'legalEntityName' },
    { title: 'Note', dataIndex: 'note', key: 'note', render: (v: string | null) => v ?? '—' },
    {
      title: 'Material Cost',
      dataIndex: 'totalValueAmount',
      key: 'totalValueAmount',
      align: 'right',
      render: (v: string) => <MoneyText tone="neutral">{formatMoney(v)}</MoneyText>,
    },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (v: InventoryConsumptionRow['status']) => <ConsumptionStatusTag status={v} /> },
  ];

  return (
    <UiCard flush>
      <FilterCard
        actions={
          <Button
            onClick={() => {
              setProjectFilter(undefined);
              setStatusFilter(undefined);
              setPage(1);
            }}
          >
            Reset
          </Button>
        }
      >
        <FilterField label="Project">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="All projects"
            value={projectFilter}
            onChange={(v) => {
              setProjectFilter(v);
              setPage(1);
            }}
            className="w-[220px]"
            options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
          />
        </FilterField>
        <FilterField label="Status">
          <Select
            allowClear
            placeholder="All statuses"
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
            className="w-[150px]"
            options={[
              { value: 'POSTED', label: 'Posted' },
              { value: 'REVERSED', label: 'Reversed' },
            ]}
          />
        </FilterField>
      </FilterCard>

      <EntityTable<InventoryConsumptionRow>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={list.isLoading}
        errorMessage={list.isError ? 'Could not load stock issues. Please retry.' : undefined}
        emptyTitle="No stock issued yet"
        emptyDescription="Issuing stock to a project charges Project Material Cost at the ruling weighted average."
        page={page}
        pageSize={PAGE_SIZE}
        total={list.data?.total ?? 0}
        onPageChange={(p) => setPage(p)}
      />
    </UiCard>
  );
}

export default function InventoryPage() {
  const router = useRouter();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canReceive = permissions.includes('inventory.receive');
  const canConsume = permissions.includes('inventory.consume');

  return (
    <>
      <PageHeader
        title="Inventory"
        description="One central store. Stock is valued at weighted average from posted movements."
        actions={
          <div className="flex gap-2">
            {canConsume ? (
              <Button onClick={() => router.push('/inventory/consumptions/new')}>Issue to Project</Button>
            ) : null}
            {canReceive ? (
              <Button type="primary" onClick={() => router.push('/inventory/receipts/new')}>
                Add Stock
              </Button>
            ) : null}
          </div>
        }
      />
      <Tabs
        items={[
          { key: 'stock', label: 'Stock', children: <StockTab /> },
          { key: 'receipts', label: 'Stock Receipts', children: <ReceiptsTab /> },
          { key: 'consumptions', label: 'Project Issues', children: <ConsumptionsTab /> },
        ]}
      />
    </>
  );
}


