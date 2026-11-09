'use client';

import { useMemo, useState } from 'react';
import { App, Button, Drawer, Form, Input, Popconfirm } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { DraftFormNote, useApplyFormDraft, useFormDraft } from '@/components/form-draft';

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  memberCount: number;
}

interface NameFormValues {
  name: string;
  description?: string;
}

interface PermissionCatalogEntry {
  key: string;
  resource: string;
  action: string;
  description: string | null;
}

function titleCase(value: string): string {
  return value
    .split(/[_.]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const PAGE_SIZE = 25;

function groupByResource(catalog: PermissionCatalogEntry[]): Map<string, PermissionCatalogEntry[]> {
  const groups = new Map<string, PermissionCatalogEntry[]>();
  for (const entry of catalog) {
    const group = groups.get(entry.resource) ?? [];
    group.push(entry);
    groups.set(entry.resource, group);
  }
  return groups;
}

/**
 * The drawer body mounts fresh (via a `key` on the parent Drawer) each time
 * it opens for a different role or mode, so its initial state can be derived
 * directly from already-loaded props at mount time — no effect-based sync
 * needed to bring in async query data.
 */
function RoleFormBody({
  mode,
  formKey,
  initialName,
  initialDescription,
  initialPermissionKeys,
  permissionCatalog,
  onSubmit,
  onCancel,
  submitting,
}: {
  mode: 'create' | 'edit' | 'view';
  formKey: string;
  initialName: string;
  initialDescription: string | null;
  initialPermissionKeys: string[];
  permissionCatalog: PermissionCatalogEntry[];
  onSubmit: (values: NameFormValues, permissionKeys: string[]) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const isReadOnly = mode === 'view';
  const formDraft = useFormDraft(isReadOnly ? 'role:view' : formKey);
  const stored = (formDraft.payload ?? null) as { name?: string; description?: string | null; permissionKeys?: string[] } | null;
  return (
    <RoleFormFields
      mode={mode}
      formDraft={formDraft}
      stored={stored}
      initialName={initialName}
      initialDescription={initialDescription}
      initialPermissionKeys={initialPermissionKeys}
      permissionCatalog={permissionCatalog}
      onSubmit={onSubmit}
      onCancel={onCancel}
      submitting={submitting}
    />
  );
}

function RoleFormFields({
  mode,
  formDraft,
  stored,
  initialName,
  initialDescription,
  initialPermissionKeys,
  permissionCatalog,
  onSubmit,
  onCancel,
  submitting,
}: {
  mode: 'create' | 'edit' | 'view';
  formDraft: ReturnType<typeof useFormDraft>;
  stored: { name?: string; description?: string | null; permissionKeys?: string[] } | null;
  initialName: string;
  initialDescription: string | null;
  initialPermissionKeys: string[];
  permissionCatalog: PermissionCatalogEntry[];
  onSubmit: (values: NameFormValues, permissionKeys: string[]) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const isReadOnly = mode === 'view';
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(
    () => new Set(stored?.permissionKeys ?? initialPermissionKeys),
  );
  const [permissionsApplied, setPermissionsApplied] = useState(Boolean(stored?.permissionKeys));
  if (!permissionsApplied && stored?.permissionKeys) {
    setPermissionsApplied(true);
    setSelectedPermissions(new Set(stored.permissionKeys));
  }
  const [form] = Form.useForm<NameFormValues>();
  useApplyFormDraft(form, formDraft.payload);
  const permissionGroups = useMemo(() => groupByResource(permissionCatalog), [permissionCatalog]);

  const togglePermission = (key: string) => {
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <>
      <Form<NameFormValues>
        form={form}
        layout="vertical"
        requiredMark
        disabled={isReadOnly}
        initialValues={{
          name: stored?.name ?? initialName,
          ...((stored?.description ?? initialDescription) != null ? { description: stored?.description ?? initialDescription } : {}),
        }}
        onFinish={(values) => onSubmit(values, Array.from(selectedPermissions))}
      >
        <Form.Item label="Name" name="name" rules={[{ required: true, message: 'Name is required.' }, { max: 100 }]}>
          <Input placeholder="e.g. Site Supervisor" />
        </Form.Item>
        <Form.Item label="Description" name="description" rules={[{ max: 1000 }]}>
          <Input.TextArea rows={2} placeholder="Optional" />
        </Form.Item>

        <div className="mt-2">
          <h4 className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Permissions</h4>
          <div className="flex flex-col gap-4">
            {Array.from(permissionGroups.entries()).map(([resource, entries]) => (
              <div key={resource}>
                <p className="mb-1 text-[12.5px] font-semibold capitalize text-ink">{resource.replace(/_/g, ' ')}</p>
                <div className="flex flex-col gap-1 pl-1">
                  {entries.map((entry) => (
                    <label key={entry.key} className="flex items-center gap-2 text-[13px] text-text">
                      <input
                        type="checkbox"
                        checked={selectedPermissions.has(entry.key)}
                        disabled={isReadOnly}
                        onChange={() => togglePermission(entry.key)}
                      />
                      <span>{entry.description ?? titleCase(entry.action)}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <Form.Item className="mt-4 mb-0">
          <div className="flex flex-wrap justify-end gap-[10px]">
            <Button onClick={onCancel}>{isReadOnly ? 'Close' : 'Cancel'}</Button>
            {!isReadOnly && formDraft.payload ? (
              <DraftFormNote saveLabel={mode === 'create' ? 'Save' : 'Save changes'} />
            ) : null}
            {!isReadOnly ? (
              <>
                <Button
                  htmlType="button"
                  loading={formDraft.saving}
                  onClick={() =>
                    formDraft.save({
                      ...(form.getFieldsValue(true) as unknown as Record<string, unknown>),
                      permissionKeys: Array.from(selectedPermissions),
                    })
                  }
                >
                  Save as draft
                </Button>
                <Button type="primary" htmlType="submit" loading={submitting}>
                  {mode === 'create' ? 'Save' : 'Save changes'}
                </Button>
              </>
            ) : null}
          </div>
        </Form.Item>
      </Form>
    </>
  );
}

/**
 * Users, Roles & Permissions — new required screen (docs/04 §18: no usable
 * HTML prototype). Built with the shared shell/card/table/drawer language
 * from docs/15, not copied from a prototype file.
 */
export default function RolesPage() {
  const { message } = App.useApp();
  const me = trpc.auth.me.useQuery();
  const canManage = (me.data?.permissions ?? []).includes('user.manage');

  const utils = trpc.useUtils();
  const list = trpc.roles.list.useQuery();
  const catalog = trpc.roles.listPermissionCatalog.useQuery();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [drawerRoleId, setDrawerRoleId] = useState<string | null>(null);
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit' | 'view'>('create');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const detail = trpc.roles.getDetail.useQuery(
    { roleId: drawerRoleId ?? '' },
    { enabled: drawerOpen && drawerMode !== 'create' && !!drawerRoleId },
  );

  const filtered = useMemo(() => {
    const rows = (list.data ?? []) as RoleRow[];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) => row.name.toLowerCase().includes(q) || (row.description ?? '').toLowerCase().includes(q),
    );
  }, [list.data, search]);

  const invalidate = async () => {
    await Promise.all([utils.roles.list.invalidate(), utils.roles.getDetail.invalidate()]);
  };
  const clearDraft = trpc.formDrafts.clear.useMutation();

  const createMutation = trpc.roles.create.useMutation({
    onSuccess: async () => {
      message.success('Role created.');
      setDrawerOpen(false);
      clearDraft.mutate({ formKey: 'role:new' });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const updateMutation = trpc.roles.update.useMutation({ onError: (error) => message.error(error.message) });
  const setPermissionsMutation = trpc.roles.setPermissions.useMutation({ onError: (error) => message.error(error.message) });
  const deleteMutation = trpc.roles.delete.useMutation({
    onSuccess: async () => {
      message.success('Role deleted.');
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const openCreate = () => {
    setDrawerMode('create');
    setDrawerRoleId(null);
    setDrawerOpen(true);
  };
  const openView = (row: RoleRow) => {
    setDrawerMode('view');
    setDrawerRoleId(row.id);
    setDrawerOpen(true);
  };
  const openEdit = (row: RoleRow) => {
    setDrawerMode('edit');
    setDrawerRoleId(row.id);
    setDrawerOpen(true);
  };

  const handleSubmit = async (values: NameFormValues, permissionKeys: string[]) => {
    if (drawerMode === 'create') {
      createMutation.mutate({ name: values.name, description: values.description, permissionKeys });
      return;
    }
    if (drawerMode === 'edit' && detail.data) {
      await updateMutation.mutateAsync({
        roleId: detail.data.id,
        name: values.name,
        description: values.description,
        expectedVersion: detail.data.version,
      });
      await setPermissionsMutation.mutateAsync({ roleId: detail.data.id, permissionKeys });
      message.success('Role updated.');
      clearDraft.mutate({ formKey: `role:${detail.data.id}` });
      setDrawerOpen(false);
      await invalidate();
    }
  };

  const columns: ColumnsType<RoleRow> = [
    { title: 'Name', dataIndex: 'name', key: 'name', render: (v: string) => <span className="font-semibold text-ink">{v}</span> },
    {
      title: 'Type',
      dataIndex: 'isSystem',
      key: 'isSystem',
      width: 100,
      render: (isSystem: boolean) =>
        isSystem ? (
          <StatusTag status="SYSTEM" tone="info" label="System" />
        ) : (
          <StatusTag status="CUSTOM" tone="brand" label="Custom" />
        ),
    },
    { title: 'Description', dataIndex: 'description', key: 'description', render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
    { title: 'Members', dataIndex: 'memberCount', key: 'memberCount', width: 100, align: 'right' },
    {
      title: '',
      key: 'actions',
      width: 200,
      align: 'right',
      render: (_v, row) => (
        <div className="flex justify-end gap-2">
          {row.isSystem ? (
            <Button size="small" onClick={() => openView(row)}>
              View
            </Button>
          ) : (
            <>
              <Button size="small" onClick={() => openEdit(row)}>
                Edit
              </Button>
              {canManage ? (
                <Popconfirm
                  title={
                    row.memberCount> 0
                      ? 'This role is assigned to users and cannot be deleted.'
                      : 'Delete this role?'
                  }
                  okText="Delete"
                  okButtonProps={{ danger: true, disabled: row.memberCount > 0 }}
                  onConfirm={() => {
                    if (row.memberCount === 0) deleteMutation.mutate({ roleId: row.id });
                  }}
                >
                  <Button size="small" danger>
                    Delete
                  </Button>
                </Popconfirm>
              ) : null}
            </>
          )}
        </div>
      ),
    },
  ];

  const drawerTitle = drawerMode === 'create' ? 'New Role' : drawerMode === 'edit' ? 'Edit Role' : 'View Role';
  const bodyReady = drawerMode === 'create' || (!detail.isLoading && !!detail.data);

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description="Define roles and the permissions each one grants. Assign roles to users from the Users screen."
        actions={
          canManage ? (
            <Button type="primary" onClick={openCreate}>
              New Role
            </Button>
          ) : undefined
        }
      />

      <UiCard flush>
        <FilterCard>
          <FilterField label="Search">
            <Input
              allowClear
              placeholder="Search roles…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-[240px]"
            />
          </FilterField>
        </FilterCard>

        <EntityTable<RoleRow>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load roles. Please retry.' : undefined}
          emptyTitle="No roles found"
          emptyDescription={canManage ? 'Use "New Role" to add one.' : undefined}
          page={page}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>

      <Drawer open={drawerOpen} title={drawerTitle} onClose={() => setDrawerOpen(false)} width={480} destroyOnHidden>
        {!bodyReady ? (
          <p className="text-[13px] text-muted">Loading…</p>
        ) : (
          <RoleFormBody
            key={drawerMode === 'create' ? 'create' : (detail.data?.id ?? 'loading')}
            mode={drawerMode}
            formKey={drawerMode === 'create' ? 'role:new' : `role:${detail.data?.id ?? 'unknown'}`}
            initialName={drawerMode === 'create' ? '' : (detail.data?.name ?? '')}
            initialDescription={drawerMode === 'create' ? null : (detail.data?.description ?? null)}
            initialPermissionKeys={drawerMode === 'create' ? [] : (detail.data?.permissionKeys ?? [])}
            permissionCatalog={catalog.data ?? []}
            onSubmit={handleSubmit}
            onCancel={() => setDrawerOpen(false)}
            submitting={createMutation.isPending || updateMutation.isPending || setPermissionsMutation.isPending}
          />
        )}
      </Drawer>
    </>
  );
}
