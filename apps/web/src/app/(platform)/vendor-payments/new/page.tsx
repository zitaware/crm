'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { App, Button, Checkbox, Form, Input, Select } from 'antd';
import { BankAccountSelect } from '@/components/bank-account-select';
import { BarChartIcon, MoneyInput, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatMoney } from '@/lib/format';
import { DEDUCTION_TYPE_OPTIONS, newIdempotencyKey, type EligiblePaymentRequestLineRow, type VendorPaymentDeductionType } from '../shared';
import { DateInput } from '@/components/date-input';

interface HeaderFormValues {
  bankAccountId: string;
  paymentModeId: string;
  paymentDate: string;
  utrReference?: string;
}

interface DeductionEntry {
  key: string;
  type: VendorPaymentDeductionType;
  amount: string;
  ratePercent: string;
  narrative: string;
}

interface LineAllocationState {
  cashPaid: string;
  deductions: DeductionEntry[];
}

type SelectedLines = Record<string, LineAllocationState>;

function toAllocationInputs(selected: SelectedLines) {
  return Object.entries(selected).map(([paymentRequestLineId, state]) => ({
    paymentRequestLineId,
    cashPaid: state.cashPaid,
    deductions: state.deductions.map((d) => ({
      type: d.type,
      amount: d.amount,
      ratePercent: d.ratePercent.trim() || undefined,
      narrative: d.narrative.trim() || undefined,
    })),
  }));
}

function newDeductionKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function DeductionRow({
  line,
  deduction,
  onChange,
  onRemove,
}: {
  line: EligiblePaymentRequestLineRow;
  deduction: DeductionEntry;
  onChange: (patch: Partial<DeductionEntry>) => void;
  onRemove: () => void;
}) {
  const base = Number(line.vendorBillTaxableAmount);

  const applyRate = (rateInput: string) => {
    if (!base || Number.isNaN(base)) return;
    const rate = Number(rateInput);
    if (!rateInput || Number.isNaN(rate)) {
      onChange({ ratePercent: rateInput });
      return;
    }
    onChange({ ratePercent: rateInput, amount: ((base * rate) / 100).toFixed(2) });
  };

  const applyAmount = (amountInput: string) => {
    onChange({ amount: amountInput });
    if (!base || Number.isNaN(base) || base === 0) return;
    const amount = Number(amountInput);
    if (!amountInput || Number.isNaN(amount)) return;
    onChange({ amount: amountInput, ratePercent: ((amount / base) * 100).toFixed(2) });
  };

  return (
    <div className="rounded-ui border border-ui-2 p-2">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
        <div className="md:col-span-2">
          <p className="mb-1 text-[11.5px] text-muted">Type</p>
          <Select value={deduction.type} onChange={(v) => onChange({ type: v })} options={DEDUCTION_TYPE_OPTIONS} className="w-full" />
        </div>
        <div>
          <p className="mb-1 text-[11.5px] text-muted">Rate % {base ? <span>of {formatMoney(base.toFixed(2))}</span> : null}</p>
          <Input placeholder="e.g. 10" value={deduction.ratePercent} onChange={(e) => applyRate(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <p className="mb-1 text-[11.5px] text-muted">Amount</p>
          <MoneyInput placeholder="0.00" value={deduction.amount} onChange={(value) => applyAmount(value ?? '')} />
        </div>
        <div>
          <p className="mb-1 text-[11.5px] text-muted">&nbsp;</p>
          <Button size="small" danger block onClick={onRemove}>
            Remove
          </Button>
        </div>
        <div className="md:col-span-6">
          <p className="mb-1 text-[11.5px] text-muted">Note</p>
          <Input placeholder="Optional" value={deduction.narrative} onChange={(e) => onChange({ narrative: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

function SelectedLineCard({
  line,
  state,
  onCashPaidChange,
  onAddDeduction,
  onDeductionChange,
  onRemoveDeduction,
}: {
  line: EligiblePaymentRequestLineRow;
  state: LineAllocationState;
  onCashPaidChange: (value: string) => void;
  onAddDeduction: () => void;
  onDeductionChange: (key: string, patch: Partial<DeductionEntry>) => void;
  onRemoveDeduction: (key: string) => void;
}) {
  return (
    <div className="rounded-ui border border-ui p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="font-semibold text-ink">{line.vendorBillNumber}</div>
          <div className="text-[11.5px] text-muted">
            {line.projectName} · {line.requestNumber ?? 'Draft request'} · Available {formatMoney(line.availableToPay)}
          </div>
        </div>
        <div className="w-[160px]">
          <p className="mb-1 text-[11.5px] text-muted">Cash Paid</p>
          <MoneyInput value={state.cashPaid} onChange={(value) => onCashPaidChange(value ?? '')} placeholder="0.00" />
        </div>
      </div>

      <p className="mb-1 text-[11px] font-bold uppercase tracking-[.06em] text-muted-2">Deductions</p>
      <div className="flex flex-col gap-2">
        {state.deductions.map((d) => (
          <DeductionRow key={d.key} line={line} deduction={d} onChange={(patch) => onDeductionChange(d.key, patch)} onRemove={() => onRemoveDeduction(d.key)} />
        ))}
        <Button size="small" onClick={onAddDeduction}>
          Add Deduction
        </Button>
      </div>
    </div>
  );
}

function NewVendorPaymentForm() {
  const seedPaymentRequestId = useSearchParams().get('paymentRequestId') ?? '';
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<HeaderFormValues>();

  const eligible = trpc.vendorPayments.getEligiblePaymentRequestLines.useQuery({ seedPaymentRequestId }, { enabled: !!seedPaymentRequestId });
  const paymentModes = trpc.documentSupport.listPaymentModes.useQuery({ includeInactive: false });

  // Selected-line state keyed by paymentRequestLineId — reset whenever the
  // eligible set itself changes (different vendor/legal entity), adjusted
  // during render rather than in an effect (this app's own established
  // pattern for "adjust state when a prop/query result changes").
  const eligibleSetKey = `${eligible.data?.vendorId ?? ''}:${eligible.data?.legalEntityId ?? ''}`;
  const [selected, setSelected] = useState<SelectedLines>({});
  const [selectedForKey, setSelectedForKey] = useState(eligibleSetKey);
  if (eligibleSetKey !== selectedForKey) {
    setSelectedForKey(eligibleSetKey);
    setSelected({});
  }

  const toggleLine = (line: EligiblePaymentRequestLineRow) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (line.id in next) {
        delete next[line.id];
      } else {
        next[line.id] = { cashPaid: line.availableToPay, deductions: [] };
      }
      return next;
    });
  };
  const setCashPaid = (lineId: string, value: string) => {
    setSelected((prev) => ({ ...prev, [lineId]: { ...prev[lineId]!, cashPaid: value } }));
  };
  const addDeduction = (lineId: string) => {
    setSelected((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId]!, deductions: [...prev[lineId]!.deductions, { key: newDeductionKey(), type: 'TDS', amount: '', ratePercent: '', narrative: '' }] },
    }));
  };
  const changeDeduction = (lineId: string, key: string, patch: Partial<DeductionEntry>) => {
    setSelected((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId]!, deductions: prev[lineId]!.deductions.map((d) => (d.key === key ? { ...d, ...patch } : d)) },
    }));
  };
  const removeDeduction = (lineId: string, key: string) => {
    setSelected((prev) => ({ ...prev, [lineId]: { ...prev[lineId]!, deductions: prev[lineId]!.deductions.filter((d) => d.key !== key) } }));
  };

  const allocationInputs = toAllocationInputs(selected);
  const bankAccountId = Form.useWatch('bankAccountId', form);

  const preview = trpc.vendorPayments.calculatePreview.useQuery(
    { bankAccountId: bankAccountId ?? '', allocations: allocationInputs },
    { enabled: !!bankAccountId && allocationInputs.length > 0 },
  );

  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey());
  const postMutation = trpc.vendorPayments.postVendorPayment.useMutation({
    onSuccess: (payment) => {
      message.success('Vendor payment posted.');
      router.push(`/vendor-payments/${payment.id}`);
    },
    onError: (error) => {
      message.error(error.message);
      setIdempotencyKey(newIdempotencyKey());
    },
  });

  if (!seedPaymentRequestId) {
    return <PageHeader title="Record Vendor Payment" description="Missing payment request reference — record a payment from an approved Payment Request's own Record Payment action." />;
  }
  if (eligible.isLoading) return <PageHeader title="Record Vendor Payment" description="Loading…" />;
  if (eligible.isError || !eligible.data) return <PageHeader title="Record Vendor Payment" description="Could not load this payment request's eligible lines." />;

  const d = eligible.data;
  const lines = d.lines;

  const submit = (values: HeaderFormValues) => {
    if (allocationInputs.length === 0) {
      message.error('Select at least one payment request line.');
      return;
    }
    const actualAmount = allocationInputs.reduce((sum, a) => sum + Number(a.cashPaid || 0), 0).toFixed(2);
    postMutation.mutate({
      bankAccountId: values.bankAccountId,
      paymentModeId: values.paymentModeId,
      paymentDate: values.paymentDate,
      utrReference: values.utrReference?.trim() || undefined,
      actualAmount,
      allocations: allocationInputs,
      idempotencyKey,
    });
  };

  return (
    <>
      <PageHeader
        title="Record Vendor Payment"
        description={`${d.vendorName} — ${d.legalEntityName}`}
        actions={<Button onClick={() => router.push(`/payment-requests/${seedPaymentRequestId}`)}>Back to Request</Button>}
      />

      <UiCard flush>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px]">
          <div className="border-b border-ui-2 p-4 lg:border-b-0 lg:border-r lg:border-ui-2">
            <Form<HeaderFormValues> id="vendor-payment-form" form={form} layout="vertical" onFinish={submit}>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-brand">Payment Details</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Form.Item label="Bank account" name="bankAccountId" rules={[{ required: true, message: 'Bank account is required.' }]}>
                  <BankAccountSelect legalEntityId={d.legalEntityId} placeholder="Select bank account…" />
                </Form.Item>
                <Form.Item label="Payment mode" name="paymentModeId" rules={[{ required: true, message: 'Payment mode is required.' }]}>
                  <Select loading={paymentModes.isLoading} options={(paymentModes.data ?? []).map((m) => ({ value: m.id, label: m.label }))} placeholder="Select mode…" />
                </Form.Item>
                <Form.Item label="Payment date" name="paymentDate" rules={[{ required: true, message: 'Payment date is required.' }]}>
                  <DateInput />
                </Form.Item>
                <Form.Item label="UTR / Reference no." name="utrReference">
                  <Input placeholder="Optional" />
                </Form.Item>
              </div>

              <p className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-[.06em] text-brand">Payment Request Lines</p>
              {lines.length === 0 ? (
                <p className="text-[12.5px] text-muted">No approved payment request lines with an available balance for this vendor and legal entity.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-ui text-left text-muted">
                        <th className="py-2 pr-3" />
                        <th className="py-2 pr-3">Bill No.</th>
                        <th className="py-2 pr-3">Request No.</th>
                        <th className="py-2 pr-3">Project</th>
                        <th className="py-2 pr-3 text-right">Requested</th>
                        <th className="py-2 pr-3 text-right">Available</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => {
                        const isSelected = line.id in selected;
                        return (
                          <tr key={line.id} className="border-b border-ui-2">
                            <td className="py-2 pr-3">
                              <Checkbox checked={isSelected} onChange={() => toggleLine(line)} />
                            </td>
                            <td className="py-2 pr-3">{line.vendorBillNumber}</td>
                            <td className="py-2 pr-3">{line.requestNumber ?? 'Draft'}</td>
                            <td className="py-2 pr-3">{line.projectName}</td>
                            <td className="py-2 pr-3 text-right">{formatMoney(line.requestedAmount)}</td>
                            <td className="py-2 pr-3 text-right">{formatMoney(line.availableToPay)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {lines.filter((l) => l.id in selected).length > 0 ? (
                <div className="mt-4 flex flex-col gap-3">
                  {lines
                    .filter((l) => l.id in selected)
                    .map((line) => (
                      <SelectedLineCard
                        key={line.id}
                        line={line}
                        state={selected[line.id]!}
                        onCashPaidChange={(value) => setCashPaid(line.id, value)}
                        onAddDeduction={() => addDeduction(line.id)}
                        onDeductionChange={(key, patch) => changeDeduction(line.id, key, patch)}
                        onRemoveDeduction={(key) => removeDeduction(line.id, key)}
                      />
                    ))}
                </div>
              ) : null}
            </Form>
          </div>

          <div className="bg-paper p-4 lg:sticky lg:top-4 lg:self-start">
            <div className="flex items-center gap-[7px] text-[11px] font-bold uppercase tracking-[.05em] text-brand">
              <BarChartIcon className="h-[14px] w-[14px]" />
              Live Summary
            </div>

            {!preview.data ? (
              <p className="mt-3 text-[12.5px] text-muted">
                {preview.isFetching ? 'Calculating…' : 'Select a bank account and at least one line — this updates automatically.'}
              </p>
            ) : (
              <>
                {preview.data.allocations.map((a) => (
                  <div key={a.paymentRequestLineId} className="flex justify-between border-b border-ui-2 py-2 text-[13px]">
                    <span className="text-muted">Line settlement</span>
                    <span className="font-mono font-semibold text-ink">{formatMoney(a.settledAmount)}</span>
                  </div>
                ))}
                <div className="mt-2 flex justify-between border-b border-ui-2 py-2 text-[13px]">
                  <span className="text-muted">Dr Accounts Payable — Vendor</span>
                  <span className="font-mono font-semibold text-ink">{formatMoney(preview.data.debitTotal)}</span>
                </div>
                {preview.data.creditLines.map((l) => (
                  <div key={l.ledgerAccountCode} className="flex justify-between border-b border-ui-2 py-2 text-[13px]">
                    <span className="text-muted">Cr {l.ledgerAccountName}</span>
                    <span className="font-mono font-semibold text-ink">{formatMoney(l.amount)}</span>
                  </div>
                ))}
                <div className="mt-2 flex justify-between rounded-ui bg-ink px-3 py-[11px] text-white">
                  <span className="font-semibold">Total settlement</span>
                  <span className="font-mono text-[15px] font-semibold">{formatMoney(preview.data.debitTotal)}</span>
                </div>
                {!preview.data.balanced ? <p className="mt-2 text-[12px] font-medium text-negative">This journal would not balance — check the amounts before posting.</p> : null}
              </>
            )}
            <p className="mt-3 text-[11px] leading-[1.5] text-muted">
              Every figure here is computed by the server from what you&apos;ve entered — nothing is calculated in the browser.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ui-2 bg-paper p-4">
          <Button onClick={() => router.push(`/payment-requests/${seedPaymentRequestId}`)}>Cancel</Button>
          <Button type="primary" htmlType="submit" form="vendor-payment-form" loading={postMutation.isPending}>
            Post Vendor Payment
          </Button>
        </div>
      </UiCard>
    </>
  );
}

export default function NewVendorPaymentPage() {
  return (
    <Suspense fallback={null}>
      <NewVendorPaymentForm />
    </Suspense>
  );
}
