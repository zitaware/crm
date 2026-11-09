'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { App, Button, Form, Input, Popconfirm, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, MasterFormDrawer, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { useFormDraft } from '@/components/form-draft';

interface DistrictRow {
  id: string;
  stateId: string;
  name: string;
  isActive: boolean;
  version: number;
}

interface FormValues {
  name: string;
}

const PAGE_SIZE = 25;

export default function DistrictsPage() {
  const { message } = App.useApp();
  const me = trpc.auth.me.useQuery();
  const canManage = (me.data?.permissions ?? []).includes('master.manage');

  const utils = trpc.useUtils();
  const states = trpc.geography.listStates.useQuery();
  const [stateId, setStateId] = useState<string | undefined>(undefined);
  const list = trpc.geography.listDistricts.useQuery(
    { stateId: stateId ?? '', includeInactive: true },
    { enabled: !!stateId },
  );

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<DistrictRow | null>(null);
  const [form] = Form.useForm<FormValues>();
  const formKey = editing ? `district:${editing.id}` : 'district:new';
  const formDraft = useFormDraft(drawerOpen ? formKey : 'district:closed');
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef('');
  useEffect(() => {
    const token = `${drawerOpen}:${formKey}`;
    if (!drawerOpen || formDraft.isLoading || appliedDraft.current === token) return;
    appliedDraft.current = token;
    if (formDraft.payload) form.setFieldsValue(formDraft.payload as unknown as FormValues);
  }, [drawerOpen, formKey, formDraft.isLoading, formDraft.payload, form]);

  const filtered = useMemo(() => {
    const rows = (list.data ?? []) as DistrictRow[];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (status === 'active' && !row.isActive) return false;
      if (status === 'inactive' && row.isActive) return false;
      if (!q) return true;
      return row.name.toLowerCase().includes(q);
    });
  }, [list.data, search, status]);

  const invalidate = async () => {
    await Promise.all([
      utils.geography.listDistricts.invalidate(),
      utils.geography.getCounts.invalidate(),
    ]);
  };

  const createMutation = trpc.geography.createDistrict.useMutation({
    onSuccess: async () => {
      message.success('District created.');
      setDrawerOpen(false);
      clearDraft.mutate({ formKey: 'district:new' });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const updateMutation = trpc.geography.updateDistrict.useMutation({
    onSuccess: async () => {
      message.success('District updated.');
      setDrawerOpen(false);
      if (editing) clearDraft.mutate({ formKey: `district:${editing.id}` });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const setActiveMutation = trpc.geography.setDistrictActive.useMutation({
    onSuccess: async () => await invalidate(),
    onError: (error) => message.error(error.message),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setDrawerOpen(true);
  };
  const openEdit = (row: DistrictRow) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({ name: row.name });
    setDrawerOpen(true);
  };
  const onFinish = (values: FormValues) => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, name: values.name, expectedVersion: editing.version });
    } else if (stateId) {
      createMutation.mutate({ stateId, name: values.name });
    }
  };

  const columns: ColumnsType<DistrictRow> = [
    { title: 'District', dataIndex: 'name', key: 'name', render: (v: string) => <span className="font-semibold text-ink">{v}</span> },
    { title: 'Status', dataIndex: 'isActive', key: 'isActive', width: 110, render: (a: boolean) => <StatusTag status={a ? 'ACTIVE' : 'INACTIVE'} /> },
  ];
  if (canManage) {
    columns.push({
      title: '',
      key: 'actions',
      width: 150,
      align: 'right',
      render: (_v, row) => (
        <div className="flex justify-end gap-2">
          <Button size="small" onClick={() => openEdit(row)}>
            Edit
          </Button>
          <Popconfirm
            title={row.isActive ? 'Deactivate this district?' : 'Reactivate this district?'}
            okText="Confirm"
            onConfirm={() => setActiveMutation.mutate({ id: row.id, isActive: !row.isActive, expectedVersion: row.version })}
          >
            <Button size="small" danger={row.isActive}>
              {row.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>
          </Popconfirm>
        </div>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Districts"
        description="Districts under a state. Select a state to view and manage its districts."
        actions={
          <>
            <Link href="/masters">
              <Button>Back to Masters</Button>
            </Link>
            {canManage ? (
              <Button type="primary" disabled={!stateId} onClick={openCreate}>
                New District
              </Button>
            ) : null}
          </>
        }
      />

      <UiCard flush>
        <FilterCard
          actions={
            <Button
              onClick={() => {
                setSearch('');
                setStatus('all');
                setPage(1);
              }}
            >
              Reset
            </Button>
          }
        >
          <FilterField label="State">
            <Select
              showSearch
              placeholder="Select a state"
              optionFilterProp="label"
              loading={states.isLoading}
              value={stateId}
              onChange={(v) => {
                setStateId(v);
                setPage(1);
              }}
              className="w-[220px]"
              options={(states.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
            />
          </FilterField>
          <FilterField label="Search">
            <Input
              allowClear
              placeholder="Search districts…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-[200px]"
              disabled={!stateId}
            />
          </FilterField>
          <FilterField label="Status">
            <Select
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              className="w-[140px]"
              disabled={!stateId}
              options={[
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </FilterField>
        </FilterCard>

        {!stateId ? (
          <div className="p-[50px_20px] text-center text-[13px] text-muted">Select a state to view its districts.</div>
        ) : (
          <EntityTable<DistrictRow>
            rowKey="id"
            columns={columns}
            dataSource={filtered}
            loading={list.isLoading}
            errorMessage={list.isError ? 'Could not load districts. Please retry.' : undefined}
            emptyTitle="No districts found"
            emptyDescription={canManage ? 'Use "New District" to add one under this state.' : undefined}
            page={page}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            onPageChange={(p) => setPage(p)}
          />
        )}
      </UiCard>

      <MasterFormDrawer
        open={drawerOpen}
        title={editing ? 'Edit District' : 'Add District'}
        onClose={() => setDrawerOpen(false)}
        onSubmit={() => form.submit()}
        onSaveDraft={() => formDraft.save(form.getFieldsValue(true) as unknown as Record<string, unknown>)}
        submitting={createMutation.isPending || updateMutation.isPending}
        draftSaving={formDraft.saving}
        drafted={formDraft.payload != null}
        submitLabel={editing ? 'Save changes' : 'Save'}
      >
        <Form<FormValues> form={form} layout="vertical" requiredMark onFinish={onFinish}>
          <Form.Item
            label="State"
            extra="Districts are added under the state selected in the filter above."
>
            <Input disabled value={states.data?.find((s) => s.id === stateId)?.name ?? ''} />
          </Form.Item>
          <Form.Item label="District name" name="name" rules={[{ required: true, message: 'Name is required.' }, { max: 200 }]}>
            <Input placeholder="e.g. Pune" />
          </Form.Item>
        </Form>
      </MasterFormDrawer>
    </>
  );
}
