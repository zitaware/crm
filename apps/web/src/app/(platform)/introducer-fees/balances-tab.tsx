'use client';

import { useState } from 'react';
import { Button } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, KpiCard, MoneyText, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import type { IntroducerBalanceRow } from './shared';

/** A column heading with a one-line meaning under it. */
function Heading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="leading-tight">
      <div>{title}</div>
      <div className="text-[11px] font-normal normal-case tracking-normal text-muted">{hint}</div>
    </div>
  );
}

const money = (v: string) => formatMoney(v);

/** Every payment to one introducer, latest first: when, how much, and how it went. */
function PaymentHistory({ introducerId }: { introducerId: string }) {
  const payments = trpc.introducerFees.listPayments.useQuery({ introducerId });
  if (payments.isLoading) return <p className="m-0 py-2 text-[12.5px] text-muted">Loading payments…</p>;
  const rows = [...(payments.data?.rows ?? [])].sort((a, b) => b.paymentDate.localeCompare(a.paymentDate) || b.paymentNumber.localeCompare(a.paymentNumber));
  if (rows.length === 0) return <p className="m-0 py-2 text-[12.5px] text-muted">No payment yet.</p>;
  return (
    <table className="w-full text-[12.5px]">
      <thead>
        <tr className="border-b border-ui text-left text-muted">
          <th className="py-1.5 pr-3 font-medium">Date</th>
          <th className="py-1.5 pr-3 font-medium">Payment</th>
          <th className="py-1.5 pr-3 text-right font-medium">Paid</th>
          <th className="py-1.5 pr-3 text-right font-medium">TDS</th>
          <th className="py-1.5 pr-3 text-right font-medium">Cash paid</th>
          <th className="py-1.5 pr-3 font-medium">From</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id} className={`border-b border-ui-2 last:border-b-0 ${p.status === 'REVERSED' ? 'text-muted-2 line-through' : 'text-ink'}`}>
            <td className="py-1.5 pr-3">{formatDate(p.paymentDate)}</td>
            <td className="py-1.5 pr-3 font-mono">
              {p.paymentNumber}
              {p.status === 'REVERSED' ? <span className="ml-1 font-sans no-underline">(reversed)</span> : null}
            </td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{money(p.grossAmount)}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{money(p.tdsAmount)}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{money(p.netAmount)}</td>
            <td className="py-1.5 pr-3 text-muted">{[p.bankAccountName, p.paymentModeName, p.referenceNumber].filter(Boolean).join(' · ')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function BalancesTab() {
  const balances = trpc.introducerFees.listBalances.useQuery();
  const rows = (balances.data?.rows ?? []) as IntroducerBalanceRow[];
  const totals = balances.data?.totals;
  const [accounting, setAccounting] = useState(false);

  /** The plain view: what was agreed, what was paid and when, what is left. */
  const plainColumns: ColumnsType<IntroducerBalanceRow> = [
    { title: 'Introducer', dataIndex: 'introducerName', key: 'introducerName', render: (v: string) => <span className="font-semibold text-ink">{v}</span> },
    { title: 'Agreements', dataIndex: 'agreementCount', key: 'agreementCount', align: 'right' },
    {
      title: <Heading title="Commission agreed" hint="Total promised" />,
      dataIndex: 'agreedAmount',
      key: 'agreedAmount',
      align: 'right',
      render: (v: string, r) => (
        <span title={r.agreedComplete ? undefined : 'Part of the commission is not known yet: a percentage agreement whose project has no value.'}>
          {money(v)}
          {r.agreedComplete ? '' : ' +'}
        </span>
      ),
    },
    {
      title: <Heading title="Paid" hint="TDS included" />,
      dataIndex: 'paidAmount',
      key: 'paidAmount',
      align: 'right',
      render: (v: string) => <MoneyText tone="positive">{money(v)}</MoneyText>,
    },
    { title: 'Last paid', dataIndex: 'lastPaidOn', key: 'lastPaidOn', align: 'right', render: (v: string | null) => (v ? formatDate(v) : '—') },
    {
      title: <Heading title="Left to pay" hint="Agreed less paid" />,
      dataIndex: 'remainingAmount',
      key: 'remainingAmount',
      align: 'right',
      render: (v: string) => <MoneyText tone={Number(v) > 0 ? 'negative' : 'neutral'}>{money(v)}</MoneyText>,
    },
  ];

  /**
   * The accounting behind it, kept as five separate figures (docs/04 §15):
   * earned, settled, withheld, cash out, and paid ahead. A single number
   * would hide which way the money runs.
   */
  const accountingColumns: ColumnsType<IntroducerBalanceRow> = [
    { title: 'Introducer', dataIndex: 'introducerName', key: 'introducerName', render: (v: string) => <span className="font-semibold text-ink">{v}</span> },
    { title: <Heading title="Accrued" hint="Booked as earned" />, dataIndex: 'accruedAmount', key: 'accruedAmount', align: 'right', render: money },
    { title: <Heading title="Settled" hint="Accrued and paid" />, dataIndex: 'allocatedAmount', key: 'allocatedAmount', align: 'right', render: money },
    { title: <Heading title="TDS" hint="Deducted, owed to govt." />, dataIndex: 'tdsAmount', key: 'tdsAmount', align: 'right', render: money },
    { title: <Heading title="Cash paid" hint="Left the bank" />, dataIndex: 'netPaidAmount', key: 'netPaidAmount', align: 'right', render: money },
    { title: <Heading title="Advance" hint="Paid before booked" />, dataIndex: 'advanceAmount', key: 'advanceAmount', align: 'right', render: money },
    {
      title: <Heading title="Payable" hint="Booked, not yet paid" />,
      dataIndex: 'payableAmount',
      key: 'payableAmount',
      align: 'right',
      render: (v: string) => <MoneyText tone={Number(v) > 0 ? 'negative' : 'neutral'}>{money(v)}</MoneyText>,
    },
  ];

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Commission agreed" value={<MoneyText tone="neutral">{money(totals?.agreedAmount ?? '0')}</MoneyText>} sub="Across all agreements" />
        <KpiCard label="Paid" value={<MoneyText tone="positive">{money(totals?.paidAmount ?? '0')}</MoneyText>} sub="TDS included" />
        <KpiCard label="Left to pay" value={<MoneyText tone="negative">{money(totals?.remainingAmount ?? '0')}</MoneyText>} sub="Agreed less paid" />
      </div>

      <UiCard
        flush
        title={accounting ? 'Accounting details' : 'Commission by introducer'}
        actions={
          <Button size="small" type="link" className="px-0" onClick={() => setAccounting((v) => !v)}>
            {accounting ? 'Back to summary' : 'Show accounting details'}
          </Button>
        }
      >
        {!accounting ? <p className="m-0 border-b border-ui-2 px-4 py-2 text-[12px] text-muted">Click an introducer to see each payment: when, how much, and from which account.</p> : null}
        {accounting ? (
          <p className="m-0 border-b border-ui-2 px-4 py-2 text-[12px] text-muted">
            How the books carry it: commission is booked as an expense when earned (accrued), then paid. TDS is deducted from each payment and deposited with the
            government. A payment made before the commission is booked is held as an advance.
          </p>
        ) : null}
        <EntityTable<IntroducerBalanceRow>
          rowKey="introducerId"
          columns={accounting ? accountingColumns : plainColumns}
          dataSource={rows}
          expandable={{
            expandRowByClick: true,
            rowExpandable: (r) => r.agreementCount > 0 || Number(r.paidAmount) > 0,
            expandedRowRender: (r) => <PaymentHistory introducerId={r.introducerId} />,
          }}
          loading={balances.isLoading}
          errorMessage={balances.isError ? 'Could not load introducer balances. Please retry.' : undefined}
          emptyTitle="No introducers"
          emptyDescription="Introducers appear here once they exist in the CRM."
          page={1}
          pageSize={rows.length || 1}
          total={rows.length}
          onPageChange={() => undefined}
        />
      </UiCard>
    </>
  );
}
