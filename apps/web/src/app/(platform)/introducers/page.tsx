'use client';

import { useMemo, useState } from 'react';
import { App, Button, Drawer, Form, Input, Popconfirm, Select } from 'antd';
import { FormSaveButtons, useApplyFormDraft, useFormDraft } from '@/components/form-draft';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';

interface IntroducerRow {
  id: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  version: number;
}

interface CoreFormValues {
  name: string;
  phone: string | undefined;
}

function IntroducerFormBody({
  mode,
  formKey,
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  mode: 'create' | 'edit';
  formKey: string;
  initial: CoreFormValues;
  onSubmit: (values: CoreFormValues) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [form] = Form.useForm<CoreFormValues>();
  const formDraft = useFormDraft(formKey);
  useApplyFormDraft(form, formDraft.payload);

  return (
    <Form<CoreFormValues> form={form} layout="vertical" requiredMark initialValues={initial} onFinish={onSubmit}>
      <Form.Item label="Name" name="name" rules={[{ required: true, message: 'Name is required.' }, { max: 200 }]}>
        <Input placeholder="e.g. Rajesh Patel" />
      </Form.Item>
      <Form.Item label="Phone" name="phone" rules={[{ max: 30 }]}>
        <Input placeholder="+91 …" />
      </Form.Item>

      <Form.Item className="mt-2 mb-0">
        <FormSaveButtons
          onCancel={onCancel}
          submitting={submitting || formDraft.saving}
          saveLabel={mode === 'create' ? 'Save' : 'Save changes'}
          drafted={formDraft.payload != null}
          onDraft={() => formDraft.save(form.getFieldsValue(true) as unknown as Record<string, unknown>)}
        />
      </Form.Item>
    </Form>
  );
}

const PAGE_SIZE = 25;

export default function IntroducersPage() {
  const { message } = App.useApp();
  const me = trpc.auth.me.useQuery();
  const canCreate = (me.data?.permissions ?? []).includes('introducer.create');
  const canUpdate = (me.data?.permissions ?? []).includes('introducer.update');

  const utils = trpc.useUtils();
  const list = trpc.introducers.list.useQuery({ includeInactive: true });
  const clearDraft = trpc.formDrafts.clear.useMutation();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ACTIVE' | 'INACTIVE'>('all');
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editingRow = (list.data ?? []).find((row) => row.id === editingId) as IntroducerRow | undefined;

  const filtered = useMemo(() => {
    const rows = (list.data ?? []) as IntroducerRow[];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter === 'ACTIVE' && !row.isActive) return false;
      if (statusFilter === 'INACTIVE' && row.isActive) return false;
      if (!q) return true;
      return row.name.toLowerCase().includes(q) || (row.phone ?? '').toLowerCase().includes(q);
    });
  }, [list.data, search, statusFilter]);

  const invalidate = async () => {
    await utils.introducers.list.invalidate();
  };

  const createMutation = trpc.introducers.create.useMutation({
    onSuccess: async () => {
      message.success('Introducer added.');
      setDrawerOpen(false);
      clearDraft.mutate({ formKey: 'introducer:new' });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const updateMutation = trpc.introducers.update.useMutation({
    onSuccess: async () => {
      message.success('Introducer updated.');
      setDrawerOpen(false);
      if (editingId) clearDraft.mutate({ formKey: `introducer:${editingId}` });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const setActiveMutation = trpc.introducers.setActive.useMutation({
    onSuccess: async () => await invalidate(),
    onError: (error) => message.error(error.message),
  });

  const openCreate = () => {
    setEditingId(null);
    setDrawerOpen(true);
  };
  const openEdit = (row: IntroducerRow) => {
    setEditingId(row.id);
    setDrawerOpen(true);
  };

  const handleSubmit = (values: CoreFormValues) => {
    if (!editingId) {
      createMutation.mutate({ name: values.name, phone: values.phone });
    } else if (editingRow) {
      updateMutation.mutate({
        id: editingRow.id,
        name: values.name,
        phone: values.phone,
        expectedVersion: editingRow.version,
      });
    }
  };

  const columns: ColumnsType<IntroducerRow> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (v: string, row) => (
        <button type="button" className="text-left font-semibold text-ink hover:text-brand" onClick={() => openEdit(row)}>
          {v}
        </button>
      ),
    },
    { title: 'Phone', dataIndex: 'phone', key: 'phone', render: (v: string | null) => v ?? '—' },
    { title: 'Status', dataIndex: 'isActive', key: 'isActive', width: 110, render: (v: boolean) => <StatusTag status={v ? 'ACTIVE' : 'INACTIVE'} /> },
    {
      title: '',
      key: 'actions',
      width: 200,
      align: 'right',
      render: (_v, row) => (
        <div className="flex justify-end gap-2">
          <Button size="small" onClick={() => openEdit(row)}>
            Edit
          </Button>
          {canUpdate ? (
            <Popconfirm
              title={row.isActive ? 'Deactivate this introducer?' : 'Reactivate this introducer?'}
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
        title="Introducers"
        description="People who refer work. Used on leads to track commission-eligible referrals."
        actions={
          canCreate ? (
            <Button type="primary" onClick={openCreate}>
              Add Introducer
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
                setStatusFilter('all');
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
              placeholder="Search introducers…"
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
        </FilterCard>

        <EntityTable<IntroducerRow>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load introducers. Please retry.' : undefined}
          emptyTitle="No introducers found"
          emptyDescription={canCreate ? 'Use "Add Introducer" to add one.' : undefined}
          page={page}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>

      <Drawer open={drawerOpen} title={editingId ? 'Edit Introducer' : 'Add Introducer'} onClose={() => setDrawerOpen(false)} width={480} destroyOnHidden>
        <IntroducerFormBody
          key={editingId ?? 'create'}
          mode={editingId ? 'edit' : 'create'}
          formKey={editingId ? `introducer:${editingId}` : 'introducer:new'}
          initial={
            editingRow
              ? { name: editingRow.name, phone: editingRow.phone ?? undefined }
              : { name: '', phone: undefined }
          }
          onSubmit={handleSubmit}
          onCancel={() => setDrawerOpen(false)}
          submitting={createMutation.isPending || updateMutation.isPending}
        />
      </Drawer>
    </>
  );
}
