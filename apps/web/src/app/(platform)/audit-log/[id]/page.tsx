'use client';

import { useParams, useRouter } from 'next/navigation';
import { Button } from 'antd';
import { PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDateTime } from '@/lib/format';

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="mb-3">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-[.06em] text-muted-2">{label}</p>
      <pre className="max-h-[240px] overflow-auto rounded-ui bg-ui-2 p-3 text-[12px] text-text">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export default function AuditEventDetailPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = String(params.id ?? '');

  const detail = trpc.audit.getById.useQuery({ id: eventId }, { enabled: !!eventId });

  if (detail.isError) {
    return (
      <>
        <PageHeader title="Audit Event" description="Could not load this audit event." />
      </>
    );
  }
  if (detail.isLoading || !detail.data) {
    return (
      <>
        <PageHeader title="Audit Event" description="Loading…" />
      </>
    );
  }

  const row = detail.data;

  return (
    <>
      <PageHeader
        title="Audit Event Details"
        actions={<Button onClick={() => router.push('/audit-log')}>Back to List</Button>}
      />

      <UiCard className="mb-4">
        <div className="grid grid-cols-2 gap-2 text-[13px]">
          <span className="text-muted">Time</span>
          <span className="text-text">{formatDateTime(row.createdAt)}</span>
          <span className="text-muted">Actor</span>
          <span className="text-text">{row.actorEmail ?? '—'}</span>
          <span className="text-muted">Entity Type</span>
          <span className="text-text">{row.entityType}</span>
          <span className="text-muted">Entity ID</span>
          <span className="break-all font-mono text-[12px] text-text">{row.entityId}</span>
          <span className="text-muted">Action</span>
          <span className="text-text">{row.action}</span>
          {row.legalEntityId ? (
            <>
              <span className="text-muted">Legal Entity ID</span>
              <span className="break-all font-mono text-[12px] text-text">{row.legalEntityId}</span>
            </>
          ) : null}
          {row.reason ? (
            <>
              <span className="text-muted">Reason</span>
              <span className="text-text">{row.reason}</span>
            </>
          ) : null}
          <span className="text-muted">Correlation ID</span>
          <span className="break-all font-mono text-[12px] text-text">{row.correlationId}</span>
          {row.ipAddress ? (
            <>
              <span className="text-muted">IP Address</span>
              <span className="text-text">{row.ipAddress}</span>
            </>
          ) : null}
          {row.userAgent ? (
            <>
              <span className="text-muted">User Agent</span>
              <span className="break-all text-[12px] text-text">{row.userAgent}</span>
            </>
          ) : null}
        </div>
      </UiCard>

      <UiCard>
        <JsonBlock label="Old Values" value={row.oldValues} />
        <JsonBlock label="New Values" value={row.newValues} />
        <JsonBlock label="Command Payload" value={row.commandPayload} />
      </UiCard>
    </>
  );
}
