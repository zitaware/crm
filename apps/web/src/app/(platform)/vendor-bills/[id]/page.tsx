'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { App, Button, Form, Input, Modal, Select } from 'antd';
import { PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { VendorSelect } from '@/components/vendor-select';
import { ProjectSelect } from '@/components/project-select';
import { LegalEntitySelect } from '@/components/legal-entity-select';
import { GstRegistrationSelect } from '@/components/gst-registration-select';
import { formatDate, formatMoney } from '@/lib/format';
import { DocumentsTab } from '@/components/documents-tab';
import {
  newIdempotencyKey,
  PRIORITY_OPTIONS,
  VendorBillLineItemsEditor,
  VendorBillLivePreviewPanel,
  VendorBillStatusTag,
  type LineItemFormValue,
  type VendorBillDetailData,
  type VendorBillLinesPreview,
  type VendorBillPriority,
} from '../shared';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';
import { PaymentRequestStatusTag, type PaymentRequestRow } from '../../payment-requests/shared';
import { DateInput } from '@/components/date-input';

interface DraftFormValues {
  vendorId: string;
  /** Optional (ADR-177): blank is company overhead. */
  projectId?: string | null;
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

function DraftEditor({ bill }: { bill: VendorBillDetailData }) {
  const { message } = App.useApp();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [form] = Form.useForm<DraftFormValues>();
  const formDraft = useFormDraft(`vendor-bill:${bill.id}`);
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef(false);
  useEffect(() => {
    if (appliedDraft.current || formDraft.isLoading || !formDraft.payload) return;
    appliedDraft.current = true;
    form.setFieldsValue(formDraft.payload as Partial<DraftFormValues>);
  }, [bill.id, form, formDraft.isLoading, formDraft.payload]);

  const projects = trpc.projects.list.useQuery();
  const units = trpc.masters.list.useQuery({ type: 'units_of_measure', includeInactive: false });
  const defaultUnitId = units.data?.find((u) => u.code === 'qty')?.id;

  const watchedProject = Form.useWatch('projectId', form);
  // Before the form reports its own value, the bill's; once touched, a cleared project means company overhead (ADR-177).
  const projectId = watchedProject === undefined && !form.isFieldTouched('projectId') ? bill.projectId : (watchedProject ?? null);
  const chosenLegalEntityId = Form.useWatch('legalEntityId', form);
  const selectedProject = (projects.data ?? []).find((p) => p.id === projectId);
  const legalEntityId = selectedProject?.legalEntityId ?? (projectId ? bill.legalEntityId : (chosenLegalEntityId ?? bill.legalEntityId));

  // Clear a previously-selected GST registration if the project (and so the
  // legal entity) changes to a different one — adjusted during render, not
  // in an effect, matching this app's own established pattern.
  const [lastLegalEntityId, setLastLegalEntityId] = useState(legalEntityId);
  if (legalEntityId !== lastLegalEntityId) {
    setLastLegalEntityId(legalEntityId);
    if (legalEntityId !== bill.legalEntityId) form.setFieldValue('gstRegistrationId', undefined);
  }

  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitKey, setSubmitKey] = useState(newIdempotencyKey());
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelKey, setCancelKey] = useState(newIdempotencyKey());

  const [preview, setPreview] = useState<VendorBillLinesPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const invalidate = () => utils.vendorBills.getDetail.invalidate({ id: bill.id });

  const updateMutation = trpc.vendorBills.updateDraft.useMutation({
    onSuccess: async () => {
      message.success('Vendor bill saved.');
      clearDraft.mutate({ formKey: `vendor-bill:${bill.id}` });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const submitMutation = trpc.vendorBills.submit.useMutation({
    onSuccess: async () => {
      message.success('Vendor bill submitted for approval.');
      setSubmitOpen(false);
      setSubmitKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const cancelMutation = trpc.vendorBills.cancel.useMutation({
    onSuccess: async () => {
      message.success('Vendor bill cancelled.');
      setCancelOpen(false);
      setCancelKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  // Live Summary panel — same debounced-server-call mechanism as the New
  // Vendor Bill page and the Record Payment page it's both modeled on.
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

  const submitUpdate = (values: DraftFormValues) => {
    updateMutation.mutate({
      id: bill.id,
      expectedVersion: bill.version,
      projectId: values.projectId ?? null,
      legalEntityId: values.projectId ? undefined : values.legalEntityId,
      vendorId: values.vendorId,
      priority: values.priority,
      gstRegistrationId: values.gstRegistrationId,
      vendorBillNumber: values.vendorBillNumber,
      vendorBillDate: values.vendorBillDate,
      lines: toLineInputs(values.lines),
    });
  };

  return (
    <>
      <UiCard
        flush
        title="Draft Vendor Bill"
        
        actions={
          <Button size="small" onClick={() => router.push('/purchases')}>
            Back to list
          </Button>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px]">
          <div className="border-b border-ui-2 p-4 lg:border-b-0 lg:border-r lg:border-ui-2">
            <Form<DraftFormValues>
              id="vendor-bill-draft-form"
              form={form}
              layout="vertical"
              onFinish={submitUpdate}
              initialValues={{
                vendorId: bill.vendorId,
                projectId: bill.projectId,
                legalEntityId: bill.legalEntityId,
                priority: bill.priority,
                gstRegistrationId: bill.gstRegistrationId,
                vendorBillNumber: bill.vendorBillNumber,
                vendorBillDate: bill.vendorBillDate,
                lines: bill.lines.map((l) => ({
                  description: l.description,
                  expenseCategoryId: l.expenseCategoryId,
                  unitOfMeasureId: l.unitOfMeasureId ?? defaultUnitId,
                  hsnSac: l.hsnSac ?? undefined,
                  quantity: l.quantity,
                  unitPrice: l.unitPrice,
                  gstRatePercent: l.gstRatePercent,
                  itcEligible: l.itcEligible,
                })),
              }}
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
                    <LegalEntitySelect />
                  </Form.Item>
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Form.Item label="GST registration" name="gstRegistrationId" rules={[{ required: true }]}>
                  <GstRegistrationSelect legalEntityId={legalEntityId} />
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
            loading={formDraft.saving}
            onClick={() => formDraft.save(form.getFieldsValue(true) as unknown as Record<string, unknown>)}
          >
            Save as draft
          </Button>
          <Button type="primary" htmlType="submit" form="vendor-bill-draft-form" loading={updateMutation.isPending}>
            Save
          </Button>
          <Button onClick={() => setSubmitOpen(true)}>Submit for Approval…</Button>
          <Button danger onClick={() => setCancelOpen(true)}>
            Cancel Request…
          </Button>
        </div>
      </UiCard>

      <UiCard title="Documents" className="mt-4">
        <DocumentsTab entityType="VENDOR_BILL" entityId={bill.id} />
      </UiCard>

      <Modal
        title="Submit Vendor Bill"
        open={submitOpen}
        onCancel={() => setSubmitOpen(false)}
        onOk={() => submitMutation.mutate({ id: bill.id, expectedVersion: bill.version, idempotencyKey: submitKey })}
        confirmLoading={submitMutation.isPending}
        okText="Submit"
      >
        <p className="text-muted">
          Submitting freezes this bill&apos;s lines and amounts, and sends it for approval. You will not be able to edit it afterward.
        </p>
      </Modal>

      <Modal
        title="Cancel Vendor Bill"
        open={cancelOpen}
        onCancel={() => setCancelOpen(false)}
        onOk={() => cancelMutation.mutate({ id: bill.id, expectedVersion: bill.version, reason: cancelReason, idempotencyKey: cancelKey })}
        confirmLoading={cancelMutation.isPending}
        okButtonProps={{ disabled: !cancelReason.trim() }}
        okText="Cancel Request"
      >
        <p className="mb-2 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
      </Modal>
    </>
  );
}

/** Shown once a bill is FINALIZED — every Payment Request that has
 * reserved (or once reserved) part of this bill's balance, plus the
 * "Raise Payment Request…" action, shown only while a balance actually
 * remains (not merely "when finalized"). */
function PaymentRequestsCard({ bill }: { bill: VendorBillDetailData }) {
  const router = useRouter();
  const me = trpc.auth.me.useQuery();
  const canCreate = (me.data?.permissions ?? []).includes('payment_request.create');
  const list = trpc.paymentRequests.list.useQuery({ page: 1, pageSize: 50, filters: { vendorBillId: bill.id } });
  const availability = trpc.paymentRequests.getBillAvailability.useQuery({ vendorBillId: bill.id });
  const rows = (list.data?.rows ?? []) as PaymentRequestRow[];
  const hasBalance = Number(availability.data?.available ?? '0') > 0;

  return (
    <UiCard
      title="Payment Requests"
      className="mt-4"
      actions={
        canCreate && hasBalance ? (
          <Button size="small" type="primary" onClick={() => router.push(`/payment-requests/new?vendorBillId=${bill.id}`)}>
            Raise Payment Request…
          </Button>
        ) : undefined
      }
    >
      <p className="mb-3 text-[12px] text-muted">Available to request: {formatMoney(availability.data?.available ?? '0')} of {formatMoney(bill.totalAmount)}.</p>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-muted">No payment requests raised against this bill yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-ui text-left text-muted">
                <th className="py-2 pr-3">Request</th>
                <th className="py-2 pr-3 text-right">Requested Amount</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ui-2">
                  <td className="py-2 pr-3">{row.requestNumber ?? 'Draft'}</td>
                  <td className="py-2 pr-3 text-right">{formatMoney(row.totalRequestedAmount)}</td>
                  <td className="py-2 pr-3">
                    <PaymentRequestStatusTag status={row.status} />
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <Button size="small" onClick={() => router.push(`/payment-requests/${row.id}`)}>
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </UiCard>
  );
}

/** Covers every non-DRAFT status: SUBMITTED (maker-checker pending),
 * FINALIZED (posted), REJECTED/CANCELLED (terminal, no posting ever
 * happened), VOID (posted then reversed). Merges the former
 * FinalizedOrVoidView's read-only detail/GST/void content with Purchase
 * Request's own DecidedOrSubmittedView maker-checker UI, ported almost
 * verbatim — approve/reject/cancel now live here instead of on a separate
 * document. */
function DecidedView({ bill }: { bill: VendorBillDetailData }) {
  const { message } = App.useApp();
  const router = useRouter();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const permissions = me.data?.permissions ?? [];
  const canApprove = permissions.includes('vendor_bill.approve');
  const canSelfApprove = permissions.includes('vendor_bill.self_approve');
  const canVoid = permissions.includes('vendor_bill.void');
  const isOwnRequest = bill.createdBy === me.data?.userId;
  const canCancel = bill.createdBy === me.data?.userId;

  const [approveOpen, setApproveOpen] = useState(false);
  const [approveNote, setApproveNote] = useState('');
  const [approveKey, setApproveKey] = useState(newIdempotencyKey());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectKey, setRejectKey] = useState(newIdempotencyKey());
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelKey, setCancelKey] = useState(newIdempotencyKey());
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidAccountingDate, setVoidAccountingDate] = useState('');
  const [voidKey, setVoidKey] = useState(newIdempotencyKey());

  const invalidate = () => utils.vendorBills.getDetail.invalidate({ id: bill.id });

  const approveMutation = trpc.vendorBills.approve.useMutation({
    onSuccess: async () => {
      message.success('Vendor bill approved and posted.');
      setApproveOpen(false);
      setApproveKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const rejectMutation = trpc.vendorBills.reject.useMutation({
    onSuccess: async () => {
      message.success('Vendor bill rejected.');
      setRejectOpen(false);
      setRejectKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const cancelMutation = trpc.vendorBills.cancel.useMutation({
    onSuccess: async () => {
      message.success('Vendor bill cancelled.');
      setCancelOpen(false);
      setCancelKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const voidMutation = trpc.vendorBills.void.useMutation({
    onSuccess: async () => {
      message.success('Vendor bill voided.');
      setVoidOpen(false);
      setVoidKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  // Approve is hidden entirely for a self-authored bill unless the viewer
  // also holds vendor_bill.self_approve — never just disabled.
  const showApprove = bill.status === 'SUBMITTED' && canApprove && (!isOwnRequest || canSelfApprove);
  const showReject = bill.status === 'SUBMITTED' && canApprove;
  const showCancel = bill.status === 'SUBMITTED' && canCancel;
  const showVoid = bill.status === 'FINALIZED' && canVoid;

  return (
    <>
      <UiCard
        title={bill.vendorBillNumber}
        actions={
          <div className="flex gap-2">
            {showApprove ? (
              <Button size="small" type="primary" onClick={() => setApproveOpen(true)}>
                {isOwnRequest ? 'Approve (Self)…' : 'Approve…'}
              </Button>
            ) : null}
            {showReject ? (
              <Button size="small" danger onClick={() => setRejectOpen(true)}>
                Reject…
              </Button>
            ) : null}
            {showCancel ? (
              <Button size="small" onClick={() => setCancelOpen(true)}>
                Cancel…
              </Button>
            ) : null}
            {showVoid ? (
              <Button size="small" danger onClick={() => setVoidOpen(true)}>
                Void…
              </Button>
            ) : null}
            <Button size="small" onClick={() => router.push('/purchases')}>
              Back to list
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Details</p>
            <div className="text-[12px] text-muted">Vendor: {bill.vendorName}</div>
            <div className="text-[12px] text-muted">Project: {bill.projectName ?? 'Company overhead'}</div>
            {bill.billUrl ? (
              <div className="text-[12px] text-muted">
                Invoice:{' '}
                {/^https?:\/\//i.test(bill.billUrl) ? (
                  <a href={bill.billUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                    open link
                  </a>
                ) : (
                  bill.billUrl
                )}
              </div>
            ) : null}
            {bill.paymentReceiptUrl ? (
              <div className="text-[12px] text-muted">
                Payment receipt:{' '}
                {/^https?:\/\//i.test(bill.paymentReceiptUrl) ? (
                  <a href={bill.paymentReceiptUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                    open link
                  </a>
                ) : (
                  bill.paymentReceiptUrl
                )}
              </div>
            ) : null}
            <div className="text-[12px] text-muted">Priority: {bill.priority}</div>
            <div className="text-[12px] text-muted">Legal entity: {bill.legalEntityName}</div>
            <div className="text-[12px] text-muted">GST registration: {bill.gstRegistrationGstin}</div>
            <div className="text-[12px] text-muted">Bill date: {formatDate(bill.vendorBillDate)}</div>
          </div>
          <div>
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Posting</p>
            <div className="text-[12px] text-muted">Journal entry: {bill.journalEntryId ?? '—'}</div>
            {bill.status === 'VOID' ? (
              <>
                <div className="text-[12px] text-muted">Void reason: {bill.voidReason ?? '—'}</div>
                <div className="text-[12px] text-muted">Voided at: {bill.voidedAt ? formatDate(bill.voidedAt) : '—'}</div>
                <div className="text-[12px] text-muted">Reversal journal entry: {bill.voidJournalEntryId ?? '—'}</div>
              </>
            ) : null}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-ui text-left text-muted">
                <th className="py-2 pr-3">Description</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3 text-right">Qty</th>
                <th className="py-2 pr-3">Unit</th>
                <th className="py-2 pr-3 text-right">Unit Price</th>
                <th className="py-2 pr-3 text-right">Taxable</th>
                <th className="py-2 pr-3 text-right">GST%</th>
                <th className="py-2 pr-3 text-right">CGST</th>
                <th className="py-2 pr-3 text-right">SGST</th>
                <th className="py-2 pr-3 text-right">IGST</th>
                <th className="py-2 pr-3 text-center">ITC</th>
                <th className="py-2 pr-3 text-right">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((line) => (
                <tr key={line.id} className="border-b border-ui-2">
                  <td className="py-2 pr-3">{line.description}</td>
                  <td className="py-2 pr-3">
                    {line.inventoryItemId ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="rounded-ui bg-positive-soft px-1.5 py-0.5 text-[11px] font-medium text-positive">Stock</span>
                        {line.inventoryItemName}
                      </span>
                    ) : (
                      line.expenseCategoryName
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">{line.quantity}</td>
                  <td className="py-2 pr-3">{line.unitOfMeasureName ?? '—'}</td>
                  <td className="py-2 pr-3 text-right">{formatMoney(line.unitPrice)}</td>
                  <td className="py-2 pr-3 text-right">{formatMoney(line.taxableAmount)}</td>
                  <td className="py-2 pr-3 text-right">{line.gstRatePercent}</td>
                  <td className="py-2 pr-3 text-right">{formatMoney(line.cgstAmount)}</td>
                  <td className="py-2 pr-3 text-right">{formatMoney(line.sgstAmount)}</td>
                  <td className="py-2 pr-3 text-right">{formatMoney(line.igstAmount)}</td>
                  <td className="py-2 pr-3 text-center">{line.itcEligible ? 'Yes' : 'No'}</td>
                  <td className="py-2 pr-3 text-right">{formatMoney(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ml-auto mt-4 w-full max-w-xs rounded-ui border border-ui">
          <div className="flex justify-between border-b border-ui-2 px-4 py-2 text-[13px]">
            <span className="text-muted">Taxable</span>
            <span>{formatMoney(bill.taxableAmount)}</span>
          </div>
          {bill.cgstAmount && Number(bill.cgstAmount) > 0 ? (
            <div className="flex justify-between border-b border-ui-2 px-4 py-2 text-[13px]">
              <span className="text-muted">CGST</span>
              <span>{formatMoney(bill.cgstAmount)}</span>
            </div>
          ) : null}
          {bill.sgstAmount && Number(bill.sgstAmount) > 0 ? (
            <div className="flex justify-between border-b border-ui-2 px-4 py-2 text-[13px]">
              <span className="text-muted">SGST</span>
              <span>{formatMoney(bill.sgstAmount)}</span>
            </div>
          ) : null}
          {bill.igstAmount && Number(bill.igstAmount) > 0 ? (
            <div className="flex justify-between border-b border-ui-2 px-4 py-2 text-[13px]">
              <span className="text-muted">IGST</span>
              <span>{formatMoney(bill.igstAmount)}</span>
            </div>
          ) : null}
          <div className="flex justify-between px-4 py-2 text-[14px] font-semibold text-ink">
            <span>Total</span>
            <span>{formatMoney(bill.totalAmount)}</span>
          </div>
        </div>

        {bill.status === 'CANCELLED' ? (
          <div className="mt-4 rounded-ui border border-ui bg-ui-2 p-3 text-[12.5px] text-muted">
            <b>Cancelled.</b> Reason: {bill.cancelledReason ?? '—'} — {bill.cancelledAt ? formatDate(bill.cancelledAt) : '—'}
          </div>
        ) : null}

        {bill.decisions.length > 0 ? (
          <div className="mt-4">
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Approval History</p>
            <div className="flex flex-col divide-y divide-ui">
              {bill.decisions.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12.5px]">
                  <div>
                    <span className={d.decision === 'APPROVED' ? 'font-medium text-positive' : 'font-medium text-negative'}>{d.decision === 'APPROVED' ? 'Approved' : 'Rejected'}</span>
                    {d.isSelfApproval ? <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] text-brand">Self-approved</span> : null}
                    {d.note ? <div className="mt-1 text-muted">{d.note}</div> : null}
                  </div>
                  <span className="text-muted">{formatDate(d.decidedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </UiCard>

      {bill.status === 'FINALIZED' && permissions.includes('payment_request.read') ? <PaymentRequestsCard bill={bill} /> : null}

      <UiCard title="Documents" className="mt-4">
        <DocumentsTab entityType="VENDOR_BILL" entityId={bill.id} />
      </UiCard>

      <Modal
        title={isOwnRequest ? 'Approve Your Own Vendor Bill' : 'Approve Vendor Bill'}
        open={approveOpen}
        onCancel={() => setApproveOpen(false)}
        onOk={() => approveMutation.mutate({ id: bill.id, expectedVersion: bill.version, note: approveNote.trim() || undefined, idempotencyKey: approveKey })}
        confirmLoading={approveMutation.isPending}
        okButtonProps={{ disabled: isOwnRequest && !approveNote.trim() }}
        okText="Approve"
      >
        {isOwnRequest ? (
          <>
            <p className="mb-2 text-negative">You are approving your own vendor bill. A justification note is required.</p>
            <Input.TextArea rows={3} value={approveNote} onChange={(e) => setApproveNote(e.target.value)} placeholder="Why are you approving your own bill?" />
          </>
        ) : (
          <p className="text-muted">This approves the bill and posts the Expense / Input GST Receivable / Accounts Payable journal entry. You will not be able to edit it afterward — only void it.</p>
        )}
      </Modal>

      <Modal
        title="Reject Vendor Bill"
        open={rejectOpen}
        onCancel={() => setRejectOpen(false)}
        onOk={() => rejectMutation.mutate({ id: bill.id, expectedVersion: bill.version, reason: rejectReason, idempotencyKey: rejectKey })}
        confirmLoading={rejectMutation.isPending}
        okButtonProps={{ disabled: !rejectReason.trim() }}
        okText="Reject"
      >
        <p className="mb-2 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
      </Modal>

      <Modal
        title="Cancel Vendor Bill"
        open={cancelOpen}
        onCancel={() => setCancelOpen(false)}
        onOk={() => cancelMutation.mutate({ id: bill.id, expectedVersion: bill.version, reason: cancelReason, idempotencyKey: cancelKey })}
        confirmLoading={cancelMutation.isPending}
        okButtonProps={{ disabled: !cancelReason.trim() }}
        okText="Cancel Request"
      >
        <p className="mb-2 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
      </Modal>

      <Modal
        title="Void Vendor Bill"
        open={voidOpen}
        onCancel={() => setVoidOpen(false)}
        onOk={() => voidMutation.mutate({ id: bill.id, expectedVersion: bill.version, reason: voidReason, accountingDate: voidAccountingDate, idempotencyKey: voidKey })}
        confirmLoading={voidMutation.isPending}
        okButtonProps={{ disabled: !voidReason.trim() || !voidAccountingDate }}
        okText="Void"
      >
        <p className="mb-2 text-muted">This reverses the posted journal entry. Reason (required):</p>
        <Input.TextArea rows={3} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} className="mb-3" />
        <p className="mb-2 text-muted">Reversal accounting date (required):</p>
        <DateInput value={voidAccountingDate} onChange={setVoidAccountingDate} />
      </Modal>
    </>
  );
}

export default function VendorBillDetailPage() {
  const params = useParams();
  const id = String(params.id ?? '');

  const detail = trpc.vendorBills.getDetail.useQuery({ id }, { enabled: !!id });

  if (detail.isError) {
    return <PageHeader title="Vendor Bill" description="Could not load this vendor bill." />;
  }
  if (detail.isLoading || !detail.data) {
    return <PageHeader title="Vendor Bill" description="Loading…" />;
  }

  const bill = detail.data as VendorBillDetailData;

  return (
    <>
      <PageHeader title={bill.vendorBillNumber} description={`${bill.vendorName} · ${bill.projectName ?? 'Company overhead'}`} actions={<VendorBillStatusTag status={bill.status} />} />
      {bill.status === 'DRAFT' ? <DraftEditor bill={bill} /> : <DecidedView bill={bill} />}
    </>
  );
}
