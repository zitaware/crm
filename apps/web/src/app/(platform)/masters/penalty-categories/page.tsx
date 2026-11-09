'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { App, Button, Form, Input, InputNumber, Popconfirm, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, MasterFormDrawer, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { useFormDraft } from '@/components/form-draft';
import { LedgerAccountSelect } from '@/components/ledger-account-select';

interface PenaltyRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  basisType: string | null;
  acceptedLedgerAccountId: string | null;
  disputedLedgerAccountId: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
}

interface FormValues {
  code: string;
  name: string;
  description?: string;
  basisType?: string;
  acceptedLedgerAccountId?: string;
  disputedLedgerAccountId?: string;
  sortOrder?: number;
}

const PAGE_SIZE = 25;

export default function PenaltyCategoriesPage() {
  const { message } = App.useApp();
  const me = trpc.auth.me.useQuery();
  const canManage = (me.data?.permissions ?? []).includes('master.manage');

  const utils = trpc.useUtils();
  const list = trpc.penaltyCategories.list.useQuery({ includeInactive: true });

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<PenaltyRow | null>(null);
  const [form] = Form.useForm<FormValues>();
  const formKey = editing ? `penalty-category:${editing.id}` : 'penalty-category:new';
  const formDraft = useFormDraft(drawerOpen ? formKey : 'penalty-category:closed');
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef('');
  useEffect(() => {
    const token = `${drawerOpen}:${formKey}`;
    if (!drawerOpen || formDraft.isLoading || appliedDraft.current === token) return;
    appliedDraft.current = token;
    if (formDraft.payload) form.setFieldsValue(formDraft.payload as unknown as FormValues);
  }, [drawerOpen, formKey, formDraft.isLoading, formDraft.payload, form]);

  const filtered = useMemo(() => {
    const rows = (list.data ?? []) as PenaltyRow[];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (status === 'active' && !row.isActive) return false;
      if (status === 'inactive' && row.isActive) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.code.toLowerCase().includes(q) ||
        (row.description ?? '').toLowerCase().includes(q) ||
        (row.basisType ?? '').toLowerCase().includes(q)
      );
    });
  }, [list.data, search, status]);

  const invalidate = async () => {
    await Promise.all([utils.penaltyCategories.list.invalidate(), utils.penaltyCategories.getCount.invalidate()]);
  };

  const createMutation = trpc.penaltyCategories.create.useMutation({
    onSuccess: async () => {
      message.success('Penalty category created.');
      setDrawerOpen(false);
      clearDraft.mutate({ formKey: 'penalty-category:new' });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const updateMutation = trpc.penaltyCategories.update.useMutation({
    onSuccess: async () => {
      message.success('Penalty category updated.');
      setDrawerOpen(false);
      if (editing) clearDraft.mutate({ formKey: `penalty-category:${editing.id}` });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const setActiveMutation = trpc.penaltyCategories.setActive.useMutation({
    onSuccess: async () => await invalidate(),
    onError: (error) => message.error(error.message),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setDrawerOpen(true);
  };
  const openEdit = (row: PenaltyRow) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      code: row.code,
      name: row.name,
      sortOrder: row.sortOrder,
      ...(row.description != null ? { description: row.description } : {}),
      ...(row.basisType != null ? { basisType: row.basisType } : {}),
      ...(row.acceptedLedgerAccountId != null ? { acceptedLedgerAccountId: row.acceptedLedgerAccountId } : {}),
      ...(row.disputedLedgerAccountId != null ? { disputedLedgerAccountId: row.disputedLedgerAccountId } : {}),
    });
    setDrawerOpen(true);
  };
  const onFinish = (values: FormValues) => {
    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        name: values.name,
        description: values.description,
        basisType: values.basisType,
        acceptedLedgerAccountId: values.acceptedLedgerAccountId,
        disputedLedgerAccountId: values.disputedLedgerAccountId,
        sortOrder: values.sortOrder,
        expectedVersion: editing.version,
      });
    } else {
      createMutation.mutate({
        code: values.code,
        name: values.name,
        description: values.description,
        basisType: values.basisType,
        acceptedLedgerAccountId: values.acceptedLedgerAccountId,
        disputedLedgerAccountId: values.disputedLedgerAccountId,
        sortOrder: values.sortOrder,
      });
    }
  };

  const columns: ColumnsType<PenaltyRow> = [
    { title: 'Name', dataIndex: 'name', key: 'name', render: (v: string) => <span className="font-semibold text-ink">{v}</span> },
    { title: 'Code', dataIndex: 'code', key: 'code', width: 100, render: (v: string) => <span className="font-mono text-[12.5px] text-muted">{v}</span> },
    { title: 'Basis', dataIndex: 'basisType', key: 'basisType', width: 150, render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
    { title: 'Description', dataIndex: 'description', key: 'description', render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
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
            title={row.isActive ? 'Deactivate this penalty category?' : 'Reactivate this penalty category?'}
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
        title="Penalty Category Master"
        description="Penalty categories and their default calculation basis."
        actions={
          <>
            <Link href="/masters">
              <Button>Back to Masters</Button>
            </Link>
            {canManage ? (
              <Button type="primary" onClick={openCreate}>
                New Penalty Category
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
              placeholder="Search penalty categories…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-[240px]"
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

        <EntityTable<PenaltyRow>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load penalty categories. Please retry.' : undefined}
          emptyTitle="No penalty categories found"
          emptyDescription={canManage ? 'Use "New Penalty Category" to add one.' : undefined}
          page={page}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>

      <MasterFormDrawer
        open={drawerOpen}
        title={editing ? 'Edit Penalty Category' : 'Add Penalty Category'}
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
            extra={editing ? 'Code cannot be changed after creation.' : 'A short immutable identifier (e.g. LD).'}
>
            <Input disabled={!!editing} placeholder="e.g. LD" />
          </Form.Item>
          <Form.Item label="Name" name="name" rules={[{ required: true, message: 'Name is required.' }, { max: 200 }]}>
            <Input placeholder="e.g. Liquidated Damages" />
          </Form.Item>
          <Form.Item
            label="Default basis"
            name="basisType"
            rules={[{ max: 100 }]}
            extra="How the penalty is calculated by default (e.g. PERCENTAGE, FIXED_AMOUNT, PER_DAY)."
>
            <Input placeholder="e.g. PERCENTAGE" />
          </Form.Item>
          <Form.Item label="Description" name="description" rules={[{ max: 1000 }]}>
            <Input.TextArea rows={3} placeholder="Optional" />
          </Form.Item>
          <Form.Item
            label="Accepted-penalty ledger account"
            name="acceptedLedgerAccountId"
            extra="Where an accepted penalty deduction posts on a receipt. Leave blank to use the org default."
>
            <LedgerAccountSelect allowClear placeholder="Use default" />
          </Form.Item>
          <Form.Item
            label="Disputed-penalty ledger account"
            name="disputedLedgerAccountId"
            extra="Where a disputed penalty deduction posts on a receipt. Leave blank to use the org default."
>
            <LedgerAccountSelect allowClear placeholder="Use default" />
          </Form.Item>
          <Form.Item label="Sort order" name="sortOrder" extra="Lower numbers appear first in dropdowns.">
            <InputNumber min={0} className="w-full" placeholder="0" />
          </Form.Item>
        </Form>
      </MasterFormDrawer>
    </>
  );
}
