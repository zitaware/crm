'use client';

import { useMemo, useState } from 'react';
import { App, Button, Input, Popconfirm, Select } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { useRouter } from 'next/navigation';
import { trpc } from '@/server/trpc';
import { GeographySelect } from '@/components/master-select';
import { completeIsoRange } from '@/lib/dates';

interface ClientRow {
  id: string;
  name: string;
  shortCode: string | null;
  department: string;
  clientTypeId: string | null;
  clientTypeName: string | null;
  stateId: string | null;
  stateName: string | null;
  districtId: string | null;
  districtName: string | null;
  cityId: string | null;
  cityName: string | null;
  leadCount: number;
  projectCount: number;
  isActive: boolean;
  createdAt: string;
  version: number;
}

const PAGE_SIZE = 25;

export default function ClientsPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const me = trpc.auth.me.useQuery();
  const canCreate = (me.data?.permissions ?? []).includes('client.create');
  const canUpdate = (me.data?.permissions ?? []).includes('client.update');

  const utils = trpc.useUtils();
  const list = trpc.clients.list.useQuery({ includeInactive: true });

  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<'all' | 'ACTIVE' | 'INACTIVE'>('all');
  const [addedRange, setAddedRange] = useState<[string, string] | undefined>(undefined);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const rows = (list.data ?? []) as ClientRow[];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter === 'ACTIVE' && !row.isActive) return false;
      if (statusFilter === 'INACTIVE' && row.isActive) return false;
      if (stateFilter && row.stateId !== stateFilter) return false;
      if (addedRange) {
        const created = row.createdAt.slice(0, 10);
        if (created < addedRange[0] || created > addedRange[1]) return false;
      }
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        (row.shortCode ?? '').toLowerCase().includes(q) ||
        (row.department ?? '').toLowerCase().includes(q)
      );
    });
  }, [list.data, search, statusFilter, stateFilter, addedRange]);

  const invalidate = async () => {
    await utils.clients.list.invalidate();
  };

  const setActiveMutation = trpc.clients.setActive.useMutation({
    onSuccess: async () => await invalidate(),
    onError: (error) => message.error(error.message),
  });

  const columns: ColumnsType<ClientRow> = [
    {
      title: 'Client',
      dataIndex: 'name',
      key: 'name',
      render: (v: string, row) => (
        <button type="button" className="text-left font-semibold text-ink hover:text-brand" onClick={() => router.push(`/clients/${row.id}`)}>
          {v}
        </button>
      ),
    },
    { title: 'Department', dataIndex: 'department', key: 'department', render: (v: string | null) => v ?? '—' },
    {
      title: 'Location',
      key: 'location',
      render: (_v, row) => (
        <span className="text-[12.5px] text-muted">
          {[row.cityName, row.stateName].filter(Boolean).join(', ') || '—'}
        </span>
      ),
    },
    { title: 'Projects', dataIndex: 'projectCount', key: 'projectCount', width: 100, align: 'right', render: (v: number) => <span className="tabular-nums">{v}</span> },
    { title: 'Leads', dataIndex: 'leadCount', key: 'leadCount', width: 90, align: 'right', render: (v: number) => <span className="tabular-nums">{v}</span> },
    { title: 'Status', dataIndex: 'isActive', key: 'isActive', width: 110, render: (v: boolean) => <StatusTag status={v ? 'ACTIVE' : 'INACTIVE'} /> },
    {
      title: '',
      key: 'actions',
      width: 200,
      align: 'right',
      render: (_v, row) => (
        <div className="flex justify-end gap-2">
          <Button size="small" onClick={() => router.push(`/clients/${row.id}`)}>
            View
          </Button>
          {canUpdate ? (
            <Popconfirm
              title={row.isActive ? 'Deactivate this client?' : 'Reactivate this client?'}
              onConfirm={() => setActiveMutation.mutate({ id: row.id, isActive: !row.isActive, expectedVersion: row.version })}
            >
              <Button size="small" danger={row.isActive}>
                {row.isActive ? 'Deactivate' : 'Reactivate'}
              </Button>
            </Popconfirm>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Clients"
        description="Your clients, with how many projects and leads each has."
        actions={
          canCreate ? (
            <Button type="primary" onClick={() => router.push('/clients/new')}>
              Add Client
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
                setStateFilter(undefined);
                setStatusFilter('all');
                setAddedRange(undefined);
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
              placeholder="Search clients…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-[220px]"
            />
          </FilterField>
          <FilterField label="State">
            <GeographySelect
              kind="state"
              allowClear
              value={stateFilter}
              onChange={(v) => {
                setStateFilter(v);
                setPage(1);
              }}
              placeholder="All states"
              className="w-[180px]"
            />
          </FilterField>
          <FilterField label="Status">
            <Select
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              className="w-[140px]"
              options={[
                { value: 'all', label: 'All' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Inactive' },
              ]}
            />
          </FilterField>
          <FilterField label="Added between">
            <DatePicker.RangePicker
              onChange={(picked) => {
                setAddedRange(completeIsoRange(picked) ?? undefined);
                setPage(1);
              }}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<ClientRow>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load clients. Please retry.' : undefined}
          emptyTitle="No clients found"
          emptyDescription={canCreate ? 'Use "Add Client" to add one.' : undefined}
          page={page}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>
    </>
  );
}
