'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { App, Button, Checkbox, Form, Input, Modal, Select } from 'antd';
import { MoneyInput, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';
import { formatDate, formatMoney } from '@/lib/format';
import { DocumentsTab } from '@/components/documents-tab';
import {
  newIdempotencyKey,
  PRIORITY_OPTIONS,
  PaymentRequestStatusTag,
  type EligibleVendorBillRow,
  type PaymentRequestDetailData,
  type PaymentRequestPriority,
} from '../shared';
import { VendorPaymentStatusTag, type VendorPaymentRow } from '../../vendor-payments/shared';
import { DateInput } from '@/components/date-input';

interface DraftFormValues {
  requestedPaymentDate: string;
  priority: PaymentRequestPriority;
  remarks?: string;
}

function DraftEditor({ request }: { request: PaymentRequestDetailData }) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const [form] = Form.useForm<DraftFormValues>();
  const formDraft = useFormDraft(`payment-request:${request.id}`);
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef(false);
  useEffect(() => {
    if (appliedDraft.current || formDraft.isLoading || !formDraft.payload) return;
    appliedDraft.current = true;
    form.setFieldsValue(formDraft.payload as Partial<DraftFormValues>);
  }, [form, formDraft.isLoading, formDraft.payload]);

  const eligible = trpc.paymentRequests.getEligibleBills.useQuery({ vendorId: request.vendorId, legalEntityId: request.legalEntityId });
  const bills: EligibleVendorBillRow[] = eligible.data?.bills ?? [];

  // vendorBillId -> requested amount string, present only while selected.
  // Seeded from the request's own current lines the first time bills load —
  // adjusted during render, not in an effect, per React's own "adjusting
  // state when a prop changes" pattern.
  const [selected, setSelected] = useState<Record<string, string> | null>(null);
  if (selected === null && bills.length > 0) {
    const initial: Record<string, string> = {};
    for (const line of request.lines) {
      initial[line.vendorBillId] = line.requestedAmount;
    }
    setSelected(initial);
  }

  const effectiveSelected = selected ?? {};
  const toggleBill = (bill: EligibleVendorBillRow) => {
    setSelected((prev) => {
      const next = { ...(prev ?? {}) };
      if (bill.vendorBillId in next) {
        delete next[bill.vendorBillId];
      } else {
        // A bill already on this draft may show less "available" than its
        // own requested amount here (this draft's own reservation isn't
        // counted against itself elsewhere) — default to whichever is
        // larger so re-checking doesn't silently shrink an existing line.
        const existing = request.lines.find((l) => l.vendorBillId === bill.vendorBillId)?.requestedAmount;
        next[bill.vendorBillId] = existing && Number(existing) > Number(bill.availableForRequest) ? existing : bill.availableForRequest;
      }
      return next;
    });
  };
  const setBillAmount = (vendorBillId: string, value: string) => {
    setSelected((prev) => ({ ...(prev ?? {}), [vendorBillId]: value }));
  };

  const lines = Object.entries(effectiveSelected).map(([vendorBillId, requestedAmount]) => ({ vendorBillId, requestedAmount }));
  const preview = trpc.paymentRequests.calculatePreview.useQuery(
    { vendorId: request.vendorId, legalEntityId: request.legalEntityId, lines },
    { enabled: lines.length > 0 },
  );

  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitKey, setSubmitKey] = useState(newIdempotencyKey());
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelKey, setCancelKey] = useState(newIdempotencyKey());

  const invalidate = () => utils.paymentRequests.getDetail.invalidate({ id: request.id });

  const updateMutation = trpc.paymentRequests.updateDraft.useMutation({
    onSuccess: async () => {
      message.success('Payment request saved.');
      clearDraft.mutate({ formKey: `payment-request:${request.id}` });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const submitMutation = trpc.paymentRequests.submit.useMutation({
    onSuccess: async () => {
      message.success('Request submitted for approval.');
      setSubmitOpen(false);
      setSubmitKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const cancelMutation = trpc.paymentRequests.cancel.useMutation({
    onSuccess: async () => {
      message.success('Request cancelled.');
      setCancelOpen(false);
      setCancelKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const submitUpdate = (values: DraftFormValues) => {
    if (lines.length === 0) {
      message.error('Select at least one vendor bill.');
      return;
    }
    updateMutation.mutate({
      id: request.id,
      expectedVersion: request.version,
      requestedPaymentDate: values.requestedPaymentDate,
      priority: values.priority,
      remarks: values.remarks?.trim() || undefined,
      lines,
    });
  };

  return (
    <>
      <UiCard title="Draft Payment Request">
        <Form<DraftFormValues>
          form={form}
          layout="vertical"
          onFinish={submitUpdate}
          initialValues={{
            requestedPaymentDate: request.requestedPaymentDate,
            priority: request.priority,
            remarks: request.remarks ?? undefined,
          }}
        >
          <p className="mb-2 mt-1 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Request Details</p>
          <div className="mb-2 text-[12px] text-muted">
            Vendor: {request.vendorName} · Legal Entity: {request.legalEntityName}
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            <Form.Item label="Requested payment date" name="requestedPaymentDate" rules={[{ required: true, message: 'Requested payment date is required.' }]}>
              <DateInput />
            </Form.Item>
            <Form.Item label="Priority" name="priority">
              <Select options={PRIORITY_OPTIONS} />
            </Form.Item>
          </div>
          <Form.Item label="Remarks" name="remarks" rules={[{ max: 2000 }]}>
            <Input.TextArea rows={2} />
          </Form.Item>

          <p className="mb-2 mt-4 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Vendor Bills</p>
          {eligible.isLoading ? (
            <p className="text-[12.5px] text-muted">Loading eligible bills…</p>
          ) : bills.length === 0 ? (
            <p className="text-[12.5px] text-muted">No finalized vendor bills with an available balance for this vendor and legal entity.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-ui text-left text-muted">
                    <th className="py-2 pr-3" />
                    <th className="py-2 pr-3">Bill No.</th>
                    <th className="py-2 pr-3">Project</th>
                    <th className="py-2 pr-3">Bill Date</th>
                    <th className="py-2 pr-3">Due Date</th>
                    <th className="py-2 pr-3 text-right">Bill Total</th>
                    <th className="py-2 pr-3 text-right">Already Reserved</th>
                    <th className="py-2 pr-3 text-right">Available</th>
                    <th className="py-2 pr-3 text-right">Requested Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((bill) => {
                    const isSelected = bill.vendorBillId in effectiveSelected;
                    return (
                      <tr key={bill.vendorBillId} className="border-b border-ui-2">
                        <td className="py-2 pr-3">
                          <Checkbox checked={isSelected} onChange={() => toggleBill(bill)} />
                        </td>
                        <td className="py-2 pr-3">{bill.vendorBillNumber}</td>
                        <td className="py-2 pr-3">{bill.projectName}</td>
                        <td className="py-2 pr-3">{formatDate(bill.vendorBillDate)}</td>
                        <td className="py-2 pr-3">{bill.dueDate ? formatDate(bill.dueDate) : '—'}</td>
                        <td className="py-2 pr-3 text-right">{formatMoney(bill.totalAmount)}</td>
                        <td className="py-2 pr-3 text-right">{formatMoney(bill.alreadyReserved)}</td>
                        <td className="py-2 pr-3 text-right">{formatMoney(bill.availableForRequest)}</td>
                        <td className="py-2 pr-3 text-right">
                          <div className="ml-auto w-[140px]">
                            <MoneyInput
                              disabled={!isSelected}
                              value={effectiveSelected[bill.vendorBillId] ?? bill.availableForRequest}
                              onChange={(value) => setBillAmount(bill.vendorBillId, value ?? '')}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 ml-auto w-full max-w-xs rounded-ui border border-ui">
            <div className="flex justify-between px-4 py-2 text-[14px] font-semibold text-ink">
              <span>Total Requested</span>
              <span>{formatMoney(preview.data?.totalRequestedAmount ?? request.totalRequestedAmount ?? '0')}</span>
            </div>
          </div>
          {preview.data && !preview.data.valid ? (
            <p className="mt-2 text-[12px] text-negative">One or more selected amounts exceed what&apos;s currently available. Adjust before saving.</p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {formDraft.payload ? <DraftFormNote saveLabel="Save" /> : null}
            <Button
              htmlType="button"
              loading={formDraft.saving}
              onClick={() => formDraft.save(form.getFieldsValue(true) as unknown as Record<string, unknown>)}
            >
              Save as draft
            </Button>
            <Button type="primary" htmlType="submit" loading={updateMutation.isPending}>
              Save
            </Button>
            <Button onClick={() => setSubmitOpen(true)}>Submit for Approval…</Button>
            <Button danger onClick={() => setCancelOpen(true)}>
              Cancel Request…
            </Button>
          </div>
        </Form>
      </UiCard>

      <UiCard title="Documents" className="mt-4">
        <DocumentsTab entityType="PAYMENT_REQUEST" entityId={request.id} />
      </UiCard>

      <Modal
        title="Submit Payment Request"
        open={submitOpen}
        onCancel={() => setSubmitOpen(false)}
        onOk={() => submitMutation.mutate({ id: request.id, expectedVersion: request.version, idempotencyKey: submitKey })}
        confirmLoading={submitMutation.isPending}
        okText="Submit"
      >
        <p className="text-muted">
          Submitting locks in these vendor bills and requested amounts, and reserves that amount against each bill&apos;s available balance for approval. You will not be able to edit it
          afterward.
        </p>
      </Modal>

      <Modal
        title="Cancel Payment Request"
        open={cancelOpen}
        onCancel={() => setCancelOpen(false)}
        onOk={() => cancelMutation.mutate({ id: request.id, expectedVersion: request.version, reason: cancelReason, idempotencyKey: cancelKey })}
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

function DecidedOrSubmittedView({ request }: { request: PaymentRequestDetailData }) {
  const { message } = App.useApp();
  const router = useRouter();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const permissions = me.data?.permissions ?? [];
  const canApprove = permissions.includes('payment_request.approve');
  const canSelfApprove = permissions.includes('payment_request.self_approve');
  const canRevoke = permissions.includes('payment_request.revoke');
  const canRecordPayment = permissions.includes('vendor_payment.post');
  const isOwnRequest = request.createdBy === me.data?.userId;
  const canCancel = request.createdBy === me.data?.userId;

  const availability = trpc.vendorPayments.getPaymentRequestAvailability.useQuery({ paymentRequestId: request.id }, { enabled: request.status === 'APPROVED' });
  const vendorPaymentsList = trpc.vendorPayments.list.useQuery({ page: 1, pageSize: 50, filters: { paymentRequestId: request.id } });
  const vendorPaymentRows = (vendorPaymentsList.data?.rows ?? []) as VendorPaymentRow[];
  const showRecordPayment = request.status === 'APPROVED' && canRecordPayment && Number(availability.data?.available ?? '0') > 0;

  const [approveOpen, setApproveOpen] = useState(false);
  const [approveNote, setApproveNote] = useState('');
  const [approveKey, setApproveKey] = useState(newIdempotencyKey());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectKey, setRejectKey] = useState(newIdempotencyKey());
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelKey, setCancelKey] = useState(newIdempotencyKey());
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [revokeKey, setRevokeKey] = useState(newIdempotencyKey());

  const invalidate = () => utils.paymentRequests.getDetail.invalidate({ id: request.id });

  const approveMutation = trpc.paymentRequests.approve.useMutation({
    onSuccess: async () => {
      message.success('Request approved.');
      setApproveOpen(false);
      setApproveKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const rejectMutation = trpc.paymentRequests.reject.useMutation({
    onSuccess: async () => {
      message.success('Request rejected.');
      setRejectOpen(false);
      setRejectKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const cancelMutation = trpc.paymentRequests.cancel.useMutation({
    onSuccess: async () => {
      message.success('Request cancelled.');
      setCancelOpen(false);
      setCancelKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const revokeMutation = trpc.paymentRequests.revoke.useMutation({
    onSuccess: async () => {
      message.success('Approval revoked.');
      setRevokeOpen(false);
      setRevokeKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  // Approve is hidden entirely for a self-request unless the viewer holds
  // payment_request.self_approve — never just disabled.
  const showApprove = request.status === 'SUBMITTED' && canApprove && (!isOwnRequest || canSelfApprove);

  return (
    <>
      <UiCard
        title={request.requestNumber ?? 'Payment Request'}
        actions={
          <div className="flex gap-2">
            {showApprove ? (
              <Button size="small" type="primary" onClick={() => setApproveOpen(true)}>
                {isOwnRequest ? 'Approve (Self)…' : 'Approve…'}
              </Button>
            ) : null}
            {request.status === 'SUBMITTED' && canApprove ? (
              <Button size="small" danger onClick={() => setRejectOpen(true)}>
                Reject…
              </Button>
            ) : null}
            {showRecordPayment ? (
              <Button size="small" type="primary" onClick={() => router.push(`/vendor-payments/new?paymentRequestId=${request.id}`)}>
                Record Payment…
              </Button>
            ) : null}
            {request.status === 'APPROVED' && canRevoke ? (
              <Button size="small" danger onClick={() => setRevokeOpen(true)}>
                Revoke…
              </Button>
            ) : null}
            {(request.status === 'DRAFT' || request.status === 'SUBMITTED') && canCancel ? (
              <Button size="small" onClick={() => setCancelOpen(true)}>
                Cancel…
              </Button>
            ) : null}
            <Button size="small" onClick={() => router.push('/payment-requests')}>
              Back to list
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Details</p>
            <div className="text-[12px] text-muted">Vendor: {request.vendorName}</div>
            <div className="text-[12px] text-muted">Legal Entity: {request.legalEntityName}</div>
            <div className="text-[12px] text-muted">Requested payment date: {formatDate(request.requestedPaymentDate)}</div>
            <div className="text-[12px] text-muted">Priority: {request.priority}</div>
            {request.remarks ? <div className="text-[12px] text-muted">Remarks: {request.remarks}</div> : null}
          </div>
          <div>
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Authorization</p>
            <div className="text-[12px] text-muted">Total requested: {formatMoney(request.totalRequestedAmount)}</div>
            <div className="text-[12px] text-muted">Submitted: {request.submittedAt ? formatDate(request.submittedAt) : '—'}</div>
            {request.status === 'APPROVED' ? (
              <div className="text-[12px] text-muted">Remaining to pay: {formatMoney(availability.data?.available ?? '0')}</div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-ui text-left text-muted">
                <th className="py-2 pr-3">Bill No.</th>
                <th className="py-2 pr-3">Project</th>
                <th className="py-2 pr-3">Bill Date</th>
                <th className="py-2 pr-3 text-right">Bill Total</th>
                <th className="py-2 pr-3 text-right">Requested Amount</th>
              </tr>
            </thead>
            <tbody>
              {request.lines.map((line) => (
                <tr key={line.id} className="border-b border-ui-2">
                  <td className="py-2 pr-3">{line.vendorBillNumber}</td>
                  <td className="py-2 pr-3">{line.projectName}</td>
                  <td className="py-2 pr-3">{formatDate(line.vendorBillDate)}</td>
                  <td className="py-2 pr-3 text-right">{formatMoney(line.vendorBillTotalAmount)}</td>
                  <td className="py-2 pr-3 text-right">{formatMoney(line.requestedAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ml-auto mt-4 w-full max-w-xs rounded-ui border border-ui">
          <div className="flex justify-between px-4 py-2 text-[14px] font-semibold text-ink">
            <span>Total Requested</span>
            <span>{formatMoney(request.totalRequestedAmount)}</span>
          </div>
        </div>

        {request.status === 'CANCELLED' ? (
          <div className="mt-4 rounded-ui border border-ui bg-ui-2 p-3 text-[12.5px] text-muted">
            <b>Cancelled.</b> Reason: {request.cancelledReason ?? '—'} — {request.cancelledAt ? formatDate(request.cancelledAt) : '—'}
          </div>
        ) : null}

        {request.decisions.length > 0 ? (
          <div className="mt-4">
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Approval History</p>
            <div className="flex flex-col divide-y divide-ui">
              {request.decisions.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12.5px]">
                  <div>
                    <span className={d.decision === 'APPROVED' ? 'font-medium text-positive' : 'font-medium text-negative'}>
                      {d.decision === 'APPROVED' ? 'Approved' : d.decision === 'REJECTED' ? 'Rejected' : 'Revoked'}
                    </span>
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

      {vendorPaymentRows.length > 0 ? (
        <UiCard title="Vendor Payments" className="mt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-ui text-left text-muted">
                  <th className="py-2 pr-3">Payment Date</th>
                  <th className="py-2 pr-3">Bank Account</th>
                  <th className="py-2 pr-3 text-right">Amount</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {vendorPaymentRows.map((p) => (
                  <tr key={p.id} className="border-b border-ui-2">
                    <td className="py-2 pr-3">{formatDate(p.paymentDate)}</td>
                    <td className="py-2 pr-3">{p.bankAccountName}</td>
                    <td className="py-2 pr-3 text-right">{formatMoney(p.actualAmount)}</td>
                    <td className="py-2 pr-3">
                      <VendorPaymentStatusTag status={p.status} />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Button size="small" onClick={() => router.push(`/vendor-payments/${p.id}`)}>
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </UiCard>
      ) : null}

      <UiCard title="Documents" className="mt-4">
        <DocumentsTab entityType="PAYMENT_REQUEST" entityId={request.id} />
      </UiCard>

      <Modal
        title={isOwnRequest ? 'Approve Your Own Request' : 'Approve Payment Request'}
        open={approveOpen}
        onCancel={() => setApproveOpen(false)}
        onOk={() => approveMutation.mutate({ id: request.id, expectedVersion: request.version, note: approveNote.trim() || undefined, idempotencyKey: approveKey })}
        confirmLoading={approveMutation.isPending}
        okButtonProps={{ disabled: isOwnRequest && !approveNote.trim() }}
        okText="Approve"
      >
        {isOwnRequest ? (
          <>
            <p className="mb-2 text-negative">You are approving your own request. A justification note is required.</p>
            <Input.TextArea rows={3} value={approveNote} onChange={(e) => setApproveNote(e.target.value)} placeholder="Why are you approving your own request?" />
          </>
        ) : (
          <p className="text-muted">This authorizes settlement of the requested amount. No bank transaction is created at this stage.</p>
        )}
      </Modal>

      <Modal
        title="Reject Payment Request"
        open={rejectOpen}
        onCancel={() => setRejectOpen(false)}
        onOk={() => rejectMutation.mutate({ id: request.id, expectedVersion: request.version, reason: rejectReason, idempotencyKey: rejectKey })}
        confirmLoading={rejectMutation.isPending}
        okButtonProps={{ disabled: !rejectReason.trim() }}
        okText="Reject"
      >
        <p className="mb-2 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
      </Modal>

      <Modal
        title="Cancel Payment Request"
        open={cancelOpen}
        onCancel={() => setCancelOpen(false)}
        onOk={() => cancelMutation.mutate({ id: request.id, expectedVersion: request.version, reason: cancelReason, idempotencyKey: cancelKey })}
        confirmLoading={cancelMutation.isPending}
        okButtonProps={{ disabled: !cancelReason.trim() }}
        okText="Cancel Request"
      >
        <p className="mb-2 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
      </Modal>

      <Modal
        title="Revoke Approval"
        open={revokeOpen}
        onCancel={() => setRevokeOpen(false)}
        onOk={() => revokeMutation.mutate({ id: request.id, expectedVersion: request.version, reason: revokeReason, idempotencyKey: revokeKey })}
        confirmLoading={revokeMutation.isPending}
        okButtonProps={{ disabled: !revokeReason.trim() }}
        okText="Revoke"
      >
        <p className="mb-2 text-muted">This releases the reserved amount on every bill referenced by this request. Reason (required):</p>
        <Input.TextArea rows={3} value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} />
      </Modal>
    </>
  );
}

export default function PaymentRequestDetailPage() {
  const params = useParams();
  const id = String(params.id ?? '');

  const detail = trpc.paymentRequests.getDetail.useQuery({ id }, { enabled: !!id });

  if (detail.isError) {
    return <PageHeader title="Payment Request" description="Could not load this payment request." />;
  }
  if (detail.isLoading || !detail.data) {
    return <PageHeader title="Payment Request" description="Loading…" />;
  }

  const request = detail.data as PaymentRequestDetailData;

  return (
    <>
      <PageHeader
        title={request.requestNumber ?? 'Draft Payment Request'}
        description={`${request.vendorName} · ${request.legalEntityName}`}
        actions={<PaymentRequestStatusTag status={request.status} />}
      />
      {request.status === 'DRAFT' ? <DraftEditor request={request} /> : <DecidedOrSubmittedView request={request} />}
    </>
  );
}
