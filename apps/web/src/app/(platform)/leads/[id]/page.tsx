'use client';

import { Suspense, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { App, Button, Input, Modal, Tabs } from 'antd';
import { PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { DocumentsTab } from '@/components/documents-tab';
import { ProjectFormBody } from '../../projects/shared';
import type { ProjectCoreFormValues } from '../../projects/shared';
import { formatDate, formatMoney, LeadFormBody, PIPELINE_STAGES, StageBadge, StagePicker, STAGE_META } from '../shared';
import type { LeadCoreFormValues } from '../shared';

function StageStrip({ stage }: { stage: string }) {
  const isWon = stage === 'TENDER_WON';
  const isLost = stage === 'TENDER_LOST';
  const currentIndex = PIPELINE_STAGES.indexOf(stage as (typeof PIPELINE_STAGES)[number]);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-ui border border-ui bg-ui-2 p-3">
      {PIPELINE_STAGES.map((s, index) => {
        const done = !isWon && !isLost && index <= currentIndex;
        const active = !isWon && !isLost && index === currentIndex;
        return (
          <div
            key={s}
            className={
              'rounded-full px-3 py-1 text-[12px] font-medium ' +
              (active
                ? 'bg-ink text-white'
                : done
                  ? 'bg-brand-soft text-brand'
                  : 'bg-ui text-muted')
            }
>
            {STAGE_META[s]!.label}
          </div>
        );
      })}
      <div className={'rounded-full px-3 py-1 text-[12px] font-medium ' + (isWon ? 'bg-positive-soft text-positive' : 'bg-ui text-muted')}>
        ✓ Won
      </div>
      <div className={'rounded-full px-3 py-1 text-[12px] font-medium ' + (isLost ? 'bg-negative-soft text-negative' : 'bg-ui text-muted')}>
        ✕ Lost
      </div>
    </div>
  );
}

function UpdatesTab({ leadId }: { leadId: string }) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const updates = trpc.leads.listUpdates.useQuery({ leadId });
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');

  const createUpdate = trpc.leads.createUpdate.useMutation({
    onSuccess: async () => {
      setTitle('');
      setNote('');
      await utils.leads.listUpdates.invalidate({ leadId });
    },
    onError: (error) => message.error(error.message),
  });

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[360px_1fr]">
      <UiCard title="Add Update">
        <div className="flex flex-col gap-3">
          <Input placeholder="e.g. Call with Joint Secretary" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input.TextArea
            placeholder="What happened, decisions, next steps…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
          />
          <Button
            type="primary"
            disabled={!title.trim() || !note.trim()}
            loading={createUpdate.isPending}
            onClick={() => createUpdate.mutate({ leadId, title: title.trim(), note: note.trim() })}
          >
            Add Update
          </Button>
          <p className="text-[12px] text-muted">Each update is stamped with today&apos;s date and appears on the timeline.</p>
        </div>
      </UiCard>

      <UiCard title={`Update Timeline (${updates.data?.length ?? 0})`}>
        {updates.isLoading ? (
          <p className="text-muted">Loading…</p>
        ) : updates.isError ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-negative">Could not load updates. Please retry.</p>
            <Button size="small" onClick={() => updates.refetch()}>
              Retry
            </Button>
          </div>
        ) : (updates.data ?? []).length === 0 ? (
          <p className="text-muted">No updates yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {(updates.data ?? []).map((update) => (
              <div key={update.id} className="border-l-2 border-brand pl-3">
                <div className="font-semibold text-ink">{update.title}</div>
                <div className="text-[12px] text-muted">
                  {formatDate(update.createdAt)}
                  {update.createdByEmail ? ` · by ${update.createdByEmail}` : ''}
                </div>
                <p className="mt-1 text-[13.5px] text-ink">{update.note}</p>
              </div>
            ))}
          </div>
        )}
      </UiCard>
    </div>
  );
}

