'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, App, Button, Form, Input, Segmented, Select, Upload } from 'antd';
import { MoneyInput, UiCard } from '@zitaware/ui';
import type { ServerSubscriptionEntryInput } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { LegalEntitySelect } from '@/components/legal-entity-select';
import { EmployeeSelect } from '@/components/employee-select';
import { ProjectSelect } from '@/components/project-select';
import { BankAccountSelect } from '@/components/bank-account-select';
import { CardAccountSelect } from '@/components/card-account-select';
import { MasterSelect } from '@/components/master-select';
import { DateInput } from '@/components/date-input';
import { formatDate, formatMoney } from '@/lib/format';
import { useUploadAndLink } from '@/lib/upload-document';
import { newIdempotencyKey, type DirectExpenseRow } from '../direct-expenses/shared';

type Values = Omit<ServerSubscriptionEntryInput, 'gstAmount'> & {
  gstAmount?: string;
  reason?: string;
  reversalDate?: string;
};

const DEFAULT_CATEGORY: Record<'SERVER' | 'SUBSCRIPTION', string> = {
  SERVER: 'Hosting / Cloud / Infra',
  SUBSCRIPTION: 'Software Licenses',
};

/** The bill as it was entered, so a correction starts from it. */
function valuesOf(row: DirectExpenseRow): Values {
  return {
    spendType: row.spendType ?? 'SUBSCRIPTION',
    title: row.title,
    employeeId: row.purchasedByEmployeeId ?? '',
    legalEntityId: row.legalEntityId,
    ...(row.projectId ? { projectId: row.projectId } : {}),
    expenseCategoryId: row.expenseCategoryId,
    expenseDate: row.expenseDate,
    basicAmount: row.taxableAmount,
    gstAmount: row.gstAmount,
    ...(row.supplyType ? { supplyType: row.supplyType } : {}),
    paymentModeId: row.paymentModeId,
    ...(row.cardAccountId ? { cardAccountId: row.cardAccountId } : {}),
    ...(row.bankAccountId && !row.cardAccountId ? { bankAccountId: row.bankAccountId } : {}),
    ...(row.transactionReference ? { transactionReference: row.transactionReference } : {}),
    ...(row.note ? { note: row.note } : {}),
    ...(row.billUrl ? { billUrl: row.billUrl } : {}),
    reversalDate: row.expenseDate,
  };
}

/**
 * Add a server or subscription bill, or correct a posted one (ADR-169), on
 * its own page. The fields are the sheet's columns. A correction never edits
 * the bill: the API reverses it and posts the corrected one. A bill file
 * chosen here is uploaded and linked once the bill is posted.
 */
