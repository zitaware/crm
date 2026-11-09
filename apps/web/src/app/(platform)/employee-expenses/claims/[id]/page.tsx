'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { App, Button, Form, Input, Modal, Segmented } from 'antd';
import { MoneyInput, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';
import { MasterSelect } from '@/components/master-select';
import { ProjectSelect } from '@/components/project-select';
import { LegalEntitySelect } from '@/components/legal-entity-select';
import { BankAccountSelect } from '@/components/bank-account-select';
import { formatDate, formatMoney } from '@/lib/format';
import { DocumentsTab } from '@/components/documents-tab';
import { ClaimApprovalLine, EmployeeExpenseClaimStatusTag, mayDecide, newIdempotencyKey, type EmployeeExpenseClaimDetailData } from '../../shared';
import { DateInput } from '@/components/date-input';

interface DraftFormValues {
  expenseCategoryId: string;
  title: string;
  projectId?: string;
  legalEntityId?: string;
  amount: string;
  expenseDate: string;
  gstInvoiceAvailable: boolean;
  gstCreditAmount?: string;
  note?: string;
}

function DraftEditor({ claim }: { claim: EmployeeExpenseClaimDetailData }) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const canEditDraft = (trpc.auth.me.useQuery().data?.permissions ?? []).includes('employee_claim.create');
  const [form] = Form.useForm<DraftFormValues>();
  const formDraft = useFormDraft(`expense-claim:${claim.id}`);
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef(false);
  useEffect(() => {
    if (appliedDraft.current || formDraft.isLoading || !formDraft.payload) return;
    appliedDraft.current = true;
    form.setFieldsValue(formDraft.payload as Partial<DraftFormValues>);
  }, [form, formDraft.isLoading, formDraft.payload]);

  const legalEntities = trpc.legalEntities.list.useQuery({ includeInactive: false });

  const projectId = Form.useWatch('projectId', form);
  const gstInvoiceAvailable = Form.useWatch('gstInvoiceAvailable', form);
  const showLegalEntityPicker = !projectId && (legalEntities.data?.length ?? 0) > 1;

  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitKey, setSubmitKey] = useState(newIdempotencyKey());
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelKey, setCancelKey] = useState(newIdempotencyKey());

  const invalidate = () => utils.employeeExpenses.getClaimDetail.invalidate({ id: claim.id });

  const updateMutation = trpc.employeeExpenses.updateClaimDraft.useMutation({
    onSuccess: async () => {
      message.success('Expense claim saved.');
      clearDraft.mutate({ formKey: `expense-claim:${claim.id}` });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const submitMutation = trpc.employeeExpenses.submitClaim.useMutation({
    onSuccess: async () => {
      message.success('Expense claim submitted for approval.');
      setSubmitOpen(false);
      setSubmitKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const cancelMutation = trpc.employeeExpenses.cancelClaim.useMutation({
    onSuccess: async () => {
      message.success('Expense claim cancelled.');
      setCancelOpen(false);
      setCancelKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const submitUpdate = (values: DraftFormValues) => {
    updateMutation.mutate({
      id: claim.id,
      expectedVersion: claim.version,
      expenseCategoryId: values.expenseCategoryId,
      title: values.title,
      projectId: values.projectId || undefined,
      legalEntityId: values.projectId ? undefined : values.legalEntityId,
      amount: values.amount,
      expenseDate: values.expenseDate,
      gstInvoiceAvailable: !!values.gstInvoiceAvailable,
      gstCreditAmount: values.gstInvoiceAvailable ? values.gstCreditAmount : '0',
      note: values.note?.trim() || undefined,
    });
  };

  return (
    <>
      <UiCard title="Draft Expense Claim">
        <Form<DraftFormValues>
          form={form}
          layout="vertical"
          onFinish={submitUpdate}
          initialValues={{
            expenseCategoryId: claim.expenseCategoryId,
            title: claim.title,
            projectId: claim.projectId ?? undefined,
            legalEntityId: claim.legalEntityId,
            amount: claim.amount,
            expenseDate: claim.expenseDate,
            gstInvoiceAvailable: claim.gstInvoiceAvailable,
            gstCreditAmount: claim.gstCreditAmount,
            note: claim.note ?? undefined,
          }}
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Form.Item label="Category" name="expenseCategoryId" rules={[{ required: true, message: 'Category is required.' }]}>
              <MasterSelect type="expense_categories" placeholder="Select category…" />
            </Form.Item>
            <Form.Item label="Title" name="title" rules={[{ required: true, message: 'Title is required.' }]}>
              <Input />
            </Form.Item>
            <Form.Item label="Project (optional)" name="projectId">
              <ProjectSelect allowClear placeholder="None / company overhead" />
            </Form.Item>
            {showLegalEntityPicker ? (
              <Form.Item label="Legal entity" name="legalEntityId" rules={[{ required: !projectId, message: 'Legal entity is required when no project is selected.' }]}>
                <LegalEntitySelect />
              </Form.Item>
            ) : null}
            <Form.Item label="Amount" name="amount" rules={[{ required: true, message: 'Amount is required.' }]}>
              <MoneyInput placeholder="0.00" />
            </Form.Item>
            <Form.Item label="Expense date" name="expenseDate" rules={[{ required: true, message: 'Expense date is required.' }]}>
              <DateInput />
            </Form.Item>
            <Form.Item label="GST invoice available?" name="gstInvoiceAvailable">
              <Segmented
                options={[
                  { label: 'Yes', value: true },
                  { label: 'No', value: false },
                ]}
              />
            </Form.Item>
            {gstInvoiceAvailable ? (
              <Form.Item label="GST credit" name="gstCreditAmount">
                <MoneyInput placeholder="0.00" />
              </Form.Item>
            ) : null}
          </div>
          <Form.Item label="Note" name="note">
            <Input.TextArea rows={2} />
          </Form.Item>

          <div className="flex gap-2">
            {canEditDraft ? (
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
                <Button onClick={() => setSubmitOpen(true)}>Submit for Approval…</Button>
                <Button danger onClick={() => setCancelOpen(true)}>
                  Cancel Claim…
                </Button>
              </>
            ) : null}
          </div>
        </Form>
      </UiCard>

      <Modal
        title="Submit Expense Claim"
        open={submitOpen}
        onCancel={() => setSubmitOpen(false)}
        onOk={() => submitMutation.mutate({ id: claim.id, expectedVersion: claim.version, idempotencyKey: submitKey })}
        confirmLoading={submitMutation.isPending}
        okText="Submit"
      >
        <p className="text-muted">Submitting locks this claim for approval. You will not be able to edit it afterward.</p>
      </Modal>

      <Modal
        title="Cancel Expense Claim"
        open={cancelOpen}
        onCancel={() => setCancelOpen(false)}
        onOk={() => cancelMutation.mutate({ id: claim.id, expectedVersion: claim.version, reason: cancelReason, idempotencyKey: cancelKey })}
        confirmLoading={cancelMutation.isPending}
        okButtonProps={{ disabled: !cancelReason.trim() }}
        okText="Cancel Claim"
      >
        <p className="mb-2 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
      </Modal>
    </>
  );
}

function DecidedView({ claim }: { claim: EmployeeExpenseClaimDetailData }) {
  const { message } = App.useApp();
  const router = useRouter();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const permissions = me.data?.permissions ?? [];
  const canApprove = permissions.includes('employee_claim.approve');
  const canSelfApprove = permissions.includes('employee_claim.self_approve');
  const canReimburse = permissions.includes('employee_claim.reimburse');
  const canReverse = permissions.includes('employee_claim.reverse');
  const isOwnClaim = claim.createdBy === me.data?.userId;
  const canCancel = claim.createdBy === me.data?.userId;

  const [approveOpen, setApproveOpen] = useState(false);
  const [approveNote, setApproveNote] = useState('');
  const [approveKey, setApproveKey] = useState(newIdempotencyKey());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectKey, setRejectKey] = useState(newIdempotencyKey());
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelKey, setCancelKey] = useState(newIdempotencyKey());
  const [reimburseOpen, setReimburseOpen] = useState(false);
  const [reimburseBankAccountId, setReimburseBankAccountId] = useState<string | undefined>(undefined);
  const [reimburseDate, setReimburseDate] = useState('');
  const [reimburseKey, setReimburseKey] = useState(newIdempotencyKey());
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseAccountingDate, setReverseAccountingDate] = useState('');
  const [reverseKey, setReverseKey] = useState(newIdempotencyKey());

  const invalidate = () => utils.employeeExpenses.getClaimDetail.invalidate({ id: claim.id });

  const approveMutation = trpc.employeeExpenses.approveClaim.useMutation({
    onSuccess: async () => {
      message.success('Expense claim approved.');
      setApproveOpen(false);
      setApproveKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const rejectMutation = trpc.employeeExpenses.rejectClaim.useMutation({
    onSuccess: async () => {
      message.success('Expense claim rejected.');
      setRejectOpen(false);
      setRejectKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const cancelMutation = trpc.employeeExpenses.cancelClaim.useMutation({
    onSuccess: async () => {
      message.success('Expense claim cancelled.');
      setCancelOpen(false);
      setCancelKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const reimburseMutation = trpc.employeeExpenses.reimburseClaim.useMutation({
    onSuccess: async () => {
      message.success('Expense claim reimbursed.');
      setReimburseOpen(false);
      setReimburseKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const reverseMutation = trpc.employeeExpenses.reverseReimbursement.useMutation({
    onSuccess: async () => {
      message.success('Reimbursement reversed.');
      setReverseOpen(false);
      setReverseKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const listedHere = mayDecide(claim, me.data?.userId);
  const showApprove = claim.status === 'SUBMITTED' && canApprove && listedHere && (!isOwnClaim || canSelfApprove);

  return (
    <>
      <UiCard
        title={claim.title}
        actions={
          <div className="flex gap-2">
            {showApprove ? (
              <Button size="small" type="primary" onClick={() => setApproveOpen(true)}>
                {isOwnClaim ? 'Approve (Self)…' : 'Approve…'}
              </Button>
            ) : null}
            {claim.status === 'SUBMITTED' && canApprove && listedHere ? (
              <Button size="small" danger onClick={() => setRejectOpen(true)}>
                Reject…
              </Button>
            ) : null}
            {claim.status === 'SUBMITTED' && canCancel ? (
              <Button size="small" onClick={() => setCancelOpen(true)}>
                Cancel…
              </Button>
            ) : null}
            {claim.status === 'APPROVED' && canReimburse ? (
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  setReimburseDate(new Date().toISOString().slice(0, 10));
                  setReimburseOpen(true);
                }}
              >
                Reimburse…
              </Button>
            ) : null}
            {claim.status === 'REIMBURSED' && canReverse ? (
              <Button
                size="small"
                danger
                onClick={() => {
                  setReverseAccountingDate(new Date().toISOString().slice(0, 10));
                  setReverseOpen(true);
                }}
              >
                Reverse Reimbursement…
              </Button>
            ) : null}
            <Button size="small" onClick={() => router.push('/employee-expenses')}>
              Back to list
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Details</p>
            <div className="text-[12px] text-muted">Employee: {claim.employeeName}</div>
            <div className="text-[12px] text-muted">Category: {claim.expenseCategoryName}</div>
            <div className="text-[12px] text-muted">Project: {claim.projectName ?? 'Company overhead'}</div>
            <div className="text-[12px] text-muted">Expense date: {formatDate(claim.expenseDate)}</div>
            {claim.note ? <div className="text-[12px] text-muted">Note: {claim.note}</div> : null}
            <div className="mt-2">
              <ClaimApprovalLine claim={claim} />
            </div>
          </div>
          <div>
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Amount</p>
            <div className="text-[12px] text-muted">Amount: {formatMoney(claim.amount)}</div>
            <div className="text-[12px] text-muted">GST invoice available: {claim.gstInvoiceAvailable ? 'Yes' : 'No'}</div>
            {Number(claim.gstCreditAmount) > 0 ? <div className="text-[12px] text-muted">GST credit: {formatMoney(claim.gstCreditAmount)}</div> : null}
            <div className="text-[12px] text-muted">Submitted: {claim.submittedAt ? formatDate(claim.submittedAt) : '—'}</div>
            {claim.status === 'REIMBURSED' ? <div className="text-[12px] text-muted">Reimbursed: {claim.reimbursedAt ? formatDate(claim.reimbursedAt) : '—'}</div> : null}
          </div>
        </div>

        {claim.status === 'CANCELLED' ? (
          <div className="mt-4 rounded-ui border border-ui bg-ui-2 p-3 text-[12.5px] text-muted">
            <b>Cancelled.</b> Reason: {claim.cancelledReason ?? '—'} — {claim.cancelledAt ? formatDate(claim.cancelledAt) : '—'}
          </div>
        ) : null}
        {claim.reimbursementReversalJournalEntryId ? (
          <div className="mt-4 rounded-ui border border-ui bg-negative-soft p-3 text-[12.5px] text-negative">
            <b>A prior reimbursement was reversed.</b> Reason: {claim.reimbursementReversalReason ?? '—'}
          </div>
        ) : null}

        {claim.decisions.length > 0 ? (
          <div className="mt-4">
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Approval History</p>
            <div className="flex flex-col divide-y divide-ui">
              {claim.decisions.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12.5px]">
                  <div>
                    <span className={d.decision === 'APPROVED' ? 'font-medium text-positive' : 'font-medium text-negative'}>{d.decision === 'APPROVED' ? 'Approved' : 'Rejected'}</span>
                    {d.actorName ? <span className="ml-1 text-muted">by {d.actorName}</span> : null}
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

      <UiCard title="Documents" className="mt-4">
        <DocumentsTab entityType="EMPLOYEE_EXPENSE_CLAIM" entityId={claim.id} />
      </UiCard>

      <Modal
        title={isOwnClaim ? 'Approve Your Own Claim' : 'Approve Expense Claim'}
        open={approveOpen}
        onCancel={() => setApproveOpen(false)}
        onOk={() => approveMutation.mutate({ id: claim.id, expectedVersion: claim.version, note: approveNote.trim() || undefined, idempotencyKey: approveKey })}
        confirmLoading={approveMutation.isPending}
        okButtonProps={{ disabled: isOwnClaim && !approveNote.trim() }}
        okText="Approve"
      >
        {isOwnClaim ? (
          <>
            <p className="mb-2 text-negative">You are approving your own expense claim. A justification note is required.</p>
            <Input.TextArea rows={3} value={approveNote} onChange={(e) => setApproveNote(e.target.value)} placeholder="Why are you approving your own claim?" />
          </>
        ) : (
          <p className="text-muted">This posts the expense against {claim.employeeName}&apos;s own wallet.</p>
        )}
      </Modal>

      <Modal
        title="Reject Expense Claim"
        open={rejectOpen}
        onCancel={() => setRejectOpen(false)}
        onOk={() => rejectMutation.mutate({ id: claim.id, expectedVersion: claim.version, reason: rejectReason, idempotencyKey: rejectKey })}
        confirmLoading={rejectMutation.isPending}
        okButtonProps={{ disabled: !rejectReason.trim() }}
        okText="Reject"
      >
        <p className="mb-2 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
      </Modal>

      <Modal
        title="Cancel Expense Claim"
        open={cancelOpen}
        onCancel={() => setCancelOpen(false)}
        onOk={() => cancelMutation.mutate({ id: claim.id, expectedVersion: claim.version, reason: cancelReason, idempotencyKey: cancelKey })}
        confirmLoading={cancelMutation.isPending}
        okButtonProps={{ disabled: !cancelReason.trim() }}
        okText="Cancel Claim"
      >
        <p className="mb-2 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
      </Modal>

      <Modal
        title="Reimburse Expense Claim"
        open={reimburseOpen}
        onCancel={() => setReimburseOpen(false)}
        onOk={() =>
          reimburseBankAccountId &&
          reimburseMutation.mutate({ id: claim.id, expectedVersion: claim.version, bankAccountId: reimburseBankAccountId, reimbursementDate: reimburseDate, idempotencyKey: reimburseKey })
        }
        confirmLoading={reimburseMutation.isPending}
        okButtonProps={{ disabled: !reimburseBankAccountId || !reimburseDate }}
        okText="Reimburse"
      >
        <p className="mb-2 text-muted">
          Pay {formatMoney(claim.amount)} to {claim.employeeName}.
        </p>
        <label className="mb-3 flex flex-col gap-[3px]">
          <span className="text-[12.5px] font-semibold text-text">Bank account</span>
          <BankAccountSelect value={reimburseBankAccountId} onChange={setReimburseBankAccountId} legalEntityId={claim.legalEntityId} />
        </label>
        <label className="flex flex-col gap-[3px]">
          <span className="text-[12.5px] font-semibold text-text">Reimbursement date</span>
          <DateInput value={reimburseDate} onChange={setReimburseDate} />
        </label>
      </Modal>

      <Modal
        title="Reverse Reimbursement"
        open={reverseOpen}
        onCancel={() => setReverseOpen(false)}
        onOk={() =>
          reverseMutation.mutate({ id: claim.id, expectedVersion: claim.version, reason: reverseReason, accountingDate: reverseAccountingDate, idempotencyKey: reverseKey })
        }
        confirmLoading={reverseMutation.isPending}
        okButtonProps={{ disabled: !reverseReason.trim() || !reverseAccountingDate }}
        okText="Reverse Reimbursement"
      >
        <p className="mb-2 text-muted">This reverses the reimbursement journal and returns the claim to Approved, ready to be reimbursed again.</p>
        <p className="mb-2 text-muted">Reversal accounting date</p>
        <DateInput value={reverseAccountingDate} onChange={setReverseAccountingDate} />
        <p className="mb-2 mt-3 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
      </Modal>
    </>
  );
}

export default function EmployeeExpenseClaimDetailPage() {
  const params = useParams();
  const id = String(params.id ?? '');

  const detail = trpc.employeeExpenses.getClaimDetail.useQuery({ id }, { enabled: !!id });

  if (detail.isError) return <PageHeader title="Expense Claim" description="Could not load this expense claim." />;
  if (detail.isLoading || !detail.data) return <PageHeader title="Expense Claim" description="Loading…" />;

  const claim = detail.data as EmployeeExpenseClaimDetailData;

  return (
    <>
      <PageHeader title={claim.title} description={`${claim.employeeName} · ${claim.expenseCategoryName}`} actions={<EmployeeExpenseClaimStatusTag status={claim.status} />} />
      {claim.status === 'DRAFT' ? <DraftEditor claim={claim} /> : <DecidedView claim={claim} />}
    </>
  );
}
