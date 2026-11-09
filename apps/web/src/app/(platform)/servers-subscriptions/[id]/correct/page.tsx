'use client';

import { useParams, useRouter } from 'next/navigation';
import { Button } from 'antd';
import { PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import type { DirectExpenseRow } from '../../../direct-expenses/shared';
import { EntryForm } from '../../entry-form';

export default function CorrectServerSubscriptionBillPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const bill = trpc.directExpenses.getDetail.useQuery({ id });
  const row = bill.data as DirectExpenseRow | undefined;

  return (
    <>
      <PageHeader
        title="Correct Bill"
        description="A posted bill is not edited: saving reverses it and posts the corrected one."
        actions={<Button onClick={() => router.push(`/servers-subscriptions/${id}`)}>Back to bill</Button>}
      />
      {bill.isLoading ? <UiCard>Loading…</UiCard> : null}
      {bill.isError ? <UiCard>Could not load this bill.</UiCard> : null}
      {row && (row.status !== 'POSTED' || !row.spendType) ? <UiCard>Only a posted server or subscription bill can be corrected. This one is {row.status.toLowerCase()}.</UiCard> : null}
      {row && row.status === 'POSTED' && row.spendType ? <EntryForm correcting={row} /> : null}
    </>
  );
}
