'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from 'antd';
import { PageHeader } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { SalaryImportsScreen } from '../salary-imports/salary-list';
import { AllocationTab } from '../employee-allocations/allocation-screen';
import { ManpowerCostTab } from '../employee-allocations/manpower-cost-tab';

type TabKey = 'salary' | 'allocation' | 'cost';

/**
 * Salary, allocation and manpower cost for one month. They used to be two
 * menu items; the work is one sequence, so it is one screen (ADR-125).
 */
export function EmployeeCostingScreen() {
  const router = useRouter();
  const requested = useSearchParams().get('tab');
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canSalary = permissions.includes('salary_import.read');
  const canAllocation = permissions.includes('employee_allocation.read');

  const latestPosted = trpc.salaryImports.list.useQuery(
    { page: 1, pageSize: 1, status: 'POSTED' },
    { enabled: canSalary },
  );
  const latestPostedMonth = latestPosted.data?.rows[0]?.salaryMonth ?? null;

  const available: TabKey[] = [
    ...(canSalary ? (['salary'] as const) : []),
    ...(canAllocation ? (['allocation', 'cost'] as const) : []),
  ];
  const tab: TabKey = available.find((key) => key === requested) ?? available[0] ?? 'salary';

  return (
    <>
      <PageHeader
        title="Employee Costing"
        description="The month's salary, where that time went, and the cost that follows. Salary is posted first. Allocation splits it and does not post a journal."
      />
      {available.length === 0 ? (
        <p className="text-[13px] text-muted">You do not have access to employee costing.</p>
      ) : (
        <Tabs
          activeKey={tab}
          destroyInactiveTabPane
          onChange={(key) => router.replace(`/employee-costing?tab=${key}`)}
          items={[
            ...(canSalary ? [{ key: 'salary', label: 'Salary', children: <SalaryImportsScreen /> }] : []),
            ...(canAllocation
              ? [
                  { key: 'allocation', label: 'Allocation', children: <AllocationTab /> },
                  {
                    key: 'cost',
                    label: 'Cost',
                    children: (
                      <ManpowerCostTab
                        latestPostedMonth={latestPostedMonth}
                        onGoToAllocation={() => router.replace('/employee-costing?tab=allocation')}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
    </>
  );
}
