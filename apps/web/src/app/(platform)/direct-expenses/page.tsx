'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import dayjs from 'dayjs';
import { App, Button, Input, Modal, Select } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { MasterSelect } from '@/components/master-select';
import { formatDate, formatMoney } from '@/lib/format';
import { DirectExpenseStatusTag, newIdempotencyKey, type DirectExpenseRow, type DirectExpenseStatus } from './shared';
import { DateInput } from '@/components/date-input';
import { completeIsoRange } from '@/lib/dates';

const { RangePicker } = DatePicker;

interface Filters {
  expenseCategoryId?: string | undefined;
  projectId?: string | undefined;
  status?: DirectExpenseStatus | undefined;
  expenseDateFrom?: string | undefined;
  expenseDateTo?: string | undefined;
}

const PAGE_SIZE = 25;

const STATUS_OPTIONS: Array<{ value: DirectExpenseStatus; label: string }> = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'POSTED', label: 'Posted' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'REVERSED', label: 'Reversed' },
];

export default function DirectExpensesPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canCreate = permissions.includes('direct_expense.create');
  const canReverse = permissions.includes('direct_expense.reverse');

  const [draftCategoryId, setDraftCategoryId] = useState<string | undefined>(undefined);
  const [draftProjectId, setDraftProjectId] = useState<string | undefined>(undefined);
  const [draftStatus, setDraftStatus] = useState<DirectExpenseStatus | undefined>(undefined);
  const [draftExpenseRange, setDraftExpenseRange] = useState<[string, string] | null>(null);
  const [appliedFilters, setAppliedFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);

  const list = trpc.directExpenses.list.useQuery({ page, pageSize: PAGE_SIZE, filters: appliedFilters });
  const projects = trpc.projects.list.useQuery();

  const applyFilters = () => {
    setAppliedFilters({
      expenseCategoryId: draftCategoryId,
      projectId: draftProjectId,
      status: draftStatus,
      expenseDateFrom: draftExpenseRange?.[0],
      expenseDateTo: draftExpenseRange?.[1],
    });
    setPage(1);
  };
  const resetFilters = () => {
    setDraftCategoryId(undefined);
    setDraftProjectId(undefined);
    setDraftStatus(undefined);
    setDraftExpenseRange(null);
    setAppliedFilters({});
    setPage(1);
  };

  const [reverseTarget, setReverseTarget] = useState<DirectExpenseRow | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseAccountingDate, setReverseAccountingDate] = useState('');
  const [reverseKey, setReverseKey] = useState(newIdempotencyKey());

  const invalidate = () => utils.directExpenses.list.invalidate();

  const reverseMutation = trpc.directExpenses.reverse.useMutation({
    onSuccess: async () => {
      message.success('Direct expense reversed.');
      setReverseTarget(null);
      setReverseReason('');
      setReverseKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const rows = (list.data?.rows ?? []) as DirectExpenseRow[];
  const total = list.data?.total ?? 0;

  const columns: ColumnsType<DirectExpenseRow> = [
    {
      title: 'Expense',
      key: 'title',
      render: (_v, row) => (
        <div>
          <div className="font-semibold text-ink">{row.title}</div>
          <div className="text-[11.5px] text-muted">
            {row.expenseCategoryName}
            {row.billUrl ? (
              <>
                {' · '}
                <a href={row.billUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                  Bill link
                </a>
              </>
            ) : null}
          </div>
        </div>
      ),
    },
    { title: 'Project', key: 'projectName', render: (_v, row) => row.projectName ?? 'Company overhead' },
    { title: 'Date', key: 'expenseDate', render: (_v, row) => formatDate(row.expenseDate) },
    { title: 'Amount', key: 'amount', align: 'right', render: (_v, row) => formatMoney(row.amount) },
    { title: 'Status', key: 'status', render: (_v, row) => <DirectExpenseStatusTag status={row.status} /> },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_v, row) => (
        <div className="flex justify-end gap-2">
          {canReverse && row.status === 'POSTED' ? (
            <Button
              size="small"
              danger
              onClick={() => {
                setReverseAccountingDate(new Date().toISOString().slice(0, 10));
                setReverseTarget(row);
              }}
            >
              Reverse
            </Button>
          ) : null}
          <Button size="small" onClick={() => router.push(`/direct-expenses/${row.id}`)}>
            View
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Direct Expenses"
        description="Company-paid bills with no employee or wallet involved — posted immediately against a bank account."
        actions={canCreate ? <Button type="primary" onClick={() => router.push('/direct-expenses/new')}>Add Direct Expense</Button> : undefined}
      />

      <UiCard flush>
        <FilterCard
          actions={
            <>
              <Button onClick={resetFilters}>Reset</Button>
              <Button type="primary" onClick={applyFilters}>
                Apply
              </Button>
            </>
          }
        >
          <FilterField label="Category">
            <MasterSelect
              type="expense_categories"
              includeInactive
              allowClear
              placeholder="All"
              value={draftCategoryId}
              onChange={setDraftCategoryId}
              className="w-[180px]"
            />
          </FilterField>
          <FilterField label="Project">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="All"
              value={draftProjectId}
              onChange={setDraftProjectId}
              className="w-[200px]"
              loading={projects.isLoading}
              options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          </FilterField>
          <FilterField label="Status">
            <Select allowClear placeholder="All" value={draftStatus} onChange={setDraftStatus} className="w-[160px]" options={STATUS_OPTIONS} />
          </FilterField>
          <FilterField label="Expense Date">
            <RangePicker
              value={draftExpenseRange ? [dayjs(draftExpenseRange[0]), dayjs(draftExpenseRange[1])] : null}
              onChange={(picked) => setDraftExpenseRange(completeIsoRange(picked))}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<DirectExpenseRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load direct expenses. Please retry.' : undefined}
          emptyTitle="No direct expenses found"
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>

      <Modal
        title="Reverse Direct Expense"
        open={!!reverseTarget}
        onCancel={() => setReverseTarget(null)}
        onOk={() =>
          reverseTarget &&
          reverseMutation.mutate({ id: reverseTarget.id, expectedVersion: reverseTarget.version, reason: reverseReason, accountingDate: reverseAccountingDate, idempotencyKey: reverseKey })
        }
        confirmLoading={reverseMutation.isPending}
        okButtonProps={{ disabled: !reverseReason.trim() || !reverseAccountingDate }}
        okText="Reverse"
      >
        <p className="mb-2 text-muted">This reverses the posting journal for {reverseTarget ? formatMoney(reverseTarget.amount) : ''}.</p>
        <p className="mb-2 text-muted">Reversal accounting date</p>
        <DateInput value={reverseAccountingDate} onChange={setReverseAccountingDate} />
        <p className="mb-2 mt-3 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
      </Modal>
    </>
  );
}
