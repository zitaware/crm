'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { App, Button, Form, Input, InputNumber, Popconfirm, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  EntityTable,
  FilterCard,
  FilterField,
  MasterFormDrawer,
  PageHeader,
  StatusTag,
  UiCard,
} from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { useFormDraft } from '@/components/form-draft';
import { findMasterCatalogItem } from '../catalog';

interface MasterRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
}

interface FormValues {
  code: string;
  name: string;
  description?: string;
  sortOrder?: number;
}

const PAGE_SIZE = 25;

export default function MasterTypePage() {
  const routeType = String(useParams().type ?? '');
  const item = findMasterCatalogItem(routeType);
  if (!item) {
    notFound();
  }
  const type = item.type;

  const { message } = App.useApp();
  const me = trpc.auth.me.useQuery();
  const canManage = (me.data?.permissions ?? []).includes('master.manage');

  const utils = trpc.useUtils();
  const list = trpc.masters.list.useQuery({ type, includeInactive: true });

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<MasterRow | null>(null);
  const [form] = Form.useForm<FormValues>();
  const formKey = editing ? `master:${type}:${editing.id}` : `master:${type}:new`;
  const formDraft = useFormDraft(drawerOpen ? formKey : `master:${type}:closed`);
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef('');
  useEffect(() => {
    const token = `${drawerOpen}:${formKey}`;
    if (!drawerOpen || formDraft.isLoading || appliedDraft.current === token) return;
    appliedDraft.current = token;
    if (formDraft.payload) form.setFieldsValue(formDraft.payload as unknown as FormValues);
  }, [drawerOpen, formKey, formDraft.isLoading, formDraft.payload, form]);

  const filtered = useMemo(() => {
    const rows = (list.data ?? []) as MasterRow[];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (status === 'active' && !row.isActive) return false;
      if (status === 'inactive' && row.isActive) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.code.toLowerCase().includes(q) ||
        (row.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [list.data, search, status]);

  const invalidate = async () => {
    await Promise.all([utils.masters.list.invalidate({ type }), utils.masters.getCatalog.invalidate()]);
  };

  const createMutation = trpc.masters.create.useMutation({
    onSuccess: async () => {
      message.success(`${item.singularLabel} created.`);
      setDrawerOpen(false);
      clearDraft.mutate({ formKey: `master:${type}:new` });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const updateMutation = trpc.masters.update.useMutation({
    onSuccess: async () => {
      message.success(`${item.singularLabel} updated.`);
      setDrawerOpen(false);
      if (editing) clearDraft.mutate({ formKey: `master:${type}:${editing.id}` });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const setActiveMutation = trpc.masters.setActive.useMutation({
    onSuccess: async () => await invalidate(),
    onError: (error) => message.error(error.message),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setDrawerOpen(true);
  };

  const openEdit = (row: MasterRow) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      code: row.code,
      name: row.name,
      sortOrder: row.sortOrder,
      ...(row.description != null ? { description: row.description } : {}),
    });
    setDrawerOpen(true);
  };

  const onFinish = (values: FormValues) => {
    if (editing) {
      updateMutation.mutate({
        type,
        id: editing.id,
        name: values.name,
        description: values.description,
        sortOrder: values.sortOrder,
        expectedVersion: editing.version,
      });
    } else {
      createMutation.mutate({
        type,
        code: values.code,
        name: values.name,
        description: values.description,
        sortOrder: values.sortOrder,
      });
    }
  };

  const columns: ColumnsType<MasterRow> = [
    { title: 'Name', dataIndex: 'name', key: 'name', render: (value: string) => <span className="font-semibold text-ink">{value}</span> },
    { title: 'Code', dataIndex: 'code', key: 'code', render: (value: string) => <span className="font-mono text-[12.5px] text-muted">{value}</span> },
    { title: 'Description', dataIndex: 'description', key: 'description', render: (value: string | null) => value ?? <span className="text-muted-2">—</span> },
    { title: 'Sort', dataIndex: 'sortOrder', key: 'sortOrder', align: 'right', width: 70 },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 110,
      render: (isActive: boolean) => <StatusTag status={isActive ? 'ACTIVE' : 'INACTIVE'} />,
    },
  ];

  if (canManage) {
    columns.push({
      title: '',
      key: 'actions',
      width: 150,
      align: 'right',
      render: (_value, row) => (
        <div className="flex justify-end gap-2">
          <Button size="small" onClick={() => openEdit(row)}>
            Edit
          </Button>
          <Popconfirm
            title={row.isActive ? `Deactivate this ${item.singularLabel.toLowerCase()}?` : `Reactivate this ${item.singularLabel.toLowerCase()}?`}
            okText="Confirm"
            onConfirm={() =>
              setActiveMutation.mutate({ type, id: row.id, isActive: !row.isActive, expectedVersion: row.version })
            }
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
        title={`${item.singularLabel} Master`}
        description={item.description}
        actions={
          <>
            <Link href="/masters">
              <Button>Back to Masters</Button>
            </Link>
            {canManage ? (
              <Button type="primary" onClick={openCreate}>
                New {item.singularLabel}
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
              placeholder={`Search ${item.pluralLabel.toLowerCase()}…`}
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
              onChange={(value) => {
                setStatus(value);
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

        <EntityTable<MasterRow>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load records. Please retry.' : undefined}
          emptyTitle={`No ${item.pluralLabel.toLowerCase()} found`}
          emptyDescription={canManage ? `Use "New ${item.singularLabel}" to add one.` : undefined}
          page={page}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onPageChange={(nextPage) => setPage(nextPage)}
        />
      </UiCard>

      <MasterFormDrawer
        open={drawerOpen}
        title={editing ? `Edit ${item.singularLabel}` : `Add ${item.singularLabel}`}
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
            label="Code"
            name="code"
            rules={[{ required: true, message: 'Code is required.' }, { max: 50 }]}
            extra={editing ? 'Code cannot be changed after creation.' : 'A short immutable identifier (e.g. REFERRAL).'}
>
            <Input disabled={!!editing} placeholder="e.g. REFERRAL" />
          </Form.Item>
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: 'Name is required.' }, { max: 200 }]}
>
            <Input placeholder={`e.g. ${item.singularLabel}`} />
          </Form.Item>
          <Form.Item label="Description" name="description" rules={[{ max: 1000 }]}>
            <Input.TextArea rows={3} placeholder="Optional" />
          </Form.Item>
          <Form.Item
            label="Sort order"
            name="sortOrder"
            extra="Lower numbers appear first in dropdowns."
>
            <InputNumber min={0} className="w-full" placeholder="0" />
          </Form.Item>
        </Form>
      </MasterFormDrawer>
    </>
  );
}
