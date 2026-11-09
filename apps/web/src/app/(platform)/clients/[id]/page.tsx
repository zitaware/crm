'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { App, Button } from 'antd';
import { MoneyText, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { StageBadge as LeadStageBadge } from '../../leads/shared';
import { StageBadge as ProjectStageBadge } from '../../projects/shared';
import { absMoney, ClientFormBody, formatDate, formatMoney, isCreditBalance } from '../shared';
import type { ClientCoreFormValues } from '../shared';

interface LeadRow {
  id: string;
  clientId: string;
  title: string;
  stage: string;
}

interface ProjectRow {
  id: string;
  clientId: string;
  name: string;
  stage: string;
  value: string | null;
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = String(params.id ?? '');
  const { message } = App.useApp();

  const me = trpc.auth.me.useQuery();
  const canUpdate = (me.data?.permissions ?? []).includes('client.update');
  const canCreateLead = (me.data?.permissions ?? []).includes('lead.create');
  const canCreateProject = (me.data?.permissions ?? []).includes('project.create');
  const canReadFinancials = (me.data?.permissions ?? []).includes('project.read_financials');

  const utils = trpc.useUtils();
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const client = trpc.clients.getDetail.useQuery({ id: clientId }, { enabled: !!clientId });
  const leadsList = trpc.leads.list.useQuery();
  const projectsList = trpc.projects.list.useQuery();
  const financials = trpc.clients.getFinancialSummary.useQuery({ id: clientId }, { enabled: !!clientId && canReadFinancials });

  const [editing, setEditing] = useState(false);

  const updateMutation = trpc.clients.update.useMutation({
    onSuccess: async () => {
      message.success('Client updated.');
      setEditing(false);
      await utils.clients.getDetail.invalidate({ id: clientId });
      clearDraft.mutate({ formKey: `client:${clientId}` });
    },
    onError: (error) => message.error(error.message),
  });

  const leads = useMemo(
    () => ((leadsList.data ?? []) as LeadRow[]).filter((row) => row.clientId === clientId),
    [leadsList.data, clientId],
  );
  const projects = useMemo(
    () => ((projectsList.data ?? []) as ProjectRow[]).filter((row) => row.clientId === clientId),
    [projectsList.data, clientId],
  );
  const totalProjectValue = useMemo(
    () => projects.reduce((sum, row) => sum + Number(row.value ?? 0), 0),
    [projects],
  );

  if (client.isError) {
    return (
      <>
        <PageHeader title="Client" description="Could not load this client." />
      </>
    );
  }
  if (client.isLoading || !client.data) {
    return (
      <>
        <PageHeader title="Client" description="Loading…" />
      </>
    );
  }

  const data = client.data;

  const handleSubmit = (values: ClientCoreFormValues) => {
    updateMutation.mutate({
      id: data.id,
      name: values.name,
      shortCode: values.shortCode,
      clientTypeId: values.clientTypeId,
      department: values.department,
      stateId: values.stateId,
      districtId: values.districtId,
      cityId: values.cityId,
      pinCode: values.pinCode,
      officeAddress: values.officeAddress,
      gstin: values.gstin,
      expectedVersion: data.version,
    });
  };

  return (
    <>
      <PageHeader
        title={data.name}
        actions={
          <div className="flex gap-2">
            <Button onClick={() => router.push('/clients')}>Back to List</Button>
            {canUpdate && !editing ? (
              <Button type="primary" onClick={() => setEditing(true)}>
                Edit Client
              </Button>
            ) : null}
          </div>
        }
      />

      {editing ? (
        <UiCard title="Edit Client">
          <ClientFormBody
            key={data.id}
            mode="edit"
            formKey={`client:${data.id}`}
            initial={{
              name: data.name,
              shortCode: data.shortCode ?? undefined,
              clientTypeId: data.clientTypeId ?? undefined,
              department: data.department ?? undefined,
              stateId: data.stateId ?? undefined,
              districtId: data.districtId ?? undefined,
              cityId: data.cityId ?? undefined,
              pinCode: data.pinCode ?? undefined,
              officeAddress: data.officeAddress ?? undefined,
              gstin: data.gstin ?? undefined,
            }}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(false)}
            submitting={updateMutation.isPending}
          />
        </UiCard>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-[15px] font-semibold text-brand">
              {initials(data.name)}
            </span>
            <div>
              <div className="text-[13px] text-muted">
                {[
                  data.department,
                  data.clientTypeName,
                  [data.cityName, data.stateName].filter(Boolean).join(', ') || null,
                  `Client since ${formatDate(data.createdAt)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <UiCard>
              <div className="text-[12px] uppercase tracking-[.06em] text-muted-2">Leads</div>
              <div className="text-[22px] font-semibold text-ink">{leads.length}</div>
            </UiCard>
            <UiCard>
              <div className="text-[12px] uppercase tracking-[.06em] text-muted-2">Projects</div>
              <div className="text-[22px] font-semibold text-ink">{projects.length}</div>
            </UiCard>
            <UiCard>
              <div className="text-[12px] uppercase tracking-[.06em] text-muted-2">Total Project Value</div>
              <div className="text-[22px] font-semibold text-ink">
                {formatMoney(canReadFinancials && financials.data ? financials.data.totalContractValueExclGst : totalProjectValue.toFixed(2))}
              </div>
            </UiCard>
            <UiCard>
              <div className="text-[12px] uppercase tracking-[.06em] text-muted-2">Client Since</div>
              <div className="text-[22px] font-semibold text-ink">{formatDate(data.createdAt)}</div>
            </UiCard>
          </div>

          {canReadFinancials && (
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <UiCard>
                <div className="text-[12px] uppercase tracking-[.06em] text-muted-2">
                  {financials.data && isCreditBalance(financials.data.clientReceivable) ? 'Overpaid' : 'Still to collect'}
                </div>
                <div className="text-[22px] font-semibold">
                  {financials.data ? (
                    isCreditBalance(financials.data.clientReceivable) ? (
                      <MoneyText tone="positive">{formatMoney(absMoney(financials.data.clientReceivable))}</MoneyText>
                    ) : (
                      <MoneyText tone="warning">{formatMoney(financials.data.clientReceivable)}</MoneyText>
                    )
                  ) : (
                    <span className="text-ink">{formatMoney('0.00')}</span>
                  )}
                </div>
              </UiCard>
            </div>
          )}

          <UiCard title="Client Information" className="mb-4">
            <dl className="grid grid-cols-1 gap-y-2 text-[13.5px] sm:grid-cols-2">
              <div className="grid grid-cols-[140px_1fr]">
                <dt className="text-muted">Department</dt>
                <dd>{data.department ?? '—'}</dd>
              </div>
              <div className="grid grid-cols-[140px_1fr]">
                <dt className="text-muted">Client type</dt>
                <dd>{data.clientTypeName ?? '—'}</dd>
              </div>
              <div className="grid grid-cols-[140px_1fr]">
                <dt className="text-muted">Location</dt>
                <dd>{[data.cityName, data.districtName, data.stateName].filter(Boolean).join(', ') || '—'}</dd>
              </div>
              <div className="grid grid-cols-[140px_1fr]">
                <dt className="text-muted">PIN code</dt>
                <dd>{data.pinCode ?? '—'}</dd>
              </div>
              <div className="grid grid-cols-[140px_1fr]">
                <dt className="text-muted">GSTIN</dt>
                <dd>{data.gstin ?? '—'}</dd>
              </div>
              <div className="grid grid-cols-[140px_1fr]">
                <dt className="text-muted">Address</dt>
                <dd>{data.officeAddress ?? '—'}</dd>
              </div>
            </dl>
          </UiCard>

          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <UiCard
              title={`Leads (${leads.length})`}
              actions={
                canCreateLead ? (
                  <Button size="small" onClick={() => router.push(`/leads/new?clientId=${clientId}`)}>
                    Add
                  </Button>
                ) : null
              }
            >
              {leads.length === 0 ? (
                <p className="text-muted">None recorded for this client.</p>
              ) : (
                <div className="flex flex-col divide-y divide-ui">
                  {leads.map((lead) => (
                    <button
                      key={lead.id}
                      type="button"
                      className="flex items-center justify-between py-2 text-left"
                      onClick={() => router.push(`/leads/${lead.id}`)}
                    >
                      <span className="font-medium text-ink hover:text-brand">{lead.title}</span>
                      <LeadStageBadge stage={lead.stage} />
                    </button>
                  ))}
                </div>
              )}
            </UiCard>

            <UiCard
              title={`Projects (${projects.length})`}
              actions={
                canCreateProject ? (
                  <Button size="small" onClick={() => router.push(`/projects/new?clientId=${clientId}`)}>
                    Add project
                  </Button>
                ) : null
              }
            >
              {projects.length === 0 ? (
                <p className="text-muted">No projects yet.</p>
              ) : (
                <div className="flex flex-col divide-y divide-ui">
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      className="flex items-center justify-between py-2 text-left"
                      onClick={() => router.push(`/projects/${project.id}`)}
                    >
                      <span className="font-medium text-ink hover:text-brand">{project.name}</span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums text-[12.5px] text-muted">{formatMoney(project.value)}</span>
                        <ProjectStageBadge stage={project.stage} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </UiCard>
          </div>
        </>
      )}
    </>
  );
}
