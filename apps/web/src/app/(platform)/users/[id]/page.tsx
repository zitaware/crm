'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { App, Button, Collapse, Input, Popconfirm, Segmented, Select, Tag } from 'antd';
import { PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDateTime } from '@/lib/format';

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return formatDateTime(value);
}

function titleCase(value: string): string {
  return value
    .split(/[_.]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

interface PermissionCatalogEntry {
  key: string;
  resource: string;
  action: string;
  description: string | null;
}

type PermissionState = 'inherited' | 'granted' | 'revoked';

/**
 * Resource-grouped, searchable, collapsible permission editor — replaces
 * the old flat 73-row checkbox-style list. Each row is a 3-way Grant /
 * Inherit / Revoke toggle rather than three separate buttons, and each
 * resource group is collapsed by default (expanded automatically when it
 * has an active override, or when the search box matches something inside
 * it) so the page opens scannable instead of a 70+ row wall.
 */
function PermissionsCard({
  overrideByKey,
  effectiveSet,
  permissionCatalog,
  onSetOverride,
  onClearOverride,
}: {
  overrideByKey: Map<string, { permissionKey: string; effect: 'GRANT' | 'REVOKE'; reason: string | null }>;
  effectiveSet: Set<string>;
  permissionCatalog: PermissionCatalogEntry[];
  onSetOverride: (permissionKey: string, effect: 'GRANT' | 'REVOKE') => void;
  onClearOverride: (permissionKey: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [openKeys, setOpenKeys] = useState<string[]>(() =>
    Array.from(new Set(permissionCatalog.filter((e) => overrideByKey.has(e.key)).map((e) => e.resource))),
  );

  const permissionState = (key: string): PermissionState => {
    const override = overrideByKey.get(key);
    if (override?.effect === 'GRANT') return 'granted';
    if (override?.effect === 'REVOKE') return 'revoked';
    return 'inherited';
  };

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byResource = new Map<string, PermissionCatalogEntry[]>();
    for (const entry of permissionCatalog) {
      const label = entry.description ?? titleCase(entry.action);
      if (q && !label.toLowerCase().includes(q) && !entry.resource.toLowerCase().includes(q) && !entry.key.toLowerCase().includes(q)) {
        continue;
      }
      const group = byResource.get(entry.resource) ?? [];
      group.push(entry);
      byResource.set(entry.resource, group);
    }
    return Array.from(byResource.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [permissionCatalog, search]);

  const totalCount = permissionCatalog.length;
  const effectiveCount = permissionCatalog.filter((e) => effectiveSet.has(e.key)).length;
  const overrideCount = overrideByKey.size;

  return (
    <UiCard title="Permissions" className="mt-4">
      <p className="mb-3 text-[12.5px] text-muted">
        Effective permission = role grants, plus any override below. A revoke always wins over a role grant.
      </p>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Input.Search
          allowClear
          placeholder="Search permissions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-[320px]"
        />
        <div className="flex items-center gap-3 text-[12.5px] text-muted">
          <span>
            <b className="text-text">{effectiveCount}</b> of {totalCount} effective
          </span>
          {overrideCount > 0 ? (
            <span className="rounded-full bg-brand-soft px-2 py-0.5 font-semibold text-brand">
              {overrideCount} override{overrideCount === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
      </div>

      <Collapse
        activeKey={search.trim() ? groups.map(([resource]) => resource) : openKeys}
        onChange={(keys) => setOpenKeys(Array.isArray(keys) ? keys : [keys])}
        items={groups.map(([resource, entries]) => {
          const groupEffective = entries.filter((e) => effectiveSet.has(e.key)).length;
          const groupOverrides = entries.filter((e) => overrideByKey.has(e.key)).length;
          return {
            key: resource,
            label: (
              <div className="flex items-center gap-2">
                <span className="font-semibold text-ink">{titleCase(resource)}</span>
                <span className="text-[12px] text-muted">
                  {groupEffective}/{entries.length} effective
                </span>
                {groupOverrides > 0 ? (
                  <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[11px] font-semibold text-brand">
                    {groupOverrides} override{groupOverrides === 1 ? '' : 's'}
                  </span>
                ) : null}
              </div>
            ),
            children: (
              <div className="flex flex-col divide-y divide-ui-2">
                {entries.map((entry) => {
                  const state = permissionState(entry.key);
                  const isEffective = effectiveSet.has(entry.key);
                  return (
                    <div key={entry.key} className="flex flex-wrap items-center justify-between gap-3 py-2">
                      <span className={`text-[13px] ${isEffective ? 'text-text' : 'text-muted-2'}`}>
                        {entry.description ?? titleCase(entry.action)}
                        {isEffective ? null : <span className="ml-1 text-[11.5px]">(not granted)</span>}
                      </span>
                      <Segmented
                        size="small"
                        value={state}
                        onChange={(value) => {
                          const next = value as PermissionState;
                          if (next === 'inherited') onClearOverride(entry.key);
                          else onSetOverride(entry.key, next === 'granted' ? 'GRANT' : 'REVOKE');
                        }}
                        options={[
                          { label: 'Inherit', value: 'inherited' },
                          { label: <span className={state === 'granted' ? 'text-positive' : undefined}>Grant</span>, value: 'granted' },
                          { label: <span className={state === 'revoked' ? 'text-negative' : undefined}>Revoke</span>, value: 'revoked' },
                        ]}
                      />
                    </div>
                  );
                })}
              </div>
            ),
          };
        })}
      />
      {groups.length === 0 ? <p className="py-4 text-center text-[13px] text-muted-2">No permissions match &quot;{search}&quot;.</p> : null}
    </UiCard>
  );
}

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = String(params.id ?? '');
  const { message } = App.useApp();
  const utils = trpc.useUtils();

  const detail = trpc.users.getDetail.useQuery({ userId }, { enabled: !!userId });
  const roleOptions = trpc.roles.list.useQuery();
  const permissionCatalog = trpc.roles.listPermissionCatalog.useQuery();
  const linkableEmployees = trpc.employees.listLinkable.useQuery();

  const [addRoleId, setAddRoleId] = useState<string | undefined>(undefined);
  const [linkEmployeeId, setLinkEmployeeId] = useState<string | undefined>(undefined);

  const invalidate = async () => {
    await Promise.all([
      utils.users.list.invalidate(),
      utils.users.getDetail.invalidate({ userId }),
      utils.employees.listLinkable.invalidate(),
    ]);
  };

  const assignRoleMutation = trpc.roles.assignRole.useMutation({
    onSuccess: async () => {
      setAddRoleId(undefined);
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const removeRoleMutation = trpc.roles.removeRole.useMutation({
    onSuccess: async () => await invalidate(),
    onError: (error) => message.error(error.message),
  });
  const setOverrideMutation = trpc.roles.setPermissionOverride.useMutation({
    onSuccess: async () => await invalidate(),
    onError: (error) => message.error(error.message),
  });
  const clearOverrideMutation = trpc.roles.clearPermissionOverride.useMutation({
    onSuccess: async () => await invalidate(),
    onError: (error) => message.error(error.message),
  });
  const disableMutation = trpc.users.disable.useMutation({
    onSuccess: async () => {
      message.success('User disabled.');
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const enableMutation = trpc.users.enable.useMutation({
    onSuccess: async () => {
      message.success('User enabled.');
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const revokeSessionsMutation = trpc.users.revokeSessions.useMutation({
    onSuccess: async () => {
      message.success('All sessions revoked.');
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const reinviteMutation = trpc.users.reinvite.useMutation({
    onSuccess: async () => {
      message.success('Invitation resent.');
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const linkEmployeeMutation = trpc.users.linkEmployee.useMutation({
    onSuccess: async () => {
      setLinkEmployeeId(undefined);
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  // ADR-174: an Admin logs in as this user to see what they see.
  const me = trpc.auth.me.useQuery();
  const impersonate = trpc.auth.startImpersonation.useMutation({
    onSuccess: () => window.location.assign('/'),
    onError: (error) => message.error(error.message),
  });
  const unlinkEmployeeMutation = trpc.users.unlinkEmployee.useMutation({
    onSuccess: async () => await invalidate(),
    onError: (error) => message.error(error.message),
  });

  if (detail.isError) {
    return <PageHeader title="User" description="Could not load this user." />;
  }
  if (detail.isLoading || !detail.data) {
    return <PageHeader title="User" description="Loading…" />;
  }

  const d = detail.data;
  const assignedRoleIds = new Set(d.roles.map((r) => r.id));
  const availableRoles = (roleOptions.data ?? []).filter((r) => !assignedRoleIds.has(r.id));
  const effectiveSet = new Set(d.effectivePermissions);
  const overrideByKey = new Map(d.overrides.map((o) => [o.permissionKey, o]));
  const canImpersonate =
    (me.data?.permissions ?? []).includes('user.impersonate') && !me.data?.impersonatedBy && d.status === 'ACTIVE' && d.id !== me.data?.userId;

  return (
    <>
      <PageHeader
        title={d.displayName}
        description={d.email}
        actions={
          <div className="flex items-center gap-2">
            <StatusTag status={d.status} />
            {canImpersonate ? (
              <Popconfirm
                title={`Log in as ${d.displayName}?`}
                description="You will see and do exactly what they can, and it is recorded. Use “Return to my login” at the top to come back."
                okText="Log in as"
                onConfirm={() => impersonate.mutate({ userId: d.id })}
              >
                <Button type="primary" loading={impersonate.isPending}>
                  Log in as
                </Button>
              </Popconfirm>
            ) : null}
            <Button onClick={() => router.push('/users')}>Back to List</Button>
          </div>
        }
      />

      <UiCard>
        <div className="grid grid-cols-2 gap-y-2 text-[13px] text-muted md:grid-cols-4">
          <span>Invited: {formatDate(d.invitedAt)}</span>
          <span>Last login: {formatDate(d.lastLoginAt)}</span>
          {d.disabledAt ? <span>Disabled: {formatDate(d.disabledAt)}</span> : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {d.status === 'INVITED' ? (
            <Button size="small" loading={reinviteMutation.isPending} onClick={() => reinviteMutation.mutate({ userId })}>
              Resend Invitation
            </Button>
          ) : null}
          {d.status === 'ACTIVE' ? (
            <Popconfirm title="Disable this user? Active sessions will be revoked." onConfirm={() => disableMutation.mutate({ userId })}>
              <Button size="small" danger loading={disableMutation.isPending}>
                Disable
              </Button>
            </Popconfirm>
          ) : null}
          {d.status === 'DISABLED' ? (
            <Button size="small" loading={enableMutation.isPending} onClick={() => enableMutation.mutate({ userId })}>
              Enable
            </Button>
          ) : null}
          <Popconfirm title="Revoke all active sessions for this user?" onConfirm={() => revokeSessionsMutation.mutate({ userId })}>
            <Button size="small" loading={revokeSessionsMutation.isPending}>
              Revoke Sessions
            </Button>
          </Popconfirm>
        </div>
      </UiCard>

      <UiCard title="Linked Employee" className="mt-4">
        {d.employee ? (
          <div className="flex items-center justify-between rounded-ui border border-ui bg-ui-2 px-3 py-2">
            <span className="text-[13px] text-text">
              {d.employee.fullName} <span className="text-muted">({d.employee.employeeCode})</span>
            </span>
            <Popconfirm title="Unlink this employee record?" onConfirm={() => unlinkEmployeeMutation.mutate({ userId })}>
              <Button size="small" loading={unlinkEmployeeMutation.isPending}>
                Unlink
              </Button>
            </Popconfirm>
          </div>
        ) : (
          <div className="flex gap-2">
            <Select
              className="flex-1"
              placeholder="Select an employee to link"
              value={linkEmployeeId}
              onChange={setLinkEmployeeId}
              options={(linkableEmployees.data ?? []).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }))}
              showSearch
              optionFilterProp="label"
            />
            <Button
              disabled={!linkEmployeeId}
              loading={linkEmployeeMutation.isPending}
              onClick={() => linkEmployeeId && linkEmployeeMutation.mutate({ userId, employeeId: linkEmployeeId })}
            >
              Link
            </Button>
          </div>
        )}
      </UiCard>

      <UiCard title="Roles" className="mt-4">
        <div className="flex flex-wrap gap-2">
          {d.roles.map((role) => (
            <Tag key={role.id} closable onClose={() => removeRoleMutation.mutate({ userId, roleId: role.id })}>
              {role.name}
            </Tag>
          ))}
          {d.roles.length === 0 ? <span className="text-[13px] text-muted-2">No roles assigned.</span> : null}
        </div>
        <div className="mt-3 flex gap-2">
          <Select
            className="flex-1 max-w-[320px]"
            placeholder="Add a role"
            value={addRoleId}
            onChange={setAddRoleId}
            options={availableRoles.map((r) => ({ value: r.id, label: r.name }))}
          />
          <Button
            disabled={!addRoleId}
            loading={assignRoleMutation.isPending}
            onClick={() => addRoleId && assignRoleMutation.mutate({ userId, roleId: addRoleId })}
          >
            Add
          </Button>
        </div>
      </UiCard>

      <PermissionsCard
        overrideByKey={overrideByKey}
        effectiveSet={effectiveSet}
        permissionCatalog={permissionCatalog.data ?? []}
        onSetOverride={(permissionKey, effect) => setOverrideMutation.mutate({ userId, permissionKey, effect, reason: undefined })}
        onClearOverride={(permissionKey) => clearOverrideMutation.mutate({ userId, permissionKey })}
      />
    </>
  );
}
