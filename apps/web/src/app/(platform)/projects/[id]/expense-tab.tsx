'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import dayjs from 'dayjs';
import { Button, Table, Tag } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import type { ColumnsType } from 'antd/es/table';
import { UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '../shared';
import type { ProjectExpenseCategory, ProjectExpenseRow } from '@zitaware/contracts';
import { completeIsoRange } from '@/lib/dates';

const { RangePicker } = DatePicker;

/** One descriptor per category, driving the chips, the tag colours and the
 * permission gating together. Adding a seventh category means adding one
 * entry here, not editing four separate places. */
const CATEGORIES: ReadonlyArray<{
  key: ProjectExpenseCategory;
  label: string;
  color: string;
  permission: string;
}> = [
  { key: 'PURCHASE', label: 'Purchase', color: 'blue', permission: 'vendor_bill.read' },
  { key: 'REIMBURSEMENT', label: 'Reimbursement', color: 'gold', permission: 'employee_claim.read' },
  { key: 'DIRECT_EXPENSE', label: 'Direct Expense', color: 'purple', permission: 'direct_expense.read' },
  { key: 'MATERIAL', label: 'Material', color: 'cyan', permission: 'inventory.read' },
  { key: 'MANPOWER', label: 'Manpower', color: 'geekblue', permission: 'project_cost.read' },
  { key: 'INTRODUCER', label: 'Introducer', color: 'magenta', permission: 'introducer_fee.read' },
];

export function canReadProjectSpend(permissions: readonly string[]): boolean {
  return CATEGORIES.some((category) => permissions.includes(category.permission));
}

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label])) as Record<ProjectExpenseCategory, string>;
const CATEGORY_TAG_COLOR = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.color])) as Record<ProjectExpenseCategory, string>;

/** Where a row's "View" goes. Manpower has no document at all — allocation
 * posts no journal — and consumption/accrual have no detail route yet, so
 * those land on their list page. Returns null when there is nowhere useful
 * to send the user, and the button is hidden instead of lying. */
function detailPath(row: ProjectExpenseRow): string | null {
  switch (row.linkType) {
    case 'VENDOR_BILL':
      return `/vendor-bills/${row.linkId}`;
    case 'DIRECT_EXPENSE':
      return `/direct-expenses/${row.linkId}`;
    case 'EMPLOYEE_EXPENSE_CLAIM':
      return `/employee-expenses/claims/${row.linkId}`;
    case 'INVENTORY_CONSUMPTION':
      return '/inventory';
    case 'INTRODUCER_ACCRUAL':
      return '/introducer-fees';
    case 'NONE':
      return null;
  }
}

/** Gross, per-transaction spend ledger, matching project-expense.html's own
 * tab — labeled "Spend" (not "Expense") since ADR-089 introduced a separate
 * "Recognized Expense" figure on the Financials tab that excludes
 * recoverable Input GST; this ledger deliberately keeps showing each
 * document's own gross total, matching what that document shows everywhere
 * else in the app. All six of the prototype's categories now have a real
 * backing source (ADR-097 closed ADR-086's four deferrals; Server and
 * Subscription arrive as Direct Expense, since their cycle payments post
 * through that service). All totals/percentages come from the server
 * (Decimal-safe) — this component never sums money client-side. */
