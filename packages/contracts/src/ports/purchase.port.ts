import type { VendorBillStatus } from './vendor-bill.port';

/**
 * Purchases (ADR-176): one screen for a vendor bill's whole life. The stage
 * is derived, never stored: from the bill's status and what has been paid
 * against it.
 */
export type PurchaseStage = 'DRAFT' | 'WAITING_APPROVAL' | 'TO_PAY' | 'PART_PAID' | 'PAID' | 'CLOSED';

export interface PurchaseRow {
  vendorBillId: string;
  vendorId: string;
  vendorName: string;
  vendorBillNumber: string;
  vendorBillDate: string;
  /** Null for a company-overhead bill (ADR-177). */
  projectId: string | null;
  projectName: string | null;
  legalEntityId: string;
  legalEntityName: string;
  status: VendorBillStatus;
  stage: PurchaseStage;
  totalAmount: string | null;
  /** Settled so far by posted vendor payments, TDS included. */
  paidAmount: string;
  dueAmount: string;
  createdBy: string | null;
  version: number;
}

export interface PurchaseList {
  rows: PurchaseRow[];
  total: number;
  counts: Record<PurchaseStage, number>;
}

/** One bill in a payment: how much of it is settled now (TDS included) and the TDS withheld from that. */
export interface PurchasePayLine {
  vendorBillId: string;
  amount: string;
  tdsAmount?: string | undefined;
}

/** One row of the purchase register import (ADR-178): one bill already paid, as read and checked. */
/** One purchase, the register's columns as a form (ADR-181). */
export interface PurchaseEntryInput {
  date: string;
  details: string;
  vendorId: string;
  legalEntityId: string;
  projectId?: string | undefined;
  /** An existing category, or a name: matched to Masters ignoring case and spaces, else added. Neither is Office / Administrative. */
  expenseCategoryId?: string | undefined;
  categoryName?: string | undefined;
  /** Before GST; Other Charges are added to it. */
  amount: string;
  otherCharges?: string | undefined;
  /** Amount With GST: what was paid. GST is the difference. */
  totalAmount: string;
  /** Blank: by the vendor's state against the company's GST registration. */
  gstSplit?: 'CGST_SGST' | 'IGST' | undefined;
  billNumber?: string | undefined;
  paidBy?: string | undefined;
  invoiceLink?: string | undefined;
  paymentReceiptLink?: string | undefined;
  /** Blank: the bill is approved and waits in "To pay". */
  paymentModeId?: string | undefined;
  /** The bank account, or the card (a debit card pays from its linked bank account). */
  bankAccountId?: string | undefined;
  cardAccountId?: string | undefined;
}

export interface PurchaseImportRow {
  rowNumber: number;
  date: string | null;
  details: string;
  supplier: string;
  /** The vendor it matched, or null when it will be added. */
  vendorId: string | null;
  vendorIsNew: boolean;
  legalEntityName: string | null;
  projectName: string | null;
  categoryName: string | null;
  /** True when the category is not in Masters and will be added. */
  categoryIsNew: boolean;
  /** Amount + Other Charges, before GST. */
  taxableAmount: string | null;
  gstAmount: string | null;
  totalAmount: string | null;
  /** CGST+SGST or IGST, from the vendor's state against the company's GST registration. */
  gstSplit: 'CGST_SGST' | 'IGST' | null;
  paymentModeLabel: string | null;
  paymentSourceLabel: string | null;
  invoiceLink: string | null;
  errors: string[];
}

/** The preview's per-row GST switch (ADR-179): how a row's GST was charged, overriding the vendor's state. */
export interface PurchaseImportChoice {
  rowNumber: number;
  gstSplit: 'CGST_SGST' | 'IGST';
}

export interface PurchaseImportPreview {
  rows: PurchaseImportRow[];
  billCount: number;
  newVendorCount: number;
  newCategoryCount: number;
  errorCount: number;
  /** Total paid across the rows without errors. */
  totalAmount: string;
}

export interface PurchasePort {
  list(input: {
    organizationId: string;
    stage?: PurchaseStage | undefined;
    search?: string | undefined;
    projectId?: string | undefined;
    vendorId?: string | undefined;
    page: number;
    pageSize: number;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<PurchaseList>;

  /**
   * Pays approved bills of one vendor and legal entity straight away: the
   * payment request the books need is made and approved by the payer behind
   * the scenes (ADR-176), then the vendor payment is posted.
   */
  pay(input: {
    organizationId: string;
    lines: PurchasePayLine[];
    /** Exactly one: the bank account, or a credit card (ADR-179). */
    bankAccountId?: string | undefined;
    cardAccountId?: string | undefined;
    paymentModeId: string;
    paymentDate: string;
    utrReference?: string | undefined;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<{ vendorPaymentId: string; cashPaid: string }>;

  /** One bill, entered as a row of the purchase register: approved, and paid when a payment mode is given (ADR-181). */
  addEntry(input: { organizationId: string; entry: PurchaseEntryInput; idempotencyKey: string; actorId: string; canSeeAll: boolean; correlationId: string }): Promise<{ vendorBillId: string; paid: boolean; categoryCreated: boolean }>;

  downloadImportSample(): Promise<{ filename: string; contentBase64: string }>;
  previewImport(input: { organizationId: string; contentBase64: string; choices?: PurchaseImportChoice[] | undefined; actorId: string; canSeeAll: boolean }): Promise<PurchaseImportPreview>;
  /** All or nothing on validation; each row then becomes an approved bill, paid on its date. */
  importRows(input: {
    organizationId: string;
    contentBase64: string;
    choices?: PurchaseImportChoice[] | undefined;
    idempotencyKey: string;
    actorId: string;
    canSeeAll: boolean;
    correlationId: string;
  }): Promise<{ bills: number; vendorsCreated: number; categoriesCreated: number }>;
}
