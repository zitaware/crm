/**
 * Inventory stock ledger and standalone receipts (Phase 7.2, ADR-092).
 *
 * The primary way stock arrives is a Vendor Bill line carrying an
 * `inventoryItemId`: approving that bill debits INVENTORY as part of its own
 * journal and creates the movement atomically, so there is no separate
 * document and no second journal (docs/04:464 — "do not duplicate the
 * vendor-bill liability journal").
 *
 * `InventoryReceipt` therefore covers only the two cases that path cannot:
 * OPENING (cutover stock, credited to Opening Balance Equity, reusing
 * ADR-071's mechanism) and DIRECT (received against a vendor liability with
 * no bill raised here).
 */
export type InventoryReceiptType = 'OPENING' | 'DIRECT';
export type InventoryDocumentStatus = 'POSTED' | 'REVERSED';
export type InventoryMovementType = 'OPENING' | 'RECEIPT' | 'CONSUMPTION' | 'REVERSAL';

export interface InventoryStockRow {
  inventoryItemId: string;
  code: string;
  name: string;
  unitOfMeasureName: string;
  productCategoryId: string | null;
  productCategoryName: string | null;
  /** Cumulative quantity ever received / issued — the list screen's own
   * "total in" / "total out" columns. */
  totalQuantityIn: string;
  totalQuantityOut: string;
  quantityOnHand: string;
  stockValueAmount: string;
  weightedAverageRate: string;
}

export interface InventoryMovementRow {
  id: string;
  movementType: InventoryMovementType;
  movementDate: string;
  sequenceNumber: number;
  quantityIn: string;
  quantityOut: string;
  unitCostAmount: string;
  movementValueAmount: string;
  balanceQuantity: string;
  balanceValueAmount: string;
  weightedAverageRate: string;
  /** Where this movement came from, resolved for display. */
  sourceLabel: string;
  vendorBillId: string | null;
  vendorBillNumber: string | null;
  inventoryReceiptId: string | null;
  inventoryReceiptNumber: string | null;
  inventoryConsumptionId: string | null;
  inventoryConsumptionNumber: string | null;
  /** Set only on a consumption movement — the project the cost was charged
   * to. Present here so the item ledger can answer "where did this stock
   * go?" without a second query. */
  projectId: string | null;
  projectName: string | null;
  partyName: string | null;
  createdAt: string;
}

export interface InventoryItemLedger {
  inventoryItemId: string;
  code: string;
  name: string;
  unitOfMeasureName: string;
  quantityOnHand: string;
  stockValueAmount: string;
  weightedAverageRate: string;
  movements: InventoryMovementRow[];
}

export interface InventoryReceiptLineInput {
  inventoryItemId: string;
  quantity: string;
  unitCostAmount: string;
}

export interface InventoryReceiptLineRow extends InventoryReceiptLineInput {
  id: string;
  sequence: number;
  itemCode: string;
  itemName: string;
  unitOfMeasureName: string;
  lineValueAmount: string;
}

export interface InventoryReceiptSummary {
  id: string;
  receiptNumber: string;
  receiptType: InventoryReceiptType;
  legalEntityId: string;
  legalEntityName: string;
  partyId: string | null;
  partyName: string | null;
  receivedDate: string;
  invoiceChallanNumber: string | null;
  note: string | null;
  status: InventoryDocumentStatus;
  totalValueAmount: string;
  journalEntryId: string;
  reversalJournalEntryId: string | null;
  reversalReason: string | null;
  createdAt: string;
  version: number;
}

export interface InventoryReceiptDetail extends InventoryReceiptSummary {
  lines: InventoryReceiptLineRow[];
}

export interface InventoryConsumptionLineInput {
  inventoryItemId: string;
  quantity: string;
}

export interface InventoryConsumptionLineRow extends InventoryConsumptionLineInput {
  id: string;
  sequence: number;
  itemCode: string;
  itemName: string;
  unitOfMeasureName: string;
  /** The ruling weighted average this line was actually issued at — read
   * off the stored line, never recomputed from today's average. */
  unitCostAmount: string;
  lineValueAmount: string;
}

export interface InventoryConsumptionSummary {
  id: string;
  consumptionNumber: string;
  legalEntityId: string;
  legalEntityName: string;
  projectId: string;
  projectName: string;
  consumedDate: string;
  note: string | null;
  status: InventoryDocumentStatus;
  totalValueAmount: string;
  journalEntryId: string;
  reversalJournalEntryId: string | null;
  reversalReason: string | null;
  createdAt: string;
  version: number;
}

export interface InventoryConsumptionDetail extends InventoryConsumptionSummary {
  lines: InventoryConsumptionLineRow[];
}

/**
 * What one consumption line WOULD cost if posted right now (Phase 7.3).
 *
 * Server-computed so the entry screen never does valuation arithmetic of
 * its own — CLAUDE.md's "do not calculate accounting totals independently
 * in React components", applied to the weighted average. Explicitly a
 * preview: the figure is re-derived under the item's row lock at posting
 * time, and a receipt landing in between will legitimately change it.
 */
export interface InventoryConsumptionPreviewLine {
  inventoryItemId: string;
  itemName: string;
  unitOfMeasureName: string;
  quantity: string;
  quantityOnHand: string;
  weightedAverageRate: string;
  lineValueAmount: string;
  /** Set when the line asks for more than is on hand; the preview still
   * returns so the screen can show every problem at once. */
  shortfallMessage: string | null;
}

export interface InventoryConsumptionPreview {
  lines: InventoryConsumptionPreviewLine[];
  totalValueAmount: string;
  isPostable: boolean;
}

export interface InventoryStockFilters {
  search: string | undefined;
  productCategoryId: string | undefined;
  /** Hide items that have never moved and hold no stock. */
  inStockOnly: boolean | undefined;
}

export interface InventoryPort {
  listStock(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: InventoryStockFilters;
  }): Promise<{ rows: InventoryStockRow[]; total: number; totalStockValueAmount: string }>;

  getItemLedger(input: {
    organizationId: string;
    inventoryItemId: string;
    fromDate: string | undefined;
    toDate: string | undefined;
  }): Promise<InventoryItemLedger>;

  listReceipts(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: { receiptType: InventoryReceiptType | undefined; status: InventoryDocumentStatus | undefined };
  }): Promise<{ rows: InventoryReceiptSummary[]; total: number }>;

  getReceiptDetail(input: { organizationId: string; id: string }): Promise<InventoryReceiptDetail>;

  recordReceipt(input: {
    organizationId: string;
    legalEntityId: string;
    receiptType: InventoryReceiptType;
    partyId: string | undefined;
    receivedDate: string;
    invoiceChallanNumber: string | undefined;
    note: string | undefined;
    lines: InventoryReceiptLineInput[];
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<InventoryReceiptSummary>;

  reverseReceipt(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<InventoryReceiptSummary>;

  listConsumptions(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: { projectId: string | undefined; status: InventoryDocumentStatus | undefined };
  }): Promise<{ rows: InventoryConsumptionSummary[]; total: number }>;

  getConsumptionDetail(input: { organizationId: string; id: string }): Promise<InventoryConsumptionDetail>;

  previewConsumption(input: {
    organizationId: string;
    lines: InventoryConsumptionLineInput[];
  }): Promise<InventoryConsumptionPreview>;

  recordConsumption(input: {
    organizationId: string;
    legalEntityId: string;
    projectId: string;
    consumedDate: string;
    note: string | undefined;
    lines: InventoryConsumptionLineInput[];
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<InventoryConsumptionSummary>;

  reverseConsumption(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    reason: string;
    accountingDate: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<InventoryConsumptionSummary>;
}
