'use client';

import { Suspense, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { App, Button, Input, Modal, Select, Slider, Tabs } from 'antd';
import { PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { EmployeeSelect } from '@/components/employee-select';
import { DocumentsTab } from '@/components/documents-tab';
import { MilestoneTab } from './milestone-tab';
import { PaymentAlertTab } from './payment-alert-tab';
import { InvoiceTab } from './invoice-tab';
import { PaymentTab } from './payment-tab';
import { canReadProjectSpend, ExpenseTab } from './expense-tab';
import { ProjectKpiStrip, ProjectMoneyPanel } from './project-overview';
import { FinancialsTab } from './financials-tab';
import { CostsTab } from './costs-tab';
import {
  formatDate,
  ProjectFormBody,
  STAGE_META,
  STAGE_ORDER,
  StageBadge,
  STATUS_META,
  StatusBadge,
} from '../shared';
import type { ProjectCoreFormValues } from '../shared';

type ReasonPrompt =
  | { kind: 'stage-backward' }
  | { kind: 'cancel' };

/** Add and remove are open to whoever can edit the project or assign its team. */
function TeamTab({
  projectId,
  legalEntityId,
  canManageTeam,
  isTerminal,
}: {
  projectId: string;
  /** Only employees of the project's legal entity are offered (ADR-154). */
  legalEntityId: string;
  canManageTeam: boolean;
  isTerminal: boolean;
}) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const team = trpc.projects.listTeamMembers.useQuery({ projectId });
  const [employeeId, setEmployeeId] = useState<string | undefined>(undefined);
  const [role, setRole] = useState('');

  const invalidate = () => utils.projects.listTeamMembers.invalidate({ projectId });

  const addMutation = trpc.projects.addTeamMember.useMutation({
    onSuccess: async () => {
      message.success('Team member added.');
      setEmployeeId(undefined);
      setRole('');
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const removeMutation = trpc.projects.removeTeamMember.useMutation({
    onSuccess: async () => {
      message.success('Team member removed.');
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const canEdit = canManageTeam && !isTerminal;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[360px_1fr]">
      {canEdit ? (
        <UiCard title="Add Team Member">
          <div className="flex flex-col gap-3">
            <EmployeeSelect placeholder="Select employee" value={employeeId} onChange={setEmployeeId} legalEntityId={legalEntityId} />
            <Input placeholder="Role on this project (optional)" value={role} onChange={(e) => setRole(e.target.value)} />
            <Button
              type="primary"
              disabled={!employeeId}
              loading={addMutation.isPending}
              onClick={() => employeeId && addMutation.mutate({ projectId, employeeId, role: role.trim() || undefined })}
            >
              Add Team Member
            </Button>
          </div>
        </UiCard>
      ) : null}

      <UiCard title={`Team (${team.data?.length ?? 0})`}>
        {team.isLoading ? (
          <p className="text-muted">Loading…</p>
        ) : team.isError ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-negative">Could not load the team. Please retry.</p>
            <Button size="small" onClick={() => team.refetch()}>
              Retry
            </Button>
          </div>
        ) : (team.data ?? []).length === 0 ? (
          <p className="text-muted">No team members yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-ui">
            {(team.data ?? []).map((member) => (
              <div key={member.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="font-medium text-ink">{member.employeeName}</div>
                  <div className="text-[12px] text-muted">{member.role ?? '—'}</div>
                </div>
                {canEdit ? (
                  <Button
                    size="small"
                    danger
                    loading={removeMutation.isPending}
                    onClick={() => removeMutation.mutate({ projectId, employeeId: member.employeeId })}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </UiCard>
    </div>
  );
}

/** Add gated by project_progress.create (Admin + Project Manager, per
 * ADR-061 — physical-progress reporting is the PM's execution domain, same
 * reasoning as change_stage/change_status). Percentage can only increase;
 * hidden once terminal or already at 100%. */
function ProgressTab({ projectId, canAdd, isTerminal }: { projectId: string; canAdd: boolean; isTerminal: boolean }) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const progress = trpc.projects.listProgress.useQuery({ projectId });
  const entries = progress.data ?? [];
  const currentPercentage = entries[0]?.percentage ?? 0;

  const [title, setTitle] = useState('');
  const [percentage, setPercentage] = useState(1);
  const [note, setNote] = useState('');

  const addMutation = trpc.projects.addProgress.useMutation({
    onSuccess: async () => {
      message.success('Progress update added.');
      setTitle('');
      setNote('');
      await utils.projects.listProgress.invalidate({ projectId });
    },
    onError: (error) => message.error(error.message),
  });

  const canEdit = canAdd && !isTerminal && currentPercentage < 100;
  const sliderMin = Math.min(currentPercentage + 1, 100);
  const effectivePercentage = Math.max(percentage, sliderMin);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_360px]">
      <UiCard title="Physical Progress Timeline">
        {progress.isLoading ? (
          <p className="text-muted">Loading…</p>
        ) : progress.isError ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-negative">Could not load progress updates. Please retry.</p>
            <Button size="small" onClick={() => progress.refetch()}>
              Retry
            </Button>
          </div>
        ) : entries.length === 0 ? (
          <p className="text-muted">No progress updates yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-ui">
            {entries.map((entry, index) => {
              const previousPercentage = entries[index + 1]?.percentage ?? 0;
              return (
                <div key={entry.id} className="flex flex-col gap-1 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-[13.5px] text-ink">{entry.title}</b>
                    <span className="text-[11.5px] text-muted-2">{formatDate(entry.createdAt)}</span>
                    <span className="ml-auto rounded-full bg-positive-soft px-2 py-0.5 text-[11px] font-semibold text-positive">
                      +{entry.percentage - previousPercentage}%
                    </span>
                    <span className="text-[15px] font-semibold text-ink">{entry.percentage}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded bg-line-2">
                    <div className="h-full rounded bg-info" style={{ width: `${entry.percentage}%` }} />
                  </div>
                  <p className="text-[12.5px] text-ink">{entry.note}</p>
                  <div className="text-[11.5px] text-muted">by {entry.createdByEmail ?? '—'}</div>
                </div>
              );
            })}
          </div>
        )}
      </UiCard>

      <div className="flex flex-col gap-4">
        <UiCard>
          <div className="text-center">
            <div className="text-[11px] uppercase tracking-[.05em] text-muted">Current Physical Progress</div>
            <div className="mt-1.5 text-[36px] font-bold text-ink">{currentPercentage}%</div>
            <div className="mt-3 h-2 overflow-hidden rounded bg-line-2">
              <div className="h-full rounded bg-info" style={{ width: `${currentPercentage}%` }} />
            </div>
          </div>
        </UiCard>

        {canEdit ? (
          <UiCard title="Add Progress Update">
            <div className="flex flex-col gap-3">
              <Input placeholder="e.g. Go-live for 4 districts" value={title} onChange={(e) => setTitle(e.target.value)} />
              <div>
                <Slider min={sliderMin} max={100} value={effectivePercentage} onChange={setPercentage} />
                <div className="flex justify-between text-[11.5px] text-muted">
                  <span>current {currentPercentage}%</span>
                  <b className="text-ink">new: {effectivePercentage}%</b>
                  <span>100%</span>
                </div>
              </div>
              <Input.TextArea
                rows={4}
                placeholder="What was completed since last update…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button
                type="primary"
                disabled={!title.trim() || !note.trim()}
                loading={addMutation.isPending}
                onClick={() =>
                  addMutation.mutate({ projectId, title: title.trim(), percentage: effectivePercentage, note: note.trim() })
                }
              >
                Add Update
              </Button>
              <p className="text-[11.5px] text-muted">% can only move forward.</p>
            </div>
          </UiCard>
        ) : null}
      </div>
    </div>
  );
}

// MUST list every `key` in the Tabs items array below. A key missing here is
// silently rejected and the page falls back to 'detail', so the tab looks
// like it "won't open" even though it renders fine — exactly what happened to
// material/manpower/introducer when they were added (ADR-097).
// Old per-stream keys still resolve, so links and bookmarks made before the
// three cost tabs were merged keep working (ADR-099).
const TAB_ALIASES: Record<string, string> = { material: 'costs', manpower: 'costs', introducer: 'costs' };

const VALID_TABS = [
  'detail',
  'team',
  'milestone',
  'payment-alert',
  'invoices',
  'payment',
  'expense',
  'costs',
  'financials',
  'progress',
  'documentation',
];

function ProjectDetailPageInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = String(params.id ?? '');
  const { message } = App.useApp();

  const rawTab = searchParams.get('tab');
  const resolvedTab = rawTab ? (TAB_ALIASES[rawTab] ?? rawTab) : null;
  const activeTab = resolvedTab && VALID_TABS.includes(resolvedTab) ? resolvedTab : 'detail';
  const handleTabChange = (key: string) => router.push(`/projects/${projectId}?tab=${key}`, { scroll: false });

  const me = trpc.auth.me.useQuery();
  const canUpdate = (me.data?.permissions ?? []).includes('project.update');
  const canManageTeam = canUpdate || (me.data?.permissions ?? []).includes('project.manage_team');
  const canChangeStage = (me.data?.permissions ?? []).includes('project.change_stage');
  const canChangeStatus = (me.data?.permissions ?? []).includes('project.change_status');
  const canAddProgress = (me.data?.permissions ?? []).includes('project_progress.create');
  const canReadFinancials = (me.data?.permissions ?? []).includes('project.read_financials');
  // Latest progress update first (listProgress's own order); feeds the figures strip.
  const physicalPercent = trpc.projects.listProgress.useQuery({ projectId }).data?.[0]?.percentage ?? 0;
  // The Costs tab shows if any of its sections would; each section gates itself.
  const canReadCosts =
    (me.data?.permissions ?? []).includes('inventory.read') ||
    (me.data?.permissions ?? []).includes('introducer_fee.read');
  const canReadClients = (me.data?.permissions ?? []).includes('client.read');
  const canReadMilestones = (me.data?.permissions ?? []).includes('milestone.read');
  const canReadPaymentAlerts = (me.data?.permissions ?? []).includes('payment_alert.read');
  const canReadInvoices = (me.data?.permissions ?? []).includes('invoice.read');
  const canReadReceipts = (me.data?.permissions ?? []).includes('receipt.read');
  const canReadSpend = canReadProjectSpend(me.data?.permissions ?? []);
  const canReadDocuments = (me.data?.permissions ?? []).includes('document.read');

  const utils = trpc.useUtils();
  const project = trpc.projects.getDetail.useQuery({ id: projectId }, { enabled: !!projectId });
  const client = trpc.clients.getDetail.useQuery(
    { id: project.data?.clientId ?? '' },
    { enabled: !!project.data?.clientId && canReadClients },
  );

  const [editing, setEditing] = useState(false);
  const [reasonPrompt, setReasonPrompt] = useState<ReasonPrompt | null>(null);
  const [backwardTargetStage, setBackwardTargetStage] = useState<(typeof STAGE_ORDER)[number] | undefined>(undefined);
  const [reason, setReason] = useState('');

  // Every projects.* query — the list, its financial summaries and this
  // detail — so a change shows in the Projects list too, not only here.
  const invalidateDetail = () => utils.projects.invalidate();
  const clearDraft = trpc.formDrafts.clear.useMutation();

  const updateMutation = trpc.projects.update.useMutation({
    onSuccess: async () => {
      message.success('Project updated.');
      setEditing(false);
      await invalidateDetail();
      clearDraft.mutate({ formKey: `project:${projectId}` });
    },
    onError: (error) => message.error(error.message),
  });
  const changeStageMutation = trpc.projects.changeStage.useMutation({
    onSuccess: async () => {
      message.success('Stage updated.');
      setReasonPrompt(null);
      setReason('');
      setBackwardTargetStage(undefined);
      await invalidateDetail();
    },
    onError: (error) => message.error(error.message),
  });
  const changeStatusMutation = trpc.projects.changeStatus.useMutation({
    onSuccess: async () => {
      message.success('Status updated.');
      setReasonPrompt(null);
      setReason('');
      await invalidateDetail();
    },
    onError: (error) => message.error(error.message),
  });

  if (project.isError) {
    return (
      <>
        <PageHeader title="Project" description="Could not load this project." />
      </>
    );
  }
  if (project.isLoading || !project.data) {
    return (
      <>
        <PageHeader title="Project" description="Loading…" />
      </>
    );
  }

  const data = project.data;
  const clientInitials = data.clientName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const isTerminal = data.operationalStatus === 'CANCELLED' || data.operationalStatus === 'CLOSED';
  const currentStageIndex = STAGE_ORDER.indexOf(data.stage as (typeof STAGE_ORDER)[number]);
  const earlierStages = STAGE_ORDER.slice(0, currentStageIndex);

  const onStageChange = (next: (typeof STAGE_ORDER)[number]) => {
    if (next === data.stage) return;
    const nextIndex = STAGE_ORDER.indexOf(next);
    if (nextIndex > currentStageIndex) {
      changeStageMutation.mutate({ id: data.id, targetStage: next, reason: undefined, expectedVersion: data.version });
      return;
    }
    if (nextIndex < currentStageIndex) {
      setBackwardTargetStage(next);
      setReason('');
      setReasonPrompt({ kind: 'stage-backward' });
    }
  };
  const submitBackwardMove = () => {
    if (!backwardTargetStage || !reason.trim()) return;
    changeStageMutation.mutate({
      id: data.id,
      targetStage: backwardTargetStage,
      reason: reason.trim(),
      expectedVersion: data.version,
    });
  };
  const onStatusChange = (next: 'ACTIVE' | 'ON_HOLD' | 'CANCELLED' | 'CLOSED') => {
    if (next === data.operationalStatus) return;
    if (next === 'CANCELLED') {
      setReason('');
      setReasonPrompt({ kind: 'cancel' });
      return;
    }
    changeStatusMutation.mutate({ id: data.id, targetStatus: next, reason: undefined, expectedVersion: data.version });
  };
  const submitCancel = () => {
    if (!reason.trim()) return;
    changeStatusMutation.mutate({
      id: data.id,
      targetStatus: 'CANCELLED',
      reason: reason.trim(),
      expectedVersion: data.version,
    });
  };

  const handleSubmit = (values: ProjectCoreFormValues) => {
    // A select cleared on the form is sent as null, which removes it; tender
    // is not on the form, so it is left as it is.
    updateMutation.mutate({
      id: data.id,
      leadId: values.leadId ?? null,
      tenderId: values.tenderId,
      projectManagerId: values.projectManagerId ?? null,
      salesManagerId: values.salesManagerId ?? null,
      introducerId: values.introducerId ?? null,
      projectTypeId: values.projectTypeId ?? null,
      name: values.name,
      description: values.description,
      value: values.value,
      gstApplicable: values.gstApplicable,
      workOrderNumber: values.workOrderNumber,
      workOrderDate: values.workOrderDate || null,
      expectedVersion: data.version,
    });
  };

  return (
    <>
      <PageHeader
        title={data.name}
        actions={
          <div className="flex gap-2">
            <Button onClick={() => router.push('/projects')}>Back to List</Button>
            {canUpdate && !editing ? (
              <Button type="primary" onClick={() => setEditing(true)}>
                Edit Project
              </Button>
            ) : null}
          </div>
        }
      />

      {editing ? (
        <UiCard title="Edit Project">
          <ProjectFormBody
            key={data.id}
            mode="edit"
            formKey={`project:${data.id}`}
            initial={{
              clientId: data.clientId,
              legalEntityId: data.legalEntityId,
              leadId: data.leadId ?? undefined,
              tenderId: data.tenderId ?? undefined,
              projectManagerId: data.projectManagerId ?? undefined,
              salesManagerId: data.salesManagerId ?? undefined,
              introducerId: data.introducerId ?? undefined,
              projectTypeId: data.projectTypeId ?? undefined,
              name: data.name,
              description: data.description ?? undefined,
              value: data.value ?? undefined,
              gstApplicable: data.gstApplicable,
              workOrderNumber: data.workOrderNumber ?? undefined,
              workOrderDate: data.workOrderDate ?? undefined,
            }}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(false)}
            submitting={updateMutation.isPending}
          />
        </UiCard>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand">
              {clientInitials}
            </span>
            <span>{data.clientName}</span>
            <span>·</span>
            <span>{data.legalEntityName}</span>
            <span>·</span>
            <span>Sales: {data.salesManagerName ?? 'Unassigned'}</span>
            <span>·</span>
            <span>PM: {data.projectManagerName ?? 'Unassigned'}</span>
            <span>·</span>
            <span>Created {formatDate(data.createdAt)}</span>
            <span>·</span>
            <StageBadge stage={data.stage} />
            <StatusBadge status={data.operationalStatus} />
          </div>

          {isTerminal ? (
            <p className="mb-3 text-[12.5px] text-muted">
              This project is {data.operationalStatus === 'CANCELLED' ? 'cancelled' : 'closed'} — its stage and status can no
              longer be changed.
            </p>
          ) : (
            <div className="mb-3 flex flex-wrap items-end gap-3">
              {canChangeStage ? (
                <label className="flex min-w-[220px] flex-col gap-1 text-[12px] text-muted">
                  Stage
                  <Select
                    value={data.stage as (typeof STAGE_ORDER)[number]}
                    loading={changeStageMutation.isPending}
                    onChange={onStageChange}
                    options={STAGE_ORDER.map((stage) => ({
                      value: stage,
                      label: STAGE_META[stage]!.label,
                    }))}
                  />
                </label>
              ) : null}
              {canChangeStatus ? (
                <label className="flex min-w-[180px] flex-col gap-1 text-[12px] text-muted">
                  Status
                  <Select
                    value={data.operationalStatus as 'ACTIVE' | 'ON_HOLD' | 'CANCELLED' | 'CLOSED'}
                    loading={changeStatusMutation.isPending}
                    onChange={onStatusChange}
                    options={[
                      { value: 'ACTIVE' as const, label: STATUS_META.ACTIVE!.label },
                      { value: 'ON_HOLD' as const, label: STATUS_META.ON_HOLD!.label },
                      { value: 'CANCELLED' as const, label: STATUS_META.CANCELLED!.label },
                      { value: 'CLOSED' as const, label: STATUS_META.CLOSED!.label },
                    ]}
                  />
                </label>
              ) : null}
            </div>
          )}

          {canReadFinancials ? <ProjectKpiStrip projectId={projectId} physicalPercent={physicalPercent} /> : null}

          <Tabs
            activeKey={activeTab}
            onChange={handleTabChange}
            items={[
              {
                key: 'detail',
                label: 'Detail',
                children: (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_1fr]">
                    <div className="flex flex-col gap-4">
                      <UiCard title="Project Information">
                        <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-[13.5px]">
                          <dt className="text-muted">Project name</dt>
                          <dd>{data.name}</dd>
                          <dt className="text-muted">Client</dt>
                          <dd>{data.clientName}</dd>
                          <dt className="text-muted">Department</dt>
                          <dd>{client.data?.department ?? '—'}</dd>
                          <dt className="text-muted">Legal entity</dt>
                          <dd>{data.legalEntityName}</dd>
                          <dt className="text-muted">Project type</dt>
                          <dd>{data.projectTypeName ?? '—'}</dd>
                          <dt className="text-muted">Came from</dt>
                          <dd>{data.leadTitle ?? '—'}</dd>
                          <dt className="text-muted">Introducer</dt>
                          <dd>{data.introducerName ?? '—'}</dd>
                          <dt className="text-muted">GST applicable</dt>
                          <dd>{data.gstApplicable ? 'Yes' : 'No'}</dd>
                        </dl>
                      </UiCard>

                      <UiCard title="Description">
                        <p className="text-[13.5px] text-ink">{data.description ?? '—'}</p>
                      </UiCard>

                      <UiCard title="Work Order">
                        <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-[13.5px]">
                          <dt className="text-muted">Work order number</dt>
                          <dd>{data.workOrderNumber ?? '—'}</dd>
                          <dt className="text-muted">Work order date</dt>
                          <dd>{data.workOrderDate ? formatDate(data.workOrderDate) : '—'}</dd>
                        </dl>
                      </UiCard>
                    </div>

                    <div className="flex flex-col gap-4">
                      {canReadFinancials ? <ProjectMoneyPanel projectId={projectId} /> : null}
                    </div>
                  </div>
                ),
              },
              {
                key: 'team',
                label: 'Team',
                children: <TeamTab projectId={projectId} legalEntityId={data.legalEntityId} canManageTeam={canManageTeam} isTerminal={isTerminal} />,
              },
              ...(canReadMilestones
                ? [{ key: 'milestone', label: 'Milestone', children: <MilestoneTab projectId={projectId} contractValue={data.value} /> }]
                : []),
              ...(canReadPaymentAlerts
                ? [{ key: 'payment-alert', label: 'Payment Alert', children: <PaymentAlertTab projectId={projectId} /> }]
                : []),
              ...(canReadInvoices
                ? [{ key: 'invoices', label: 'Invoices', children: <InvoiceTab projectId={projectId} /> }]
                : []),
              ...(canReadReceipts
                ? [{ key: 'payment', label: 'Payment', children: <PaymentTab projectId={projectId} /> }]
                : []),
              ...(canReadSpend
                ? [{ key: 'expense', label: 'Spend', children: <ExpenseTab projectId={projectId} /> }]
                : []),
              ...(canReadCosts
                ? [{ key: 'costs', label: 'Costs', children: <CostsTab projectId={projectId} /> }]
                : []),
              ...(canReadFinancials
                ? [
                    {
                      key: 'financials',
                      label: 'Financials',
                      children: <FinancialsTab projectId={projectId} />,
                    },
                  ]
                : []),
              {
                key: 'progress',
                label: 'Physical Progress',
                children: <ProgressTab projectId={projectId} canAdd={canAddProgress} isTerminal={isTerminal} />,
              },
              ...(canReadDocuments
                ? [{ key: 'documentation', label: 'Documentation', children: <DocumentsTab entityType="PROJECT" entityId={projectId} /> }]
                : []),
            ]}
          />
        </>
      )}

      <Modal
        title={reasonPrompt?.kind === 'cancel' ? 'Cancel Project' : 'Move Stage Backward'}
        open={!!reasonPrompt}
        onCancel={() => {
          setReasonPrompt(null);
          setReason('');
          setBackwardTargetStage(undefined);
        }}
        onOk={reasonPrompt?.kind === 'cancel' ? submitCancel : submitBackwardMove}
        confirmLoading={changeStageMutation.isPending || changeStatusMutation.isPending}
        okButtonProps={{
          disabled: !reason.trim() || (reasonPrompt?.kind === 'stage-backward' && !backwardTargetStage),
          danger: reasonPrompt?.kind === 'cancel',
        }}
        okText={reasonPrompt?.kind === 'cancel' ? 'Cancel Project' : 'Move Stage'}
      >
        {reasonPrompt?.kind === 'stage-backward' ? (
          <div className="mb-3">
            <p className="mb-2 text-muted">Target stage</p>
            <Select
              className="w-full"
              placeholder="Select an earlier stage"
              value={backwardTargetStage}
              onChange={setBackwardTargetStage}
              options={earlierStages.map((s) => ({ value: s, label: STAGE_META[s]!.label }))}
            />
          </div>
        ) : null}
        <p className="mb-2 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </>
  );
}

export default function ProjectDetailPage() {
  return (
    <Suspense fallback={null}>
      <ProjectDetailPageInner />
    </Suspense>
  );
}
