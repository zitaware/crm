'use client';

import { Tabs } from 'antd';
import { PageHeader } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { BalancesTab } from './balances-tab';
import { AgreementsTab } from './agreements-tab';
import { AccrualsTab } from './accruals-tab';
import { PaymentsTab } from './payments-tab';

export default function IntroducerFeesPage() {
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canCreate = permissions.includes('introducer_fee.create');
  const canPay = permissions.includes('introducer_fee.pay');

  return (
    <>
      <PageHeader
        title="Introducer Fees"
        description="How much commission each introducer was promised, how much has been paid and when, and what is left to pay."
      />
      <Tabs
        items={[
          { key: 'balances', label: 'Balances', children: <BalancesTab /> },
          { key: 'agreements', label: 'Agreements', children: <AgreementsTab canCreate={canCreate} /> },
          { key: 'accruals', label: 'Accruals', children: <AccrualsTab canCreate={canCreate} /> },
          { key: 'payments', label: 'Payments', children: <PaymentsTab canPay={canPay} /> },
        ]}
      />
    </>
  );
}
