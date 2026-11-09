'use client';

import { useEffect, useRef, useState } from 'react';
import { App, Form, Input, Modal, Select, Switch } from 'antd';
import type { ProjectSummary } from '@zitaware/contracts';
import { MoneyInput } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { DateInput } from '@/components/date-input';
import { ClientSelect } from '@/components/client-select';
import { IntroducerSelect } from '@/components/introducer-select';
import { LegalEntitySelect } from '@/components/legal-entity-select';
import { MasterSelect } from '@/components/master-select';
import { QuickAddSelect, type QuickAddBoxProps } from '@/components/quick-add-select';

export interface ProjectCoreFormValues {
  clientId: string;
  legalEntityId: string;
  leadId: string | undefined;
  tenderId: string | undefined;
  projectManagerId: string | undefined;
  salesManagerId: string | undefined;
  introducerId: string | undefined;
  projectTypeId: string | undefined;
  name: string;
  description: string | undefined;
  value: string | undefined;
  gstApplicable: boolean;
  workOrderNumber: string | undefined;
  workOrderDate: string | undefined;
}

export const EMPTY_PROJECT: ProjectCoreFormValues = {
  clientId: '',
  legalEntityId: '',
  leadId: undefined,
  tenderId: undefined,
  projectManagerId: undefined,
  salesManagerId: undefined,
  introducerId: undefined,
  projectTypeId: undefined,
  name: '',
  description: undefined,
  value: undefined,
  gstApplicable: true,
  workOrderNumber: undefined,
  workOrderDate: undefined,
};

/** The projects.create payload, the same from the New Project page and the F2 box. */
export function projectCreateInput(values: ProjectCoreFormValues) {
  return {
    clientId: values.clientId,
    legalEntityId: values.legalEntityId,
    leadId: values.leadId,
    tenderId: values.tenderId,
    projectManagerId: values.projectManagerId,
    salesManagerId: values.salesManagerId,
    introducerId: values.introducerId,
    projectTypeId: values.projectTypeId,
    name: values.name,
    description: values.description,
    value: values.value,
    gstApplicable: values.gstApplicable,
    workOrderNumber: values.workOrderNumber,
    workOrderDate: values.workOrderDate,
  };
}

/**
 * The project form's fields, used by the New / Edit Project page, a won
 * lead's project form and the picker's F2 box so they can never differ.
 * Must sit inside a `Form<ProjectCoreFormValues>` whose initial values are
 * `initial`.
 */