export function EntryForm({ correcting }: { correcting: DirectExpenseRow | null }) {
  const router = useRouter();
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const [form] = Form.useForm<Values>();
  const [key] = useState(newIdempotencyKey);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadAndLink = useUploadAndLink();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canAttach =
    permissions.includes('document.upload') && permissions.includes('document.manage');

  const paymentModes = trpc.documentSupport.listPaymentModes.useQuery({ includeInactive: false });
  // The same list the card picker loads, only to say when this legal entity has no card of the type.
  const cardAccounts = trpc.legalEntities.listCardAccounts.useQuery({ includeInactive: true });

  const legalEntityId = Form.useWatch('legalEntityId', form);
  const paymentModeId = Form.useWatch('paymentModeId', form);
  const spendType = Form.useWatch('spendType', form);
  const gstAmount = Form.useWatch('gstAmount', form);
  const mode = (paymentModes.data ?? []).find((m) => m.id === paymentModeId);
  const hasGst = !!gstAmount && Number(gstAmount) > 0;

  const cardType =
    mode?.code === 'DEBIT_CARD' ? 'DEBIT_CARD' : mode?.code === 'CREDIT_CARD' ? 'CREDIT_CARD' : undefined;
  const cardCount = (cardAccounts.data ?? []).filter(
    (c) => c.isActive && c.legalEntityId === legalEntityId && c.type === mode?.code,
  ).length;

  /** The bill is posted by now; a file that fails to upload is said plainly and can be added on the bill's page. */
  const done = async (saved: { id: string }, text: string) => {
    if (file) {
      setUploading(true);
      try {
        await uploadAndLink(file, 'DIRECT_EXPENSE', saved.id);
      } catch (error) {
        message.warning(
          `${text} The bill file did not upload (${error instanceof Error ? error.message : 'unknown error'}); add it under Files on the bill.`,
        );
        setUploading(false);
        router.push(`/servers-subscriptions/${saved.id}`);
        return;
      }
      setUploading(false);
    }
    message.success(text);
    await utils.directExpenses.list.invalidate();
    router.push(`/servers-subscriptions/${saved.id}`);
  };
  const create = trpc.directExpenses.createEntry.useMutation({
    onSuccess: (saved) => done(saved, 'Bill posted.'),
    onError: (e) => message.error(e.message),
  });
  const correct = trpc.directExpenses.correctEntry.useMutation({
    onSuccess: (saved) =>
      done(saved, 'Bill corrected: the old one is reversed and the corrected one posted.'),
    onError: (e) => message.error(e.message),
  });
  const saving = create.isPending || correct.isPending || uploading;
  const cancel = () =>
    router.push(correcting ? `/servers-subscriptions/${correcting.id}` : '/servers-subscriptions');

  const submit = (v: Values) => {
    const entry: ServerSubscriptionEntryInput = {
      spendType: v.spendType,
      title: v.title,
      employeeId: v.employeeId,
      legalEntityId: v.legalEntityId,
      projectId: v.projectId || undefined,
      expenseCategoryId: v.expenseCategoryId || undefined,
      expenseDate: v.expenseDate,
      basicAmount: v.basicAmount,
      gstAmount: v.gstAmount || undefined,
      supplyType: hasGst ? v.supplyType : undefined,
      paymentModeId: v.paymentModeId,
      cardAccountId: mode?.requiresCardSource ? v.cardAccountId : undefined,
      bankAccountId: mode?.requiresCardSource ? undefined : v.bankAccountId,
      transactionReference: v.transactionReference?.trim() || undefined,
      note: v.note?.trim() || undefined,
      billUrl: v.billUrl?.trim() || undefined,
    };
    if (correcting) {
      correct.mutate({
        id: correcting.id,
        expectedVersion: correcting.version,
        reason: v.reason ?? '',
        reversalDate: v.reversalDate ?? correcting.expenseDate,
        entry,
        idempotencyKey: key,
      });
    } else {
      create.mutate({ entry, idempotencyKey: key });
    }
  };

  return (
    <UiCard>
      {correcting ? (
        <Alert
          type="info"
          showIcon
          className="mb-4"
          message={`A posted bill is not edited. Saving reverses "${correcting.title}" (${formatMoney(correcting.amount)}, ${formatDate(correcting.expenseDate)}) and posts the corrected bill. Both stay in the history.`}
        />
      ) : null}
      <Form<Values>
        form={form}
        layout="vertical"
        requiredMark
        onFinish={submit}
        initialValues={
          correcting
            ? valuesOf(correcting)
            : { spendType: 'SUBSCRIPTION', supplyType: 'INTERSTATE' }
        }
      >
        <div className="grid grid-cols-1 gap-x-4 md:grid-cols-[auto_1fr]">
          <Form.Item label="Server / Subscription" name="spendType" rules={[{ required: true }]}>
            <Segmented
              options={[
                { value: 'SUBSCRIPTION', label: 'Subscription' },
                { value: 'SERVER', label: 'Server' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="Name"
            name="title"
            rules={[
              { required: true, whitespace: true, message: 'Name is required.' },
              { max: 300 },
            ]}
          >
            <Input placeholder="e.g. Cursor, AWS Mumbai, Digital signature renewal" />
          </Form.Item>
        </div>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 xl:grid-cols-4">
          <Form.Item
            label="Legal entity"
            name="legalEntityId"
            rules={[{ required: true, message: 'Legal entity is required.' }]}
          >
            <LegalEntitySelect
              placeholder="Company that paid"
              onUserChange={() => form.resetFields(['employeeId', 'projectId', 'cardAccountId', 'bankAccountId'])}
            />
          </Form.Item>
          <Form.Item
            label="Employee"
            name="employeeId"
            rules={[{ required: true, message: 'Employee is required.' }]}
          >
            <EmployeeSelect
              legalEntityId={legalEntityId}
              placeholder={legalEntityId ? 'Who paid or uses it' : 'Choose the legal entity first'}
              disabled={!legalEntityId}
            />
          </Form.Item>
          <Form.Item
            label="Date"
            name="expenseDate"
            rules={[{ required: true, message: 'Date is required.' }]}
          >
            <DateInput />
          </Form.Item>
          <Form.Item label="Project (optional)" name="projectId" extra="Blank is company overhead.">
            <ProjectSelect legalEntityId={legalEntityId} allowClear placeholder="Company overhead" />
          </Form.Item>
        </div>

        <p className="mb-2 mt-1 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">
          Amount in rupees, as on the bill
        </p>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 xl:grid-cols-4">
          <Form.Item
            label="Basic amount"
            name="basicAmount"
            rules={[{ required: true, message: 'Basic amount is required.' }]}
          >
            <MoneyInput placeholder="0.00" />
          </Form.Item>
          <Form.Item label="GST amount" name="gstAmount">
            <MoneyInput placeholder="0.00" />
          </Form.Item>
          {hasGst ? (
            <Form.Item
              label="GST type"
              name="supplyType"
              rules={[{ required: true, message: 'Choose the GST type.' }]}
            >
              <Segmented
                options={[
                  { value: 'INTERSTATE', label: 'IGST' },
                  { value: 'INTRASTATE', label: 'CGST + SGST' },
                ]}
              />
            </Form.Item>
          ) : null}
        </div>

        <p className="mb-2 mt-1 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">
          Paid by
        </p>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 xl:grid-cols-4">
          <Form.Item
            label="Payment mode"
            name="paymentModeId"
            rules={[{ required: true, message: 'Payment mode is required.' }]}
          >
            <Select
              placeholder="Select…"
              loading={paymentModes.isLoading}
              onChange={() =>
                form.setFieldsValue({ cardAccountId: undefined, bankAccountId: undefined })
              }
              options={(paymentModes.data ?? []).map((m) => ({ value: m.id, label: m.label }))}
            />
          </Form.Item>
          {mode?.requiresCardSource ? (
            <Form.Item
              label={mode.code === 'DEBIT_CARD' ? 'Debit card' : 'Credit card'}
              name="cardAccountId"
              rules={[{ required: true, message: 'Card is required.' }]}
              extra={
                legalEntityId && cardAccounts.data && cardCount === 0
                  ? 'No card of this type for this legal entity in Card Accounts.'
                  : undefined
              }
            >
              <CardAccountSelect
                legalEntityId={legalEntityId}
                cardType={cardType}
                disabled={!legalEntityId}
                placeholder={legalEntityId ? 'Select card…' : 'Choose the legal entity first'}
              />
            </Form.Item>
          ) : (
            <Form.Item
              label="Bank account"
              name="bankAccountId"
              rules={[{ required: true, message: 'Bank account is required.' }]}
            >
              <BankAccountSelect
                legalEntityId={legalEntityId}
                disabled={!legalEntityId}
                placeholder={legalEntityId ? 'Select account…' : 'Choose the legal entity first'}
              />
            </Form.Item>
          )}
          <Form.Item label="Reference (optional)" name="transactionReference">
            <Input placeholder="Transaction / invoice no." />
          </Form.Item>
          <Form.Item label="Expense category (optional)" name="expenseCategoryId">
            <MasterSelect
              type="expense_categories"
              allowClear
              placeholder={`Default: ${DEFAULT_CATEGORY[spendType ?? 'SUBSCRIPTION']}`}
            />
          </Form.Item>
        </div>
        <p className="mb-2 mt-1 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">
          Bill
        </p>
        <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
          <Form.Item
            label="Bill link (optional)"
            name="billUrl"
            extra="A web address of the bill (vendor portal, Google Drive). A bill can have a link and a file both."
            rules={[
              { pattern: /^https?:\/\/\S+$/i, message: 'A web address starting with https://.' },
            ]}
          >
            <Input placeholder="https://…" inputMode="url" />
          </Form.Item>
          {canAttach ? (
            <Form.Item
              label="Bill file (optional)"
              extra={
                correcting
                  ? 'Files on the old bill are carried to the corrected one; add another here if needed.'
                  : 'PDF or image of the bill. More files can be added on the bill later.'
              }
            >
              <Upload
                maxCount={1}
                beforeUpload={(chosen) => {
                  setFile(chosen);
                  return false;
                }}
                onRemove={() => setFile(null)}
                fileList={file ? [{ uid: '-1', name: file.name, size: file.size }] : []}
              >
                <Button>Choose file</Button>
              </Upload>
            </Form.Item>
          ) : null}
        </div>
        <Form.Item label="Note (optional)" name="note">
          <Input.TextArea rows={2} />
        </Form.Item>

        {correcting ? (
          <>
            <p className="mb-2 mt-1 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">
              Correction
            </p>
            <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 xl:grid-cols-4">
              <Form.Item
                label="Reverse the old bill on"
                name="reversalDate"
                rules={[{ required: true, message: 'Reversal date is required.' }]}
                extra="Its own date keeps that month right."
              >
                <DateInput />
              </Form.Item>
              <Form.Item
                label="Why"
                name="reason"
                rules={[
                  { required: true, whitespace: true, message: 'Say why it is being corrected.' },
                ]}
              >
                <Input placeholder="e.g. Wrong amount" />
              </Form.Item>
            </div>
          </>
        ) : null}

        <div className="flex gap-[10px]">
          <Button type="primary" htmlType="submit" loading={saving}>
            {correcting ? 'Reverse old & post corrected' : 'Post bill'}
          </Button>
          <Button onClick={cancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </Form>
    </UiCard>
  );
}
