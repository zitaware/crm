'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Empty } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import { KpiCard, MoneyText, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { formatQuantity, MovementTypeTag, type InventoryMovementRow } from '../shared';
import { isoDate } from '@/lib/dates';

export default function InventoryItemLedgerPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = use(params);
  const router = useRouter();

  const [fromDate, setFromDate] = useState<string | undefined>(undefined);
  const [toDate, setToDate] = useState<string | undefined>(undefined);

  const ledger = trpc.inventory.getItemLedger.useQuery({ inventoryItemId: itemId, fromDate, toDate });
  const data = ledger.data;
  const movements = (data?.movements ?? []) as InventoryMovementRow[];

  const stockIn = movements.filter((m) => Number(m.quantityIn) > 0);
  const stockOut = movements.filter((m) => Number(m.quantityOut) > 0);

  return (
    <>
      <PageHeader
        title={data ? `${data.code} — ${data.name}` : 'Item Ledger'}
        description="Every movement, in order, with the running balance it produced."
        actions={
          <div className="flex gap-2">
            {/* The item master entry this ledger is about (ADR-097). */}
            <Button size="small" onClick={() => router.push('/products')}>
              Product Master
            </Button>
            <Button size="small" onClick={() => router.push('/inventory')}>
              Back to Inventory
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="On Hand" value={data ? `${formatQuantity(data.quantityOnHand)} ${data.unitOfMeasureName}` : '—'} />
        <KpiCard
          label="Stock Value"
          value={<MoneyText tone="neutral">{formatMoney(data?.stockValueAmount ?? '0')}</MoneyText>}
        />
        <KpiCard
          label="Weighted Average Rate"
          value={<MoneyText tone="neutral">{formatMoney(data?.weightedAverageRate ?? '0')}</MoneyText>}
          sub="Per unit, from posted movements"
        />
      </div>

      <UiCard title="Filter" className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="mb-1 text-[12px] text-muted">From</div>
            <DatePicker onChange={(picked) => setFromDate(isoDate(picked) || undefined)} />
          </div>
          <div>
            <div className="mb-1 text-[12px] text-muted">To</div>
            <DatePicker onChange={(picked) => setToDate(isoDate(picked) || undefined)} />
          </div>
          <Button
            onClick={() => {
              setFromDate(undefined);
              setToDate(undefined);
            }}
          >
            Reset
          </Button>
          <p className="ml-auto max-w-md text-[12px] text-muted">
            Filtering narrows the rows shown. The on-hand and value figures above always describe the item&apos;s current
            position, never the filtered window.
          </p>
        </div>
      </UiCard>

      <LedgerTable title="Stock In" rows={stockIn} loading={ledger.isLoading} direction="in" />
      <div className="h-4" />
      <LedgerTable title="Stock Out" rows={stockOut} loading={ledger.isLoading} direction="out" />
    </>
  );
}

function LedgerTable({
  title,
  rows,
  loading,
  direction,
}: {
  title: string;
  rows: InventoryMovementRow[];
  loading: boolean;
  direction: 'in' | 'out';
}) {
  return (
    <UiCard title={title} flush>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead>
            <tr className="border-b border-ui text-left text-muted">
              <th className="px-4 py-2">#</th>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Source</th>
              <th className="px-4 py-2">Party</th>
              <th className="px-4 py-2 text-right">{direction === 'in' ? 'Qty In' : 'Qty Out'}</th>
              <th className="px-4 py-2 text-right">Unit Cost</th>
              <th className="px-4 py-2 text-right">Value</th>
              <th className="px-4 py-2 text-right">Balance Qty</th>
              <th className="px-4 py-2 text-right">Balance Value</th>
              <th className="px-4 py-2 text-right">Avg Rate</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-muted">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-6">
                  <Empty description={`No ${direction === 'in' ? 'stock-in' : 'stock-out'} movement in this range`} />
                </td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr key={m.id} className="border-b border-ui-2">
                  <td className="px-4 py-2 text-muted">{m.sequenceNumber}</td>
                  <td className="px-4 py-2">{formatDate(m.movementDate)}</td>
                  <td className="px-4 py-2">
                    <MovementTypeTag type={m.movementType} />
                  </td>
                  <td className="px-4 py-2">{m.sourceLabel}</td>
                  <td className="px-4 py-2">{m.partyName ?? '—'}</td>
                  <td className="px-4 py-2 text-right">{formatQuantity(direction === 'in' ? m.quantityIn : m.quantityOut)}</td>
                  <td className="px-4 py-2 text-right">{formatMoney(m.unitCostAmount)}</td>
                  <td className="px-4 py-2 text-right">{formatMoney(m.movementValueAmount)}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatQuantity(m.balanceQuantity)}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatMoney(m.balanceValueAmount)}</td>
                  <td className="px-4 py-2 text-right">{formatMoney(m.weightedAverageRate)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </UiCard>
  );
}
