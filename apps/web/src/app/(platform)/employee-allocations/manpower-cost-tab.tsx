'use client';

import { useState } from 'react';
import { Alert, Button, Select } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import dayjs from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, KpiCard, MoneyText, UiCard } from '@zitaware/ui';
import { useRouter } from 'next/navigation';
import { NextStep } from '@/components/next-step';
import { trpc } from '@/server/trpc';
import { formatMoney } from '@/lib/format';

interface ManpowerRow {
  projectId: string;
  projectName: string;
  allocationMonth: string;
  employeeCount: number;
  totalPercentage: string;
  manpowerCostAmount: string;
}

function currentMonthStart(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
function monthsBefore(month: string, count: number): string {
  const base = new Date(`${month}T00:00:00.000Z`);
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - count, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
function formatMonth(value: string): string {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function formatPercent(value: string): string {
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return `${n.toLocaleString('en-IN', { maximumFractionDigits: 4 })}%`;
}

export function ManpowerCostTab({
  latestPostedMonth,
  onGoToAllocation,
}: {
  /** Newest month with posted salary, or null. The range used to end at the
   * CURRENT month, which can never have salary — so the report opened on a
   * window whose most recent months are structurally empty. */
  latestPostedMonth?: string | null;
  onGoToAllocation?: (() => void) | undefined;
}) {
  const [fromOverride, setFromOverride] = useState<string | null>(null);
  const [toOverride, setToOverride] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [legalEntityId, setLegalEntityId] = useState<string | undefined>(undefined);
  const router = useRouter();

  const hasPostedSalary = Boolean(latestPostedMonth);
  const toMonth = toOverride ?? latestPostedMonth ?? currentMonthStart();
  const fromMonth = fromOverride ?? monthsBefore(toMonth, 5);
  const setFromMonth = setFromOverride;
  const setToMonth = setToOverride;

  const projects = trpc.projects.list.useQuery();
  const legalEntities = trpc.legalEntities.list.useQuery({ includeInactive: false });
  const report = trpc.employeeAllocations.getProjectManpowerCost.useQuery({ fromMonth, toMonth, projectId, legalEntityId });
  const rows = (report.data?.rows ?? []) as ManpowerRow[];

  const columns: ColumnsType<ManpowerRow> = [
    { title: 'Month', dataIndex: 'allocationMonth', key: 'allocationMonth', render: formatMonth },
    {
      title: 'Project',
      dataIndex: 'projectName',
      key: 'projectName',
      render: (v: string, row) => (
        <button
          type="button"
          className="font-semibold text-ink hover:text-brand"
          onClick={() => router.push(`/projects/${row.projectId}?tab=costs`)}
        >
          {v}
        </button>
      ),
    },
    { title: 'Employees', dataIndex: 'employeeCount', key: 'employeeCount', align: 'right' },
    {
      title: 'Allocated Effort',
      dataIndex: 'totalPercentage',
      key: 'totalPercentage',
      align: 'right',
      render: formatPercent,
    },
    {
      title: 'Manpower Cost',
      dataIndex: 'manpowerCostAmount',
      key: 'manpowerCostAmount',
      align: 'right',
      render: (v: string) => <MoneyText tone="negative">{formatMoney(v)}</MoneyText>,
    },
  ];

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Total Manpower Cost"
          value={<MoneyText tone="negative">{formatMoney(report.data?.totalManpowerCostAmount ?? '0')}</MoneyText>}
          sub="Across the selected months"
        />
        <KpiCard label="Project-months" value={rows.length} />
        <KpiCard
          label="Excluded drafts"
          value={report.data?.excludedDraftEmployeeMonths ?? 0}
          sub="Employee-months not yet submitted"
        />
      </div>

      {(report.data?.excludedDraftEmployeeMonths ?? 0) > 0 ? (
        <Alert
          className="mb-4"
          type="warning"
          showIcon
          message="Some employee-months are still in draft"
          description="A draft is not yet the employee's answer, so it is excluded — the cost below will rise once those months are submitted."
        />
      ) : null}

      {/* An empty report has two quite different causes, and saying which one
          applies is the whole difference between "nothing happened" and "you
          have not finished setting up". */}
      {!report.isLoading && rows.length === 0 ? (
        <div className="mb-4">
          <NextStep
            title={
              hasPostedSalary
                ? 'Salary is imported, but no allocation has been submitted in this range'
                : 'No salary has been imported yet, so there is nothing to attribute'
            }
            detail={
              hasPostedSalary
                ? 'Manpower cost is gross salary multiplied by a submitted allocation percentage. Until an employee-month is submitted against a project, there is nothing to show.'
                : 'This report multiplies imported gross salary by an allocation percentage. Both are needed; the salary comes first.'
            }
            actionLabel={hasPostedSalary ? 'Go to allocation' : 'Go to salary'}
            onAction={() => (hasPostedSalary ? onGoToAllocation?.() : router.push('/employee-costing?tab=salary'))}
          />
        </div>
      ) : null}

      <UiCard flush>
        <FilterCard
          actions={
            <Button
              onClick={() => {
                setFromOverride(null);
                setToOverride(null);
                setProjectId(undefined);
                setLegalEntityId(undefined);
              }}
            >
              Reset
            </Button>
          }
        >
          <FilterField label="From month">
            <DatePicker
              picker="month"
              className="w-[150px]"
              allowClear={false}
              value={dayjs(fromMonth)}
              onChange={(_d, s) => {
                if (typeof s === 'string' && s) setFromMonth(`${s}-01`);
              }}
            />
          </FilterField>
          <FilterField label="To month">
            <DatePicker
              picker="month"
              className="w-[150px]"
              allowClear={false}
              value={dayjs(toMonth)}
              onChange={(_d, s) => {
                if (typeof s === 'string' && s) setToMonth(`${s}-01`);
              }}
            />
          </FilterField>
          <FilterField label="Legal Entity">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="All"
              value={legalEntityId}
              onChange={(v?: string) => {
                setLegalEntityId(v);
                setProjectId(undefined);
              }}
              className="w-[220px]"
              options={(legalEntities.data ?? []).map((e) => ({ value: e.id, label: e.legalName }))}
            />
          </FilterField>
          <FilterField label="Project">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="All projects"
              value={projectId}
              onChange={setProjectId}
              className="w-[240px]"
              options={(projects.data ?? [])
                .filter((p) => !legalEntityId || p.legalEntityId === legalEntityId)
                .map((p) => ({ value: p.id, label: p.name }))}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<ManpowerRow>
          rowKey={(row) => `${row.projectId}-${row.allocationMonth}`}
          columns={columns}
          dataSource={rows}
          loading={report.isLoading}
          errorMessage={report.isError ? 'Could not load manpower cost. Please retry.' : undefined}
          emptyTitle="No manpower cost in this range"
          emptyDescription="Cost appears once a month's salary is imported and employees have submitted an allocation naming a project."
          page={1}
          pageSize={rows.length || 1}
          total={rows.length}
          onPageChange={() => undefined}
        />
      </UiCard>
    </>
  );
}
