'use client';

import { useMemo, useState } from 'react';
import { Button, Input, Select } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, MoneyText, PageHeader, UiCard } from '@zitaware/ui';
import { useRouter } from 'next/navigation';
import { trpc } from '@/server/trpc';
import { MasterSelect } from '@/components/master-select';
import { absMoney, formatMoney, isCreditBalance, STAGE_OPTIONS, STATUS_OPTIONS, StageBadge, StatusBadge } from './shared';
import { completeIsoRange } from '@/lib/dates';

interface ProjectRow {
  id: string;
  clientId: string;
  clientName: string;
  legalEntityId: string;
  legalEntityName: string;
  leadId: string | null;
  leadTitle: string | null;
  tenderId: string | null;
  tenderTitle: string | null;
  projectManagerId: string | null;
  projectManagerName: string | null;
  salesManagerName: string | null;
  introducerId: string | null;
  introducerName: string | null;
  projectTypeId: string | null;
  projectTypeName: string | null;
  name: string;
  description: string | null;
  stage: string;
  operationalStatus: string;
  value: string | null;
  budget: string | null;
  gstApplicable: boolean;
  workOrderNumber: string | null;
  workOrderDate: string | null;
  createdAt: string;
  version: number;
}

const PAGE_SIZE = 25;

export default function ProjectsPage() {
  const router = useRouter();
  const me = trpc.auth.me.useQuery();
  const canCreate = (me.data?.permissions ?? []).includes('project.create');
  const canReadFinancials = (me.data?.permissions ?? []).includes('project.read_financials');
  const canReadClients = (me.data?.permissions ?? []).includes('client.read');

  const list = trpc.projects.list.useQuery();
  const clientsList = trpc.clients.list.useQuery({ includeInactive: true }, { enabled: canReadClients });
  const legalEntitiesList = trpc.legalEntities.list.useQuery({ includeInactive: true });

  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<string | undefined>(undefined);
  const [legalEntityFilter, setLegalEntityFilter] = useState<string | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const [stageFilter, setStageFilter] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [createdRange, setCreatedRange] = useState<[string, string] | undefined>(undefined);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const rows = (list.data ?? []) as ProjectRow[];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (clientFilter && row.clientId !== clientFilter) return false;
      if (legalEntityFilter && row.legalEntityId !== legalEntityFilter) return false;
      if (typeFilter && row.projectTypeId !== typeFilter) return false;
      if (stageFilter && row.stage !== stageFilter) return false;
      if (statusFilter && row.operationalStatus !== statusFilter) return false;
      if (createdRange) {
        const created = row.createdAt.slice(0, 10);
        if (created < createdRange[0] || created > createdRange[1]) return false;
      }
      if (!q) return true;
      return row.name.toLowerCase().includes(q) || (row.description ?? '').toLowerCase().includes(q);
    });
  }, [list.data, search, clientFilter, legalEntityFilter, typeFilter, stageFilter, statusFilter, createdRange]);

  // Only the currently-visible page's ids are requested — the backend
  // independently re-verifies access to each one rather than trusting this
  // list (ADR-089). Bounds the aggregation to what's on screen instead of
  // every project in the org.
  const visiblePageIds = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((row) => row.id),
    [filtered, page],
  );
  const financials = trpc.projects.listFinancialSummaries.useQuery(
    { projectIds: visiblePageIds },
    { enabled: canReadFinancials && visiblePageIds.length > 0 },
  );
  const financialsData = financials.data;
  const financialsByProjectId = useMemo(() => {
    const map = new Map<string, NonNullable<typeof financialsData>[number]>();
    for (const row of financialsData ?? []) map.set(row.projectId, row);
    return map;
  }, [financialsData]);

  const columns: ColumnsType<ProjectRow> = [
    {
      title: 'Project',
      dataIndex: 'name',
      key: 'name',
      render: (v: string, row) => (
        <button
          type="button"
          className="text-left font-semibold text-ink hover:text-brand"
          onClick={() => router.push(`/projects/${row.id}`)}
        >
          <div>{v}</div>
          {row.description ? <div className="text-[12.5px] font-normal text-muted line-clamp-1">{row.description}</div> : null}
          <div className="text-[11.5px] font-normal text-muted">
            {row.clientName}
            {row.projectTypeName ? ` · ${row.projectTypeName}` : ''}
          </div>
          <div className="text-[11.5px] font-normal text-muted-2">{row.legalEntityName}</div>
        </button>
      ),
    },
    {
      title: 'Stage / Status',
      key: 'stage',
      render: (_v, row) => (
        <div className="flex flex-col items-start gap-1">
          <StageBadge stage={row.stage} />
          <StatusBadge status={row.operationalStatus} />
        </div>
      ),
    },
    {
      title: 'Managers',
      key: 'managers',
      render: (_v, row) => (
        <div className="text-[12.5px]">
          <div>
            <span className="text-muted">Sales</span> {row.salesManagerName ?? '—'}
          </div>
          <div>
            <span className="text-muted">PM</span> {row.projectManagerName ?? '—'}
          </div>
        </div>
      ),
    },
    ...(canReadFinancials
      ? ([
          {
            title: 'Value / Billing',
            key: 'money',
            align: 'right',
            render: (_v, row) => {
              const f = financialsByProjectId.get(row.id);
              return (
                <div className="text-[12.5px] tabular-nums">
                  <div className="text-[13.5px] font-medium">{formatMoney(row.value)}</div>
                  {f ? (
                    <>
                      <div>
                        <span className="text-muted">Billed</span> <MoneyText tone="neutral">{formatMoney(f.netBilled)}</MoneyText>
                      </div>
                      <div>
                        <span className="text-muted">To collect</span>{' '}
                        {isCreditBalance(f.clientReceivable) ? (
                          <MoneyText tone="positive">{formatMoney(absMoney(f.clientReceivable))} Cr</MoneyText>
                        ) : (
                          <MoneyText tone="warning">{formatMoney(f.clientReceivable)}</MoneyText>
                        )}
                      </div>
                      <div>
                        <span className="text-muted">Expense</span> <MoneyText tone="negative">{formatMoney(f.recognizedProjectExpense)}</MoneyText>
                      </div>
                    </>
                  ) : null}
                </div>
              );
            },
          },
        ] satisfies ColumnsType<ProjectRow>)
      : []),
    {
      title: '',
      key: 'actions',
      align: 'right',
      // Not pinned: the stacked columns fit the page, so nothing scrolls under it.
      fixed: false,
      render: (_v, row) => (
        <Button size="small" onClick={() => router.push(`/projects/${row.id}`)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Projects"
        description="Won opportunities in execution. Each project belongs to a client and an owning legal entity, and progresses through its own stage and status."
        actions={
          canCreate ? (
            <Button type="primary" onClick={() => router.push('/projects/new')}>
              Add Project
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
                setLegalEntityFilter(undefined);
                setTypeFilter(undefined);
                setStageFilter(undefined);
                setStatusFilter(undefined);
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
              placeholder="Search projects…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-[220px]"
            />
          </FilterField>
          {canReadClients ? (
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
          ) : null}
          <FilterField label="Legal Entity">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              value={legalEntityFilter}
              onChange={(v) => {
                setLegalEntityFilter(v);
                setPage(1);
              }}
              placeholder="All entities"
              className="w-[170px]"
              options={(legalEntitiesList.data ?? []).map((e) => ({ value: e.id, label: e.legalName }))}
            />
          </FilterField>
          <FilterField label="Type">
            <MasterSelect
              type="project_types"
              includeInactive
              allowClear
              value={typeFilter}
              onChange={(v) => {
                setTypeFilter(v);
                setPage(1);
              }}
              placeholder="All types"
              className="w-[170px]"
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
              className="w-[190px]"
              options={STAGE_OPTIONS}
            />
          </FilterField>
          <FilterField label="Status">
            <Select
              allowClear
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              placeholder="All statuses"
              className="w-[150px]"
              options={STATUS_OPTIONS}
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

        <EntityTable<ProjectRow>
          rowKey="id"
          tableLayout="auto"
          scroll={{ x: true }}
          columns={columns}
          dataSource={filtered}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load projects. Please retry.' : undefined}
          emptyTitle="No projects found"
          emptyDescription={canCreate ? 'Use "Add Project" to add one.' : undefined}
          page={page}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>
    </>
  );
}
