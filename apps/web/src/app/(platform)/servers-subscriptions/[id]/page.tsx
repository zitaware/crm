'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button } from 'antd';
import { PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { DocumentsTab } from '@/components/documents-tab';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { DirectExpenseStatusTag, SPEND_TYPE_LABEL, type DirectExpenseRow } from '../../direct-expenses/shared';
import { ReverseBillModal } from '../reverse-modal';

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-ui-2 py-2 text-[13px] last:border-b-0">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="text-right text-ink">{children}</span>
    </div>
  );
}

/** One server or subscription bill: what was paid, how it was booked, its link and files, and its correction or reversal (ADR-169). */
export default function ServerSubscriptionBillPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const utils = trpc.useUtils();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canReverse = permissions.includes('direct_expense.reverse');
  const canCorrect = canReverse && permissions.includes('direct_expense.post');
  const query = trpc.directExpenses.getDetail.useQuery({ id });
  const bill = query.data as DirectExpenseRow | undefined;
  const [reversing, setReversing] = useState(false);

  if (query.isLoading) return <UiCard>Loading…</UiCard>;
  if (!bill) return <UiCard>Could not load this bill.</UiCard>;

  const gstType = bill.supplyType === 'INTRASTATE' ? 'CGST + SGST' : bill.supplyType === 'INTERSTATE' ? 'IGST' : null;

  return (
    <>
      <PageHeader
        title={bill.title}
        description={`${bill.spendType ? SPEND_TYPE_LABEL[bill.spendType] : 'Direct expense'} · ${formatDate(bill.expenseDate)} · ${bill.projectName ?? 'Company overhead'}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {bill.status === 'POSTED' && bill.spendType && canCorrect ? (
              <Button type="primary" onClick={() => router.push(`/servers-subscriptions/${bill.id}/correct`)}>
                Correct
              </Button>
            ) : null}
            {bill.status === 'POSTED' && canReverse ? (
              <Button danger onClick={() => setReversing(true)}>
                Reverse
              </Button>
            ) : null}
            <Button onClick={() => router.push('/servers-subscriptions')}>Back to list</Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <UiCard title="Bill" actions={<DirectExpenseStatusTag status={bill.status} />}>
          <Line label="Type">{bill.spendType ? SPEND_TYPE_LABEL[bill.spendType] : '—'}</Line>
          <Line label="Employee">{bill.purchasedByEmployeeName ?? '—'}</Line>
          <Line label="Date">{formatDate(bill.expenseDate)}</Line>
          <Line label="Legal entity">{bill.legalEntityName}</Line>
          <Line label="Charged to">{bill.projectName ?? 'Company overhead'}</Line>
          <Line label="Expense category">{bill.expenseCategoryName}</Line>
          <Line label="Paid by">
            {bill.paymentModeLabel}
            {bill.cardAccountLabel ?? bill.bankAccountName ? <span className="text-muted"> · {bill.cardAccountLabel ?? bill.bankAccountName}</span> : null}
          </Line>
          {bill.transactionReference ? <Line label="Reference">{bill.transactionReference}</Line> : null}
          <Line label="Bill link">
            {bill.billUrl ? (
              <a href={bill.billUrl} target="_blank" rel="noopener noreferrer" className="break-all text-brand hover:underline">
                {bill.billUrl}
              </a>
            ) : (
              '—'
            )}
          </Line>
          {bill.note ? <Line label="Note">{bill.note}</Line> : null}
        </UiCard>

        <UiCard title="Amount">
          <Line label="Basic">{formatMoney(bill.taxableAmount)}</Line>
          <Line label={gstType ? `GST (${gstType})` : 'GST'}>{formatMoney(bill.gstAmount)}</Line>
          <Line label="Total paid">
            <b>{formatMoney(bill.amount)}</b>
          </Line>
          <p className="m-0 mt-3 text-[12px] text-muted">
            {bill.status === 'REVERSED'
              ? `Reversed${bill.reversedAt ? ` on ${formatDateTime(bill.reversedAt)}` : ''}: ${bill.reversalReason ?? ''}`
              : bill.postedAt
                ? `Posted ${formatDateTime(bill.postedAt)}.`
                : null}{' '}
            <Link href={`/direct-expenses/${bill.id}`} className="text-brand hover:underline">
              Open as direct expense
            </Link>
          </p>
        </UiCard>
      </div>

      <div className="mt-4">
        <DocumentsTab entityType="DIRECT_EXPENSE" entityId={bill.id} uploadCardTitle="Upload bill file" listCardTitle="Bill files" emptyText="No bill file yet." />
      </div>

      {reversing ? (
        <ReverseBillModal
          bill={bill}
          onClose={() => setReversing(false)}
          onReversed={async () => {
            await Promise.all([utils.directExpenses.getDetail.invalidate({ id }), utils.directExpenses.list.invalidate()]);
          }}
        />
      ) : null}
    </>
  );
}