export function ProjectFields({
  mode,
  initial,
  originLocked = false,
  legalEntityLocked = false,
  autoFocus,
}: {
  mode: 'create' | 'edit';
  initial: ProjectCoreFormValues;
  /** Client and originating lead are already known, as when a lead is won. */
  originLocked?: boolean;
  /** The legal entity is the one chosen on the form the F2 box came from. */
  legalEntityLocked?: boolean;
  autoFocus?: boolean;
}) {
  const form = Form.useFormInstance<ProjectCoreFormValues>();
  const leadsList = trpc.leads.list.useQuery();
  const employeesList = trpc.employees.list.useQuery({ includeInactive: false });
  // Managers come from the project's own legal entity (ADR-154).
  const legalEntityId = Form.useWatch('legalEntityId', form) as string | undefined;
  const managerCandidates = trpc.projects.listManagerCandidates.useQuery({ legalEntityId: legalEntityId ?? '' }, { enabled: !!legalEntityId });
  // Only employees holding a qualifying designation are offered (ADR-153);
  // the manager already saved on the project stays listed so it still shows.
  const managerOptions = (candidates: Array<{ id: string; fullName: string; designationName: string }> | undefined, savedId: string | undefined) => {
    const options = (candidates ?? []).map((e) => ({ value: e.id, label: `${e.fullName} — ${e.designationName}` }));
    const saved =
      (mode === 'edit' || !managerCandidates.data) && savedId && !options.some((o) => o.value === savedId)
        ? (employeesList.data ?? []).find((e) => e.id === savedId)
        : undefined;
    return saved ? [{ value: saved.id, label: saved.fullName }, ...options] : options;
  };
  // A new project pre-filled from a tender drops a manager who does not
  // hold a qualifying designation for that role, instead of failing on save.
  useEffect(() => {
    const candidates = managerCandidates.data;
    if (mode !== 'create' || !candidates) return;
    const fields = [
      ['projectManagerId', candidates.projectManagers],
      ['salesManagerId', candidates.salesManagers],
    ] as const;
    for (const [field, eligible] of fields) {
      const value = form.getFieldValue(field) as string | undefined;
      if (value && !eligible.some((e) => e.id === value)) form.setFieldValue(field, undefined);
    }
  }, [form, mode, managerCandidates.data]);
  const me = trpc.auth.me.useQuery();
  const tendersList = trpc.tenders.list.useQuery(undefined, { enabled: (me.data?.permissions ?? []).includes('tender.read') });

  // The tender or lead's contract value, falling back to its linked tender's.
  const suggestedValue = (leadId: string | undefined): string | undefined => {
    if (!leadId) return undefined;
    const lead = (leadsList.data ?? []).find((l) => l.id === leadId);
    const tender = (tendersList.data ?? []).find((t) => t.leadId === leadId);
    return lead?.estimatedValue ?? tender?.estimatedValue ?? undefined;
  };
  // The value last filled in from an origin; starts as the saved origin's.
  const lastSuggested = useRef<string | undefined>(undefined);
  // Replaces the contract value only while it is empty or still the value
  // suggested by the previously chosen origin, never one typed by hand.
  const fillValueFromOrigin = (nextLeadId: string) => {
    const current = form.getFieldValue('value') as string | undefined;
    const previous = lastSuggested.current ?? suggestedValue(initial.leadId);
    const next = suggestedValue(nextLeadId);
    if (next && (!current || current === previous)) {
      form.setFieldValue('value', next);
      lastSuggested.current = next;
    }
  };

  return (
    <>
      <h5 className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Project Details</h5>
      <Form.Item label="Project name" name="name" rules={[{ required: true, message: 'Name is required.' }, { max: 300 }]}>
        <Input {...(autoFocus ? { autoFocus: true } : {})} placeholder="e.g. SBMU VTMS — Phase 2 Rollout" />
      </Form.Item>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
        <Form.Item
          label="Client"
          name="clientId"
          rules={[{ required: true, message: 'Client is required.' }]}
          extra="One client can have multiple projects."
>
          <ClientSelect disabled={mode === 'edit' || originLocked} />
        </Form.Item>
        <Form.Item
          label="Owning legal entity"
          name="legalEntityId"
          rules={[{ required: true, message: 'Legal entity is required.' }]}
          {...(legalEntityLocked ? { extra: 'The legal entity chosen on this form.' } : {})}
>
          <LegalEntitySelect disabled={mode === 'edit' || legalEntityLocked} placeholder="Select legal entity" />
        </Form.Item>
        <Form.Item label="Project type" name="projectTypeId">
          <MasterSelect type="project_types" allowClear placeholder="Select type" />
        </Form.Item>
      </div>
      <Form.Item label="Description" name="description" rules={[{ max: 2000 }]}>
        <Input.TextArea rows={2} placeholder="Scope of work…" />
      </Form.Item>

      <h5 className="mb-2 mt-4 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Origin</h5>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
        <Form.Item
          label="Came from"
          name="leadId"
          extra={originLocked ? 'This project was created from this lead.' : 'Optional. The lead this project came from.'}
        >
          <Select
            allowClear={!originLocked}
            disabled={originLocked}
            showSearch
            optionFilterProp="label"
            placeholder="— No originating lead"
            loading={leadsList.isLoading}
            options={(leadsList.data ?? []).map((l) => ({ value: l.id, label: l.title }))}
            onSelect={(leadId: string) => fillValueFromOrigin(leadId)}
          />
        </Form.Item>
        <Form.Item label="Sales Manager" name="salesManagerId" extra="Business Development Manager or Marketing Manager of the owning legal entity.">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={legalEntityId ? 'Unassigned' : 'Choose the legal entity first'}
            loading={managerCandidates.isFetching}
            options={managerOptions(managerCandidates.data?.salesManagers, initial.salesManagerId)}
          />
        </Form.Item>
        <Form.Item label="Project Manager" name="projectManagerId" extra="Project Manager or Hardware Manager of the owning legal entity.">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={legalEntityId ? 'Unassigned' : 'Choose the legal entity first'}
            loading={managerCandidates.isFetching}
            options={managerOptions(managerCandidates.data?.projectManagers, initial.projectManagerId)}
          />
        </Form.Item>
        <Form.Item label="Introducer" name="introducerId">
          <IntroducerSelect allowClear placeholder="— Direct (no introducer)" />
        </Form.Item>
      </div>

      <h5 className="mb-2 mt-4 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Value &amp; Work Order</h5>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
        <Form.Item label="Contract value (excl. GST)" name="value" extra="Client-facing contract value before GST. Filled from the lead chosen in Came from.">
          <MoneyInput placeholder="e.g. 6200000" prefix="₹" showInWords />
        </Form.Item>
        <Form.Item label="Work order number" name="workOrderNumber" rules={[{ max: 100 }]}>
          <Input placeholder="e.g. WO/2026/0042" />
        </Form.Item>
        <Form.Item label="Work order date" name="workOrderDate">
          <DateInput />
        </Form.Item>
        <Form.Item label="GST applicable" name="gstApplicable" valuePropName="checked">
          <Switch />
        </Form.Item>
      </div>
    </>
  );
}

