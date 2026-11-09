'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Drawer, Form, Input, Popconfirm, Select, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: string | Date;
  roleNames: string[];
  employeeLinked: boolean;
}

interface InviteFormValues {
  email: string;
  displayName: string;
  roleIds: string[];
  employeeId?: string;
}

const PAGE_SIZE = 25;

export default function UsersPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const me = trpc.auth.me.useQuery();
  const canManage = (me.data?.permissions ?? []).includes('user.manage');
  // ADR-174: an Admin logs in as another user to see what they see.
  const canImpersonate = (me.data?.permissions ?? []).includes('user.impersonate') && !me.data?.impersonatedBy;
  const impersonate = trpc.auth.startImpersonation.useMutation({
    // A full reload, so the server-rendered shell picks up the new login too.
    onSuccess: () => window.location.assign('/'),
    onError: (error) => message.error(error.message),
  });

  const utils = trpc.useUtils();
  const list = trpc.users.list.useQuery();
  const roleOptions = trpc.roles.list.useQuery();
  const linkableEmployees = trpc.employees.listLinkable.useQuery();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ACTIVE' | 'INVITED' | 'DISABLED'>('all');
  const [page, setPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [form] = Form.useForm<InviteFormValues>();

  const filtered = useMemo(() => {
    const rows = (list.data ?? []) as UserRow[];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (!q) return true;
      return row.displayName.toLowerCase().includes(q) || row.email.toLowerCase().includes(q);
    });
  }, [list.data, search, statusFilter]);

  const inviteMutation = trpc.users.invite.useMutation({
    onSuccess: async () => {
      message.success('Invitation sent.');
      setInviteOpen(false);
      form.resetFields();
      await Promise.all([utils.users.list.invalidate(), utils.employees.listLinkable.invalidate()]);
    },
    onError: (error) => message.error(error.message),
  });

  const onInviteFinish = (values: InviteFormValues) => {
    inviteMutation.mutate({
      email: values.email,
      displayName: values.displayName,
      roleIds: values.roleIds,
      employeeId: values.employeeId,
      idempotencyKey: crypto.randomUUID(),
    });
  };

  const columns: ColumnsType<UserRow> = [
    {
      title: 'Name',
      dataIndex: 'displayName',
      key: 'displayName',
      render: (v: string, row) => (
        <button type="button" className="text-left font-semibold text-ink hover:text-brand" onClick={() => router.push(`/users/${row.id}`)}>
          {v}
        </button>
      ),
    },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 110, render: (v: string) => <StatusTag status={v} /> },
    {
      title: 'Roles',
      dataIndex: 'roleNames',
      key: 'roleNames',
      render: (names: string[]) =>
        names.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {names.map((name) => (
              <Tag key={name}>{name}</Tag>
            ))}
          </div>
        ) : (
          <span className="text-muted-2">—</span>
        ),
    },
    {
      title: 'Employee',
      dataIndex: 'employeeLinked',
      key: 'employeeLinked',
      width: 100,
      render: (linked: boolean) => (linked ? <StatusTag status="ACTIVE" label="Linked" /> : <span className="text-muted-2">—</span>),
    },
    {
      title: '',
      key: 'actions',
      width: 200,
      align: 'right',
      render: (_v, row) => (
        <div className="flex justify-end gap-2">
          {canImpersonate && row.status === 'ACTIVE' && row.id !== me.data?.userId ? (
            <Popconfirm
              title={`Log in as ${row.displayName}?`}
              description="You will see and do exactly what they can, and it is recorded. Use “Return to my login” at the top to come back."
              okText="Log in as"
              onConfirm={() => impersonate.mutate({ userId: row.id })}
            >
              <Button size="small" loading={impersonate.isPending && impersonate.variables?.userId === row.id}>
                Log in as
              </Button>
            </Popconfirm>
          ) : null}
          <Button size="small" onClick={() => router.push(`/users/${row.id}`)}>
            View
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        description="Invite users, assign roles, manage per-user permission overrides and session access."
        actions={
          canManage ? (
            <Button type="primary" onClick={() => setInviteOpen(true)}>
              Invite User
            </Button>
          ) : undefined
        }
      />

      <UiCard flush>
        <FilterCard>
          <FilterField label="Search">
            <Input
              allowClear
              placeholder="Search users…"
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
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              className="w-[140px]"
              options={[
                { value: 'all', label: 'All' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INVITED', label: 'Invited' },
                { value: 'DISABLED', label: 'Disabled' },
              ]}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<UserRow>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load users. Please retry.' : undefined}
          emptyTitle="No users found"
          emptyDescription={canManage ? 'Use "Invite User" to add one.' : undefined}
          page={page}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>

      <Drawer open={inviteOpen} title="Invite User" onClose={() => setInviteOpen(false)} width={440} destroyOnHidden>
        <Form<InviteFormValues> form={form} layout="vertical" requiredMark onFinish={onInviteFinish}>
          <Form.Item label="Email" name="email" rules={[{ required: true, type: 'email', message: 'A valid email is required.' }]}>
            <Input placeholder="name@zitaware.in" />
          </Form.Item>
          <Form.Item label="Display name" name="displayName" rules={[{ required: true, message: 'Display name is required.' }]}>
            <Input placeholder="e.g. Priya Sharma" />
          </Form.Item>
          <Form.Item label="Roles" name="roleIds" rules={[{ required: true, message: 'Select at least one role.' }]}>
            <Select mode="multiple" placeholder="Select roles" options={(roleOptions.data ?? []).map((r) => ({ value: r.id, label: r.name }))} />
          </Form.Item>
          <Form.Item label="Link to employee" name="employeeId" extra="Optional — only unlinked, active employees are shown.">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="No employee link"
              options={(linkableEmployees.data ?? []).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }))}
            />
          </Form.Item>
          <Form.Item className="mb-0 mt-4">
            <div className="flex justify-end gap-[10px]">
              <Button onClick={() => setInviteOpen(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={inviteMutation.isPending}>
                Send Invitation
              </Button>
            </div>
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
