'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { App, Button, Form, Input, Modal } from 'antd';
import { PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';
import { formatDate, formatMoney } from '@/lib/format';
import { LineItemsEditor, type LineItemFormValue } from '../../../../../../invoices/shared';
import { CreditDebitNoteStatusTag, CreditDebitNoteTypeTag, newIdempotencyKey, type CreditDebitNoteDetailData } from '../../../../../../credit-debit-notes/shared';
import { DateInput } from '@/components/date-input';

interface DraftFormValues {
  reason: string;
  lines: LineItemFormValue[];
}

function DraftEditor({ note }: { note: CreditDebitNoteDetailData }) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canUpdate = permissions.includes('credit_debit_note.update');
  const canFinalize = permissions.includes('credit_debit_note.finalize');
  const canVoidDraft = permissions.includes('credit_debit_note.void');
  const [form] = Form.useForm<DraftFormValues>();
  const formDraft = useFormDraft(`credit-note:${note.id}`);
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef(false);
  useEffect(() => {
    if (appliedDraft.current || formDraft.isLoading || !formDraft.payload) return;
    appliedDraft.current = true;
    form.setFieldsValue(formDraft.payload as Partial<DraftFormValues>);
  }, [form, formDraft.isLoading, formDraft.payload]);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizeKey, setFinalizeKey] = useState(newIdempotencyKey());
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidKey, setVoidKey] = useState(newIdempotencyKey());

  const invalidate = () => utils.creditDebitNotes.getDetail.invalidate({ id: note.id });

  const updateMutation = trpc.creditDebitNotes.updateDraft.useMutation({
    onSuccess: async () => {
      message.success('Note saved.');
      clearDraft.mutate({ formKey: `credit-note:${note.id}` });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const finalizeMutation = trpc.creditDebitNotes.finalize.useMutation({
    onSuccess: async () => {
      message.success(`${note.type === 'CREDIT' ? 'Credit' : 'Debit'} note finalized.`);
      setFinalizeOpen(false);
      setFinalizeKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const voidMutation = trpc.creditDebitNotes.void.useMutation({
    onSuccess: async () => {
      message.success('Draft voided.');
      setVoidOpen(false);
      setVoidKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const submitUpdate = (values: DraftFormValues) => {
    updateMutation.mutate({
      id: note.id,
      expectedVersion: note.version,
      reason: values.reason,
      lines: values.lines.map((l) => ({
        description: l.description,
        hsnSac: l.hsnSac?.trim() || undefined,
        quantity: '1',
        unitPrice: l.unitPrice,
        gstRatePercent: l.gstRatePercent,
      })),
    });
  };

  return (
    <>
      <UiCard title={note.type === 'CREDIT' ? 'Draft Credit Note' : 'Draft Debit Note'}>
        <Form<DraftFormValues>
          form={form}
          layout="vertical"
          onFinish={submitUpdate}
          initialValues={{
            reason: note.reason,
            lines: note.lines.map((l) => ({
              description: l.description,
              hsnSac: l.hsnSac ?? undefined,
              unitPrice: l.unitPrice,
              gstRatePercent: l.gstRatePercent,
            })),
          }}
        >
          <Form.Item label="Reason" name="reason" rules={[{ required: true, message: 'A reason is required.' }]}>
            <Input.TextArea rows={2} />
          </Form.Item>

          <p className="mb-2 mt-1 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">
            {note.type === 'CREDIT' ? 'Amount to Credit' : 'Amount to Debit'}
          </p>
          <LineItemsEditor />

          <div className="mt-4 flex gap-2">
            {canUpdate ? (
              <>
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
              </>
            ) : null}
            {canFinalize ? <Button onClick={() => setFinalizeOpen(true)}>Finalize…</Button> : null}
            {canVoidDraft ? (
              <Button danger onClick={() => setVoidOpen(true)}>
                Void Draft…
              </Button>
            ) : null}
          </div>
        </Form>
      </UiCard>

      <Modal
        title={note.type === 'CREDIT' ? 'Finalize Credit Note' : 'Finalize Debit Note'}
        open={finalizeOpen}
        onCancel={() => setFinalizeOpen(false)}
        onOk={() => finalizeMutation.mutate({ id: note.id, expectedVersion: note.version, idempotencyKey: finalizeKey })}
        confirmLoading={finalizeMutation.isPending}
        okText="Finalize"
      >
        <p className="text-muted">
          Finalizing generates the note number and posts the accounting journal into today&apos;s open accounting period —
          it does not reopen or change the original invoice. This cannot be undone except by voiding with a reversal.
        </p>
      </Modal>

      <Modal
        title="Void Draft"
        open={voidOpen}
        onCancel={() => setVoidOpen(false)}
        onOk={() =>
          voidMutation.mutate({
            id: note.id,
            expectedVersion: note.version,
            reason: voidReason,
            accountingDate: undefined,
            idempotencyKey: voidKey,
          })
        }
        confirmLoading={voidMutation.isPending}
        okButtonProps={{ disabled: !voidReason.trim() }}
        okText="Void Draft"
      >
        <p className="mb-2 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
      </Modal>
    </>
  );
}

function FinalizedOrVoidView({ note }: { note: CreditDebitNoteDetailData }) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canVoid = permissions.includes('credit_debit_note.void');

  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [accountingDate, setAccountingDate] = useState('');
  const [voidKey, setVoidKey] = useState(newIdempotencyKey());

  const voidMutation = trpc.creditDebitNotes.void.useMutation({
    onSuccess: async () => {
      message.success(`${note.type === 'CREDIT' ? 'Credit' : 'Debit'} note voided.`);
      setVoidOpen(false);
      setVoidKey(newIdempotencyKey());
      await utils.creditDebitNotes.getDetail.invalidate({ id: note.id });
    },
    onError: (error) => message.error(error.message),
  });

  return (
    <>
      <UiCard
        title={`${note.type === 'CREDIT' ? 'Credit' : 'Debit'} Note ${note.noteNumber ?? ''}`}
        actions={
          canVoid && note.status === 'FINALIZED' ? (
            <Button
              size="small"
              danger
              onClick={() => {
                setAccountingDate(new Date().toISOString().slice(0, 10));
                setVoidOpen(true);
              }}
            >
              Void…
            </Button>
          ) : undefined
        }
      >
        <div className="grid grid-cols-2 gap-y-2 text-[13.5px] md:grid-cols-4">
          <span className="text-muted">Note date</span>
          <span>{note.noteDate ? formatDate(note.noteDate) : '—'}</span>
          <span className="text-muted">Against invoice</span>
          <span>{note.invoiceNumber ?? '—'}</span>
        </div>

        <div className="mt-4 rounded-ui border border-ui bg-paper p-3 text-[12.5px] text-ink">
          <b className="text-muted">Reason:</b> {note.reason}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-ui text-left text-muted">
                <th className="py-2 pr-3">Description</th>
                <th className="py-2 pr-3">HSN/SAC</th>
                <th className="py-2 pr-3 text-right">Amount</th>
                <th className="py-2 pr-3 text-right">Taxable</th>
                <th className="py-2 pr-3 text-right">GST%</th>
                <th className="py-2 pr-3 text-right">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {note.lines.map((line) => (
                <tr key={line.id} className="border-b border-ui-2">
                  <td className="py-2 pr-3">{line.description}</td>
                  <td className="py-2 pr-3">{line.hsnSac ?? '—'}</td>
                  <td className="py-2 pr-3 text-right">{formatMoney(line.unitPrice)}</td>
                  <td className="py-2 pr-3 text-right">{formatMoney(line.taxableAmount)}</td>
                  <td className="py-2 pr-3 text-right">{line.gstRatePercent}%</td>
                  <td className="py-2 pr-3 text-right">{formatMoney(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ml-auto mt-4 w-full max-w-xs rounded-ui border border-ui">
          <div className="flex justify-between border-b border-ui-2 px-4 py-2 text-[13px]">
            <span className="text-muted">Taxable</span>
            <span>{formatMoney(note.taxableAmount)}</span>
          </div>
          {note.cgstAmount && Number(note.cgstAmount) > 0 ? (
            <div className="flex justify-between border-b border-ui-2 px-4 py-2 text-[13px]">
              <span className="text-muted">CGST</span>
              <span>{formatMoney(note.cgstAmount)}</span>
            </div>
          ) : null}
          {note.sgstAmount && Number(note.sgstAmount) > 0 ? (
            <div className="flex justify-between border-b border-ui-2 px-4 py-2 text-[13px]">
              <span className="text-muted">SGST</span>
              <span>{formatMoney(note.sgstAmount)}</span>
            </div>
          ) : null}
          {note.igstAmount && Number(note.igstAmount) > 0 ? (
            <div className="flex justify-between border-b border-ui-2 px-4 py-2 text-[13px]">
              <span className="text-muted">IGST</span>
              <span>{formatMoney(note.igstAmount)}</span>
            </div>
          ) : null}
          <div className="flex justify-between px-4 py-2 text-[14px] font-semibold text-ink">
            <span>Total</span>
            <span>{formatMoney(note.totalAmount)}</span>
          </div>
        </div>

        {note.status === 'VOID' ? (
          <div className="mt-4 rounded-ui border border-ui bg-negative-soft p-3 text-[12.5px] text-negative">
            <b>Voided.</b> Reason: {note.voidReason ?? '—'} — {note.voidedAt ? formatDate(note.voidedAt) : '—'}
          </div>
        ) : null}
      </UiCard>

      <Modal
        title={`Void ${note.type === 'CREDIT' ? 'Credit' : 'Debit'} Note`}
        open={voidOpen}
        onCancel={() => setVoidOpen(false)}
        onOk={() =>
          voidMutation.mutate({
            id: note.id,
            expectedVersion: note.version,
            reason: voidReason,
            accountingDate,
            idempotencyKey: voidKey,
          })
        }
        confirmLoading={voidMutation.isPending}
        okButtonProps={{ disabled: !voidReason.trim() || !accountingDate }}
        okText="Void Note"
      >
        <p className="mb-2 text-muted">This reverses the note&apos;s journal entry. The note number is retained. The original invoice is untouched.</p>
        <p className="mb-2 text-muted">Reversal accounting date</p>
        <DateInput value={accountingDate} onChange={setAccountingDate} />
        <p className="mb-2 mt-3 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
      </Modal>
    </>
  );
}

export default function CreditDebitNoteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = String(params.id ?? '');
  const invoiceId = String(params.invoiceId ?? '');
  const noteId = String(params.noteId ?? '');

  const detail = trpc.creditDebitNotes.getDetail.useQuery({ id: noteId }, { enabled: !!noteId });

  if (detail.isError) {
    return <PageHeader title="Credit / Debit Note" description="Could not load this note." />;
  }
  if (detail.isLoading || !detail.data) {
    return <PageHeader title="Credit / Debit Note" description="Loading…" />;
  }

  const note = detail.data as CreditDebitNoteDetailData;

  return (
    <>
      <PageHeader
        title={note.noteNumber ? `${note.type === 'CREDIT' ? 'Credit' : 'Debit'} Note ${note.noteNumber}` : `Draft ${note.type === 'CREDIT' ? 'Credit' : 'Debit'} Note`}
        description={`Against invoice ${note.invoiceNumber ?? ''}`}
        actions={
          <div className="flex items-center gap-2">
            <CreditDebitNoteTypeTag type={note.type} />
            <CreditDebitNoteStatusTag status={note.status} />
            <Button onClick={() => router.push(`/projects/${projectId}/invoices/${invoiceId}`)}>Back to Invoice</Button>
          </div>
        }
      />

      {note.status === 'DRAFT' ? <DraftEditor note={note} /> : <FinalizedOrVoidView note={note} />}
    </>
  );
}
