'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Form, Input, Select } from 'antd';
import { MoneyInput, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { LegalEntitySelect } from '@/components/legal-entity-select';
import { EmployeeSelect } from '@/components/employee-select';
import { ProjectSelect } from '@/components/project-select';
import { BankAccountSelect } from '@/components/bank-account-select';
import { formatMoney } from '@/lib/format';
import { newIdempotencyKey } from '../shared';
import { DateInput } from '@/components/date-input';

interface FormValues {
  employeeId: string;
  projectId?: string;
  legalEntityId?: string;
  amount: string;
  advanceDate: string;
  paymentModeId: string;
  bankAccountId: string;
  utrReference?: string;
  purpose?: string;
  note?: string;
}

export default function GiveAdvancePage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();

  const employees = trpc.employees.list.useQuery({ includeInactive: false });
  const reimbursableEmployees = (employees.data ?? []).filter((e) => e.isReimbursable);
  const paymentModes = trpc.documentSupport.listPaymentModes.useQuery({ includeInactive: false });

  const employeeId = Form.useWatch('employeeId', form);
  const amount = Form.useWatch('amount', form);
  const selectedEmployee = reimbursableEmployees.find((e) => e.id === employeeId);

  // The legal entity comes first: it narrows the employees, projects and bank accounts (ADR-183).
  const legalEntityId = Form.useWatch('legalEntityId', form);

  const walletImpact = trpc.employeeExpenses.calculateAdvanceWalletImpact.useQuery(
    { employeeId: employeeId ?? '', amount: amount || '0' },
    { enabled: !!employeeId },
  );

  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey());
  const issueMutation = trpc.employeeExpenses.issueAdvance.useMutation({
    onSuccess: () => {
      message.success('Advance issued.');
      router.push('/employee-expenses');
    },
    onError: (error) => {
      message.error(error.message);
      setIdempotencyKey(newIdempotencyKey());
    },
  });

  const submit = (values: FormValues) => {
    issueMutation.mutate({
      employeeId: values.employeeId,
      projectId: values.projectId || undefined,
      legalEntityId: values.legalEntityId,
      amount: values.amount,
      advanceDate: values.advanceDate,
      paymentModeId: values.paymentModeId,
      bankAccountId: values.bankAccountId,
      utrReference: values.utrReference?.trim() || undefined,
      purpose: values.purpose?.trim() || undefined,
      note: values.note?.trim() || undefined,
      idempotencyKey,
    });
  };

  return (
    <>
      <PageHeader
        title="Give Advance"
        description="Hand a cash advance to an employee. It credits their wallet — future expense claims draw it down first."
        actions={
          <Button onClick={() => router.push('/employee-expenses')}>
            Back to Employee Expenses
          </Button>
        }
      />

      <UiCard>
        <Form<FormValues> form={form} layout="vertical" onFinish={submit}>
          <p className="mb-2 mt-1 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">
            Advance Details
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Form.Item
              label="Legal entity"
              name="legalEntityId"
              rules={[{ required: true, message: 'Legal entity is required.' }]}
            >
              <LegalEntitySelect
                onUserChange={() => form.resetFields(['employeeId', 'projectId', 'bankAccountId'])}
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

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Form.Item
              label="Amount"
              name="amount"
              rules={[{ required: true, message: 'Amount is required.' }]}
            >
              <MoneyInput placeholder="0.00" />
            </Form.Item>
            <Form.Item
              label="Date given"
              name="advanceDate"
              rules={[{ required: true, message: 'Date is required.' }]}
            >
              <DateInput />
            </Form.Item>
            <Form.Item label="Project (optional)" name="projectId">
              <ProjectSelect
                legalEntityId={legalEntityId}
                allowClear
                placeholder="None / general"
                disabled={!legalEntityId}
              />
            </Form.Item>
            <Form.Item
              label="Payment mode"
              name="paymentModeId"
              rules={[{ required: true, message: 'Payment mode is required.' }]}
            >
              <Select
                loading={paymentModes.isLoading}
                options={(paymentModes.data ?? []).map((m) => ({ value: m.id, label: m.label }))}
                placeholder="Select mode…"
              />
            </Form.Item>
            <Form.Item
              label="Bank account"
              name="bankAccountId"
              rules={[{ required: true, message: 'Bank account is required.' }]}
            >
              <BankAccountSelect
                legalEntityId={legalEntityId}
                placeholder={legalEntityId ? 'Select account…' : 'Choose the legal entity first'}
              />
            </Form.Item>
            <Form.Item label="UTR / Reference" name="utrReference">
              <Input placeholder="Optional for cash" />
            </Form.Item>
            <Form.Item label="Purpose" name="purpose">
              <Input placeholder="e.g. General field expenses" />
            </Form.Item>
          </div>
          <Form.Item label="Note" name="note">
            <Input.TextArea rows={2} placeholder="Optional — what the advance is for" />
          </Form.Item>

          {employeeId && walletImpact.data ? (
            <div className="mt-2 rounded-ui border border-dashed border-ui bg-paper p-4">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[.05em] text-brand">
                Wallet impact — {selectedEmployee?.fullName}
              </p>
              <div className="flex justify-between py-1 text-[13px]">
                <span className="text-muted">Current balance</span>
                <span className="font-mono font-semibold text-ink">
                  {formatMoney(walletImpact.data.currentBalance)}
                </span>
              </div>
              <div className="flex justify-between py-1 text-[13px]">
                <span className="text-muted">+ This advance</span>
                <span className="font-mono font-semibold text-ink">
                  {formatMoney(amount || '0')}
                </span>
              </div>
              <div className="mt-1 flex justify-between border-t border-ui-2 pt-2 text-[13px] font-semibold">
                <span>New balance</span>
                <span className="font-mono text-ink">
                  {formatMoney(walletImpact.data.newBalance)}
                </span>
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Button type="primary" htmlType="submit" loading={issueMutation.isPending}>
              Give Advance
            </Button>
            <Button onClick={() => router.push('/employee-expenses')}>Cancel</Button>
          </div>
        </Form>
      </UiCard>
    </>
  );
}