export function ExpenseTab({ projectId }: { projectId: string }) {
  const router = useRouter();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const visibleCategories = CATEGORIES.filter((c) => permissions.includes(c.permission));

  const [category, setCategory] = useState<ProjectExpenseCategory | undefined>(undefined);
  const [range, setRange] = useState<[string, string] | null>(null);

  const ledger = trpc.projects.getExpenseLedger.useQuery({
    projectId,
    category,
    dateFrom: range?.[0],
    dateTo: range?.[1],
  });

  const rows = ledger.data?.rows ?? [];
  const categoryTotals = ledger.data?.categoryTotals ?? [];

  // categoryTotals is scoped to the active filter, so the only complete view
  // of which categories actually carry rows is an unfiltered read. This is
  // the same query with no filters — the state starts unfiltered, so on mount
  // it is the identical cache entry rather than a second request, and once a
  // filter is applied it keeps serving the complete list from that cache.
  const unfilteredLedger = trpc.projects.getExpenseLedger.useQuery({ projectId });
  const populated = unfilteredLedger.data?.categoryTotals.map((t) => t.category) ?? null;

  // Manpower is the one category this project no longer asks anyone to fill
  // (ADR-099 dropped per-project salary allocation), so an always-present
  // "Manpower · —" chip is a step that looks unfinished forever. It appears
  // only if allocations actually exist. Every other category stays visible at
  // zero, because those are things the business does do.
  const shownCategories = visibleCategories.filter(
    (c) => c.key !== 'MANPOWER' || populated === null || populated.includes('MANPOWER'),
  );
  const categoriesTracked = shownCategories.length;
  const largestCategoryTotal = categoryTotals.find((c) => c.category === ledger.data?.largestCategory)?.amount;

  const columns: ColumnsType<ProjectExpenseRow> = [
    { title: 'Date', dataIndex: 'date', key: 'date', render: (v: string) => formatDate(v) },
    { title: 'Category', key: 'category', render: (_v, row) => <Tag color={CATEGORY_TAG_COLOR[row.category]}>{CATEGORY_LABEL[row.category]}</Tag> },
    {
      title: 'Details',
      key: 'details',
      render: (_v, row) => (
        <div>
          <div className="font-semibold text-ink">{row.title}</div>
          <div className="text-[11.5px] text-muted">{row.subtitle}</div>
        </div>
      ),
    },
    { title: 'Amount', key: 'amount', align: 'right', render: (_v, row) => <span className="font-mono text-negative">{formatMoney(row.amount)}</span> },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_v, row) => {
        const path = detailPath(row);
        return path ? (
          <Button size="small" onClick={() => router.push(path)}>
            View
          </Button>
        ) : null;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-ui border border-ui border-t-[3px] border-t-negative bg-surface p-4 shadow-ui">
          <div className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">Total Spend</div>
          <div className="mt-1.5 font-mono text-[20px] font-bold text-negative">{formatMoney(ledger.data?.totalAmount ?? '0')}</div>
          <div className="mt-1 text-[11.5px] text-muted">all tracked categories, gross</div>
        </div>
        <div className="rounded-ui border border-ui bg-surface p-4 shadow-ui">
          <div className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">Largest Head</div>
          <div className="mt-1.5 text-[20px] font-bold text-ink">{ledger.data?.largestCategory ? CATEGORY_LABEL[ledger.data.largestCategory] : '—'}</div>
          <div className="mt-1 text-[11.5px] text-muted">
            {ledger.data?.largestCategory ? `${formatMoney(largestCategoryTotal ?? '0')} · ${ledger.data.largestCategoryPercent}%` : 'No expenses yet'}
          </div>
        </div>
        <div className="rounded-ui border border-ui bg-surface p-4 shadow-ui">
          <div className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">Entries</div>
          <div className="mt-1.5 font-mono text-[20px] font-bold text-ink">{rows.length}</div>
          <div className="mt-1 text-[11.5px] text-muted">across {categoriesTracked} categories</div>
        </div>
      </div>

      <UiCard
        title="Project Spend"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {shownCategories.map((c) => {
              const total = categoryTotals.find((t) => t.category === c.key);
              return (
                <Tag
                  key={c.key}
                  color={category === c.key ? c.color : 'default'}
                  className="cursor-pointer"
                  onClick={() => setCategory(category === c.key ? undefined : c.key)}
                >
                  {c.label}
                  {total ? ` · ${formatMoney(total.amount)}` : ''}
                </Tag>
              );
            })}
            <RangePicker
              value={range ? [dayjs(range[0]), dayjs(range[1])] : null}
              onChange={(picked) => setRange(completeIsoRange(picked))}
            />
          </div>
        }
      >
        <Table<ProjectExpenseRow>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={rows}
          loading={ledger.isLoading}
          pagination={false}
          tableLayout="auto"
          scroll={{ x: true }}
          locale={{ emptyText: 'No expenses recorded for this project yet.' }}
          summary={() =>
            rows.length > 0 ? (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={3} align="right">
                    <b>Total (filtered)</b>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <span className="font-mono font-bold text-negative">{formatMoney(ledger.data?.totalAmount ?? '0')}</span>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} />
                </Table.Summary.Row>
              </Table.Summary>
            ) : null
          }
        />
      </UiCard>

      <div className="flex items-start gap-2 rounded-ui border border-ui bg-paper p-3 text-[12.5px] text-muted">
        <span>
          This tab shows gross, per-transaction spend for this project — <b>Purchase</b> (finalized Vendor Bills), <b>Reimbursement</b> (approved/reimbursed
          Employee Expense Claims), <b>Direct Expense</b> (posted Direct Expenses, including Server and Subscription cycle payments), <b>Material</b> (stock
          issued, at weighted-average cost), <b>Manpower</b> (imported gross salary × allocation %, submitted months only) and <b>Introducer</b> (accrued
          commission). Manpower is an analytical derivation rather than a document, so its rows have nothing to open. A vendor bill&apos;s stock lines are
          not Purchase: they become inventory, and appear under <b>Material</b> when issued to the project. See the <b>Financials</b> tab for a cost
          figure that excludes recoverable Input GST.
        </span>
      </div>
    </div>
  );
}
