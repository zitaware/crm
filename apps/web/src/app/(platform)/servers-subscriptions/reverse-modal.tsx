'use client';

import { useState } from 'react';
import { App, Input, Modal } from 'antd';
import { trpc } from '@/server/trpc';
import { DateInput } from '@/components/date-input';
import { formatDate, formatMoney } from '@/lib/format';
import { newIdempotencyKey, type DirectExpenseRow } from '../direct-expenses/shared';

/**
 * Bills are never deleted (ADR-169): reversing posts the opposite entry and
 * the bill stays, marked Reversed. The parent mounts it fresh for each bill.
 */
export function ReverseBillModal({ bill, onClose, onReversed }: { bill: DirectExpenseRow; onClose: () => void; onReversed: () => Promise<void> }) {
  const { message } = App.useApp();
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(bill.expenseDate);
  const [key] = useState(newIdempotencyKey);
  const reverse = trpc.directExpenses.reverse.useMutation({
    onSuccess: async () => {
      message.success('Bill reversed.');
      await onReversed();
      onClose();
    },
    onError: (e) => message.error(e.message),
  });

  return (
    <Modal
      title="Reverse bill"
      open
      onCancel={onClose}
      okText="Reverse"
      okButtonProps={{ danger: true, disabled: !reason.trim() || !date }}
      confirmLoading={reverse.isPending}
      onOk={() => reverse.mutate({ id: bill.id, expectedVersion: bill.version, reason: reason.trim(), accountingDate: date, idempotencyKey: key })}
    >
      <p className="mt-0 text-[13px] text-muted">
        Bills are not deleted. Reversing posts the opposite entry, so {bill.title} ({formatMoney(bill.amount)}, {formatDate(bill.expenseDate)}) no longer counts in expense, GST or
        the card or bank balance. It stays in the list as Reversed, with its link and files.
      </p>
      <p className="mb-1 text-[12.5px] text-muted">Reverse on</p>
      <DateInput value={date} onChange={setDate} />
      <p className="mb-1 mt-3 text-[12.5px] text-muted">Why</p>
      <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Recorded twice" />
    </Modal>
  );
}
