'use client';

import Link from 'next/link';

/** Drill-down from a GST report row to the document that carries the tax (docs/04 §16). */
export function GstDocumentLink({ documentType, documentId, invoiceId, projectId, label }: { documentType: string; documentId: string; invoiceId?: string | null; projectId: string | null; label: string }) {
  const base = documentType.replace(/_(VOID|REVERSAL)$/, '');
  const href =
    base === 'INVOICE' && projectId
      ? `/projects/${projectId}/invoices/${documentId}`
      : (base === 'CREDIT_NOTE' || base === 'DEBIT_NOTE') && projectId && invoiceId
        ? `/projects/${projectId}/invoices/${invoiceId}/credit-debit-notes/${documentId}`
        : base === 'VENDOR_BILL'
          ? `/vendor-bills/${documentId}`
          : base === 'DIRECT_EXPENSE'
            ? `/direct-expenses/${documentId}`
            : base === 'EXPENSE_CLAIM'
              ? `/employee-expenses/claims/${documentId}`
              : null;
  if (!href) return <span>{label}</span>;
  return (
    <Link href={href} className="font-semibold text-brand hover:underline">
      {label}
    </Link>
  );
}

export function JournalLink({ journalEntryId }: { journalEntryId: string }) {
  return (
    <Link href={`/journal-entries/${journalEntryId}`} className="text-brand hover:underline">
      Journal
    </Link>
  );
}

export const GST_DOCUMENT_LABELS: Record<string, string> = {
  INVOICE: 'Invoice',
  INVOICE_VOID: 'Invoice void',
  CREDIT_NOTE: 'Credit note',
  CREDIT_NOTE_VOID: 'Credit note void',
  DEBIT_NOTE: 'Debit note',
  DEBIT_NOTE_VOID: 'Debit note void',
  VENDOR_BILL: 'Vendor bill',
  VENDOR_BILL_VOID: 'Vendor bill void',
  DIRECT_EXPENSE: 'Direct expense',
  DIRECT_EXPENSE_REVERSAL: 'Direct expense reversal',
  EXPENSE_CLAIM: 'Expense claim',
};

/** "2026-07" → "Jul 2026". */
export function taxPeriodLabel(taxPeriod: string) {
  const [year, month] = taxPeriod.split('-');
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1]} ${year}`;
}
