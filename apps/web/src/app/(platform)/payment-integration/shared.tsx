'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Input, Modal, Select } from 'antd';
import { MoneyInput, StatusTag } from '@zitaware/ui';
import type { StatusTagTone } from '@zitaware/ui';
import { TwoLineOption } from '../invoices/shared';
import { trpc } from '@/server/trpc';
import { formatMoney } from '@/lib/format';
import { DateInput } from '@/components/date-input';
import { BankAccountSelect } from '@/components/bank-account-select';

export type AllocationDeductionType =
  | 'TDS'
  | 'CGST_TDS'
  | 'SGST_TDS'
  | 'IGST_TDS'
  | 'HOLD'
  | 'RETENTION'
  | 'ACCEPTED_PENALTY'
  | 'DISPUTED_PENALTY'
  | 'OTHER';

const DEDUCTION_TYPES: Array<{ value: AllocationDeductionType; label: string }> = [
  { value: 'TDS', label: 'TDS (on base)' },
  { value: 'CGST_TDS', label: 'GST-TDS — CGST (on base)' },
  { value: 'SGST_TDS', label: 'GST-TDS — SGST (on base)' },
  { value: 'IGST_TDS', label: 'GST-TDS — IGST (on base)' },
  { value: 'HOLD', label: 'Hold' },
  { value: 'RETENTION', label: 'Retention' },
  { value: 'ACCEPTED_PENALTY', label: 'Penalty' },
  { value: 'DISPUTED_PENALTY', label: 'Disputed penalty' },
  { value: 'OTHER', label: 'Other' },
];

/**
 * Offered when recording a receipt: one Penalty, posted as an accepted
 * penalty (ADR-161). Disputed penalty is no longer offered; receipts that
 * already carry one still read it through DEDUCTION_TYPE_LABEL.
 */
export const DEDUCTION_TYPE_OPTIONS = DEDUCTION_TYPES.filter((o) => o.value !== 'DISPUTED_PENALTY');

export const DEDUCTION_TYPE_LABEL: Record<AllocationDeductionType, string> = Object.fromEntries(
  DEDUCTION_TYPES.map((o) => [o.value, o.label]),
) as Record<AllocationDeductionType, string>;

export interface ClientReceiptRow {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  bankAccountId: string;
  bankAccountName: string;
  paymentModeId: string;
  paymentModeLabel: string;
  receiptDate: string;
  utrReference: string | null;
  actualAmount: string;
  status: 'POSTED' | 'REVERSED';
  journalEntryId: string | null;
  reversalJournalEntryId: string | null;
  reversalReason: string | null;
  reversedBy: string | null;
  reversedAt: string | null;
  clientName: string;
  projectIds: string[];
  projectNames: string[];
  invoiceNumbers: string[];
  version: number;
}

export interface DeductionRow {
  id: string;
  type: AllocationDeductionType;
  amount: string;
  ratePercent: string | null;
  penaltyCategoryId: string | null;
  penaltyCategoryName: string | null;
  otherLedgerAccountId: string | null;
  otherLedgerAccountName: string | null;
  narrative: string | null;
  releasedAmount: string;
  outstandingAmount: string;
}

export interface AllocationRow {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceProjectId: string;
  sourceEventId: string | null;
  sourceEventName: string | null;
  invoiceTaxableAmountSnapshot: string;
  invoiceCgstSnapshot: string;
  invoiceSgstSnapshot: string;
  invoiceIgstSnapshot: string;
  invoiceTotalSnapshot: string;
  cashAllocated: string;
  settledAmount: string;
  deductions: DeductionRow[];
}

export interface ClientReceiptDetailData extends ClientReceiptRow {
  allocations: AllocationRow[];
}

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

const STATUS_TONE: Record<ClientReceiptRow['status'], StatusTagTone> = {
  POSTED: 'pos',
  REVERSED: 'neg',
};
const STATUS_TEXT: Record<ClientReceiptRow['status'], string> = {
  POSTED: 'Posted',
  REVERSED: 'Reversed',
};

export function ReceiptStatusTag({ status }: { status: ClientReceiptRow['status'] }) {
  return <StatusTag status={status} label={STATUS_TEXT[status]} tone={STATUS_TONE[status]} />;
}

export interface ReleaseDeductionTarget {
  id: string;
  type: string;
  outstandingAmount: string;
  invoiceNumber: string | null;
}

/**
 * Reused from both a receipt's own detail page (release scoped to that
 * receipt's lines) and the project/global "Outstanding Holds & Retentions"
 * cards (release from a cross-receipt list) — self-contained aside from the
 * `deduction` it's releasing, so one component serves both entry points.
 */
