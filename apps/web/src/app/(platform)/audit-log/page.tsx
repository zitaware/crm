'use client';

import { useState } from 'react';
import dayjs from 'dayjs';
import { Button, Input, Select, Tooltip } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, UiCard } from '@zitaware/ui';
import { useRouter } from 'next/navigation';
import { trpc } from '@/server/trpc';
import { formatDateTime } from '@/lib/format';
import { completeIsoRange } from '@/lib/dates';

const { RangePicker } = DatePicker;

interface AuditEventRow {
  id: string;
  legalEntityId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  actorEmail: string | null;
  reason: string | null;
  oldValues: unknown;
  newValues: unknown;
  commandPayload: unknown;
  correlationId: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface Filters {
  actorEmail?: string;
  entityType?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
}

const PAGE_SIZE = 25;

export default function AuditLogPage() {
  const router = useRouter();
  const entityTypes = trpc.audit.listEntityTypes.useQuery();
  const actions = trpc.audit.listActions.useQuery();

  const [draftSearch, setDraftSearch] = useState('');
  const [draftEntityType, setDraftEntityType] = useState<string | undefined>(undefined);
  const [draftAction, setDraftAction] = useState<string | undefined>(undefined);
  const [draftRange, setDraftRange] = useState<[string, string] | null>(null);

  const [appliedFilters, setAppliedFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);

  const list = trpc.audit.list.useQuery({ page, pageSize: PAGE_SIZE, filters: appliedFilters });

  const applyFilters = () => {
    const trimmedSearch = draftSearch.trim();
    setAppliedFilters({
      ...(trimmedSearch ? { actorEmail: trimmedSearch } : {}),
      ...(draftEntityType ? { entityType: draftEntityType } : {}),
      ...(draftAction ? { action: draftAction } : {}),
      ...(draftRange ? { dateFrom: draftRange[0], dateTo: draftRange[1] } : {}),
    });
    setPage(1);
  };

  const resetFilters = () => {
    setDraftSearch('');
    setDraftEntityType(undefined);
    setDraftAction(undefined);
    setDraftRange(null);
    setAppliedFilters({});
    setPage(1);
  };

  const rows = (list.data?.rows ?? []) as AuditEventRow[];
  const total = list.data?.total ?? 0;

  const columns: ColumnsType<AuditEventRow> = [
    {
      title: 'Time',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (v: string) => formatDateTime(v),
    },
    { title: 'Actor', dataIndex: 'actorEmail', key: 'actorEmail', render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
    { title: 'Entity Type', dataIndex: 'entityType', key: 'entityType', width: 150 },
    {
      title: 'Entity ID',
      dataIndex: 'entityId',
      key: 'entityId',
      width: 140,
      render: (v: string) => (
        <Tooltip title={v}>
          <span className="font-mono text-[12px] text-muted">{v.slice(0, 8)}…</span>
        </Tooltip>
      ),
    },
    { title: 'Action', dataIndex: 'action', key: 'action', width: 220 },
    {
      title: 'Reason',
      dataIndex: 'reason',
      key: 'reason',
      render: (v: string | null) => v ?? <span className="text-muted-2">—</span>,
    },
    {
      title: '',
      key: 'actions',
      width: 110,
      align: 'right',
      render: (_v, row) => (
        <Button size="small" onClick={() => router.push(`/audit-log/${row.id}`)}>
          View Details
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit Log"
        description="Every change made across the platform — searchable by actor, entity, action and time."
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
          <FilterField label="Search Actor">
            <Input
              allowClear
              placeholder="Search by actor email…"
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              onPressEnter={applyFilters}
              className="w-[220px]"
            />
          </FilterField>
          <FilterField label="Entity Type">
            <Select
              allowClear
              placeholder="All"
              value={draftEntityType}
              onChange={setDraftEntityType}
              className="w-[160px]"
              options={(entityTypes.data ?? []).map((t) => ({ value: t, label: t }))}
            />
          </FilterField>
          <FilterField label="Action">
            <Select
              allowClear
              placeholder="All"
              value={draftAction}
              onChange={setDraftAction}
              className="w-[220px]"
              showSearch
              options={(actions.data ?? []).map((a) => ({ value: a, label: a }))}
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

        <EntityTable<AuditEventRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load the audit log. Please retry.' : undefined}
          emptyTitle="No audit events found"
          emptyDescription="Try adjusting or resetting the filters above."
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>
    </>
  );
}
