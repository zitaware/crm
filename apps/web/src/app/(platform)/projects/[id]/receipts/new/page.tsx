'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { App, Button, Form, Input, Select } from 'antd';
import { BarChartIcon, MoneyInput, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { TwoLineOption } from '../../../../invoices/shared';
import { MasterSelect } from '@/components/master-select';
import { BankAccountSelect } from '@/components/bank-account-select';
import { LedgerAccountSelect } from '@/components/ledger-account-select';
import { formatMoney } from '@/lib/format';
import { DEDUCTION_TYPE_OPTIONS, newIdempotencyKey, type AllocationDeductionType } from '../../../../payment-integration/shared';
import { DateInput } from '@/components/date-input';

interface DeductionFormValue {
  type: AllocationDeductionType;
  amount: string;
  ratePercent?: string;
  penaltyCategoryId?: string;
  otherLedgerAccountId?: string;
  narrative?: string;
}

/** "Paying for" value meaning the whole invoice rather than one CAPEX event. */
const ALL_EVENTS = 'ALL';

interface AllocationFormValue {
  invoiceId: string;
  /** A CAPEX event of a multi-event invoice, or ALL_EVENTS (ADR-151). */
  sourceEventId?: string;
  /** Amount applied to the invoice. Deductions come out of this; the bank receives the rest. */
  appliedAmount: string;
  deductions: DeductionFormValue[];
}

function moneyToPaise(value: string | undefined): number {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return 0;
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [wholeRaw, fracRaw = ''] = unsigned.split('.');
  const whole = (wholeRaw ?? '').replace(/\D/g, '') || '0';
  const frac = (fracRaw.replace(/\D/g, '') + '00').slice(0, 2);
  const paise = Number(whole) * 100 + Number(frac);
  return negative ? -paise : paise;
}

function paiseToMoney(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function percentOfMoney(base: string, rateInput: string): string | null {
  const rate = rateInput.trim();
  if (!/^\d{1,15}(\.\d{1,4})?$/.test(base) || !/^\d{1,15}(\.\d{1,4})?$/.test(rate)) return null;
  const [whole = '0', frac = ''] = base.split('.');
  const paise = BigInt(whole) * BigInt(100) + BigInt((frac + '00').slice(0, 2));
  const [rateWhole = '0', rateFrac = ''] = rate.split('.');
  const rateHundredths = BigInt(rateWhole) * BigInt(100) + BigInt((rateFrac + '00').slice(0, 2));
  const rounded = (paise * rateHundredths + BigInt(5000)) / BigInt(10000);
  return paiseToMoney(Number(rounded));
}

function cashPaise(allocation: AllocationFormValue): number {
  const deductions = (allocation.deductions ?? []).reduce((sum, deduction) => sum + moneyToPaise(deduction.amount), 0);
  return moneyToPaise(allocation.appliedAmount) - deductions;
}

interface ReceiptFormValues {
  bankAccountId: string;
  paymentModeId: string;
  receiptDate: string;
  utrReference?: string;
  allocations: AllocationFormValue[];
}

const DECIMAL_AMOUNT = /^\d{1,15}(\.\d{1,4})?$/;

function toDeductionInputs(deductions: DeductionFormValue[] | undefined) {
  return (deductions ?? []).map((d) => ({
    type: d.type,
    amount: (d.amount ?? '').trim(),
    ratePercent: d.ratePercent?.trim() || undefined,
    penaltyCategoryId: d.penaltyCategoryId,
    otherLedgerAccountId: d.otherLedgerAccountId,
    narrative: d.narrative?.trim() || undefined,
  }));
}

/** The preview call rejects with the raw validator payload. Turn that into a sentence. */
function readablePreviewError(error: unknown): string {
  const raw = error instanceof Error ? error.message : '';
  try {
    const issues = JSON.parse(raw) as Array<{ path?: Array<string | number> }>;
    if (Array.isArray(issues)) {
      const path = issues[0]?.path ?? [];
      const field = path[path.length - 1];
      if (field === 'amount' && path.includes('deductions')) return 'Enter a deduction amount.';
      if (field === 'cashAllocated' || field === 'amount' || field === 'actualAmount') return 'Enter the amount as a number, such as 16388.88.';
      if (field === 'ratePercent') return 'Enter the deduction rate as a number, such as 10.';
      if (field === 'invoiceId') return 'Select an invoice.';
      if (field === 'bankAccountId') return 'Select a bank account.';
      if (field === 'receiptDate') return 'Enter the receipt date.';
    }
  } catch {
    // The message is already a sentence.
  }
  if (!raw || raw.startsWith('[') || raw.startsWith('{')) return 'Check the amounts and try again.';
  return raw;
}
function toAllocationInputs(allocations: AllocationFormValue[]) {
  return allocations.map((a) => ({
    invoiceId: a.invoiceId,
    ...(a.sourceEventId && a.sourceEventId !== ALL_EVENTS ? { sourceEventId: a.sourceEventId } : {}),
    cashAllocated: paiseToMoney(cashPaise(a)),
    deductions: toDeductionInputs(a.deductions),
  }));
}

/** Deductions whose rate applies to the taxable amount being paid for. */
const RATE_ON_TAXABLE = new Set<AllocationDeductionType>(['TDS', 'CGST_TDS', 'SGST_TDS', 'IGST_TDS']);

function deductionTypeOptions(invoice: CandidateInvoice | undefined) {
  const igst = invoice ? moneyToPaise(invoice.igstAmount) > 0 : false;
  const intra = invoice ? moneyToPaise(invoice.cgstAmount) > 0 || moneyToPaise(invoice.sgstAmount) > 0 : false;
  return DEDUCTION_TYPE_OPTIONS.filter((option) => {
    if (option.value === 'IGST_TDS') return igst;
    if (option.value === 'CGST_TDS' || option.value === 'SGST_TDS') return intra;
    return true;
  });
}

function DeductionRow({
  allocationFieldName,
  field,
  invoice,
  taxableBase,
  remove,
}: {
  allocationFieldName: number;
  field: { name: number };
  invoice: CandidateInvoice | undefined;
  /** Taxable amount of what this allocation pays for: one CAPEX event or the whole invoice. */
  taxableBase: string | undefined;
  remove: (index: number) => void;
}) {
  const form = Form.useFormInstance<ReceiptFormValues>();
  const type: AllocationDeductionType | undefined = Form.useWatch(
    ['allocations', allocationFieldName, 'deductions', field.name, 'type'],
    form,
  );

  const showRate = !!type && RATE_ON_TAXABLE.has(type);
  const baseAmount = showRate ? taxableBase : undefined;

  const applyRate = (rateInput: string) => {
    if (!baseAmount) return;
    const computed = percentOfMoney(baseAmount, rateInput);
    if (!computed) return;
    form.setFieldValue(['allocations', allocationFieldName, 'deductions', field.name, 'amount'], computed);
  };

  const applyAmount = (amountInput: string) => {
    if (!baseAmount || Number(baseAmount) === 0) return;
    const amount = Number(amountInput);
    if (!amountInput || Number.isNaN(amount)) return;
    const computed = ((amount / Number(baseAmount)) * 100).toFixed(2);
    form.setFieldValue(['allocations', allocationFieldName, 'deductions', field.name, 'ratePercent'], computed);
  };

  return (
    <div className="rounded-ui border border-ui-2 p-2">
      {/* Every Form.Item here needs an explicit, stable `key` — Rate %
          appears/disappears based on `type`, shifting every later
          sibling's position in the children array. Without a key, React
          reconciles by position and reuses one field's DOM <input> for a
          different logical field on that shift, carrying over its stale
          raw value/focus instead of remounting — the exact cause of the
          "duplicate-looking, won't accept edits" bug reported here. */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
        <Form.Item {...field} key="type" label="Type" name={[field.name, 'type']} rules={[{ required: true, message: 'Required.' }]} className="md:col-span-2 mb-0">
          <Select options={deductionTypeOptions(invoice)} placeholder="Deduction type" />
        </Form.Item>
        {showRate ? (
          <Form.Item
            {...field}
            key="rate"
            label="Rate %"
            name={[field.name, 'ratePercent']}
            className="mb-0"
            extra={baseAmount ? <span className="text-[11px] text-muted">of taxable {formatMoney(baseAmount)}</span> : undefined}
          >
            <Input placeholder="e.g. 10" onChange={(e) => applyRate(e.target.value)} />
          </Form.Item>
        ) : null}
        <Form.Item {...field} key="amount" label="Amount" name={[field.name, 'amount']} rules={[{ required: true, message: 'Required.' }]} className="mb-0 md:col-span-2">
          <MoneyInput placeholder="0.00" onChange={(value) => applyAmount(value ?? '')} />
        </Form.Item>
        {type === 'ACCEPTED_PENALTY' || type === 'DISPUTED_PENALTY' ? (
          <Form.Item
            {...field}
            key="penalty-category"
            label="Penalty category"
            name={[field.name, 'penaltyCategoryId']}
            rules={[{ required: true, message: 'Required.' }]}
            className="md:col-span-2 mb-0"
>
            <MasterSelect type="penalty_categories" placeholder="Select category" />
          </Form.Item>
        ) : null}
        {type === 'OTHER' ? (
          <Form.Item
            {...field}
            key="other-ledger-account"
            label="Ledger account"
            name={[field.name, 'otherLedgerAccountId']}
            rules={[{ required: true, message: 'Required.' }]}
            className="md:col-span-2 mb-0"
>
            <LedgerAccountSelect placeholder="Select account" />
          </Form.Item>
        ) : null}
        <Form.Item {...field} key="note" label="Note" name={[field.name, 'narrative']} className="mb-0">
          <Input placeholder="Optional" />
        </Form.Item>
        {/* A non-breaking-space label (not text-only spacing) so this
            button's own Form.Item reproduces AntD's real label height —
            guarantees it lines up with the Note input's baseline exactly,
            not an approximation. */}
        <Form.Item key="remove" label={' '} className="mb-0">
          <Button size="small" danger block onClick={() => remove(field.name)}>
            Remove
          </Button>
        </Form.Item>
      </div>
    </div>
  );
}

function DeductionFields({
  allocationFieldName,
  invoice,
  taxableBase,
}: {
  allocationFieldName: number;
  invoice: CandidateInvoice | undefined;
  taxableBase: string | undefined;
}) {
  return (
    <Form.List name={[allocationFieldName, 'deductions']}>
      {(fields, { add, remove }) => (
        <div className="flex flex-col gap-2">
          {fields.map(({ key, ...field }) => (
            <DeductionRow key={key} allocationFieldName={allocationFieldName} field={field} invoice={invoice} taxableBase={taxableBase} remove={remove} />
          ))}
          <Button size="small" onClick={() => add({ type: 'TDS', amount: '' })}>
            Add Deduction
          </Button>
        </div>
      )}
    </Form.List>
  );
}

interface CandidateInvoice {
  id: string;
  invoiceNumber: string;
  projectId: string;
  projectName: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  totalAmount: string;
  outstandingAmount: string;
  capexEvents: Array<{ sourceEventId: string; name: string; taxableAmount: string; totalAmount: string; outstandingAmount: string }>;
}

/** What one allocation row can collect: the chosen event's outstanding, never more than the invoice's. */
function collectableAmount(invoice: CandidateInvoice, sourceEventId: string | undefined): string {
  const event = invoice.capexEvents.find((e) => e.sourceEventId === sourceEventId);
  if (!event) return invoice.outstandingAmount;
  return moneyToPaise(event.outstandingAmount) < moneyToPaise(invoice.outstandingAmount) ? event.outstandingAmount : invoice.outstandingAmount;
}

function AllocationRow({
  field,
  invoices,
  canRemove,
  remove,
}: {
  field: { name: number };
  invoices: CandidateInvoice[];
  canRemove: boolean;
  remove: (index: number) => void;
}) {
  const form = Form.useFormInstance<ReceiptFormValues>();
  const invoiceId: string | undefined = Form.useWatch(['allocations', field.name, 'invoiceId'], form);
  const sourceEventId: string | undefined = Form.useWatch(['allocations', field.name, 'sourceEventId'], form);
  const invoice = invoices.find((i) => i.id === invoiceId);
  const event = invoice?.capexEvents.find((e) => e.sourceEventId === sourceEventId);

  return (
    <div className="rounded-ui border border-ui p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Form.Item
          {...field}
          label="Invoice"
          name={[field.name, 'invoiceId']}
          rules={[{ required: true, message: 'Invoice is required.' }]}
          // A new tab, so the payment being entered here is not lost.
          extra={
            invoice ? (
              <a href={`/projects/${invoice.projectId}/invoices/${invoice.id}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                Open invoice {invoice.invoiceNumber} ↗
              </a>
            ) : undefined
          }
          className="md:col-span-2"
        >
          <Select
            placeholder="Select invoice…"
            options={[...invoices]
              .sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber, undefined, { numeric: true }))
              .map((i) => ({
                value: i.id,
                label: `${i.invoiceNumber} — ${i.projectName} · outstanding ${formatMoney(i.outstandingAmount)}`,
                title: `${i.invoiceNumber} — ${i.projectName}`,
                detail: `Outstanding ${formatMoney(i.outstandingAmount)}`,
              }))}
            optionRender={(o) => <TwoLineOption title={o.data.title} detail={o.data.detail} />}
            onChange={(invoiceId) => {
              const next = invoices.find((i) => i.id === invoiceId);
              form.setFieldValue(['allocations', field.name, 'sourceEventId'], ALL_EVENTS);
              if (next) form.setFieldValue(['allocations', field.name, 'appliedAmount'], next.outstandingAmount);
            }}
          />
        </Form.Item>
        {invoice && invoice.capexEvents.length > 1 ? (
          <Form.Item
            {...field}
            label="Paying for"
            name={[field.name, 'sourceEventId']}
            extra="TDS and GST-TDS rates apply to the taxable amount of what you pick."
            className="md:col-span-4"
          >
            <Select
              options={[
                { value: ALL_EVENTS, label: `All events — taxable ${formatMoney(invoice.taxableAmount)}` },
                ...invoice.capexEvents.map((e) => ({
                  value: e.sourceEventId,
                  label: `${e.name} — taxable ${formatMoney(e.taxableAmount)} · outstanding ${formatMoney(e.outstandingAmount)}`,
                })),
              ]}
              onChange={(next: string) => form.setFieldValue(['allocations', field.name, 'appliedAmount'], collectableAmount(invoice, next))}
            />
          </Form.Item>
        ) : null}
        <Form.Item
          {...field}
          label="Amount applied to invoice"
          name={[field.name, 'appliedAmount']}
          extra="This is the outstanding you are collecting. Deductions come out of it. The bank receives the rest."
          rules={[{ required: true, message: 'Required.' }]}
          className="md:col-span-2"
        >
          <MoneyInput placeholder="0.00" />
        </Form.Item>
      </div>
      {invoice && event ? (
        <div className="mb-3 grid grid-cols-2 gap-2 rounded-ui bg-paper p-2 text-[12px] text-muted md:grid-cols-5">
          <span className="md:col-span-2">{event.name}</span>
          <span>Taxable {formatMoney(event.taxableAmount)}</span>
          <span>Total {formatMoney(event.totalAmount)}</span>
          <span className="font-semibold text-ink">Outstanding {formatMoney(collectableAmount(invoice, event.sourceEventId))}</span>
        </div>
      ) : invoice ? (
        <div className="mb-3 grid grid-cols-2 gap-2 rounded-ui bg-paper p-2 text-[12px] text-muted md:grid-cols-5">
          <span>Taxable {formatMoney(invoice.taxableAmount)}</span>
          <span>CGST {formatMoney(invoice.cgstAmount)}</span>
          <span>SGST {formatMoney(invoice.sgstAmount)}</span>
          <span>IGST {formatMoney(invoice.igstAmount)}</span>
          <span className="font-semibold text-ink">Outstanding {formatMoney(invoice.outstandingAmount)}</span>
        </div>
      ) : null}
      <p className="mb-1 text-[11px] font-bold uppercase tracking-[.06em] text-muted-2">Deductions</p>
      <DeductionFields allocationFieldName={field.name} invoice={invoice} taxableBase={event?.taxableAmount ?? invoice?.taxableAmount} />
      {canRemove ? (
        <Button className="mt-2" size="small" danger onClick={() => remove(field.name)}>
          Remove Invoice
        </Button>
      ) : null}
    </div>
  );
}

function NewReceiptForm() {
  const params = useParams();
  const projectId = String(params.id ?? '');
  const seedInvoiceId = useSearchParams().get('invoiceId') ?? '';
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<ReceiptFormValues>();
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey());
  const [preview, setPreview] = useState<{
    allocations: Array<{ invoiceId: string; sourceEventId: string | null; cashAllocated: string; deductionsTotal: string; settledAmount: string; outstandingBefore: string; outstandingAfter: string }>;
    debitLines: Array<{ ledgerAccountCode: string; ledgerAccountName: string; amount: string }>;
    creditTotal: string;
    balanced: boolean;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const candidates = trpc.receipts.getAllocationCandidates.useQuery({ seedInvoiceId }, { enabled: !!seedInvoiceId });
  const paymentModes = trpc.documentSupport.listPaymentModes.useQuery({ includeInactive: false });
  const utils = trpc.useUtils();

  useEffect(() => {
    const invoices = candidates.data?.invoices;
    if (!invoices) return;
    const rows = (form.getFieldValue('allocations') ?? []) as AllocationFormValue[];
    rows.forEach((row, index) => {
      if (!row?.invoiceId || row.appliedAmount) return;
      const invoice = invoices.find((item) => item.id === row.invoiceId);
      if (invoice) form.setFieldValue(['allocations', index, 'appliedAmount'], invoice.outstandingAmount);
    });
  }, [candidates.data, form]);

  // Live Calculation panel (project-payment-add.html) — the prototype
  // computes its waterfall client-side; this project's own rule (CLAUDE.md:
  // never calculate accounting totals independently in React) means the
  // numbers must still come from calculatePreview on the server. This
  // effect just changes *when* that call fires — debounced on every form
  // change instead of a manual "Preview" button — so it still feels live
  // without moving any math into the browser.
  const allValues = Form.useWatch([], form);
  useEffect(() => {
    const timer = setTimeout(() => {
      const values = form.getFieldsValue();
      const hasAllocation = (values.allocations ?? []).some((a) => a?.invoiceId && a?.appliedAmount);
      if ((values.allocations ?? []).some((a) => a && cashPaise(a) < 0)) {
        setPreview(null);
        setPreviewError('Deductions come out of the amount applied to the invoice, and they are more than that amount.');
        setPreviewLoading(false);
        return;
      }
      const missingDeductionAmount = (values.allocations ?? []).some((allocation) =>
        (allocation?.deductions ?? []).some((deduction) => !DECIMAL_AMOUNT.test((deduction?.amount ?? '').trim())),
      );
      if (missingDeductionAmount) {
        setPreview(null);
        setPreviewError('Enter a deduction amount.');
        setPreviewLoading(false);
        return;
      }
      if (!values.bankAccountId || !hasAllocation) {
        setPreview(null);
        setPreviewError(null);
        return;
      }
      setPreviewLoading(true);
      utils.receipts.calculatePreview
        .fetch({ bankAccountId: values.bankAccountId, allocations: toAllocationInputs(values.allocations) })
        .then((result) => {
          setPreview(result);
          setPreviewError(null);
        })
        .catch((error: unknown) => {
          setPreview(null);
          setPreviewError(readablePreviewError(error));
        })
        .finally(() => setPreviewLoading(false));
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on any form value change, not a specific field list
  }, [JSON.stringify(allValues)]);

  const postMutation = trpc.receipts.postReceipt.useMutation({
    onSuccess: (receipt) => {
      message.success('Receipt posted.');
      router.push(`/projects/${projectId}/receipts/${receipt.id}`);
    },
    onError: (error) => {
      message.error(readablePreviewError(error));
      setIdempotencyKey(newIdempotencyKey());
    },
  });

  if (!seedInvoiceId) {
    return <PageHeader title="Record Payment" description="Missing invoice reference — record a payment from an invoice's Record Payment action." />;
  }
  if (candidates.isLoading) return <PageHeader title="Record Payment" description="Loading…" />;
  if (candidates.isError || !candidates.data) return <PageHeader title="Record Payment" description="Could not load this invoice's billing details." />;

  const d = candidates.data;

  const submit = (values: ReceiptFormValues) => {
    if (values.allocations.some((allocation) => cashPaise(allocation) < 0)) {
      message.error('Deductions come out of the amount applied to the invoice, and they are more than that amount.');
      return;
    }
    const allocations = toAllocationInputs(values.allocations);
    const actualAmount = paiseToMoney(allocations.reduce((sum, allocation) => sum + moneyToPaise(allocation.cashAllocated), 0));
    postMutation.mutate({
      bankAccountId: values.bankAccountId,
      paymentModeId: values.paymentModeId,
      receiptDate: values.receiptDate,
      utrReference: values.utrReference?.trim() || undefined,
      actualAmount,
      allocations,
      idempotencyKey,
    });
  };

  return (
    <>
      <PageHeader
        title="Record Payment"
        description={`${d.clientName} — ${d.legalEntityName}`}
        actions={<Button onClick={() => router.push(`/projects/${projectId}`)}>Back to Project</Button>}
      />

      <UiCard flush>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px]">
          <div className="border-b border-ui-2 p-4 lg:border-b-0 lg:border-r lg:border-ui-2">
            <Form<ReceiptFormValues>
              id="receipt-form"
              form={form}
              layout="vertical"
              onFinish={submit}
              initialValues={{ allocations: [{ invoiceId: seedInvoiceId, sourceEventId: ALL_EVENTS, appliedAmount: '', deductions: [] }] }}
            >
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-brand">Receipt Details</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Form.Item label="Bank account" name="bankAccountId" rules={[{ required: true, message: 'Bank account is required.' }]}>
                  <BankAccountSelect legalEntityId={d.legalEntityId} placeholder="Select bank account…" />
                </Form.Item>
                <Form.Item label="Payment mode" name="paymentModeId" rules={[{ required: true, message: 'Payment mode is required.' }]}>
                  <Select loading={paymentModes.isLoading} options={(paymentModes.data ?? []).map((m) => ({ value: m.id, label: m.label }))} placeholder="Select mode…" />
                </Form.Item>
                <Form.Item label="Receipt date" name="receiptDate" rules={[{ required: true, message: 'Receipt date is required.' }]}>
                  <DateInput />
                </Form.Item>
                <Form.Item label="UTR / Reference no." name="utrReference">
                  <Input placeholder="Optional" />
                </Form.Item>
              </div>

              <p className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-[.06em] text-brand">Invoice Allocations</p>
              <Form.List name="allocations" rules={[{ validator: async (_, v) => (v && v.length > 0 ? Promise.resolve() : Promise.reject(new Error('At least one invoice allocation is required.'))) }]}>
                {(fields, { add, remove }, { errors }) => (
                  <div className="flex flex-col gap-4">
                    {fields.map(({ key, ...field }) => (
                      <AllocationRow key={key} field={field} invoices={d.invoices} canRemove={fields.length> 1} remove={remove} />
                    ))}
                    <Form.ErrorList errors={errors} />
                    <Button onClick={() => add({ invoiceId: undefined, sourceEventId: ALL_EVENTS, appliedAmount: '', deductions: [] })}>Add Invoice</Button>
                  </div>
                )}
              </Form.List>
            </Form>
          </div>

          {/* Live Calculation — project-payment-add.html's waterfall panel,
              repositioned per the prototype's own 1fr/360px split. Every
              number here is whatever calculatePreview last returned; see
              the debounce effect above for why. */}
          <div className="bg-paper p-4 lg:sticky lg:top-4 lg:self-start">
            <div className="flex items-center gap-[7px] text-[11px] font-bold uppercase tracking-[.05em] text-brand">
              <BarChartIcon className="h-[14px] w-[14px]" />
              Live Calculation
            </div>

            {!preview ? (
              <p className="mt-3 text-[12.5px] text-muted">
                {previewLoading ? 'Calculating…' : 'Select a bank account and at least one invoice allocation — this updates automatically.'}
              </p>
            ) : (
              <>
                {preview.allocations.map((a, index) => (
                  <div key={`${a.invoiceId}-${a.sourceEventId ?? ALL_EVENTS}-${index}`} className="flex justify-between border-b border-ui-2 py-2 text-[13px]">
                    <span className="text-muted">
                      {a.sourceEventId
                        ? `${d.invoices.find((i) => i.id === a.invoiceId)?.capexEvents.find((e) => e.sourceEventId === a.sourceEventId)?.name ?? 'CAPEX event'} settlement`
                        : 'Invoice settlement'}
                    </span>
                    <span className="font-mono font-semibold text-ink">{formatMoney(a.settledAmount)}</span>
                  </div>
                ))}
                {preview.debitLines.map((l) => (
                  <div key={l.ledgerAccountCode} className="flex justify-between border-b border-ui-2 py-2 text-[13px]">
                    <span className="text-muted">Dr {l.ledgerAccountName}</span>
                    <span className="font-mono font-semibold text-ink">{formatMoney(l.amount)}</span>
                  </div>
                ))}
                <div className="mt-2 flex justify-between rounded-ui bg-ink px-3 py-[11px] text-white">
                  <span className="font-semibold">Total settlement</span>
                  <span className="font-mono text-[15px] font-semibold">{formatMoney(preview.creditTotal)}</span>
                </div>
                {!preview.balanced ? <p className="mt-2 text-[12px] font-medium text-negative">This journal would not balance — check the amounts before posting.</p> : null}
              </>
            )}
            {previewError ? <p className="mt-2 text-[12px] text-negative">{previewError}</p> : null}
            <p className="mt-3 text-[11px] leading-[1.5] text-muted">
              Every figure here is computed by the server from what you&apos;ve entered — nothing is calculated in the browser.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ui-2 bg-paper p-4">
          <Button onClick={() => router.push(`/projects/${projectId}`)}>Cancel</Button>
          <Button type="primary" htmlType="submit" form="receipt-form" loading={postMutation.isPending}>
            Post Receipt
          </Button>
        </div>
      </UiCard>
    </>
  );
}

export default function NewReceiptPage() {
  return (
    <Suspense fallback={null}>
      <NewReceiptForm />
    </Suspense>
  );
}
