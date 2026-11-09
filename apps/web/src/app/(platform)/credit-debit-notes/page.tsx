'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { CreditDebitNoteStatusTag, CreditDebitNoteTypeTag, IssueCreditDebitNoteModal, type CreditDebitNoteRow } from './shared';

interface Filters {
  projectId?: string | undefined;
  type?: 'CREDIT' | 'DEBIT' | undefined;
  status?: 'DRAFT' | 'FINALIZED' | 'VOID' | undefined;
}

const PAGE_SIZE = 25;

export default function CreditDebitNotesPage() {
  const router = useRouter();
  const projects = trpc.projects.list.useQuery();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canIssue = permissions.includes('credit_debit_note.create');

  const [draftProjectId, setDraftProjectId] = useState<string | undefined>(undefined);
  const [draftType, setDraftType] = useState<Filters['type']>(undefined);
  const [draftStatus, setDraftStatus] = useState<Filters['status']>(undefined);
  const [appliedFilters, setAppliedFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [issueOpen, setIssueOpen] = useState(false);

  const list = trpc.creditDebitNotes.list.useQuery({ page, pageSize: PAGE_SIZE, filters: appliedFilters });

  const applyFilters = () => {
    setAppliedFilters({ projectId: draftProjectId, type: draftType, status: draftStatus });
    setPage(1);
  };
  const resetFilters = () => {
    setDraftProjectId(undefined);
    setDraftType(undefined);
    setDraftStatus(undefined);
    setAppliedFilters({});
    setPage(1);
  };

  const rows = (list.data?.rows ?? []) as CreditDebitNoteRow[];
  const total = list.data?.total ?? 0;

  const columns: ColumnsType<CreditDebitNoteRow> = [
    {
      title: 'Note No.',
      key: 'noteNumber',
      render: (_v, row) => row.noteNumber ?? <span className="text-muted-2">Draft</span>,
    },
    { title: 'Type', key: 'type', render: (_v, row) => <CreditDebitNoteTypeTag type={row.type} /> },
    {
      title: 'Against invoice',
      key: 'invoice',
      render: (_v, row) => (
        <div>
          <div>{row.invoiceNumber ?? '—'}</div>
          <div className="text-[11.5px] text-muted">{row.projectName}</div>
        </div>
      ),
    },
    { title: 'Date', dataIndex: 'noteDate', key: 'noteDate', render: (v: string | null) => (v ? formatDate(v) : '—') },
    { title: 'Total', dataIndex: 'totalAmount', key: 'totalAmount', align: 'right', render: (v: string | null) => formatMoney(v) },
    { title: 'Status', key: 'status', render: (_v, row) => <CreditDebitNoteStatusTag status={row.status} /> },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_v, row) => (
        <Button size="small" onClick={() => router.push(`/projects/${row.projectId}/invoices/${row.invoiceId}/credit-debit-notes/${row.id}`)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Credit / Debit Notes"
        description="Corrections against already-finalized invoices. Every note originates from a specific finalized invoice — issue from the invoice's own page or via Add here."
        actions={
          canIssue ? (
            <Button type="primary" onClick={() => setIssueOpen(true)}>
              Add Credit / Debit Note
            </Button>
          ) : undefined
        }
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
          <FilterField label="Project">
            <Select
              allowClear
              placeholder="All projects"
              value={draftProjectId}
              onChange={setDraftProjectId}
              className="w-[220px]"
              options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          </FilterField>
          <FilterField label="Type">
            <Select
              allowClear
              placeholder="All"
              value={draftType}
              onChange={setDraftType}
              className="w-[160px]"
              options={[
                { value: 'CREDIT', label: 'Credit Note' },
                { value: 'DEBIT', label: 'Debit Note' },
              ]}
            />
          </FilterField>
          <FilterField label="Status">
            <Select
              allowClear
              placeholder="All"
              value={draftStatus}
              onChange={setDraftStatus}
              className="w-[140px]"
              options={[
                { value: 'DRAFT', label: 'Draft' },
                { value: 'FINALIZED', label: 'Finalized' },
                { value: 'VOID', label: 'Void' },
              ]}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<CreditDebitNoteRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load credit/debit notes. Please retry.' : undefined}
          emptyTitle="No credit/debit notes found"
          emptyDescription="Corrections issued against finalized invoices will appear here."
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>

      <IssueCreditDebitNoteModal open={issueOpen} onClose={() => setIssueOpen(false)} />
    </>
  );
}
