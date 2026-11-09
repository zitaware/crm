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
import { BankAccountSelect } from '@/components/bank-account-select';
import { formatDate, formatMoney } from '@/lib/format';
import { EmployeeExpenseClaimStatusTag, newIdempotencyKey, type EmployeeExpenseClaimRow, type EmployeeExpenseClaimStatus, ClaimApprovalLine, mayDecide } from './shared';
import { DateInput } from '@/components/date-input';
import { completeIsoRange } from '@/lib/dates';

const { RangePicker } = DatePicker;

interface Filters {
  employeeId?: string | undefined;
  expenseCategoryId?: string | undefined;
  projectId?: string | undefined;
  status?: EmployeeExpenseClaimStatus | undefined;
  expenseDateFrom?: string | undefined;
  expenseDateTo?: string | undefined;
  approvedDateFrom?: string | undefined;
  approvedDateTo?: string | undefined;
}

const PAGE_SIZE = 25;

const STATUS_OPTIONS: Array<{ value: EmployeeExpenseClaimStatus; label: string }> = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUBMITTED', label: 'Pending Approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REIMBURSED', label: 'Reimbursed' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export default function EmployeeExpensesPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery().data;
  const permissions = me?.permissions ?? [];
  const canApprove = permissions.includes('employee_claim.approve');
  const canReimburse = permissions.includes('employee_claim.reimburse');
  const canGiveAdvance = permissions.includes('employee_advance.create');
  const hasOwnWallet = trpc.employeeExpenses.getMyEmployeeStatus.useQuery().data?.hasEmployee === true;
  const canFileOwn = permissions.includes('employee_claim.create') && hasOwnWallet;

  const [draftEmployeeId, setDraftEmployeeId] = useState<string | undefined>(undefined);
  const [draftCategoryId, setDraftCategoryId] = useState<string | undefined>(undefined);
  const [draftProjectId, setDraftProjectId] = useState<string | undefined>(undefined);
  const [draftStatus, setDraftStatus] = useState<EmployeeExpenseClaimStatus | undefined>(undefined);
  const [draftExpenseRange, setDraftExpenseRange] = useState<[string, string] | null>(null);
  const [draftApprovedRange, setDraftApprovedRange] = useState<[string, string] | null>(null);
  const [appliedFilters, setAppliedFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);

  const list = trpc.employeeExpenses.listClaims.useQuery({ page, pageSize: PAGE_SIZE, filters: appliedFilters });
  const employees = trpc.employees.list.useQuery({ includeInactive: true });
  const projects = trpc.projects.list.useQuery();

  // The stat tiles narrow with every filter except Status, since each
  // tile already represents one fixed status (or, for Advance
  // Outstanding, no status at all).
  const stats = trpc.employeeExpenses.getClaimStats.useQuery({
    filters: {
      employeeId: appliedFilters.employeeId,
      expenseCategoryId: appliedFilters.expenseCategoryId,
      projectId: appliedFilters.projectId,
      expenseDateFrom: appliedFilters.expenseDateFrom,
      expenseDateTo: appliedFilters.expenseDateTo,
      approvedDateFrom: appliedFilters.approvedDateFrom,
      approvedDateTo: appliedFilters.approvedDateTo,
    },
  });

  const applyFilters = () => {
    setAppliedFilters({
      employeeId: draftEmployeeId,
      expenseCategoryId: draftCategoryId,
      projectId: draftProjectId,
      status: draftStatus,
      expenseDateFrom: draftExpenseRange?.[0],
      expenseDateTo: draftExpenseRange?.[1],
      approvedDateFrom: draftApprovedRange?.[0],
      approvedDateTo: draftApprovedRange?.[1],
    });
    setPage(1);
  };
  const resetFilters = () => {
    setDraftEmployeeId(undefined);
    setDraftCategoryId(undefined);
    setDraftProjectId(undefined);
    setDraftStatus(undefined);
    setDraftExpenseRange(null);
    setDraftApprovedRange(null);
    setAppliedFilters({});
    setPage(1);
  };

  const [approveTarget, setApproveTarget] = useState<EmployeeExpenseClaimRow | null>(null);
  const [approveNote, setApproveNote] = useState('');
  const [approveKey, setApproveKey] = useState(newIdempotencyKey());
  const [reimburseTarget, setReimburseTarget] = useState<EmployeeExpenseClaimRow | null>(null);
  const [reimburseBankAccountId, setReimburseBankAccountId] = useState<string | undefined>(undefined);
  const [reimburseDate, setReimburseDate] = useState('');
  const [reimburseKey, setReimburseKey] = useState(newIdempotencyKey());

  const invalidate = () => utils.employeeExpenses.listClaims.invalidate();

  const approveMutation = trpc.employeeExpenses.approveClaim.useMutation({
    onSuccess: async () => {
      message.success('Expense claim approved.');
      setApproveTarget(null);
      setApproveNote('');
      setApproveKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const reimburseMutation = trpc.employeeExpenses.reimburseClaim.useMutation({
    onSuccess: async () => {
      message.success('Expense claim reimbursed.');
      setReimburseTarget(null);
      setReimburseBankAccountId(undefined);
      setReimburseDate('');
      setReimburseKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const rows = (list.data?.rows ?? []) as EmployeeExpenseClaimRow[];
  const total = list.data?.total ?? 0;

  const columns: ColumnsType<EmployeeExpenseClaimRow> = [
    { title: 'Employee', dataIndex: 'employeeName', key: 'employeeName' },
    {
      title: 'Claim',
      key: 'title',
      render: (_v, row) => (
        <div>
          <div className="font-semibold text-ink">{row.title}</div>
          <div className="text-[11.5px] text-muted">{row.expenseCategoryName}</div>
        </div>
      ),
    },
    { title: 'Project', key: 'projectName', render: (_v, row) => row.projectName ?? '—' },
    { title: 'Date', key: 'expenseDate', render: (_v, row) => formatDate(row.expenseDate) },
    { title: 'Amount', key: 'amount', align: 'right', render: (_v, row) => formatMoney(row.amount) },
    { title: 'Status', key: 'status', render: (_v, row) => <EmployeeExpenseClaimStatusTag status={row.status} /> },
    { title: 'Approval', key: 'approval', render: (_v, row) => <ClaimApprovalLine claim={row} /> },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_v, row) => (
        <div className="flex justify-end gap-2">
          {canApprove && row.status === 'SUBMITTED' && mayDecide(row, me?.userId) ? (
            <Button size="small" type="primary" onClick={() => setApproveTarget(row)}>
              Approve
            </Button>
          ) : null}
          {canReimburse && row.status === 'APPROVED' ? (
            <Button
              size="small"
              onClick={() => {
                setReimburseTarget(row);
                setReimburseDate(new Date().toISOString().slice(0, 10));
              }}
            >
              Reimburse
            </Button>
          ) : null}
          <Button size="small" onClick={() => router.push(`/employee-expenses/claims/${row.id}`)}>
            View
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Employee Reimbursements"
        description="Review employee expense claims, approve them for reimbursement, and settle payments."
        actions={
          canFileOwn || canApprove || canGiveAdvance ? (
            <div className="flex gap-2">
              {canFileOwn ? <Button onClick={() => router.push('/employee-expenses/my/new')}>Add My Expense</Button> : null}
              {canApprove ? <Button onClick={() => router.push('/employee-expenses/new')}>Add Expense for Employee</Button> : null}
              {canGiveAdvance ? (
                <Button type="primary" onClick={() => router.push('/employee-expenses/give-advance')}>
                  Give Advance
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-ui border border-ui border-t-[3px] border-t-warning bg-surface p-4 shadow-ui">
          <div className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">Pending Approval</div>
          <div className="mt-1.5 font-mono text-[20px] font-bold text-ink">{formatMoney(stats.data?.pendingApproval.amount ?? '0')}</div>
          <div className="mt-1 text-[11.5px] text-muted">{stats.data?.pendingApproval.count ?? 0} claims to review</div>
        </div>
        <div className="rounded-ui border border-ui border-t-[3px] border-t-information bg-surface p-4 shadow-ui">
          <div className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">Approved — To Pay</div>
          <div className="mt-1.5 font-mono text-[20px] font-bold text-ink">{formatMoney(stats.data?.approvedToPay.amount ?? '0')}</div>
          <div className="mt-1 text-[11.5px] text-muted">{stats.data?.approvedToPay.count ?? 0} claims ready</div>
        </div>
        <div className="rounded-ui border border-ui border-t-[3px] border-t-positive bg-surface p-4 shadow-ui">
          <div className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">Reimbursed{stats.data?.reimbursed.isCurrentFinancialYear ? ' (FY)' : ''}</div>
          <div className="mt-1.5 font-mono text-[20px] font-bold text-ink">{formatMoney(stats.data?.reimbursed.amount ?? '0')}</div>
          <div className="mt-1 text-[11.5px] text-muted">{stats.data?.reimbursed.count ?? 0} claims settled</div>
        </div>
        <div className="rounded-ui border border-ui border-t-[3px] border-t-negative bg-surface p-4 shadow-ui">
          <div className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">Advance Outstanding</div>
          <div className="mt-1.5 font-mono text-[20px] font-bold text-ink">{formatMoney(stats.data?.advanceOutstanding.amount ?? '0')}</div>
          <div className="mt-1 text-[11.5px] text-muted">held by {stats.data?.advanceOutstanding.employeeCount ?? 0} staff</div>
        </div>
      </div>

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
          <FilterField label="Employee">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="All"
              value={draftEmployeeId}
              onChange={setDraftEmployeeId}
              className="w-[200px]"
              loading={employees.isLoading}
              options={(employees.data ?? []).map((e) => ({ value: e.id, label: `${e.fullName} · ${e.employeeCode}` }))}
            />
          </FilterField>
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
            <Select allowClear placeholder="All" value={draftStatus} onChange={setDraftStatus} className="w-[180px]" options={STATUS_OPTIONS} />
          </FilterField>
          <FilterField label="Expense Date">
            <RangePicker
              value={draftExpenseRange ? [dayjs(draftExpenseRange[0]), dayjs(draftExpenseRange[1])] : null}
              onChange={(picked) => setDraftExpenseRange(completeIsoRange(picked))}
            />
          </FilterField>
          <FilterField label="Approved Date">
            <RangePicker
              value={draftApprovedRange ? [dayjs(draftApprovedRange[0]), dayjs(draftApprovedRange[1])] : null}
              onChange={(picked) => setDraftApprovedRange(completeIsoRange(picked))}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<EmployeeExpenseClaimRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load expense claims. Please retry.' : undefined}
          emptyTitle="No expense claims found"
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>

      <Modal
        title="Approve Expense Claim"
        open={!!approveTarget}
        onCancel={() => setApproveTarget(null)}
        onOk={() => approveTarget && approveMutation.mutate({ id: approveTarget.id, expectedVersion: approveTarget.version, note: approveNote.trim() || undefined, idempotencyKey: approveKey })}
        confirmLoading={approveMutation.isPending}
        okText="Approve"
      >
        <p className="mb-2 text-muted">
          This posts the expense against {approveTarget?.employeeName}&apos;s own wallet ({approveTarget ? formatMoney(approveTarget.amount) : ''}).
        </p>
        <p className="mb-2 text-muted">Note (required only if approving your own claim):</p>
        <Input.TextArea rows={3} value={approveNote} onChange={(e) => setApproveNote(e.target.value)} />
      </Modal>

      <Modal
        title="Reimburse Expense Claim"
        open={!!reimburseTarget}
        onCancel={() => setReimburseTarget(null)}
        onOk={() =>
          reimburseTarget &&
          reimburseBankAccountId &&
          reimburseMutation.mutate({ id: reimburseTarget.id, expectedVersion: reimburseTarget.version, bankAccountId: reimburseBankAccountId, reimbursementDate: reimburseDate, idempotencyKey: reimburseKey })
        }
        confirmLoading={reimburseMutation.isPending}
        okButtonProps={{ disabled: !reimburseBankAccountId || !reimburseDate }}
        okText="Reimburse"
      >
        <p className="mb-2 text-muted">
          Pay {reimburseTarget ? formatMoney(reimburseTarget.amount) : ''} to {reimburseTarget?.employeeName}.
        </p>
        <label className="mb-3 flex flex-col gap-[3px]">
          <span className="text-[12.5px] font-semibold text-text">Bank account</span>
          <BankAccountSelect value={reimburseBankAccountId} onChange={setReimburseBankAccountId} legalEntityId={reimburseTarget?.legalEntityId} />
        </label>
        <label className="flex flex-col gap-[3px]">
          <span className="text-[12.5px] font-semibold text-text">Reimbursement date</span>
          <DateInput value={reimburseDate} onChange={setReimburseDate} />
        </label>
      </Modal>
    </>
  );
}
