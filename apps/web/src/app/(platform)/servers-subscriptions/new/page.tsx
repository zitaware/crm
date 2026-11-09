'use client';

import { useRouter } from 'next/navigation';
import { Button } from 'antd';
import { PageHeader } from '@zitaware/ui';
import { EntryForm } from '../entry-form';

export default function NewServerSubscriptionBillPage() {
  const router = useRouter();
  return (
    <>
      <PageHeader
        title="Add Server / Subscription Bill"
        description="One bill paid, as on the sheet. It is checked against the masters and posted as a direct expense."
        actions={<Button onClick={() => router.push('/servers-subscriptions')}>Back to Servers &amp; Subscriptions</Button>}
      />
      <EntryForm correcting={null} />
    </>
  );
}
