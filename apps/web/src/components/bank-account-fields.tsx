'use client';

import { App, Form, Input, Modal, Select } from 'antd';
import { trpc } from '@/server/trpc';
import { LegalEntitySelect } from '@/components/legal-entity-select';
import type { QuickAddBoxProps } from '@/components/quick-add-select';

export interface BankAccountFormValues {
  legalEntityId: string;
  accountName: string;
  bankName?: string;
  invoiceAccountNumber?: string;
  ifsc?: string;
}

/** What Add Bank Account sends, from the page and from the F2 box alike. */
export function bankAccountCreateInput(values: BankAccountFormValues) {
  return {
    legalEntityId: values.legalEntityId,
    accountName: values.accountName,
    bankName: values.bankName,
    invoiceAccountNumber: values.invoiceAccountNumber,
    ifsc: values.ifsc,
  };
}

/** "HDFC Operating · ****4471", so two accounts of one name are told apart. */
/**
 * The full account number first, as people know their accounts by it
 * ("99999825500595 · HDFC Operating"); the masked one when the full number is
 * not recorded. The name stays for telling them apart and for search.
 */
export function bankAccountLabel(account: { accountName: string; maskedAccountNumber: string | null; invoiceAccountNumber?: string | null }) {
  const number = account.invoiceAccountNumber || account.maskedAccountNumber;
  return number ? `${number} · ${account.accountName}` : account.accountName;
}

/**
 * The fields of the bank account form, inside a `Form<BankAccountFormValues>`.
 * Bank Accounts' drawer and the F2 box both render these, so they never differ.
 * The legal entity is chosen (LegalEntitySelect) unless `lockLegalEntity`,
 * when it shows the one already set on the form.
 */
export function BankAccountFields({
  editing,
  lockLegalEntity,
  autoFocus,
}: {
  /** The account being edited: its ledger is shown instead of the note. */
  editing?: { ledgerAccountName: string; ledgerAccountCode: string } | null;
  lockLegalEntity?: boolean;
  autoFocus?: boolean;
}) {
  const legalEntities = trpc.legalEntities.list.useQuery({ includeInactive: true }, { enabled: !!lockLegalEntity });

  return (
    <>
      {lockLegalEntity ? (
        <Form.Item label="Legal entity" name="legalEntityId" rules={[{ required: true, message: 'Legal entity is required.' }]}>
          <Select disabled loading={legalEntities.isLoading} options={(legalEntities.data ?? []).map((e) => ({ value: e.id, label: e.legalName }))} />
        </Form.Item>
      ) : (
        <Form.Item label="Legal entity" name="legalEntityId" rules={[{ required: true, message: 'Legal entity is required.' }]}>
          <LegalEntitySelect />
        </Form.Item>
      )}
      {/* The ledger is not chosen here (ADR-160): a new bank account gets its
          own ledger under Bank Accounts, named after it. */}
      {editing ? (
        <Form.Item label="Ledger account" extra="Every amount in or out of this bank posts here. It cannot be changed.">
          <div className="rounded-ui border border-ui bg-app px-3 py-[6px] text-[13px] text-text">
            {editing.ledgerAccountName} <span className="font-mono text-[12px] text-muted">({editing.ledgerAccountCode})</span>
          </div>
        </Form.Item>
      ) : (
        <p className="-mt-1 mb-4 rounded-ui border border-ui-2 bg-app px-3 py-2 text-[12.5px] text-muted">
          Its ledger account is created for you under <b className="text-text">Bank Accounts</b> in the Chart of Accounts, named after this account. Every amount in or out of this bank posts there.
        </p>
      )}
      <Form.Item label="Account name" name="accountName" rules={[{ required: true, message: 'Account name is required.' }, { max: 200 }]}>
        <Input placeholder="e.g. HDFC Operating Account" {...(autoFocus ? { autoFocus: true } : {})} />
      </Form.Item>
      <Form.Item label="Bank" name="bankName" rules={[{ max: 200 }]}>
        <Input placeholder="e.g. HDFC Bank" />
      </Form.Item>
      <Form.Item label="Account number" name="invoiceAccountNumber" rules={[{ max: 40 }]} extra="The full account number, shown in dropdowns and printed on tax invoices.">
        <Input placeholder="e.g. 99999825500595" maxLength={40} />
      </Form.Item>
      <Form.Item label="IFSC" name="ifsc" rules={[{ max: 20 }]}>
        <Input placeholder="e.g. HDFC0000123" />
      </Form.Item>
    </>
  );
}

/**
 * Add Bank Account as a box, for BankAccountSelect's F2: the same fields and
 * payload as the Bank Accounts page, with what was typed as the account name.
 * `legalEntityId`, when given, is the new account's and cannot be changed.
 */
export function BankAccountAddBox(props: QuickAddBoxProps & { legalEntityId?: string | undefined }) {
  // Mounted only while open, so every opening starts from a fresh form.
  return props.open ? <BankAccountAddModal {...props} /> : null;
}

function BankAccountAddModal({ initialText, onClose, onCreated, legalEntityId }: QuickAddBoxProps & { legalEntityId?: string | undefined }) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const [form] = Form.useForm<BankAccountFormValues>();

  const create = trpc.legalEntities.createBankAccount.useMutation({
    onSuccess: async (account) => {
      message.success('Bank account added.');
      onCreated({ value: account.id, label: bankAccountLabel(account) });
      await utils.legalEntities.listBankAccounts.invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  return (
    <Modal open title="Add bank account" okText="Add bank account" confirmLoading={create.isPending} onCancel={onClose} onOk={() => form.submit()}>
      <Form<BankAccountFormValues>
        form={form}
        layout="vertical"
        requiredMark
        initialValues={{ accountName: initialText, ...(legalEntityId ? { legalEntityId } : {}) }}
        onFinish={(values) => create.mutate(bankAccountCreateInput({ ...values, ...(legalEntityId ? { legalEntityId } : {}) }))}
      >
        <BankAccountFields lockLegalEntity={!!legalEntityId} autoFocus />
      </Form>
    </Modal>
  );
}
