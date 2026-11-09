'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Form, Input, Segmented } from 'antd';
import { MoneyInput, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';
import { MasterSelect } from '@/components/master-select';
import { LegalEntitySelect } from '@/components/legal-entity-select';
import { EmployeeSelect } from '@/components/employee-select';
import { ProjectSelect } from '@/components/project-select';
import { newIdempotencyKey } from '../shared';
import { DateInput } from '@/components/date-input';

interface FormValues {
  employeeId: string;
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

export default function NewExpenseClaimForEmployeePage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const formDraft = useFormDraft('expense-claim:for-employee:new');
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef(false);
  useEffect(() => {
    if (appliedDraft.current || formDraft.isLoading || !formDraft.payload) return;
    appliedDraft.current = true;
    form.setFieldsValue(formDraft.payload as Partial<FormValues>);
  }, [form, formDraft.isLoading, formDraft.payload]);

  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canCreateForOthers = permissions.includes('employee_claim.approve');

  // The legal entity comes first: it narrows the employees and projects (ADR-183).
  const legalEntityId = Form.useWatch('legalEntityId', form);
  const gstInvoiceAvailable = Form.useWatch('gstInvoiceAvailable', form);

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
        employeeId: values.employeeId,
        expenseCategoryId: values.expenseCategoryId,
        title: values.title,
        projectId: values.projectId || undefined,
        legalEntityId: values.legalEntityId,
        amount: values.amount,
        expenseDate: values.expenseDate,
        gstInvoiceAvailable: !!values.gstInvoiceAvailable,
        gstCreditAmount: values.gstInvoiceAvailable ? values.gstCreditAmount : undefined,
        note: values.note?.trim() || undefined,
        idempotencyKey: createKey,
      });
      if (pendingActionRef.current === 'draft') {
        message.success('Draft saved.');
        clearDraft.mutate({ formKey: 'expense-claim:for-employee:new' });
        router.push(`/employee-expenses/claims/${draft.id}`);
        return;
      }
      const submitted = await submitMutation.mutateAsync({
        id: draft.id,
        expectedVersion: draft.version,
        idempotencyKey: submitKey,
      });
      message.success('Expense claim submitted for approval.');
      clearDraft.mutate({ formKey: 'expense-claim:for-employee:new' });
      router.push(`/employee-expenses/claims/${submitted.id}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not save this expense claim.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!canCreateForOthers) {
    return (
      <PageHeader
        title="Add Expense"
        description="You do not have permission to create an expense claim on behalf of another employee."
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Add Expense"
        description="Record an expense claim on behalf of an employee — for staff who don't have a CRM login of their own."
        actions={
          <Button onClick={() => router.push('/employee-expenses')}>
            Back to Employee Reimbursements
          </Button>
        }
      />

      <UiCard>
        <Form<FormValues>
          id="expense-claim-for-employee-form"
          form={form}
          layout="vertical"
          onFinish={handleFinish}
          initialValues={{ gstInvoiceAvailable: false }}
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Form.Item
              label="Legal entity"
              name="legalEntityId"
              rules={[{ required: true, message: 'Legal entity is required.' }]}
            >
              <LegalEntitySelect
                onUserChange={() => form.resetFields(['employeeId', 'projectId'])}
              />
            </Form.Item>
            <Form.Item
              label="Employee"
              name="employeeId"
              rules={[{ required: true, message: 'Employee is required.' }]}
              extra="Reimbursement-eligible employees of this legal entity."
            >
              <EmployeeSelect
                reimbursableOnly
                legalEntityId={legalEntityId}
                placeholder={legalEntityId ? 'Select employee…' : 'Choose the legal entity first'}
                disabled={!legalEntityId}
              />
            </Form.Item>
          </div>

          <p className="mb-2 mt-1 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">
            Expense Details
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Form.Item
              label="Category"
              name="expenseCategoryId"
              rules={[{ required: true, message: 'Category is required.' }]}
            >
              <MasterSelect type="expense_categories" placeholder="Select category…" />
            </Form.Item>
            <Form.Item
              label="Title"
              name="title"
              rules={[{ required: true, message: 'Title is required.' }]}
            >
              <Input placeholder="e.g. Site visit travel — Gandhinagar" />
            </Form.Item>
            <Form.Item label="Project (optional)" name="projectId">
              <ProjectSelect
                legalEntityId={legalEntityId}
                allowClear
                placeholder="None / company overhead"
                disabled={!legalEntityId}
              />
            </Form.Item>
            <Form.Item
              label="Amount"
              name="amount"
              rules={[{ required: true, message: 'Amount is required.' }]}
            >
              <MoneyInput placeholder="0.00" />
            </Form.Item>
            <Form.Item
              label="Expense date"
              name="expenseDate"
              rules={[{ required: true, message: 'Expense date is required.' }]}
            >
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
              <Form.Item
                label="GST credit"
                name="gstCreditAmount"
                extra="Input tax credit claimable on this expense."
              >
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
            onClick={() =>
              formDraft.save(form.getFieldsValue(true) as unknown as Record<string, unknown>)
            }
          >
            Save as draft
          </Button>
          <Button
            type="primary"
            htmlType="submit"
            form="expense-claim-for-employee-form"
            loading={submitting}
            onClick={() => (pendingActionRef.current = 'submit')}
          >
            Submit for Approval
          </Button>
          <Button onClick={() => router.push('/employee-expenses')}>Cancel</Button>
        </div>
      </UiCard>
    </>
  );
}
