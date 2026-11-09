'use client';

import { useState } from 'react';
import dayjs from 'dayjs';
import { App, Button, Input, Modal, Select } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { useRouter } from 'next/navigation';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { DateInput } from '@/components/date-input';
import { completeIsoRange } from '@/lib/dates';

const { RangePicker } = DatePicker;

function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

interface JournalEntryRow {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  accountingDate: string;
  accountingPeriodId: string;
  sourceType: string;
  sourceId: string;
  postingEvent: string;
  description: string | null;
  status: 'DRAFT' | 'POSTED' | 'REVERSED';
  totalAmount: string;
  postedAt: string;
  reversalOfJournalEntryId: string | null;
  reversedByJournalEntryId: string | null;
  reversalReason: string | null;
  reversedBy: string | null;
  reversedAt: string | null;
}

interface Filters {
  legalEntityId?: string;
  sourceType?: string;
  dateFrom?: string;
  dateTo?: string;
}

const PAGE_SIZE = 25;

function ReverseJournalModal({
  target,
  onClose,
  onSuccess,
}: {
  target: JournalEntryRow | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { message } = App.useApp();
  const [reason, setReason] = useState('');
  const [accountingDate, setAccountingDate] = useState(todayDateStr());
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey());

  const reverseMutation = trpc.journal.reverseJournal.useMutation({
    onSuccess: () => {
      message.success('Journal entry reversed.');
      reset();
      onSuccess();
    },
    onError: (error) => message.error(error.message),
  });

  function reset() {
    setReason('');
    setAccountingDate(todayDateStr());
    setIdempotencyKey(newIdempotencyKey());
  }

  if (!target) return null;

  const submit = () => {
    if (!reason.trim()) return;
    reverseMutation.mutate({ id: target.id, accountingDate, reason: reason.trim(), idempotencyKey });
  };

  return (
    <Modal
      open
      title={`Reverse Journal Entry — ${target.postingEvent}`}
      onCancel={() => {
        reset();
        onClose();
      }}
      onOk={submit}
      confirmLoading={reverseMutation.isPending}
      okButtonProps={{ disabled: !reason.trim() }}
      okText="Reverse Entry"
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">
          This creates a new, opposite-signed journal entry referencing this one and marks this entry as reversed. The
          original entry and its lines are never edited or deleted.
        </p>
        <label className="flex flex-col gap-[3px]">
          <span className="text-[12.5px] font-semibold text-text">Reason</span>
          <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required" />
        </label>
        <label className="flex flex-col gap-[3px]">
          <span className="text-[12.5px] font-semibold text-text">Accounting date</span>
          <DateInput value={accountingDate} onChange={setAccountingDate} />
        </label>
      </div>
    </Modal>
  );
}

export default function JournalEntriesPage() {
  const router = useRouter();
  const me = trpc.auth.me.useQuery();
  const canReverse = (me.data?.permissions ?? []).includes('journal.reverse');

  const legalEntities = trpc.legalEntities.list.useQuery({ includeInactive: true });

  const [draftLegalEntityId, setDraftLegalEntityId] = useState<string | undefined>(undefined);
  const [draftSourceType, setDraftSourceType] = useState('');
  const [draftRange, setDraftRange] = useState<[string, string] | null>(null);

  const [appliedFilters, setAppliedFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [reversingTarget, setReversingTarget] = useState<JournalEntryRow | null>(null);

  const utils = trpc.useUtils();
  const list = trpc.journal.listEntries.useQuery({ page, pageSize: PAGE_SIZE, filters: appliedFilters });
  const invalidate = () => {
    void utils.journal.listEntries.invalidate();
    void utils.journal.getEntryDetail.invalidate();
  };

  const applyFilters = () => {
    const trimmedSourceType = draftSourceType.trim();
    setAppliedFilters({
      ...(draftLegalEntityId ? { legalEntityId: draftLegalEntityId } : {}),
      ...(trimmedSourceType ? { sourceType: trimmedSourceType } : {}),
      ...(draftRange ? { dateFrom: draftRange[0], dateTo: draftRange[1] } : {}),
    });
    setPage(1);
  };

  const resetFilters = () => {
    setDraftLegalEntityId(undefined);
    setDraftSourceType('');
    setDraftRange(null);
    setAppliedFilters({});
    setPage(1);
  };

  const rows = (list.data?.rows ?? []) as JournalEntryRow[];
  const total = list.data?.total ?? 0;

  const columns: ColumnsType<JournalEntryRow> = [
    { title: 'Accounting Date', dataIndex: 'accountingDate', key: 'accountingDate', width: 140, render: (v: string) => formatDate(v) },
    { title: 'Legal Entity', dataIndex: 'legalEntityName', key: 'legalEntityName' },
    {
      title: 'Source',
      key: 'source',
      render: (_v, row) => (
        <div>
          <div className="text-ink">{row.sourceType}</div>
          <div className="text-[11.5px] text-muted">{row.sourceId.slice(0, 8)}…</div>
        </div>
      ),
    },
    { title: 'Posting Event', dataIndex: 'postingEvent', key: 'postingEvent' },
    { title: 'Total Amount', dataIndex: 'totalAmount', key: 'totalAmount', align: 'right', render: (v: string) => formatMoney(v) },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (v: string) => <StatusTag status={v} {...(v === 'REVERSED' ? { tone: 'neg' as const } : {})} />,
    },
    {
      title: '',
      key: 'actions',
      width: 220,
      align: 'right',
      render: (_v, row) => (
        <div className="flex justify-end gap-2">
          <Button size="small" onClick={() => router.push(`/journal-entries/${row.id}`)}>
            View Lines
          </Button>
          {row.status === 'POSTED' && canReverse ? (
            <Button size="small" onClick={() => setReversingTarget(row)}>
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
        title="Journal Entries"
        description="Every posted accounting entry — read-only, with a full line-level drill-down to its source event."
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
          <FilterField label="Legal Entity">
            <Select
              allowClear
              placeholder="All"
              value={draftLegalEntityId}
              onChange={setDraftLegalEntityId}
              className="w-[220px]"
              options={(legalEntities.data ?? []).map((e) => ({ value: e.id, label: e.legalName }))}
            />
          </FilterField>
          <FilterField label="Source Type">
            <Input
              allowClear
              placeholder="e.g. ADJ"
              value={draftSourceType}
              onChange={(e) => setDraftSourceType(e.target.value)}
              onPressEnter={applyFilters}
              className="w-[180px]"
            />
          </FilterField>
          <FilterField label="Date Range">
            <RangePicker
              value={draftRange ? [dayjs(draftRange[0]), dayjs(draftRange[1])] : null}
              onChange={(picked) => {
                setDraftRange(completeIsoRange(picked));
              }}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<JournalEntryRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load journal entries. Please retry.' : undefined}
          emptyTitle="No journal entries found"
          emptyDescription="Postings will appear here once a business event creates one."
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>

      <ReverseJournalModal
        target={reversingTarget}
        onClose={() => setReversingTarget(null)}
        onSuccess={() => {
          setReversingTarget(null);
          invalidate();
        }}
      />
    </>
  );
}
