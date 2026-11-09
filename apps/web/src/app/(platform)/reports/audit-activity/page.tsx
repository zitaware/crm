'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, StatusTag, UiCard, type StatusTagTone } from '@zitaware/ui';
import { AUDIT_ACTION_GROUP_LABELS } from '@zitaware/contracts/reports';
import type { AuditActionGroup, AuditActivityEvent, AuditActivityReport, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDateTime } from '@/lib/format';
import { ExportButtons, ReportBasisNote, ReportFilterBar, defaultPeriodFilters } from '../shared';

const GROUP_TONES: Record<AuditActionGroup, StatusTagTone> = {
  CORRECTION: 'warn',
  DELETION: 'neg',
  PERIOD_CONTROL: 'info',
  ACCESS: 'info',
  SIGN_IN: 'neg',
  EXPORT: 'mut',
  EXCEPTION: 'warn',
  ROUTINE: 'mut',
};

const when = (iso: string) => formatDateTime(iso);
const humanize = (action: string) => action.charAt(0) + action.slice(1).toLowerCase().replaceAll('_', ' ');

const eventColumns: ColumnsType<AuditActivityEvent> = [
  { title: 'When', dataIndex: 'occurredAt', key: 'occurredAt', render: when },
  { title: 'Group', dataIndex: 'group', key: 'group', render: (v: AuditActionGroup) => <StatusTag status={v} label={AUDIT_ACTION_GROUP_LABELS[v]} tone={GROUP_TONES[v]} /> },
  { title: 'Action', key: 'action', render: (_v, e) => <Link href={`/audit-log/${e.id}`} className="font-semibold text-brand hover:underline">{humanize(e.action)}</Link> },
  { title: 'Record', dataIndex: 'entityType', key: 'entityType', render: (v: string) => humanize(v) },
  { title: 'User', dataIndex: 'actorEmail', key: 'actorEmail', render: (v: string | null) => v ?? <span className="text-muted-2">System</span> },
  { title: 'Reason', dataIndex: 'reason', key: 'reason', render: (v: string | null) => v ?? <span className="text-muted-2">—</span> },
];

const groupColumns: ColumnsType<AuditActivityReport['byGroup'][number]> = [
  { title: 'Group', key: 'group', render: (_v, g) => <StatusTag status={g.group} label={g.label} tone={GROUP_TONES[g.group]} /> },
  { title: 'Events', dataIndex: 'count', key: 'count', align: 'right' },
];

const actorColumns: ColumnsType<AuditActivityReport['byActor'][number]> = [
  { title: 'User', dataIndex: 'actorEmail', key: 'actorEmail' },
  { title: 'Events', dataIndex: 'events', key: 'events', align: 'right' },
  { title: 'Sensitive', dataIndex: 'sensitive', key: 'sensitive', align: 'right', render: (v: number) => (v ? <b>{v}</b> : 0) },
];

/** Audit Activity — docs/09 audit coverage and operational alerts, grouped by control (ADR-120). */
export default function AuditActivityPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultPeriodFilters);
  const report = trpc.reports.auditActivity.useQuery(filters);
  const data = report.data;
  const count = (g: AuditActionGroup) => data?.byGroup.find((x) => x.group === g)?.count ?? 0;

  return (
    <>
      <PageHeader title="Audit Activity" description="Who did what in the period, with reversals, period reopens, access changes, exports and sign-in failures called out." actions={<ExportButtons reportKey="audit-activity" filters={filters} />} />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} period />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}
      {data?.repeatedSignInFailures.length ? (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          message="Repeated sign-in failures"
          description={data.repeatedSignInFailures.map((f) => `${f.email ?? f.userId}: ${f.failures} failures, last ${when(f.lastAt)}`).join(' · ')}
        />
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Events" value={data ? String(data.totals.events) : '—'} sub={data ? `${data.totals.sensitive} sensitive` : undefined} />
        <KpiCard label="Reversals & Voids" value={data ? String(count('CORRECTION')) : '—'} />
        <KpiCard label="Period Locks & Reopens" value={data ? String(count('PERIOD_CONTROL')) : '—'} />
        <KpiCard label="Access Changes" value={data ? String(count('ACCESS')) : '—'} sub={data ? `${count('EXPORT')} exports and downloads` : undefined} />
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <UiCard title="By Control Group" flush>
          <Table<AuditActivityReport['byGroup'][number]> rowKey="group" size="small" pagination={false} loading={report.isLoading} columns={groupColumns} dataSource={data?.byGroup ?? []} />
        </UiCard>
        <UiCard title="By User" flush>
          <Table<AuditActivityReport['byActor'][number]> rowKey="actorEmail" size="small" pagination={{ pageSize: 10, hideOnSinglePage: true }} loading={report.isLoading} columns={actorColumns} dataSource={data?.byActor ?? []} />
        </UiCard>
      </div>

      <UiCard title="Sensitive Events" flush className="mb-4">
        <Table<AuditActivityEvent>
          rowKey="id"
          size="small"
          pagination={{ pageSize: 25, hideOnSinglePage: true }}
          loading={report.isLoading}
          columns={eventColumns}
          dataSource={data?.sensitiveEvents ?? []}
          tableLayout="auto" scroll={{ x: true }}
          locale={{ emptyText: 'No sensitive actions in this period.' }}
        />
        <p className="m-0 border-t border-ui-2 px-4 py-3 text-[12px] text-muted">
          The most recent 200. Search the full trail on <Link href="/audit-log" className="text-brand hover:underline">Audit Log</Link>.
        </p>
      </UiCard>
    </>
  );
}