type ProjectBoxProps = QuickAddBoxProps & {
  legalEntityId: string | undefined;
  onProject: (project: ProjectSummary) => void;
};

/** The F2 box: the New Project form in a modal. A fresh form each time it opens. */
function ProjectAddBox(box: ProjectBoxProps) {
  const [round, setRound] = useState(0);
  const [wasOpen, setWasOpen] = useState(box.open);
  if (box.open !== wasOpen) {
    setWasOpen(box.open);
    if (box.open) setRound((r) => r + 1);
  }
  return <ProjectAddModal key={round} {...box} />;
}

function ProjectAddModal({ open, initialText, onClose, onCreated, legalEntityId, onProject }: ProjectBoxProps) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const [form] = Form.useForm<ProjectCoreFormValues>();
  const initial: ProjectCoreFormValues = { ...EMPTY_PROJECT, name: initialText, legalEntityId: legalEntityId ?? '' };

  const create = trpc.projects.create.useMutation({
    onSuccess: async (project) => {
      message.success(`Project ${project.name} added.`);
      onProject(project);
      await utils.projects.list.invalidate();
      onCreated({ value: project.id, label: project.name });
    },
    onError: (error) => message.error(error.message),
  });

  return (
    <Modal open={open} width={960} title="Add project" okText="Add project" confirmLoading={create.isPending} onCancel={onClose} onOk={() => form.submit()} destroyOnHidden>
      <Form<ProjectCoreFormValues> form={form} layout="vertical" requiredMark initialValues={initial} onFinish={(v) => create.mutate(projectCreateInput(v))}>
        <ProjectFields mode="create" initial={initial} legalEntityLocked={!!legalEntityId} autoFocus />
        <p className="m-0 text-[12px] text-muted">Team, milestones and documents can be added later in Projects.</p>
      </Form>
    </Modal>
  );
}

/**
 * The project picker on entry forms. It lists projects by name, only those
 * of `legalEntityId` when one is given. F2 opens the full New Project form,
 * with what was typed as the name and the form's legal entity, and selects
 * the new project. Adding is offered only to those who may create projects.
 */
export function ProjectSelect({
  value,
  onChange,
  legalEntityId,
  placeholder = 'Select project…',
  disabled,
  allowClear,
  className,
}: {
  value?: string | null | undefined;
  /** Also given the chosen project, so a form can follow its tender, introducer or legal entity. */
  onChange?: (value: string | undefined, project: ProjectSummary | undefined) => void;
  /** Lists only this legal entity's projects, and adds the new one to it. */
  legalEntityId?: string | undefined;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
}) {
  const projects = trpc.projects.list.useQuery();
  const canAdd = (trpc.auth.me.useQuery().data?.permissions ?? []).includes('project.create');
  // Projects added here, known before the refreshed list has them.
  const added = useRef(new Map<string, ProjectSummary>());

  const rows = (projects.data ?? []).filter((p) => !legalEntityId || p.legalEntityId === legalEntityId).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <QuickAddSelect
      value={value}
      onChange={(next) => onChange?.(next, next ? ((projects.data ?? []).find((p) => p.id === next) ?? added.current.get(next)) : undefined)}
      options={rows.map((p) => ({ value: p.id, label: p.name }))}
      loading={projects.isLoading}
      placeholder={placeholder}
      {...(disabled ? { disabled: true } : {})}
      {...(allowClear ? { allowClear: true } : {})}
      {...(className ? { className } : {})}
      noun="project"
      canAdd={canAdd}
      renderAdd={(box) => <ProjectAddBox {...box} legalEntityId={legalEntityId} onProject={(project) => added.current.set(project.id, project)} />}
    />
  );
}
