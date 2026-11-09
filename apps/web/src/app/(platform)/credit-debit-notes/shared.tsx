'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal, Select } from 'antd';
import { StatusTag } from '@zitaware/ui';
import type { StatusTagTone } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatMoney } from '@/lib/format';

export interface CreditDebitNoteRow {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  projectId: string;
  projectName: string;
  legalEntityId: string;
  legalEntityName: string;
  gstRegistrationId: string;
  gstRegistrationGstin: string;
  type: 'CREDIT' | 'DEBIT';
  status: 'DRAFT' | 'FINALIZED' | 'VOID';
  reason: string;
  noteNumber: string | null;
  noteDate: string | null;
  taxableAmount: string | null;
  cgstAmount: string | null;
  sgstAmount: string | null;
  igstAmount: string | null;
  totalAmount: string | null;
  journalEntryId: string | null;
  voidJournalEntryId: string | null;
  voidReason: string | null;
  voidedBy: string | null;
  voidedAt: string | null;
  version: number;
}

export interface CreditDebitNoteLineRow {
  id: string;
  sequence: number;
  description: string;
  hsnSac: string | null;
  quantity: string;
  unitPrice: string;
  taxableAmount: string;
  gstRatePercent: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  lineTotal: string;
}

export interface CreditDebitNoteDetailData extends CreditDebitNoteRow {
  lines: CreditDebitNoteLineRow[];
}

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

const STATUS_TONE: Record<CreditDebitNoteRow['status'], StatusTagTone> = {
  DRAFT: 'info',
  FINALIZED: 'pos',
  VOID: 'neg',
};
const STATUS_TEXT: Record<CreditDebitNoteRow['status'], string> = {
  DRAFT: 'Draft',
  FINALIZED: 'Finalized',
  VOID: 'Void',
};

export function CreditDebitNoteStatusTag({ status }: { status: CreditDebitNoteRow['status'] }) {
  return <StatusTag status={status} label={STATUS_TEXT[status]} tone={STATUS_TONE[status]} />;
}

const TYPE_TONE: Record<CreditDebitNoteRow['type'], StatusTagTone> = {
  CREDIT: 'neg',
  DEBIT: 'warn',
};
const TYPE_TEXT: Record<CreditDebitNoteRow['type'], string> = {
  CREDIT: 'Credit Note',
  DEBIT: 'Debit Note',
};

/** Red for Credit (reduces revenue owed to the company) / amber for Debit
 * (increases it) -- a plain informational type badge, distinct from the
 * lifecycle StatusTag above. */
export function CreditDebitNoteTypeTag({ type }: { type: CreditDebitNoteRow['type'] }) {
  return <StatusTag status={type} label={TYPE_TEXT[type]} tone={TYPE_TONE[type]} />;
}

/**
 * Entry point for "Add Credit/Debit Note" from the global list, where
 * there's no invoice in context. A note still must originate from one
 * specific FINALIZED invoice (docs/04 SS18) -- this adds a
 * project-then-invoice-then-type picker in front of the existing
 * /projects/[id]/invoices/[invoiceId]/credit-debit-notes/new?type=...
 * route, mirroring RecordPaymentModal's own project-then-invoice shape
 * (payment-integration/shared.tsx).
 */
export function IssueCreditDebitNoteModal({
  open,
  onClose,
  defaultProjectId,
  defaultInvoiceId,
}: {
  open: boolean;
  onClose: () => void;
  defaultProjectId?: string;
  defaultInvoiceId?: string;
}) {
  const router = useRouter();
  const projects = trpc.projects.list.useQuery(undefined, { enabled: open && !defaultProjectId });
  const [projectId, setProjectId] = useState<string | undefined>(defaultProjectId);
  const [invoiceId, setInvoiceId] = useState<string | undefined>(defaultInvoiceId);
  const [type, setType] = useState<'CREDIT' | 'DEBIT' | undefined>(undefined);

  const invoices = trpc.invoices.list.useQuery(
    { page: 1, pageSize: 100, filters: { projectId, status: 'FINALIZED' } },
    { enabled: !!projectId && !defaultInvoiceId },
  );
  const invoiceOptions = (invoices.data?.rows ?? []).map((i) => ({
    value: i.id,
    label: `${i.invoiceNumber ?? ''} — ${i.sourceTitle} — Total ${formatMoney(i.totalAmount)}`,
  }));

  const reset = () => {
    setProjectId(defaultProjectId);
    setInvoiceId(defaultInvoiceId);
    setType(undefined);
  };

  return (
    <Modal
      title="Issue Credit / Debit Note"
      open={open}
      afterOpenChange={(isOpen) => (isOpen ? reset() : undefined)}
      onCancel={() => {
        reset();
        onClose();
      }}
      onOk={() => {
        if (!projectId || !invoiceId || !type) return;
        reset();
        onClose();
        router.push(`/projects/${projectId}/invoices/${invoiceId}/credit-debit-notes/new?type=${type}`);
      }}
      okButtonProps={{ disabled: !projectId || !invoiceId || !type }}
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
        {defaultInvoiceId ? null : (
          <label className="flex flex-col gap-[3px]">
            <span className="text-[12.5px] font-semibold text-text">Finalized invoice</span>
            <Select
              placeholder={projectId ? 'Select invoice…' : 'Select a project first'}
              value={invoiceId}
              onChange={setInvoiceId}
              disabled={!projectId}
              loading={invoices.isLoading}
              options={invoiceOptions}
              notFoundContent={projectId && !invoices.isLoading ? 'No finalized invoices for this project.' : undefined}
            />
          </label>
        )}
        <label className="flex flex-col gap-[3px]">
          <span className="text-[12.5px] font-semibold text-text">Type</span>
          <Select
            placeholder="Select type…"
            value={type}
            onChange={setType}
            options={[
              { value: 'CREDIT', label: 'Credit Note — reduces the amount owed' },
              { value: 'DEBIT', label: 'Debit Note — increases the amount owed' },
            ]}
          />
        </label>
      </div>
    </Modal>
  );
}
