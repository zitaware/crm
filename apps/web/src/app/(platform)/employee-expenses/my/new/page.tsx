'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Form, Input, Segmented } from 'antd';
import { MoneyInput, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';
import { MasterSelect } from '@/components/master-select';
import { ProjectSelect } from '@/components/project-select';
import { LegalEntitySelect } from '@/components/legal-entity-select';
import { newIdempotencyKey } from '../../shared';
import { NoOwnWallet } from '../../no-own-wallet';
import { DateInput } from '@/components/date-input';

interface FormValues {
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

export default function NewExpenseClaimPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const formDraft = useFormDraft('expense-claim:mine:new');
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef(false);
  useEffect(() => {
    if (appliedDraft.current || formDraft.isLoading || !formDraft.payload) return;
    appliedDraft.current = true;
    form.setFieldsValue(formDraft.payload as Partial<FormValues>);
  }, [form, formDraft.isLoading, formDraft.payload]);

  const status = trpc.employeeExpenses.getMyEmployeeStatus.useQuery();
  const legalEntities = trpc.legalEntities.list.useQuery({ includeInactive: false });

  const projectId = Form.useWatch('projectId', form);
  const gstInvoiceAvailable = Form.useWatch('gstInvoiceAvailable', form);
  const showLegalEntityPicker = !projectId && (legalEntities.data?.length ?? 0) > 1;

  const [createKey] = useState(newIdempotencyKey());
  const [submitKey] = useState(newIdempotencyKey());
  const createMutation = trpc.employeeExpenses.createClaimDraft.useMutation();
  const submitMutation = trpc.employeeExpenses.submitClaim.useMutation();
  const [submitting, setSubmitting] = useState(false);

  const pendingActionRef = useRef<'draft' | 'submit'>('draft');

  const handleFinish = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const draft = await createMutation.mutateAsync({
        expenseCategoryId: values.expenseCategoryId,
        title: values.title,
        projectId: values.projectId || undefined,
        legalEntityId: values.projectId ? undefined : values.legalEntityId,
        amount: values.amount,
        expenseDate: values.expenseDate,
        gstInvoiceAvailable: !!values.gstInvoiceAvailable,
        gstCreditAmount: values.gstInvoiceAvailable ? values.gstCreditAmount : undefined,
        note: values.note?.trim() || undefined,
        idempotencyKey: createKey,
      });
      if (pendingActionRef.current === 'draft') {
        message.success('Draft saved.');
        clearDraft.mutate({ formKey: 'expense-claim:mine:new' });
        router.push(`/employee-expenses/claims/${draft.id}`);
        return;
      }
      const submitted = await submitMutation.mutateAsync({ id: draft.id, expectedVersion: draft.version, idempotencyKey: submitKey });
      message.success('Expense claim submitted for approval.');
      clearDraft.mutate({ formKey: 'expense-claim:mine:new' });
      router.push(`/employee-expenses/claims/${submitted.id}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not save this expense claim.');
    } finally {
      setSubmitting(false);
    }
  };

  if (status.isLoading) return <PageHeader title="Add Expense" description="Loading…" />;
  if (!status.data || !status.data.hasEmployee) {
    return <NoOwnWallet title="Add Expense" />;
  }
  if (!status.data.isReimbursable) {
    return <PageHeader title="Add Expense" description="You are not marked as reimbursement-eligible — contact an administrator if this is unexpected." />;
  }

  return (
    <>
      <PageHeader
        title="Add Expense"
        description="Record a general expense. Link it to a project, or leave it as company overhead."
        actions={<Button onClick={() => router.push('/employee-expenses/my')}>Back to My Expenses</Button>}
      />

      <UiCard>
        <Form<FormValues> id="expense-claim-form" form={form} layout="vertical" onFinish={handleFinish} initialValues={{ gstInvoiceAvailable: false }}>
          <p className="mb-2 mt-1 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Expense Details</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Form.Item label="Category" name="expenseCategoryId" rules={[{ required: true, message: 'Category is required.' }]}>
              <MasterSelect type="expense_categories" placeholder="Select category…" />
            </Form.Item>
            <Form.Item label="Title" name="title" rules={[{ required: true, message: 'Title is required.' }]}>
              <Input placeholder="e.g. Site visit travel — Gandhinagar" />
            </Form.Item>
            <Form.Item label="Project (optional)" name="projectId">
              <ProjectSelect allowClear placeholder="None / company overhead" />
            </Form.Item>
            {showLegalEntityPicker ? (
              <Form.Item label="Legal entity" name="legalEntityId" rules={[{ required: !projectId, message: 'Legal entity is required when no project is selected.' }]}>
                <LegalEntitySelect />
              </Form.Item>
            ) : !projectId ? (
              <Form.Item name="legalEntityId" hidden initialValue={legalEntities.data?.[0]?.id}>
                <Input />
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
              <Form.Item label="GST credit" name="gstCreditAmount" extra="Input tax credit claimable on this expense.">
                <MoneyInput placeholder="0.00" />
              </Form.Item>
            ) : null}
          </div>

          <Form.Item label="Note" name="note">
            <Input.TextArea rows={2} placeholder="Optional" />
          </Form.Item>
        </Form>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ui-2 pt-4">
          {formDraft.payload ? <DraftFormNote saveLabel="Save" /> : null}
          <Button
            htmlType="button"
            loading={formDraft.saving || submitting}
            onClick={() => formDraft.save(form.getFieldsValue(true) as unknown as Record<string, unknown>)}
          >
            Save as draft
          </Button>
          <Button type="primary" htmlType="submit" form="expense-claim-form" loading={submitting} onClick={() => (pendingActionRef.current = 'submit')}>
            Submit for Approval
          </Button>
          <Button onClick={() => router.push('/employee-expenses/my')}>Cancel</Button>
        </div>
      </UiCard>

      <UiCard title="My Pending Expenses" className="mt-4">
        <PendingExpensesTable />
      </UiCard>
    </>
  );
}

function PendingExpensesTable() {
  const router = useRouter();
  const myClaims = trpc.employeeExpenses.getMyClaims.useQuery();
  const pending = (myClaims.data ?? []).filter((c) => c.status === 'DRAFT' || c.status === 'SUBMITTED');

  if (pending.length === 0) return <p className="text-[12.5px] text-muted">Submitted and awaiting approval — none yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-ui text-left text-muted">
            <th className="py-2 pr-3">Title</th>
            <th className="py-2 pr-3">Category</th>
            <th className="py-2 pr-3 text-right">Amount</th>
            <th className="py-2 pr-3"></th>
          </tr>
        </thead>
        <tbody>
          {pending.map((claim) => (
            <tr key={claim.id} className="border-b border-ui-2">
              <td className="py-2 pr-3">{claim.title}</td>
              <td className="py-2 pr-3">{claim.expenseCategoryName}</td>
              <td className="py-2 pr-3 text-right">{claim.amount}</td>
              <td className="py-2 pr-3 text-right">
                <Button size="small" onClick={() => router.push(`/employee-expenses/claims/${claim.id}`)}>
                  View
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
