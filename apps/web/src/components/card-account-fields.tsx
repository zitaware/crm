'use client';

import { App, Form, Input, InputNumber, Modal, Segmented, Select } from 'antd';
import { trpc } from '@/server/trpc';
import { EmployeeSelect } from '@/components/employee-select';
import { BankAccountSelect } from '@/components/bank-account-select';
import { LegalEntitySelect } from '@/components/legal-entity-select';
import type { QuickAddBoxProps } from '@/components/quick-add-select';

export type CardType = 'DEBIT_CARD' | 'CREDIT_CARD';

export interface CardAccountFormValues {
  legalEntityId: string;
  type: CardType;
  displayName: string;
  issuerName?: string;
  /** The full card number as typed. It stays in the browser: only its last four digits are sent (ADR-168). */
  cardNumber?: string;
  cardholderEmployeeId?: string;
  bankAccountId?: string;
  statementDay?: number;
  paymentDueDay?: number;
}

const cardDigits = (value: string | undefined) => (value ?? '').replace(/[\s-]/g, '');

/** The Luhn check every card number carries, so a mistyped digit is caught before saving. */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Shows the number in groups of four as it is typed. */
export const groupCardNumber = (value: string) => cardDigits(value).replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');

/** Only the last four digits ever leave the form. */
export const lastFourOf = (value: string | undefined) => {
  const digits = cardDigits(value);
  return digits ? digits.slice(-4) : undefined;
};

/** What Add Card sends, from the page and from the F2 box alike. */
export function cardAccountCreateInput(values: CardAccountFormValues) {
  return {
    legalEntityId: values.legalEntityId,
    type: values.type,
    displayName: values.displayName,
    issuerName: values.issuerName,
    cardNumber: cardDigits(values.cardNumber) || undefined,
    maskedLastFour: lastFourOf(values.cardNumber) ?? '',
    cardholderEmployeeId: values.cardholderEmployeeId,
    bankAccountId: values.type === 'DEBIT_CARD' ? values.bankAccountId : undefined,
    statementDay: values.type === 'CREDIT_CARD' ? values.statementDay : undefined,
    paymentDueDay: values.type === 'CREDIT_CARD' ? values.paymentDueDay : undefined,
  };
}

/** "HDFC Corporate •••• 4471". */
/** The card number first ("4111 2222 3333 4444 · Corporate Card" or "•••• 7823 · Corporate Card"); the name stays for telling cards apart and for search. */
export function cardAccountLabel(card: { displayName: string; maskedLastFour: string; cardNumber?: string | null }) {
  const number = card.cardNumber ? groupCardNumber(card.cardNumber) : `•••• ${card.maskedLastFour}`;
  return `${number} · ${card.displayName.trim()}`;
}

/**
 * The fields of the card form, inside a `Form<CardAccountFormValues>`. Card
 * Accounts' drawer and the F2 box both render these, so they never differ.
 * The legal entity is chosen (LegalEntitySelect) unless `lockLegalEntity`;
 * the type is fixed when editing or when `lockType`.
 */
