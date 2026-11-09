'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Form, Input, Select } from 'antd';
import { UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { VendorSelect } from '@/components/vendor-select';
import { ProjectSelect } from '@/components/project-select';
import { LegalEntitySelect } from '@/components/legal-entity-select';
import { GstRegistrationSelect } from '@/components/gst-registration-select';
import {
  newIdempotencyKey,
  PRIORITY_OPTIONS,
  VendorBillLineItemsEditor,
  VendorBillLivePreviewPanel,
  type LineItemFormValue,
  type VendorBillLinesPreview,
  type VendorBillPriority,
} from '../shared';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';
import { DateInput } from '@/components/date-input';

interface DraftFormValues {
  vendorId: string;
  /** Optional (ADR-177): blank is company overhead, and the legal entity is chosen instead. */
  projectId?: string;
  legalEntityId?: string;
  priority: VendorBillPriority;
  gstRegistrationId: string;
  vendorBillNumber: string;
  vendorBillDate: string;
  lines: LineItemFormValue[];
}

function toLineInputs(lines: LineItemFormValue[]) {
  return lines.map((l) => ({
    description: l.description,
    // Exactly one of the two is sent — the local `lineType` switch is a UI
    // affordance only and is never submitted.
    expenseCategoryId: l.lineType === 'STOCK' ? undefined : l.expenseCategoryId,
    inventoryItemId: l.lineType === 'STOCK' ? l.inventoryItemId : undefined,
    unitOfMeasureId: l.unitOfMeasureId,
    hsnSac: l.hsnSac?.trim() || undefined,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    gstRatePercent: l.gstRatePercent,
    itcEligible: l.itcEligible,
  }));
}

export default function NewVendorBillPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<DraftFormValues>();
  const formDraft = useFormDraft('vendor-bill:new');
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef(false);
  useEffect(() => {
    if (appliedDraft.current || formDraft.isLoading || !formDraft.payload) return;
    appliedDraft.current = true;
    form.setFieldsValue(formDraft.payload as Partial<DraftFormValues>);
  }, [form, formDraft.isLoading, formDraft.payload]);
  const utils = trpc.useUtils();

  const projects = trpc.projects.list.useQuery();
  const units = trpc.masters.list.useQuery({ type: 'units_of_measure', includeInactive: false });
  const defaultUnitId = units.data?.find((u) => u.code === 'qty')?.id;

  const projectId = Form.useWatch('projectId', form);
  const chosenLegalEntityId = Form.useWatch('legalEntityId', form);
  const selectedProject = (projects.data ?? []).find((p) => p.id === projectId);
  const legalEntityId = selectedProject?.legalEntityId ?? (projectId ? undefined : chosenLegalEntityId);

  // Once a project resolves a legal entity, clear a GST registration
  // selected under a previously-resolved (different) legal entity — same
  // "adjust during render, not in an effect" pattern used elsewhere in this
  // app, avoiding a stale registration silently surviving a project change.
  const [lastLegalEntityId, setLastLegalEntityId] = useState<string | undefined>(legalEntityId);
  if (legalEntityId !== lastLegalEntityId) {
    setLastLegalEntityId(legalEntityId);
    form.setFieldValue('gstRegistrationId', undefined);
  }

  const [preview, setPreview] = useState<VendorBillLinesPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Live Summary panel — same debounced-server-call mechanism as the
  // Record Payment page it's modeled on.
  const allValues = Form.useWatch([], form);
  useEffect(() => {
    const timer = setTimeout(() => {
      const values = form.getFieldsValue();
      const validLines = (values.lines ?? []).filter((l) => l?.description && (l?.lineType === 'STOCK' ? l?.inventoryItemId : l?.expenseCategoryId) && l?.unitOfMeasureId && l?.unitPrice && l?.gstRatePercent);
      if (!values.vendorId || !values.gstRegistrationId || validLines.length === 0) {
        setPreview(null);
        setPreviewError(null);
        return;
      }
      setPreviewLoading(true);
      utils.vendorBills.calculatePreview
        .fetch({ vendorId: values.vendorId, gstRegistrationId: values.gstRegistrationId, lines: toLineInputs(validLines) })
        .then((result) => {
          setPreview(result);
          setPreviewError(null);
        })
        .catch((error: unknown) => {
          setPreview(null);
          setPreviewError(error instanceof Error ? error.message : 'Could not compute the preview.');
        })
        .finally(() => setPreviewLoading(false));
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on any form value change, not a specific field list
  }, [JSON.stringify(allValues)]);

  const [createKey] = useState(newIdempotencyKey());
  const [submitKey] = useState(newIdempotencyKey());
  const createMutation = trpc.vendorBills.createDraft.useMutation();
  const submitMutation = trpc.vendorBills.submit.useMutation();
  const [submitting, setSubmitting] = useState(false);

  // Two distinct submit buttons share one <Form onFinish>; a ref (not
  // state) records which was clicked so the async handler below always
  // reads the latest value regardless of React's render/batching timing.
  const pendingActionRef = useRef<'draft' | 'submit'>('draft');

  const handleFinish = async (values: DraftFormValues) => {
    setSubmitting(true);
    try {
      const draft = await createMutation.mutateAsync({
        vendorId: values.vendorId,
        projectId: values.projectId || undefined,
        legalEntityId: values.projectId ? undefined : values.legalEntityId,
        priority: values.priority,
        gstRegistrationId: values.gstRegistrationId,
        vendorBillNumber: values.vendorBillNumber,
        vendorBillDate: values.vendorBillDate,
        lines: toLineInputs(values.lines),
        idempotencyKey: createKey,
      });
      if (pendingActionRef.current === 'draft') {
        message.success('Draft saved.');
        clearDraft.mutate({ formKey: 'vendor-bill:new' });
        router.push(`/vendor-bills/${draft.id}`);
        return;
      }
      const submitted = await submitMutation.mutateAsync({ id: draft.id, expectedVersion: draft.version, idempotencyKey: submitKey });
      message.success('Vendor bill submitted for approval.');
      clearDraft.mutate({ formKey: 'vendor-bill:new' });
      router.push(`/vendor-bills/${submitted.id}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not save this vendor bill.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <UiCard
        flush
        title="New Vendor Bill"
        
        actions={
          <Button size="small" onClick={() => router.push('/purchases')}>
            Back to list
          </Button>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px]">
          <div className="border-b border-ui-2 p-4 lg:border-b-0 lg:border-r lg:border-ui-2">
            <Form<DraftFormValues>
              id="vendor-bill-new-form"
              form={form}
              layout="vertical"
              onFinish={handleFinish}
              initialValues={{ priority: 'NORMAL', lines: [{ description: '', amount: undefined }] }}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Form.Item label="Vendor" name="vendorId" rules={[{ required: true, message: 'Vendor is required.' }]}>
                  <VendorSelect />
                </Form.Item>
                <Form.Item label="Project (optional)" name="projectId" extra={projectId ? undefined : 'Blank is company overhead.'}>
                  <ProjectSelect allowClear placeholder="Company overhead" />
                </Form.Item>
                <Form.Item label="Priority" name="priority">
                  <Select options={PRIORITY_OPTIONS} />
                </Form.Item>
              </div>
              {selectedProject ? <p className="mb-3 -mt-1 text-[11.5px] text-muted">Legal entity: {selectedProject.legalEntityName}</p> : null}
              {!projectId ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <Form.Item label="Legal entity" name="legalEntityId" rules={[{ required: true, message: 'Choose the company that is billed.' }]}>
                    <LegalEntitySelect placeholder="Company that is billed" />
                  </Form.Item>
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Form.Item
                  label="GST registration"
                  name="gstRegistrationId"
                  rules={[{ required: true, message: 'GST registration is required.' }]}
                  extra={!legalEntityId ? 'Choose a project or a legal entity first.' : undefined}
>
                  <GstRegistrationSelect legalEntityId={legalEntityId} disabled={!legalEntityId} />
                </Form.Item>
                <Form.Item
                  label="Vendor bill number"
                  name="vendorBillNumber"
                  rules={[{ required: true, message: "The vendor's own bill number is required." }]}
>
                  <Input />
                </Form.Item>
                <Form.Item label="Vendor bill date" name="vendorBillDate" rules={[{ required: true, message: 'Bill date is required.' }]}>
                  <DateInput />
                </Form.Item>
              </div>

              <p className="mb-2 mt-1 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Line Items</p>
              <VendorBillLineItemsEditor defaultUnitOfMeasureId={defaultUnitId} />
            </Form>
          </div>

          <VendorBillLivePreviewPanel preview={preview} loading={previewLoading} error={previewError} />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-ui-2 bg-paper p-4">
          {formDraft.payload ? <DraftFormNote saveLabel="Save" /> : null}
          <Button
            htmlType="button"
            loading={formDraft.saving || submitting}
            onClick={() => formDraft.save(form.getFieldsValue(true) as unknown as Record<string, unknown>)}
          >
            Save as draft
          </Button>
          <Button type="primary" htmlType="submit" form="vendor-bill-new-form" loading={submitting} onClick={() => (pendingActionRef.current = 'submit')}>
            Submit for Approval
          </Button>
          <Button onClick={() => router.push('/purchases')}>Cancel</Button>
        </div>
      </UiCard>
    </>
  );
}
