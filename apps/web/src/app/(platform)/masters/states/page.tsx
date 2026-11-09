'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { App, Button, Form, Input, Popconfirm, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, MasterFormDrawer, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { useFormDraft } from '@/components/form-draft';

interface StateRow {
  id: string;
  name: string;
  code: string;
  gstStateCode: string;
  isActive: boolean;
  version: number;
}

interface FormValues {
  name: string;
  code: string;
  gstStateCode: string;
}

const PAGE_SIZE = 25;

export default function StatesPage() {
  const { message } = App.useApp();
  const me = trpc.auth.me.useQuery();
  const canManage = (me.data?.permissions ?? []).includes('master.manage');

  const utils = trpc.useUtils();
  const list = trpc.geography.listStates.useQuery({ includeInactive: true });

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<StateRow | null>(null);
  const [form] = Form.useForm<FormValues>();
  const formKey = editing ? `state:${editing.id}` : 'state:new';
  const formDraft = useFormDraft(drawerOpen ? formKey : 'state:closed');
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef('');
  useEffect(() => {
    const token = `${drawerOpen}:${formKey}`;
    if (!drawerOpen || formDraft.isLoading || appliedDraft.current === token) return;
    appliedDraft.current = token;
    if (formDraft.payload) form.setFieldsValue(formDraft.payload as unknown as FormValues);
  }, [drawerOpen, formKey, formDraft.isLoading, formDraft.payload, form]);

  const filtered = useMemo(() => {
    const rows = (list.data ?? []) as StateRow[];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (status === 'active' && !row.isActive) return false;
      if (status === 'inactive' && row.isActive) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.code.toLowerCase().includes(q) ||
        row.gstStateCode.toLowerCase().includes(q)
      );
    });
  }, [list.data, search, status]);

  const invalidate = async () => {
    await Promise.all([utils.geography.listStates.invalidate(), utils.geography.getCounts.invalidate()]);
  };

  const createMutation = trpc.geography.createState.useMutation({
    onSuccess: async () => {
      message.success('State created.');
      setDrawerOpen(false);
      clearDraft.mutate({ formKey: 'state:new' });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const updateMutation = trpc.geography.updateState.useMutation({
    onSuccess: async () => {
      message.success('State updated.');
      setDrawerOpen(false);
      if (editing) clearDraft.mutate({ formKey: `state:${editing.id}` });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const setActiveMutation = trpc.geography.setStateActive.useMutation({
    onSuccess: async () => await invalidate(),
    onError: (error) => message.error(error.message),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setDrawerOpen(true);
  };
  const openEdit = (row: StateRow) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({ name: row.name, code: row.code, gstStateCode: row.gstStateCode });
    setDrawerOpen(true);
  };
  const onFinish = (values: FormValues) => {
    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        name: values.name,
        code: values.code,
        gstStateCode: values.gstStateCode,
        expectedVersion: editing.version,
      });
    } else {
      createMutation.mutate({ name: values.name, code: values.code, gstStateCode: values.gstStateCode });
    }
  };

  const columns: ColumnsType<StateRow> = [
    { title: 'State', dataIndex: 'name', key: 'name', render: (v: string) => <span className="font-semibold text-ink">{v}</span> },
    { title: 'Code', dataIndex: 'code', key: 'code', width: 100, render: (v: string) => <span className="font-mono text-[12.5px] text-muted">{v}</span> },
    { title: 'GST State Code', dataIndex: 'gstStateCode', key: 'gstStateCode', width: 140, render: (v: string) => <span className="font-mono text-[12.5px] text-muted">{v}</span> },
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
            title={row.isActive ? 'Deactivate this state?' : 'Reactivate this state?'}
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
        title="States"
        description="Statutory Indian states and union territories, with GST state codes."
        actions={
          <>
            <Link href="/masters">
              <Button>Back to Masters</Button>
            </Link>
            {canManage ? (
              <Button type="primary" onClick={openCreate}>
                New State
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
          <FilterField label="Search">
            <Input
              allowClear
              placeholder="Search states…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-[220px]"
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
              options={[
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<StateRow>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load states. Please retry.' : undefined}
          emptyTitle="No states found"
          page={page}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>

      <MasterFormDrawer
        open={drawerOpen}
        title={editing ? 'Edit State' : 'Add State'}
        onClose={() => setDrawerOpen(false)}
        onSubmit={() => form.submit()}
        onSaveDraft={() => formDraft.save(form.getFieldsValue(true) as unknown as Record<string, unknown>)}
        submitting={createMutation.isPending || updateMutation.isPending}
        draftSaving={formDraft.saving}
        drafted={formDraft.payload != null}
        submitLabel={editing ? 'Save changes' : 'Save'}
      >
        <Form<FormValues> form={form} layout="vertical" requiredMark onFinish={onFinish}>
          <Form.Item label="State name" name="name" rules={[{ required: true, message: 'Name is required.' }, { max: 200 }]}>
            <Input placeholder="e.g. Maharashtra" />
          </Form.Item>
          <Form.Item label="Code" name="code" rules={[{ required: true, message: 'Code is required.' }, { max: 20 }]}>
            <Input placeholder="e.g. MH" />
          </Form.Item>
          <Form.Item
            label="GST state code"
            name="gstStateCode"
            rules={[{ required: true, message: 'GST state code is required.' }, { max: 10 }]}
            extra="The numeric GST state code (e.g. 27 for Maharashtra)."
>
            <Input placeholder="e.g. 27" />
          </Form.Item>
        </Form>
      </MasterFormDrawer>
    </>
  );
}
