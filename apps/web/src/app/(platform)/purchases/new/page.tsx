'use client';

import { useRouter } from 'next/navigation';
import { Button } from 'antd';
import { PageHeader } from '@zitaware/ui';
import { PurchaseEntryForm } from '../entry-form';

export default function NewPurchasePage() {
  const router = useRouter();
  return (
    <>
      <PageHeader
        title="Add Purchase"
        description="One bill, as a row of the purchase register. It is checked against the masters, approved, and paid from the card or account given."
        actions={
          <div className="flex gap-2">
            <Button onClick={() => router.push('/vendor-bills/new')}>Bill with item lines</Button>
            <Button onClick={() => router.push('/purchases')}>Back to Purchases</Button>
          </div>
        }
      />
      <PurchaseEntryForm />
    </>
  );
}
