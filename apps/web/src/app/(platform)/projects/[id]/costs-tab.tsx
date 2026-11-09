'use client';

import { useRouter } from 'next/navigation';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, MoneyText, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { NextStep } from '@/components/next-step';
import { formatDate, formatMoney } from '../shared';
import { ConsumptionStatusTag, formatQuantity, type InventoryConsumptionRow } from '../../inventory/shared';
import { IntroducerSection } from './introducer-tab';

/**
 * Everything this project has cost, in one place (ADR-099).
 *
 * Replaces three separate tabs. Each section answers the same two questions —
 * how much, and if the answer is nothing, which step is missing — so a zero is
 * never ambiguous between "nothing happened yet" and "you haven't set this up".
 *
 * Manpower is deliberately absent: per-project salary allocation is not
 * something this business does, so the project no longer asks for it. The
 * server-side rollup still counts allocations if anyone ever makes them.
 */
export function CostsTab({ projectId }: { projectId: string }) {
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canSeeMaterial = permissions.includes('inventory.read');
  const canSeeIntroducer = permissions.includes('introducer_fee.read');

  return (
    <div className="flex flex-col gap-6">
      {canSeeMaterial ? <MaterialSection projectId={projectId} /> : null}
      {canSeeIntroducer ? <IntroducerSection projectId={projectId} /> : null}
    </div>
  );
}

function MaterialSection({ projectId }: { projectId: string }) {
  const router = useRouter();

  const issues = trpc.inventory.listConsumptions.useQuery({ page: 1, pageSize: 100, projectId });
  // Two cheap prerequisite probes: does a catalogue exist at all, and is there
  // anything actually on the shelf. They answer "why is this empty" precisely
  // rather than making the user guess which step they skipped.
  const itemCount = trpc.inventoryItems.getCount.useQuery();
  const stock = trpc.inventory.listStock.useQuery({ page: 1, pageSize: 1, inStockOnly: true });

  const rows = (issues.data?.rows ?? []) as InventoryConsumptionRow[];
  const posted = rows.filter((r) => r.status === 'POSTED');
  const total = posted.reduce((sum, r) => sum + Number(r.totalValueAmount), 0);

  const hasItems = (itemCount.data ?? 0) > 0;
  const stockOnHand = stock.data?.total ?? 0;
  const stockValue = stock.data?.totalStockValueAmount ?? '0';

  const columns: ColumnsType<InventoryConsumptionRow> = [
    { title: 'Issue', dataIndex: 'consumptionNumber', key: 'consumptionNumber', render: (v: string) => <span className="font-mono text-[12px]">{v}</span> },
    { title: 'Date', dataIndex: 'consumedDate', key: 'consumedDate', render: (v: string) => formatDate(v) },
    { title: 'Note', dataIndex: 'note', key: 'note', render: (v: string | null) => v ?? '—' },
    {
      title: 'Cost',
      dataIndex: 'totalValueAmount',
      key: 'totalValueAmount',
      align: 'right',
      render: (v: string, row) => <MoneyText tone={row.status === 'POSTED' ? 'negative' : 'neutral'}>{formatMoney(v)}</MoneyText>,
    },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (v: InventoryConsumptionRow['status']) => <ConsumptionStatusTag status={v} /> },
  ];

  const issueStock = () => router.push(`/inventory/consumptions/new?projectId=${projectId}`);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <KpiCard
          label="Material Cost"
          value={<MoneyText tone="negative">{formatMoney(total.toFixed(2))}</MoneyText>}
          sub={`${posted.length} stock issue${posted.length === 1 ? '' : 's'}`}
        />
        <KpiCard label="Valued at" value="Weighted average" sub="The ruling rate when each issue was made" />
      </div>

      {/* The prerequisite chain, most-blocking first. Only one can apply. */}
      {!itemCount.isLoading && !hasItems ? (
        <NextStep
          title="No products exist yet"
          detail="Stock has to be a product before it can be received or issued. Create one first."
          actionLabel="Create a product"
          onAction={() => router.push('/products')}
        />
      ) : !stock.isLoading && hasItems && stockOnHand === 0 ? (
        <NextStep
          title="No stock on hand"
          detail="Products exist but none are in stock. Stock arrives by approving a vendor bill with a stock line, or by recording a receipt."
          actionLabel="Add stock"
          onAction={() => router.push('/inventory/receipts/new')}
        />
      ) : !issues.isLoading && rows.length === 0 && stockOnHand > 0 ? (
        <NextStep
          title={`${formatMoney(stockValue)} of stock is on hand, and none has been issued to this project`}
          detail="Issuing stock charges it to this project at the ruling weighted average, and it appears in Spend and Financials."
          actionLabel="Issue stock"
          onAction={issueStock}
        />
      ) : null}

      <UiCard
        title="Stock Issued to This Project"
        actions={
          stockOnHand> 0 ? (
            <button type="button" className="text-[13px] font-semibold text-brand hover:underline" onClick={issueStock}>
              Issue stock
            </button>
          ) : null
        }
      >
        <Table<InventoryConsumptionRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={issues.isLoading}
          pagination={false}
          size="small"
          locale={{ emptyText: 'Nothing issued to this project yet.' }}
        />
        {posted.length > 0 ? (
          <div className="mt-2 text-[12px] text-muted">
            A reversed issue returned its stock and is excluded from the cost above.
            {stockOnHand > 0 ? ` ${formatQuantity(String(stockOnHand))} item(s) still have stock available.` : ''}
          </div>
        ) : null}
      </UiCard>
    </div>
  );
}