function WinProjectModal({
  open,
  lead,
  tenderId,
  tenderVersion,
  suggestedAmount,
  onClose,
}: {
  open: boolean;
  lead: {
    id: string;
    version: number;
    clientId: string;
    title: string;
    description: string | null;
    introducerId: string | null;
    assignedToEmployeeId: string | null;
  };
  tenderId: string | null;
  tenderVersion: number | null;
  suggestedAmount: string;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const utils = trpc.useUtils();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const [saving, setSaving] = useState(false);

  const createProject = trpc.projects.create.useMutation();
  const clearProjectDraft = trpc.formDrafts.clear.useMutation();
  const updateLead = trpc.leads.update.useMutation();
  const updateTender = trpc.tenders.update.useMutation();

  const confirm = async (values: ProjectCoreFormValues) => {
    setSaving(true);
    try {
      if (tenderId !== null && tenderVersion !== null && permissions.includes('tender.update')) {
        await updateTender.mutateAsync({
          id: tenderId,
          expectedVersion: tenderVersion,
          result: 'WON',
          resultDate: new Date().toISOString().slice(0, 10),
        });
      }
      const project = await createProject.mutateAsync({
        clientId: lead.clientId,
        legalEntityId: values.legalEntityId,
        name: values.name.trim(),
        leadId: lead.id,
        gstApplicable: values.gstApplicable,
        ...(tenderId ? { tenderId } : {}),
        ...(values.projectTypeId ? { projectTypeId: values.projectTypeId } : {}),
        ...(values.projectManagerId ? { projectManagerId: values.projectManagerId } : {}),
        ...(values.salesManagerId ? { salesManagerId: values.salesManagerId } : {}),
        ...(values.introducerId ? { introducerId: values.introducerId } : {}),
        ...(values.description?.trim() ? { description: values.description.trim() } : {}),
        ...(values.value ? { value: values.value } : {}),
        ...(values.workOrderNumber?.trim() ? { workOrderNumber: values.workOrderNumber.trim() } : {}),
        ...(values.workOrderDate ? { workOrderDate: values.workOrderDate } : {}),
      });
      await updateLead.mutateAsync({ id: lead.id, expectedVersion: lead.version, stage: 'TENDER_WON' });
      message.success('Project created.');
      clearProjectDraft.mutate({ formKey: `project:from-lead:${lead.id}` });
      await utils.leads.getDetail.invalidate({ id: lead.id });
      await utils.projects.list.invalidate();
      onClose();
      router.push(`/projects/${project.id}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not create the project.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Create the project"
      onCancel={onClose}
      footer={null}
      width={960}
      destroyOnClose
    >
      <p className="mb-3 text-[12.5px] text-muted">
        Confirm every project detail. Fields already entered are filled in. The contract value is the project amount.
      </p>
      {open ? (
        <ProjectFormBody
          mode="create"
          formKey={`project:from-lead:${lead.id}`}
          originLocked
          submitting={saving}
          onCancel={onClose}
          onSubmit={confirm}
          initial={{
            clientId: lead.clientId,
            legalEntityId: '',
            leadId: lead.id,
            tenderId: tenderId ?? undefined,
            projectManagerId: lead.assignedToEmployeeId ?? undefined,
            salesManagerId: lead.assignedToEmployeeId ?? undefined,
            introducerId: lead.introducerId ?? undefined,
            projectTypeId: undefined,
            name: lead.title,
            description: lead.description ?? undefined,
            value: suggestedAmount || undefined,
            gstApplicable: true,
            workOrderNumber: undefined,
            workOrderDate: undefined,
          }}
        />
      ) : null}
    </Modal>
  );
}

function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const leadId = String(params.id ?? '');
  const { message } = App.useApp();
  const openWinAfterSave = useRef(false);

  const me = trpc.auth.me.useQuery();
  const canUpdate = (me.data?.permissions ?? []).includes('lead.update');

  const utils = trpc.useUtils();
  const lead = trpc.leads.getDetail.useQuery({ id: leadId }, { enabled: !!leadId });
  const client = trpc.clients.getDetail.useQuery({ id: lead.data?.clientId ?? '' }, { enabled: !!lead.data?.clientId });
  const updates = trpc.leads.listUpdates.useQuery({ leadId }, { enabled: !!leadId });
  const links = trpc.documents.listLinksForEntity.useQuery({ entityType: 'LEAD', entityId: leadId }, { enabled: !!leadId });

  const [editing, setEditing] = useState(false);
  const [winOpen, setWinOpen] = useState(false);
  const canReadProjects = (me.data?.permissions ?? []).includes('project.read');
  const canCreateProject = (me.data?.permissions ?? []).includes('project.create');
  const projects = trpc.projects.list.useQuery(undefined, { enabled: canReadProjects });
  const tenders = trpc.tenders.list.useQuery(undefined, { enabled: (me.data?.permissions ?? []).includes('tender.read') });
  const existingProject = (projects.data ?? []).find((row) => row.leadId === leadId);
  const linkedTender = (tenders.data ?? []).find((row) => row.leadId === leadId);
  const createRequested =
    searchParams.get('createProject') === '1' && !!lead.data && !existingProject && canCreateProject;

  const closeWin = () => {
    setWinOpen(false);
    if (searchParams.get('createProject') === '1') router.replace(`/leads/${leadId}`);
  };

  const stageMutation = trpc.leads.update.useMutation({
    onSuccess: async () => {
      await utils.leads.getDetail.invalidate({ id: leadId });
    },
    onError: (error) => message.error(error.message),
  });

  const clearDraft = trpc.formDrafts.clear.useMutation();
  const updateMutation = trpc.leads.update.useMutation({
    onSuccess: async () => {
      message.success('Saved.');
      setEditing(false);
      await utils.leads.getDetail.invalidate({ id: leadId });
      clearDraft.mutate({ formKey: `lead:${leadId}` });
      if (openWinAfterSave.current) {
        openWinAfterSave.current = false;
        setWinOpen(true);
      }
    },
    onError: (error) => message.error(error.message),
  });

  if (lead.isError) {
    return (
      <>
        <PageHeader title="Leads" description="Could not load this record." />
      </>
    );
  }
  if (lead.isLoading || !lead.data) {
    return (
      <>
        <PageHeader title="Leads" description="Loading…" />
      </>
    );
  }

  const data = lead.data;
  const outcome = data.stage === 'TENDER_WON' || data.stage === 'TENDER_LOST';
  const tenderStage = data.stage === 'TENDER_LIVE' || data.stage === 'TENDER_FILLED' || outcome;
  const clientInitials = data.clientName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const handleSubmit = (values: LeadCoreFormValues) => {
    const becomingWon = values.stage === 'TENDER_WON' && !existingProject && canCreateProject;
    openWinAfterSave.current = becomingWon;
    const stage = becomingWon ? data.stage : values.stage;
    updateMutation.mutate({
      id: data.id,
      leadTypeId: values.leadTypeId,
      leadSourceId: values.leadSourceId,
      introducerId: values.introducerId,
      assignedToEmployeeId: values.assignedToEmployeeId,
      title: values.title,
      description: values.description,
      stage: stage as 'PROPOSAL_SENT' | 'PRESENTATION_DONE' | 'SOW_PREPARATION' | 'TENDER_LIVE' | 'TENDER_FILLED' | 'TENDER_WON' | 'TENDER_LOST',
      estimatedValue: values.estimatedValue,
      leadDate: values.leadDate,
      expectedCloseDate: values.expectedCloseDate,
      expectedTenderDate: values.expectedTenderDate,
      tenderNumber: values.tenderNumber,
      tenderDate: values.tenderDate ?? '',
      submissionDeadline: values.submissionDeadline ?? '',
      reminderOffset: values.reminderOffset as 'NONE' | 'ONE_DAY' | 'THREE_DAYS' | 'ONE_WEEK' | undefined,
      internalNote: values.internalNote,
      expectedVersion: data.version,
    });
  };

  return (
    <>
      <PageHeader
        title={data.title}
        actions={
          <div className="flex gap-2">
            <Button onClick={() => router.push('/leads')}>Back to List</Button>
            {canUpdate && !editing ? (
              <Button type="primary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
          </div>
        }
      />

      {editing ? (
        <UiCard title="Edit">
          <LeadFormBody
            key={data.id}
            mode="edit"
            formKey={`lead:${data.id}`}
            initial={{
              clientId: data.clientId,
              leadTypeId: data.leadTypeId,
              leadSourceId: data.leadSourceId,
              introducerId: data.introducerId ?? undefined,
              assignedToEmployeeId: data.assignedToEmployeeId ?? undefined,
              title: data.title,
              description: data.description ?? undefined,
              stage: data.stage,
              estimatedValue: data.estimatedValue ?? undefined,
              leadDate: data.leadDate,
              expectedCloseDate: data.expectedCloseDate ?? undefined,
              expectedTenderDate: data.expectedTenderDate ?? undefined,
              tenderNumber: data.tenderNumber ?? undefined,
              tenderDate: data.tenderDate ?? undefined,
              submissionDeadline: data.submissionDeadline ?? undefined,
              reminderOffset: data.reminderOffset ?? undefined,
              internalNote: data.internalNote ?? undefined,
            }}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(false)}
            submitting={updateMutation.isPending}
          />
        </UiCard>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand">
              {clientInitials}
            </span>
            <span>{data.clientName}</span>
            <span>·</span>
            <span>{data.leadTypeName}</span>
            <span>·</span>
            <span>Introducer: {data.introducerName ?? 'None'}</span>
            <span>·</span>
            <span>Assigned To: {data.assignedToEmployeeName ?? 'Unassigned'}</span>
            <span>·</span>
            <span>Created {formatDate(data.createdAt)}</span>
            <span>·</span>
            <StageBadge stage={data.stage} />
          </div>

          <div className="mb-3">
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Current stage</p>
            {canUpdate ? (
              <StagePicker
                value={data.stage}
                onChange={(next) => {
                  if (next === 'TENDER_WON') {
                    if (existingProject) {
                      message.info('A project already exists for this.');
                      if (data.stage !== 'TENDER_WON') {
                        stageMutation.mutate({ id: data.id, expectedVersion: data.version, stage: 'TENDER_WON' });
                      }
                      return;
                    }
                    if (!canCreateProject) {
                      message.error('You can mark this won, but creating the project needs project access.');
                      stageMutation.mutate({ id: data.id, expectedVersion: data.version, stage: 'TENDER_WON' });
                      return;
                    }
                    setWinOpen(true);
                    return;
                  }
                  if (next === data.stage) return;
                  stageMutation.mutate({
                    id: data.id,
                    expectedVersion: data.version,
                    stage: next as 'PROPOSAL_SENT' | 'PRESENTATION_DONE' | 'SOW_PREPARATION' | 'TENDER_LIVE' | 'TENDER_FILLED' | 'TENDER_LOST',
                  });
                }}
              />
            ) : (
              <StageStrip stage={data.stage} />
            )}
            {data.stage === 'TENDER_WON' && !projects.isLoading && !existingProject ? (
              <div className="lead-won-alert mt-3 flex flex-wrap items-center gap-3 rounded-ui border border-brand bg-brand-soft px-4 py-3">
                <span className="lead-won-alert-dot" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-ink">This is won and has no project.</div>
                  <div className="text-[12.5px] text-muted">Create the project to continue. You will confirm every project detail.</div>
                </div>
                {canCreateProject ? (
                  <Button type="primary" onClick={() => setWinOpen(true)}>
                    Create project
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-[12.5px] text-muted">Won asks you to confirm every project detail, then creates the project.</p>
            )}
            {existingProject ? (
              <Button className="mt-2" size="small" onClick={() => router.push(`/projects/${existingProject.id}`)}>
                Open project {existingProject.name}
              </Button>
            ) : null}
          </div>

          <Tabs
            items={[
              {
                key: 'detail',
                label: 'Detail',
                children: (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_1fr]">
                    <div className="flex flex-col gap-4">
                      <UiCard title="Details">
                        <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-[13.5px]">
                          <dt className="text-muted">Title</dt>
                          <dd>{data.title}</dd>
                          <dt className="text-muted">Client</dt>
                          <dd>{data.clientName}</dd>
                          <dt className="text-muted">Department</dt>
                          <dd>{client.data?.department ?? '—'}</dd>
                          <dt className="text-muted">Type</dt>
                          <dd>{data.leadTypeName}</dd>
                          <dt className="text-muted">Source</dt>
                          <dd>{data.leadSourceName}</dd>
                          <dt className="text-muted">Current stage</dt>
                          <dd>{STAGE_META[data.stage]?.label ?? data.stage}</dd>
                          <dt className="text-muted">Introducer</dt>
                          <dd>{data.introducerName ?? '—'}</dd>
                          {tenderStage ? (
                            <>
                              <dt className="text-muted">Reference number</dt>
                              <dd>{data.tenderNumber ?? '—'}</dd>
                            </>
                          ) : null}
                        </dl>
                      </UiCard>

                      <UiCard title="Description">
                        <p className="text-[13.5px] text-ink">{data.description ?? '—'}</p>
                      </UiCard>

                      <UiCard title={outcome ? 'Reference' : 'Key Dates'}>
                          <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-[13.5px]">
                            {outcome ? null : (
                              <>
                                <dt className="text-muted">Opened</dt>
                                <dd>{formatDate(data.leadDate)}</dd>
                                <dt className="text-muted">Expected close</dt>
                                <dd>{data.expectedCloseDate ? formatDate(data.expectedCloseDate) : '—'}</dd>
                              </>
                            )}
                            {tenderStage ? (
                              <>
                                <dt className="text-muted">Reference date</dt>
                                <dd>{data.tenderDate ? formatDate(data.tenderDate) : '—'}</dd>
                              </>
                            ) : null}
                            {tenderStage && !outcome ? (
                              <>
                                <dt className="text-muted">Submission deadline</dt>
                                <dd>{data.submissionDeadline ? formatDate(data.submissionDeadline) : '—'}</dd>
                              </>
                            ) : null}
                          </dl>
                      </UiCard>
                    </div>

                    <div className="flex flex-col gap-4">
                      <UiCard>
                        <div className="text-[12px] uppercase tracking-[.06em] text-muted-2">Contract value</div>
                        <div className="text-[22px] font-semibold text-ink">{formatMoney(data.estimatedValue)}</div>
                      </UiCard>

                      <UiCard title="At a Glance">
                        <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-[13.5px]">
                          <dt className="text-muted">Documents</dt>
                          <dd>{links.data?.length ?? 0} files</dd>
                          <dt className="text-muted">Updates</dt>
                          <dd>{updates.data?.length ?? 0} entries</dd>
                          <dt className="text-muted">Last activity</dt>
                          <dd>{formatDate(data.lastActivityAt)}</dd>
                        </dl>
                      </UiCard>
                    </div>
                  </div>
                ),
              },
              {
                key: 'documents',
                label: `Documents ${links.data?.length ?? 0}`,
                children: <DocumentsTab entityType="LEAD" entityId={leadId} />,
              },
              {
                key: 'updates',
                label: `Updates ${updates.data?.length ?? 0}`,
                children: <UpdatesTab leadId={leadId} />,
              },
            ]}
          />
        </>
      )}
      <WinProjectModal
        open={winOpen || createRequested}
        lead={{
          id: data.id,
          version: data.version,
          clientId: data.clientId,
          title: data.title,
          description: data.description,
          introducerId: data.introducerId,
          assignedToEmployeeId: data.assignedToEmployeeId,
        }}
        tenderId={linkedTender?.id ?? null}
        tenderVersion={linkedTender?.version ?? null}
        suggestedAmount={data.estimatedValue ?? linkedTender?.estimatedValue ?? ''}
        onClose={closeWin}
      />
    </>
  );
}

export default function LeadDetailRoute() {
  return (
    <Suspense fallback={null}>
      <LeadDetailPage />
    </Suspense>
  );
}
