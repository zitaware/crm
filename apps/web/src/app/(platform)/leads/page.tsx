'use client';

import { useMemo, useState } from 'react';
import { Button, Input, Select } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, UiCard } from '@zitaware/ui';
import { useRouter } from 'next/navigation';
import { trpc } from '@/server/trpc';
import { MasterSelect } from '@/components/master-select';
import { formatDate, formatMoney, StageBadge, STAGE_OPTIONS } from './shared';
import { completeIsoRange } from '@/lib/dates';

interface LeadRow {
  id: string;
  clientId: string;
  clientName: string;
  leadTypeId: string;
  leadTypeName: string;
  leadSourceId: string;
  leadSourceName: string;
  introducerId: string | null;
  introducerName: string | null;
  assignedToEmployeeId: string | null;
  assignedToEmployeeName: string | null;
  title: string;
  description: string | null;
  stage: string;
  estimatedValue: string | null;
  leadDate: string;
  expectedCloseDate: string | null;
  expectedTenderDate: string | null;
  reminderOffset: string | null;
  internalNote: string | null;
  lastActivityAt: string;
  createdAt: string;
  version: number;
}

const PAGE_SIZE = 25;

export default function LeadsPage() {
  const router = useRouter();
  const me = trpc.auth.me.useQuery();
  const canCreate = (me.data?.permissions ?? []).includes('lead.create');

  const list = trpc.leads.list.useQuery();
  const clientsList = trpc.clients.list.useQuery({ includeInactive: true });
  const introducersList = trpc.introducers.list.useQuery({ includeInactive: true });

  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<string | undefined>(undefined);
  const [leadTypeFilter, setLeadTypeFilter] = useState<string | undefined>(undefined);
  const [introducerFilter, setIntroducerFilter] = useState<string | undefined>(undefined);
  const [stageFilter, setStageFilter] = useState<string | undefined>(undefined);
  const [createdRange, setCreatedRange] = useState<[string, string] | undefined>(undefined);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const rows = (list.data ?? []) as LeadRow[];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (clientFilter && row.clientId !== clientFilter) return false;
      if (leadTypeFilter && row.leadTypeId !== leadTypeFilter) return false;
      if (introducerFilter && row.introducerId !== introducerFilter) return false;
      if (stageFilter && row.stage !== stageFilter) return false;
      if (createdRange) {
        const created = row.createdAt.slice(0, 10);
        if (created < createdRange[0] || created > createdRange[1]) return false;
      }
      if (!q) return true;
      return row.title.toLowerCase().includes(q) || (row.description ?? '').toLowerCase().includes(q);
    });
  }, [list.data, search, clientFilter, leadTypeFilter, introducerFilter, stageFilter, createdRange]);

  const columns: ColumnsType<LeadRow> = [
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      render: (v: string, row) => (
        <button type="button" className="text-left font-semibold text-ink hover:text-brand" onClick={() => router.push(`/leads/${row.id}`)}>
          <div>{v}</div>
          {row.description ? <div className="text-[12.5px] font-normal text-muted line-clamp-1">{row.description}</div> : null}
          <div className="text-[11.5px] font-normal text-muted">
            {row.clientName}
            {row.leadTypeName ? ` · ${row.leadTypeName}` : ''}
          </div>
        </button>
      ),
    },
    { title: 'Stage', dataIndex: 'stage', key: 'stage', render: (v: string) => <StageBadge stage={v} /> },
    {
      title: 'Contract value',
      dataIndex: 'estimatedValue',
      key: 'estimatedValue',
      align: 'right',
      render: (v: string | null) => <span className="tabular-nums">{formatMoney(v)}</span>,
    },
    {
      title: 'People',
      key: 'people',
      render: (_v, row) => (
        <div className="text-[12.5px]">
          <div>
            <span className="text-muted">Assigned</span> {row.assignedToEmployeeName ?? '—'}
          </div>
          <div>
            <span className="text-muted">Introducer</span> {row.introducerName ?? '—'}
          </div>
        </div>
      ),
    },
    {
      title: 'Last Update',
      dataIndex: 'lastActivityAt',
      key: 'lastActivityAt',
      render: (v: string) => <span className="text-[12.5px] text-muted">{formatDate(v)}</span>,
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      align: 'right',
      render: (_v, row) => (
        <Button size="small" onClick={() => router.push(`/leads/${row.id}`)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Leads"
        description="Every lead in one list. Mark Won to create the project."
        actions={
          canCreate ? (
            <Button type="primary" onClick={() => router.push('/leads/new')}>
              Add
            </Button>
          ) : undefined
        }
      />

      <UiCard flush>
        <FilterCard
          actions={
            <Button
              onClick={() => {
                setSearch('');
                setClientFilter(undefined);
                setLeadTypeFilter(undefined);
                setIntroducerFilter(undefined);
                setStageFilter(undefined);
                setCreatedRange(undefined);
                setPage(1);
              }}
            >
              Reset
            </Button>
          }
        >
          <FilterField label="Search">
            <Input
              allowClear
              placeholder="Search titles…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-[220px]"
            />
          </FilterField>
          <FilterField label="Client">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              value={clientFilter}
              onChange={(v) => {
                setClientFilter(v);
                setPage(1);
              }}
              placeholder="All clients"
              className="w-[180px]"
              options={(clientsList.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
          </FilterField>
          <FilterField label="Type">
            <MasterSelect
              type="lead_types"
              includeInactive
              allowClear
              value={leadTypeFilter}
              onChange={(v) => {
                setLeadTypeFilter(v);
                setPage(1);
              }}
              placeholder="All types"
              className="w-[170px]"
            />
          </FilterField>
          <FilterField label="Introducer">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              value={introducerFilter}
              onChange={(v) => {
                setIntroducerFilter(v);
                setPage(1);
              }}
              placeholder="All introducers"
              className="w-[170px]"
              options={(introducersList.data ?? []).map((i) => ({ value: i.id, label: i.name }))}
            />
          </FilterField>
          <FilterField label="Stage">
            <Select
              allowClear
              value={stageFilter}
              onChange={(v) => {
                setStageFilter(v);
                setPage(1);
              }}
              placeholder="All stages"
              className="w-[170px]"
              options={STAGE_OPTIONS}
            />
          </FilterField>
          <FilterField label="Created between">
            <DatePicker.RangePicker
              onChange={(picked) => {
                setCreatedRange(completeIsoRange(picked) ?? undefined);
                setPage(1);
              }}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<LeadRow>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load this list. Please retry.' : undefined}
          emptyTitle="Nothing here yet"
          emptyDescription={canCreate ? 'Use Add to record a lead.' : undefined}
          page={page}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>
    </>
  );
}