export function CardAccountFields({
  editing,
  lockLegalEntity,
  lockType,
  autoFocus,
}: {
  /** The card being edited: type, linked account and ledger are shown, not changed. */
  editing?: { type: CardType; maskedLastFour: string; cardNumber?: string | null; ledgerAccountName: string | null } | null;
  lockLegalEntity?: boolean;
  lockType?: boolean;
  autoFocus?: boolean;
}) {
  const form = Form.useFormInstance<CardAccountFormValues>();
  const formType = Form.useWatch('type', form);
  const legalEntityId = Form.useWatch('legalEntityId', form);
  const legalEntities = trpc.legalEntities.list.useQuery({ includeInactive: true }, { enabled: !!lockLegalEntity });

  return (
    <>
      {lockLegalEntity ? (
        <Form.Item label="Legal entity" name="legalEntityId" rules={[{ required: true, message: 'Legal entity is required.' }]}>
          <Select disabled loading={legalEntities.isLoading} options={(legalEntities.data ?? []).map((e) => ({ value: e.id, label: e.legalName }))} />
        </Form.Item>
      ) : (
        <Form.Item label="Legal entity" name="legalEntityId" rules={[{ required: true, message: 'Legal entity is required.' }]}>
          {/* The cardholder and the linked account belong to the old one. */}
          <LegalEntitySelect onUserChange={() => form.resetFields(['cardholderEmployeeId', 'bankAccountId'])} />
        </Form.Item>
      )}
      <Form.Item label="Type" name="type" rules={[{ required: true }]} extra={editing ? 'Cannot be changed after creation.' : undefined}>
        <Segmented
          disabled={!!editing || !!lockType}
          options={[
            { label: 'Debit Card', value: 'DEBIT_CARD' },
            { label: 'Credit Card', value: 'CREDIT_CARD' },
          ]}
        />
      </Form.Item>
      <Form.Item label="Display name" name="displayName" rules={[{ required: true, message: 'Display name is required.' }, { max: 200 }]}>
        <Input placeholder="e.g. HDFC Corporate Card" {...(autoFocus ? { autoFocus: true } : {})} />
      </Form.Item>
      <Form.Item label="Issuer" name="issuerName" rules={[{ max: 200 }]}>
        <Input placeholder="e.g. HDFC Bank" />
      </Form.Item>
      <Form.Item
        label="Card number"
        name="cardNumber"
        normalize={groupCardNumber}
        extra={
          editing
            ? editing.cardNumber
              ? `Current number: ${groupCardNumber(editing.cardNumber)}. You can edit or leave it as is.`
              : `Previously saved without full number (ends in ${editing.maskedLastFour}). Enter full number to save it.`
            : 'Type the full 12–19 digit card number.'
        }
        rules={[
          { required: !editing, message: 'Card number is required.' },
          {
            validator: async (_rule, value: string | undefined) => {
              const digits = cardDigits(value);
              if (!digits) return;
              if (digits.length < 12 || digits.length > 19) throw new Error('A card number has 12 to 19 digits.');
            },
          },
        ]}
      >
        <Input placeholder="e.g. 4111 1111 1111 1111" inputMode="numeric" autoComplete="off" />
      </Form.Item>
      <Form.Item label="Cardholder (optional)" name="cardholderEmployeeId">
        <EmployeeSelect allowClear placeholder="None" legalEntityId={legalEntityId} />
      </Form.Item>

      {(editing?.type ?? formType) === 'DEBIT_CARD' ? (
        <Form.Item
          label="Linked bank account"
          name="bankAccountId"
          rules={[{ required: !editing, message: 'A linked bank account is required.' }]}
          extra={editing ? 'Cannot be changed after creation.' : 'Debit card payments reduce this account immediately.'}
        >
          <BankAccountSelect disabled={!!editing} placeholder="Select bank account…" legalEntityId={legalEntityId} />
        </Form.Item>
      ) : (
        <>
          {/* The payable ledger is not chosen here (ADR-160): a new credit
              card gets its own under Credit Card Payable, named after it. */}
          {editing ? (
            <Form.Item label="Payable ledger account" extra="Credit card purchases post here until settled. It cannot be changed.">
              <div className="rounded-ui border border-ui bg-app px-3 py-[6px] text-[13px] text-text">{editing.ledgerAccountName ?? '—'}</div>
            </Form.Item>
          ) : (
            <p className="-mt-1 mb-4 rounded-ui border border-ui-2 bg-app px-3 py-2 text-[12.5px] text-muted">
              Its payable ledger account is created for you under <b className="text-text">Credit Card Payable</b> in the Chart of Accounts. Purchases on this card post there until the bill is settled.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Form.Item label="Statement day (optional)" name="statementDay">
              <InputNumber min={1} max={31} className="w-full" />
            </Form.Item>
            <Form.Item label="Payment due day (optional)" name="paymentDueDay">
              <InputNumber min={1} max={31} className="w-full" />
            </Form.Item>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Add Card as a box, for CardAccountSelect's F2: the same fields and payload
 * as the Card Accounts page, with what was typed as the display name.
 * `legalEntityId` and `cardType`, when given, are the new card's and cannot
 * be changed.
 */
export function CardAccountAddBox(props: QuickAddBoxProps & { legalEntityId?: string | undefined; cardType?: CardType | undefined }) {
  // Mounted only while open, so every opening starts from a fresh form.
  return props.open ? <CardAccountAddModal {...props} /> : null;
}

function CardAccountAddModal({ initialText, onClose, onCreated, legalEntityId, cardType }: QuickAddBoxProps & { legalEntityId?: string | undefined; cardType?: CardType | undefined }) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const [form] = Form.useForm<CardAccountFormValues>();

  const create = trpc.legalEntities.createCardAccount.useMutation({
    onSuccess: async (card) => {
      message.success('Card account added.');
      onCreated({ value: card.id, label: cardAccountLabel(card) });
      await utils.legalEntities.listCardAccounts.invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  return (
    <Modal open width={520} title="Add card" okText="Add card" confirmLoading={create.isPending} onCancel={onClose} onOk={() => form.submit()}>
      <Form<CardAccountFormValues>
        form={form}
        layout="vertical"
        requiredMark
        initialValues={{ displayName: initialText, type: cardType ?? 'DEBIT_CARD', ...(legalEntityId ? { legalEntityId } : {}) }}
        onFinish={(values) =>
          create.mutate(cardAccountCreateInput({ ...values, ...(legalEntityId ? { legalEntityId } : {}), ...(cardType ? { type: cardType } : {}) }))
        }
      >
        <CardAccountFields lockLegalEntity={!!legalEntityId} lockType={!!cardType} autoFocus />
      </Form>
    </Modal>
  );
}