export function ReleaseModal({
  deduction,
  onClose,
  onSuccess,
}: {
  deduction: ReleaseDeductionTarget | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { message } = App.useApp();
  const [releasedAmount, setReleasedAmount] = useState('');
  const [releasedOn, setReleasedOn] = useState('');
  const [bankAccountId, setBankAccountId] = useState<string | undefined>(undefined);
  const [utrReference, setUtrReference] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey());

  const releaseMutation = trpc.receipts.releaseDeduction.useMutation({
    onSuccess: async () => {
      message.success('Release recorded.');
      reset();
      onSuccess();
    },
    onError: (error) => message.error(error.message),
  });

  function reset() {
    setReleasedAmount('');
    setReleasedOn('');
    setBankAccountId(undefined);
    setUtrReference('');
    setIdempotencyKey(newIdempotencyKey());
  }

  if (!deduction) return null;

  return (
    <Modal
      open
      title={`Release — ${deduction.type === 'HOLD' ? 'Hold' : 'Retention'} on ${deduction.invoiceNumber ?? ''}`}
      onCancel={() => {
        reset();
        onClose();
      }}
      onOk={() =>
        bankAccountId &&
        releaseMutation.mutate({
          deductionId: deduction.id,
          releasedAmount,
          releasedOn,
          bankAccountId,
          utrReference: utrReference.trim() || undefined,
          idempotencyKey,
        })
      }
      confirmLoading={releaseMutation.isPending}
      okButtonProps={{ disabled: !releasedAmount || !releasedOn || !bankAccountId }}
      okText="Record Release"
    >
      <div className="flex flex-col gap-3">
        <p className="text-muted">
          Outstanding: <b className="text-text">{formatMoney(deduction.outstandingAmount)}</b>
        </p>
        <label className="flex flex-col gap-[3px]">
          <span className="text-[12.5px] font-semibold text-text">Amount received</span>
          <MoneyInput
            value={releasedAmount}
            onChange={(value) => setReleasedAmount(value ?? '')}
            placeholder={formatMoney(deduction.outstandingAmount)}
          />
        </label>
        <label className="flex flex-col gap-[3px]">
          <span className="text-[12.5px] font-semibold text-text">Released on</span>
          <DateInput value={releasedOn} onChange={setReleasedOn} />
        </label>
        <label className="flex flex-col gap-[3px]">
          <span className="text-[12.5px] font-semibold text-text">Bank account</span>
          <BankAccountSelect value={bankAccountId} onChange={setBankAccountId} />
        </label>
        <label className="flex flex-col gap-[3px]">
          <span className="text-[12.5px] font-semibold text-text">UTR / Reference no.</span>
          <Input value={utrReference} onChange={(e) => setUtrReference(e.target.value)} placeholder="Optional" />
        </label>
      </div>
    </Modal>
  );
}

/**
 * Entry point for "Record Payment" — used both globally (from the Payment
 * Integration list, where there's no invoice in context) and from a
 * project's own Payment tab (where defaultProjectId skips the project
 * step). A receipt still must originate from one specific FINALIZED
 * invoice (its client/legal entity seed the allocation candidates) — this
 * just adds a project-then-invoice picker in front of the existing
 * /projects/[id]/receipts/new?invoiceId=... route, rather than inventing a
 * second creation path.
 */
export function RecordPaymentModal({
  open,
  onClose,
  defaultProjectId,
}: {
  open: boolean;
  onClose: () => void;
  defaultProjectId?: string;
}) {
  const router = useRouter();
  const projects = trpc.projects.list.useQuery(undefined, { enabled: open && !defaultProjectId });
  const [projectId, setProjectId] = useState<string | undefined>(defaultProjectId);
  const [invoiceId, setInvoiceId] = useState<string | undefined>(undefined);

  const invoices = trpc.invoices.list.useQuery(
    { page: 1, pageSize: 100, filters: { projectId, status: 'FINALIZED' } },
    { enabled: !!projectId },
  );
  const invoiceOptions = [...(invoices.data?.rows ?? [])]
    .sort((a, b) => (a.invoiceNumber ?? '').localeCompare(b.invoiceNumber ?? '', undefined, { numeric: true }))
    .map((i) => ({
      value: i.id,
      label: `${i.invoiceNumber ?? ''} — ${i.sourceTitle} — Total ${formatMoney(i.totalAmount)} — Due ${formatMoney(i.outstandingAmount ?? '0')}`,
      title: `${i.invoiceNumber ?? ''} — ${i.sourceTitle}`,
      detail: `Total ${formatMoney(i.totalAmount)} · due ${formatMoney(i.outstandingAmount ?? '0')}`,
    }));

  const reset = () => {
    setProjectId(defaultProjectId);
    setInvoiceId(undefined);
  };

  return (
    <Modal
      title="Record Payment"
      open={open}
      afterOpenChange={(isOpen) => (isOpen ? reset() : undefined)}
      onCancel={() => {
        reset();
        onClose();
      }}
      onOk={() => {
        if (!projectId || !invoiceId) return;
        reset();
        onClose();
        router.push(`/projects/${projectId}/receipts/new?invoiceId=${invoiceId}`);
      }}
      okButtonProps={{ disabled: !projectId || !invoiceId }}
      okText="Continue"
    >
      <div className="flex flex-col gap-3">
        {defaultProjectId ? null : (
          <label className="flex flex-col gap-[3px]">
            <span className="text-[12.5px] font-semibold text-text">Project</span>
            <Select
              placeholder="Select project…"
              value={projectId}
              onChange={(v) => {
                setProjectId(v);
                setInvoiceId(undefined);
              }}
              loading={projects.isLoading}
              options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          </label>
        )}
        <label className="flex flex-col gap-[3px]">
          <span className="text-[12.5px] font-semibold text-text">Finalized invoice</span>
          <Select
            placeholder={projectId ? 'Select invoice…' : 'Select a project first'}
            value={invoiceId}
            onChange={setInvoiceId}
            disabled={!projectId}
            loading={invoices.isLoading}
            options={invoiceOptions}
            optionRender={(o) => <TwoLineOption title={o.data.title} detail={o.data.detail} />}
            notFoundContent={projectId && !invoices.isLoading ? 'No finalized invoices for this project.' : undefined}
          />
        </label>
      </div>
    </Modal>
  );
}
