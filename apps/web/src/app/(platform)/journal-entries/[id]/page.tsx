'use client';

import { useParams, useRouter } from 'next/navigation';
import { Button, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';

interface JournalLineRow {
  id: string;
  ledgerAccountCode: string;
  ledgerAccountName: string;
  debitAmount: string;
  creditAmount: string;
  projectName: string | null;
  partyName: string | null;
  employeeName: string | null;
  narrative: string | null;
}

export default function JournalEntryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const entryId = String(params.id ?? '');

  const detail = trpc.journal.getEntryDetail.useQuery({ id: entryId }, { enabled: !!entryId });
  const lines = (detail.data?.lines ?? []) as JournalLineRow[];

  const columns: ColumnsType<JournalLineRow> = [
    {
      title: 'Ledger Account',
      key: 'account',
      render: (_v, row) => (
        <div>
          <div className="font-medium text-ink">{row.ledgerAccountName}</div>
          <div className="text-[11.5px] text-muted">{row.ledgerAccountCode}</div>
        </div>
      ),
    },
    { title: 'Debit', dataIndex: 'debitAmount', key: 'debitAmount', align: 'right', render: (v: string) => (Number(v) > 0 ? formatMoney(v) : '—') },
    { title: 'Credit', dataIndex: 'creditAmount', key: 'creditAmount', align: 'right', render: (v: string) => (Number(v) > 0 ? formatMoney(v) : '—') },
    {
      title: 'Dimensions',
      key: 'dimensions',
      render: (_v, row) => {
        const parts = [row.projectName, row.partyName, row.employeeName].filter(Boolean);
        return parts.length > 0 ? parts.join(' · ') : <span className="text-muted-2">—</span>;
      },
    },
    { title: 'Narrative', dataIndex: 'narrative', key: 'narrative', render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
  ];

  if (detail.isError) {
    return (
      <>
        <PageHeader title="Journal Entry" description="Could not load this journal entry." />
      </>
    );
  }
  if (detail.isLoading || !detail.data) {
    return (
      <>
        <PageHeader title="Journal Entry" description="Loading…" />
      </>
    );
  }

  const data = detail.data;

  return (
    <>
      <PageHeader
        title={`Journal Entry — ${data.postingEvent}`}
        actions={<Button onClick={() => router.push('/journal-entries')}>Back to List</Button>}
      />

      <UiCard className="mb-4">
        <div className="grid grid-cols-2 gap-2 text-[13px]">
          <span className="text-muted">Accounting Date</span>
          <span className="text-text">{formatDate(data.accountingDate)}</span>
          <span className="text-muted">Legal Entity</span>
          <span className="text-text">{data.legalEntityName}</span>
          <span className="text-muted">Source</span>
          <span className="text-text">
            {data.sourceType} <span className="text-muted-2">({data.sourceId.slice(0, 8)}…)</span>
          </span>
          <span className="text-muted">Posting Event</span>
          <span className="text-text">{data.postingEvent}</span>
          <span className="text-muted">Status</span>
          <span>
            <StatusTag status={data.status} {...(data.status === 'REVERSED' ? { tone: 'neg' as const } : {})} />
          </span>
          {data.description ? (
            <>
              <span className="text-muted">Description</span>
              <span className="text-text">{data.description}</span>
            </>
          ) : null}
          {data.reversalOfJournalEntryId ? (
            <>
              <span className="text-muted">Reversal Of</span>
              <span className="text-text">
                <Button size="small" onClick={() => router.push(`/journal-entries/${data.reversalOfJournalEntryId}`)}>
                  View original entry
                </Button>
              </span>
            </>
          ) : null}
          {data.status === 'REVERSED' ? (
            <>
              <span className="text-muted">Reversed On</span>
              <span className="text-text">{data.reversedAt ? formatDate(data.reversedAt) : '—'}</span>
              <span className="text-muted">Reversal Reason</span>
              <span className="text-text">{data.reversalReason ?? '—'}</span>
              {data.reversedByJournalEntryId ? (
                <>
                  <span className="text-muted">Reversing Entry</span>
                  <span className="text-text">
                    <Button size="small" onClick={() => router.push(`/journal-entries/${data.reversedByJournalEntryId}`)}>
                      View reversal entry
                    </Button>
                  </span>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </UiCard>

      <UiCard title="Lines" flush>
        <Table<JournalLineRow> rowKey="id" size="small" columns={columns} dataSource={lines} pagination={false} tableLayout="auto"
          scroll={{ x: true }} />
      </UiCard>
    </>
  );
}
