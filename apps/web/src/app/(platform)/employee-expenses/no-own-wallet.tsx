'use client';

import { useRouter } from 'next/navigation';
import { Button } from 'antd';
import { PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';

/**
 * A user with no employee record (an Admin, say) has no wallet of their own:
 * advances and reimbursements are an employee's. Those who manage claims are
 * sent where they work instead of being told to call an administrator.
 */
export function NoOwnWallet({ title }: { title: string }) {
  const router = useRouter();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canAddForEmployee = permissions.includes('employee_claim.approve');
  const canSeeAll = permissions.includes('employee_claim.read');
  if (!canAddForEmployee && !canSeeAll) return <PageHeader title={title} description="No employee record is linked to your account — contact an administrator." />;
  return (
    <>
      <PageHeader title={title} />
      <UiCard>
        <p className="mt-0 text-[13px] text-ink">You are not set up as an employee, so you have no expense wallet of your own. You can still manage everyone&rsquo;s expenses:</p>
        <div className="flex flex-wrap gap-2">
          {canAddForEmployee ? (
            <Button type="primary" onClick={() => router.push('/employee-expenses/new')}>
              Add Expense for Employee
            </Button>
          ) : null}
          {canSeeAll ? <Button onClick={() => router.push('/employee-expenses')}>All Employee Reimbursements</Button> : null}
        </div>
        <p className="mb-0 mt-3 text-[12px] text-muted">To claim your own expenses, add yourself in Employees and link your login to it.</p>
      </UiCard>
    </>
  );
}
