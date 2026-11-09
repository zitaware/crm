'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { App, Button, Checkbox, Form, Input, Select } from 'antd';
import { MoneyInput, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { VendorSelect } from '@/components/vendor-select';
import { LegalEntitySelect } from '@/components/legal-entity-select';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';
import { formatDate, formatMoney } from '@/lib/format';
import { newIdempotencyKey, PRIORITY_OPTIONS, type EligibleVendorBillRow, type PaymentRequestPriority } from '../shared';
import { DateInput } from '@/components/date-input';

interface FormValues {
  vendorId: string;
  legalEntityId: string;
  requestedPaymentDate: string;
  priority: PaymentRequestPriority;
  remarks?: string;
}

function NewPaymentRequestForm() {
  const seedVendorBillId = useSearchParams().get('vendorBillId') ?? undefined;
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const formDraft = useFormDraft('payment-request:new');
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef(false);
  useEffect(() => {
    if (appliedDraft.current || formDraft.isLoading || !formDraft.payload) return;
    appliedDraft.current = true;
    form.setFieldsValue(formDraft.payload as Partial<FormValues>);
  }, [form, formDraft.isLoading, formDraft.payload]);

  const legalEntities = trpc.legalEntities.list.useQuery({ includeInactive: false });

  const vendorId = Form.useWatch('vendorId', form);
  const legalEntityId = Form.useWatch('legalEntityId', form);

  // A seeded request resolves vendor/legal entity entirely server-side —
  // the picker below is hidden and never trusted for that value. Otherwise,
  // exactly one active legal entity is auto-selected (no visible picker);
  // more than one requires an explicit choice.
  useEffect(() => {
    if (seedVendorBillId) return;
    const onlyLegalEntity = legalEntities.data?.length === 1 ? legalEntities.data[0] : undefined;
    if (onlyLegalEntity && !form.getFieldValue('legalEntityId')) {
      form.setFieldValue('legalEntityId', onlyLegalEntity.id);
    }
  }, [seedVendorBillId, legalEntities.data, form]);

  const eligible = trpc.paymentRequests.getEligibleBills.useQuery(
    { vendorId: seedVendorBillId ? undefined : vendorId, legalEntityId: seedVendorBillId ? undefined : legalEntityId, seedVendorBillId },
    { enabled: !!seedVendorBillId || (!!vendorId && !!legalEntityId) },
  );

  useEffect(() => {
    if (!seedVendorBillId || !eligible.data) return;
    form.setFieldValue('vendorId', eligible.data.vendorId);
    form.setFieldValue('legalEntityId', eligible.data.legalEntityId);
  }, [seedVendorBillId, eligible.data, form]);

  // vendorBillId -> requested amount string, present only while selected.
  // Reset whenever the eligible bill set itself changes (different vendor
  // or legal entity) — adjusted during render, not in an effect, per
  // React's own "adjusting state when a prop changes" pattern.
  const eligibleSetKey = `${eligible.data?.vendorId ?? ''}:${eligible.data?.legalEntityId ?? ''}`;
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [selectedForKey, setSelectedForKey] = useState(eligibleSetKey);
  if (eligibleSetKey !== selectedForKey) {
    setSelectedForKey(eligibleSetKey);
    setSelected({});
  }

  const toggleBill = (bill: EligibleVendorBillRow) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (bill.vendorBillId in next) {
        delete next[bill.vendorBillId];
      } else {
        next[bill.vendorBillId] = bill.availableForRequest;
      }
      return next;
    });
  };
  const setBillAmount = (vendorBillId: string, value: string) => {
    setSelected((prev) => ({ ...prev, [vendorBillId]: value }));
  };

  const lines = Object.entries(selected).map(([billId, requestedAmount]) => ({ vendorBillId: billId, requestedAmount }));

  const preview = trpc.paymentRequests.calculatePreview.useQuery(
    { vendorId: vendorId ?? '', legalEntityId: legalEntityId ?? '', lines },
    { enabled: !!vendorId && !!legalEntityId && lines.length > 0 },
  );

  const [createKey] = useState(newIdempotencyKey());
  const [submitKey] = useState(newIdempotencyKey());
  const createMutation = trpc.paymentRequests.createDraft.useMutation();
  const submitMutation = trpc.paymentRequests.submit.useMutation();
  const [submitting, setSubmitting] = useState(false);

  // Two distinct submit buttons share one <Form onFinish>; a ref (not
  // state) records which was clicked so the async handler below always
  // reads the latest value regardless of React's render/batching timing.
  const pendingActionRef = useRef<'draft' | 'submit'>('draft');

  const handleFinish = async (values: FormValues) => {
    if (lines.length === 0) {
      message.error('Select at least one vendor bill.');
      return;
    }
    setSubmitting(true);
    try {
      const draft = await createMutation.mutateAsync({
        vendorId: values.vendorId,
        legalEntityId: values.legalEntityId,
        requestedPaymentDate: values.requestedPaymentDate,
        priority: values.priority,
        remarks: values.remarks?.trim() || undefined,
        lines,
        idempotencyKey: createKey,
      });
      if (pendingActionRef.current === 'draft') {
        message.success('Draft saved.');
        clearDraft.mutate({ formKey: 'payment-request:new' });
        router.push(`/payment-requests/${draft.id}`);
        return;
      }
      const submitted = await submitMutation.mutateAsync({ id: draft.id, expectedVersion: draft.version, idempotencyKey: submitKey });
      message.success('Payment request submitted for approval.');
      clearDraft.mutate({ formKey: 'payment-request:new' });
      router.push(`/payment-requests/${submitted.id}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not save this payment request.');
    } finally {
      setSubmitting(false);
    }
  };

  const showLegalEntityPicker = !seedVendorBillId && (legalEntities.data?.length ?? 0) > 1;
  const bills = eligible.data?.bills ?? [];
  const resolvedVendorName = seedVendorBillId ? eligible.data?.vendorName : undefined;
  const resolvedLegalEntityName = seedVendorBillId ? eligible.data?.legalEntityName : undefined;

  return (
    <div>
      <PageHeader
        title="New Payment Request"
        description="Authorize settlement for one or more finalized vendor bills. No bank transaction, TDS, or journal entry is created here."
        actions={<Button onClick={() => router.push('/payment-requests')}>Back to list</Button>}
      />

      <UiCard>
        <Form<FormValues> form={form} layout="vertical" onFinish={handleFinish} initialValues={{ priority: 'NORMAL' }}>
          <p className="mb-2 mt-1 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Request Details</p>
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {seedVendorBillId ? (
              <div>
                <p className="mb-1 text-[13px] text-ink">Vendor</p>
                <p className="text-[13px] text-muted">{resolvedVendorName ?? '—'}</p>
              </div>
            ) : (
              <Form.Item label="Vendor" name="vendorId" rules={[{ required: true, message: 'Vendor is required.' }]}>
                <VendorSelect />
              </Form.Item>
            )}
            {seedVendorBillId ? (
              <div>
                <p className="mb-1 text-[13px] text-ink">Legal Entity</p>
                <p className="text-[13px] text-muted">{resolvedLegalEntityName ?? '—'}</p>
              </div>
            ) : showLegalEntityPicker ? (
              <Form.Item label="Legal Entity" name="legalEntityId" rules={[{ required: true, message: 'Legal entity is required.' }]}>
                <LegalEntitySelect />
              </Form.Item>
            ) : (
              <div>
                <p className="mb-1 text-[13px] text-ink">Legal Entity</p>
                <p className="text-[13px] text-muted">{legalEntities.data?.[0]?.legalName ?? '—'}</p>
              </div>
            )}
            <Form.Item label="Requested payment date" name="requestedPaymentDate" rules={[{ required: true, message: 'Requested payment date is required.' }]} extra="The planned execution date — this creates no accounting effect.">
              <DateInput />
            </Form.Item>
            <Form.Item label="Priority" name="priority">
              <Select options={PRIORITY_OPTIONS} />
            </Form.Item>
          </div>
          <Form.Item label="Remarks" name="remarks" rules={[{ max: 2000 }]}>
            <Input.TextArea rows={2} placeholder="Optional notes for the approver…" />
          </Form.Item>
          {/* Hidden fields keep vendorId/legalEntityId in the Form's own
              values even when resolved server-side (seeded) or auto-selected
              (single active legal entity), so onFinish still receives them. */}
          {seedVendorBillId ? (
            <>
              <Form.Item name="vendorId" hidden rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="legalEntityId" hidden rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </>
          ) : !showLegalEntityPicker ? (
            <Form.Item name="legalEntityId" hidden rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          ) : null}

          <p className="mb-2 mt-4 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Vendor Bills</p>
          {!vendorId || !legalEntityId ? (
            <p className="text-[12.5px] text-muted">Select a vendor{showLegalEntityPicker ? ' and legal entity' : ''} to see eligible bills.</p>
          ) : eligible.isLoading ? (
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
                    const isSelected = bill.vendorBillId in selected;
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
                              value={selected[bill.vendorBillId] ?? bill.availableForRequest}
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
              <span>{formatMoney(preview.data?.totalRequestedAmount ?? '0')}</span>
            </div>
          </div>
          {preview.data && !preview.data.valid ? (
            <p className="mt-2 text-[12px] text-negative">One or more selected amounts exceed what&apos;s currently available. Adjust before saving.</p>
          ) : null}

          <p className="mb-4 mt-4 text-[11.5px] text-muted">Supporting documents can be added on the request&apos;s own page, before or after submitting.</p>

          <div className="flex flex-wrap gap-2">
            {formDraft.payload ? <DraftFormNote saveLabel="Save" /> : null}
            <Button
              htmlType="button"
              loading={formDraft.saving || submitting}
              onClick={() => formDraft.save(form.getFieldsValue(true) as unknown as Record<string, unknown>)}
            >
              Save as draft
            </Button>
            <Button type="primary" htmlType="submit" loading={submitting} onClick={() => (pendingActionRef.current = 'submit')}>
              Submit for Approval
            </Button>
            <Button onClick={() => router.push('/payment-requests')}>Cancel</Button>
          </div>
        </Form>
      </UiCard>
    </div>
  );
}

export default function NewPaymentRequestPage() {
  return (
    <Suspense fallback={null}>
      <NewPaymentRequestForm />
    </Suspense>
  );
}
