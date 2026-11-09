'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from 'antd';
import { PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import type { StatusTagTone } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { ClaimApprovalLine, EmployeeExpenseClaimStatusTag } from '../shared';
import { NoOwnWallet } from '../no-own-wallet';
import type { EmployeeWalletEntryType } from '@zitaware/contracts';

const ENTRY_TYPE_LABEL: Record<EmployeeWalletEntryType, string> = {
  ADVANCE: 'Advance',
  CLAIM: 'Claim',
  REIMBURSEMENT: 'Reimbursement',
  ADVANCE_REVERSAL: 'Advance Reversed',
  REIMBURSEMENT_REVERSAL: 'Reimbursement Reversed',
};
const ENTRY_TYPE_TONE: Record<EmployeeWalletEntryType, StatusTagTone> = {
  ADVANCE: 'info',
  CLAIM: 'warn',
  REIMBURSEMENT: 'pos',
  ADVANCE_REVERSAL: 'neg',
  REIMBURSEMENT_REVERSAL: 'neg',
};

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function MyExpensesPage() {
  const router = useRouter();
  const [month, setMonth] = useState(currentMonth());
  const [tab, setTab] = useState<'statement' | 'pending'>('statement');

  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canCreate = permissions.includes('employee_claim.create');
  const status = trpc.employeeExpenses.getMyEmployeeStatus.useQuery();
  const hasEmployee = status.data?.hasEmployee === true;
  const statement = trpc.employeeExpenses.getMyWalletStatement.useQuery({ month }, { enabled: hasEmployee });
  const myClaims = trpc.employeeExpenses.getMyClaims.useQuery(undefined, { enabled: hasEmployee });

  if (status.isLoading) return <PageHeader title="My Expenses" description="Loading…" />;
  if (!status.data || !status.data.hasEmployee) {
    return <NoOwnWallet title="My Expenses" />;
  }
  if (!status.data.isReimbursable) {
    return <PageHeader title="My Expenses" description="You are not marked as reimbursement-eligible — contact an administrator if this is unexpected." />;
  }

  const pendingClaims = (myClaims.data ?? []).filter((c) => c.status === 'DRAFT' || c.status === 'SUBMITTED');

  return (
    <>
      <PageHeader
        title="My Expenses"
        description="Your own wallet ledger — advances, expense claims, and reimbursements with a running balance."
        actions={
          canCreate ? (
            <Button type="primary" onClick={() => router.push('/employee-expenses/my/new')}>
              Add Expense
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex gap-1 border-b border-ui">
        <button
          className={`px-4 py-2.5 text-[13px] font-semibold border-b-2 ${tab === 'statement' ? 'border-brand text-ink' : 'border-transparent text-muted'}`}
          onClick={() => setTab('statement')}
        >
          Statement
        </button>
        <button
          className={`px-4 py-2.5 text-[13px] font-semibold border-b-2 ${tab === 'pending' ? 'border-brand text-ink' : 'border-transparent text-muted'}`}
          onClick={() => setTab('pending')}
        >
          Pending Claims ({pendingClaims.length})
        </button>
      </div>

      {tab === 'statement' ? (
        <>
          <UiCard className="mb-4">
            <div className="flex items-end gap-3">
              <label className="flex flex-col gap-[3px]">
                <span className="text-[10.5px] font-semibold uppercase tracking-[.04em] text-muted">Month</span>
                <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-[160px]" />
              </label>
            </div>
          </UiCard>

          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="rounded-ui border border-ui border-t-[3px] border-t-information bg-surface p-4 shadow-ui">
              <div className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">Advance Given</div>
              <div className="mt-1.5 font-mono text-[20px] font-bold text-ink">{formatMoney(statement.data?.totalAdvances ?? '0')}</div>
            </div>
            <div className="rounded-ui border border-ui border-t-[3px] border-t-warning bg-surface p-4 shadow-ui">
              <div className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">Claims (month)</div>
              <div className="mt-1.5 font-mono text-[20px] font-bold text-ink">{formatMoney(statement.data?.totalClaims ?? '0')}</div>
            </div>
            <div className="rounded-ui border border-ui border-t-[3px] border-t-positive bg-surface p-4 shadow-ui">
              <div className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">Reimbursed</div>
              <div className="mt-1.5 font-mono text-[20px] font-bold text-ink">{formatMoney(statement.data?.totalReimbursed ?? '0')}</div>
            </div>
            <div className="rounded-ui border border-ui border-t-[3px] border-t-information bg-surface p-4 shadow-ui">
              <div className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">Wallet Balance</div>
              <div className="mt-1.5 font-mono text-[20px] font-bold text-ink">{formatMoney(statement.data?.closingBalance ?? '0')}</div>
            </div>
          </div>

          <UiCard title={`Statement — ${month}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-ui text-left text-muted">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Particulars</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3 text-right">Debit</th>
                    <th className="py-2 pr-3 text-right">Credit</th>
                    <th className="py-2 pr-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-ui-2">
                    <td className="py-2 pr-3 text-muted" colSpan={5}>
                      Opening balance
                    </td>
                    <td className="py-2 pr-3 text-right font-mono font-semibold text-ink">{formatMoney(statement.data?.openingBalance ?? '0')}</td>
                  </tr>
                  {(statement.data?.entries ?? []).map((entry, index) => (
                    <tr key={index} className="border-b border-ui-2">
                      <td className="py-2 pr-3">{formatDate(entry.date)}</td>
                      <td className="py-2 pr-3">{entry.particulars}</td>
                      <td className="py-2 pr-3">
                        <StatusTag status={entry.type} label={ENTRY_TYPE_LABEL[entry.type]} tone={ENTRY_TYPE_TONE[entry.type]} />
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">{Number(entry.debit) > 0 ? formatMoney(entry.debit) : '—'}</td>
                      <td className="py-2 pr-3 text-right font-mono">{Number(entry.credit) > 0 ? formatMoney(entry.credit) : '—'}</td>
                      <td className="py-2 pr-3 text-right font-mono font-semibold text-ink">{formatMoney(entry.runningBalance)}</td>
                    </tr>
                  ))}
                  {(statement.data?.entries ?? []).length === 0 ? (
                    <tr>
                      <td className="py-4 text-center text-muted" colSpan={6}>
                        No activity this month.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </UiCard>

          <div className="mt-4 rounded-ui border border-ui bg-paper p-3 text-[12.5px] text-muted">
            A positive balance means you still hold unspent company advance. A negative balance means the company owes you — approved claims are settled once reimbursed.
          </div>
        </>
      ) : (
        <UiCard title="Submitted Expense Claims">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-ui text-left text-muted">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Title</th>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3">Linked To</th>
                  <th className="py-2 pr-3 text-right">Amount</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {pendingClaims.map((claim) => (
                  <tr key={claim.id} className="border-b border-ui-2">
                    <td className="py-2 pr-3">{formatDate(claim.expenseDate)}</td>
                    <td className="py-2 pr-3">{claim.title}</td>
                    <td className="py-2 pr-3">{claim.expenseCategoryName}</td>
                    <td className="py-2 pr-3">{claim.projectName ?? 'Company overhead'}</td>
                    <td className="py-2 pr-3 text-right">{formatMoney(claim.amount)}</td>
                    <td className="py-2 pr-3">
                      <EmployeeExpenseClaimStatusTag status={claim.status} />
                      <div className="mt-1">
                        <ClaimApprovalLine claim={claim} />
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Button size="small" onClick={() => router.push(`/employee-expenses/claims/${claim.id}`)}>
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
                {pendingClaims.length === 0 ? (
                  <tr>
                    <td className="py-4 text-center text-muted" colSpan={7}>
                      No pending claims.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </UiCard>
      )}
    </>
  );
}
