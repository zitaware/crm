'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import dayjs from 'dayjs';
import { Button, Segmented, Select } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { completeIsoRange } from '@/lib/dates';
import { DirectExpenseStatusTag, SPEND_TYPE_LABEL, type DirectExpenseRow, type DirectExpenseSpendType } from '../direct-expenses/shared';
import { ImportServerSubscriptionsModal } from './import-modal';
import { ReverseBillModal } from './reverse-modal';

const { RangePicker } = DatePicker;
const PAGE_SIZE = 25;

type TypeFilter = DirectExpenseSpendType | 'ANY';

interface Filters {
  projectId?: string | undefined;
  expenseDateFrom?: string | undefined;
  expenseDateTo?: string | undefined;
}

/**
 * Server and subscription bills (ADR-169): direct expenses tagged Server or
 * Subscription, brought in from the monthly Excel sheet or added one at a
 * time. A posted bill is never edited or deleted: it is corrected (reversed
 * and posted again) or reversed.
 */
export default function ServersSubscriptionsPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canImport = permissions.includes('direct_expense.post');
  const canReverse = permissions.includes('direct_expense.reverse');
  const canCorrect = canImport && canReverse;

  const [type, setType] = useState<TypeFilter>('ANY');
  const [draftProjectId, setDraftProjectId] = useState<string | undefined>(undefined);
  const [draftRange, setDraftRange] = useState<[string, string] | null>(null);
  const [applied, setApplied] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const [status, setStatus] = useState<'POSTED' | 'REVERSED' | 'ANY'>('POSTED');
  const [reversing, setReversing] = useState<DirectExpenseRow | null>(null);

  const list = trpc.directExpenses.list.useQuery({ page, pageSize: PAGE_SIZE, filters: { ...applied, spendType: type, ...(status === 'ANY' ? {} : { status }) } });
  const refresh = async () => await utils.directExpenses.list.invalidate();
  const projects = trpc.projects.list.useQuery();
  const rows = (list.data?.rows ?? []) as DirectExpenseRow[];

  const columns: ColumnsType<DirectExpenseRow> = [
    { title: 'Date', key: 'expenseDate', width: 110, render: (_v, row) => formatDate(row.expenseDate) },
    {
      title: 'Name',
      key: 'title',
      render: (_v, row) => (
        <div>
          <div className="font-semibold text-ink">{row.title}</div>
          <div className="text-[11.5px] text-muted">{[row.spendType ? SPEND_TYPE_LABEL[row.spendType] : null, row.expenseCategoryName].filter(Boolean).join(' · ')}</div>
        </div>
      ),
    },
    { title: 'Employee', key: 'employee', render: (_v, row) => row.purchasedByEmployeeName ?? '—' },
    {
      title: 'Charged to',
      key: 'project',
      render: (_v, row) => (
        <div>
          <div className="text-ink">{row.projectName ?? 'Company overhead'}</div>
          <div className="text-[11.5px] text-muted">{row.legalEntityName}</div>
        </div>
      ),
    },
    {
      title: 'Paid by',
      key: 'paidBy',
      render: (_v, row) => (
        <div>
          <div className="text-ink">{row.paymentModeLabel}</div>
          <div className="text-[11.5px] text-muted">{row.cardAccountLabel ?? row.bankAccountName ?? ''}</div>
        </div>
      ),
    },
    {
      title: 'Amount',
      key: 'amount',
      align: 'right',
      render: (_v, row) => (
        <div className="whitespace-nowrap tabular-nums">
          <div className="font-semibold text-ink">{formatMoney(row.amount)}</div>
        </div>
      ),
    },
    {
      title: 'Bill',
      key: 'bill',
      render: (_v, row) => (
        <div className="flex items-center gap-2 whitespace-nowrap">
          {row.billUrl ? (
            <a href={row.billUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
              Open link
            </a>
          ) : null}
          <Link href={`/servers-subscriptions/${row.id}`} className="text-brand hover:underline">
            Files
          </Link>
        </div>
      ),
    },
    { title: 'Status', key: 'status', width: 110, render: (_v, row) => <DirectExpenseStatusTag status={row.status} /> },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_v, row) => (
        <div className="flex justify-end gap-2">
          <Button size="small" onClick={() => router.push(`/servers-subscriptions/${row.id}`)}>
            View
          </Button>
          {canCorrect && row.status === 'POSTED' ? (
            <Button size="small" onClick={() => router.push(`/servers-subscriptions/${row.id}/correct`)}>
              Correct
            </Button>
          ) : null}
          {canReverse && row.status === 'POSTED' ? (
            <Button size="small" danger onClick={() => setReversing(row)}>
              Reverse
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Servers & Subscriptions"
        description="Server and subscription bills, imported from the monthly Excel sheet and posted as direct expenses. Each one shows on its project's expense."
        actions={
          canImport ? (
            <div className="flex gap-2">
              <Button onClick={() => router.push('/servers-subscriptions/new')}>Add bill</Button>
              <Button type="primary" onClick={() => setImportOpen(true)}>
                Import Excel
              </Button>
            </div>
          ) : undefined
        }
      />

      <UiCard flush>
        <FilterCard
          actions={
            <>
              <Button
                onClick={() => {
                  setDraftProjectId(undefined);
                  setDraftRange(null);
                  setApplied({});
                  setPage(1);
                }}
              >
                Reset
              </Button>
              <Button
                type="primary"
                onClick={() => {
                  setApplied({ projectId: draftProjectId, expenseDateFrom: draftRange?.[0], expenseDateTo: draftRange?.[1] });
                  setPage(1);
                }}
              >
                Apply
              </Button>
            </>
          }
        >
          <FilterField label="Type">
            <Segmented<TypeFilter>
              value={type}
              onChange={(v) => {
                setType(v);
                setPage(1);
              }}
              options={[
                { value: 'ANY', label: 'All' },
                { value: 'SERVER', label: 'Server' },
                { value: 'SUBSCRIPTION', label: 'Subscription' },
              ]}
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
              className="w-[220px]"
              loading={projects.isLoading}
              options={[...(projects.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.name }))}
            />
          </FilterField>
          <FilterField label="Status">
            <Segmented<'POSTED' | 'REVERSED' | 'ANY'>
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              options={[
                { value: 'POSTED', label: 'Posted' },
                { value: 'REVERSED', label: 'Reversed' },
                { value: 'ANY', label: 'All' },
              ]}
            />
          </FilterField>
          <FilterField label="Date">
            <RangePicker
              format="DD/MM/YYYY"
              value={draftRange ? [dayjs(draftRange[0]), dayjs(draftRange[1])] : null}
              onChange={(picked) => setDraftRange(completeIsoRange(picked))}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<DirectExpenseRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load server and subscription bills. Please retry.' : undefined}
          emptyTitle="No server or subscription bills yet"
          emptyDescription={canImport ? 'Use "Import Excel" to bring in the sheet.' : undefined}
          page={page}
          pageSize={PAGE_SIZE}
          total={list.data?.total ?? 0}
          onPageChange={setPage}
        />
      </UiCard>

      <ImportServerSubscriptionsModal open={importOpen} onClose={() => setImportOpen(false)} onImported={refresh} />
      {reversing ? <ReverseBillModal key={reversing.id} bill={reversing} onClose={() => setReversing(null)} onReversed={refresh} /> : null}
    </>
  );
}
