'use client';

import { StatusTag } from '@zitaware/ui';
import type {
  InventoryConsumptionSummary,
  InventoryDocumentStatus as ContractInventoryDocumentStatus,
  InventoryMovementRow as ContractInventoryMovementRow,
  InventoryMovementType as ContractInventoryMovementType,
  InventoryReceiptSummary,
  InventoryReceiptType as ContractInventoryReceiptType,
  InventoryStockRow as ContractInventoryStockRow,
} from '@zitaware/contracts';

// Aliased to the contract rather than re-declared. Hand-written copies drift
// silently — a stale copy in the salary-imports screen is what produced a
// Journal button linking to /journal-entries/null. Aliasing makes the next
// contract change a compile error here instead.
export type InventoryReceiptType = ContractInventoryReceiptType;
export type InventoryDocumentStatus = ContractInventoryDocumentStatus;
export type InventoryMovementType = ContractInventoryMovementType;
export type InventoryStockRow = ContractInventoryStockRow;
export type InventoryMovementRow = ContractInventoryMovementRow;
export type InventoryReceiptRow = InventoryReceiptSummary;
export type InventoryConsumptionRow = InventoryConsumptionSummary;

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random()}`;
}

/** Quantities carry 4 decimals in the database because a unit can be
 * fractional, but trailing zeros are noise on screen. */
export function formatQuantity(value: string): string {
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return n.toLocaleString('en-IN', { maximumFractionDigits: 4 });
}

const MOVEMENT_TONE: Record<InventoryMovementType, 'pos' | 'neg' | 'warn' | 'mut'> = {
  OPENING: 'mut',
  RECEIPT: 'pos',
  CONSUMPTION: 'warn',
  REVERSAL: 'neg',
};
const MOVEMENT_TEXT: Record<InventoryMovementType, string> = {
  OPENING: 'Opening',
  RECEIPT: 'Receipt',
  CONSUMPTION: 'Issue',
  REVERSAL: 'Reversal',
};

export function MovementTypeTag({ type }: { type: InventoryMovementType }) {
  return <StatusTag status={type} label={MOVEMENT_TEXT[type]} tone={MOVEMENT_TONE[type]} />;
}

export function ReceiptStatusTag({ status }: { status: InventoryDocumentStatus }) {
  return (
    <StatusTag
      status={status}
      label={status === 'POSTED' ? 'Posted' : 'Reversed'}
      tone={status === 'POSTED' ? 'pos' : 'neg'}
    />
  );
}

/** Consumption carries the same POSTED/REVERSED lifecycle as a receipt, so
 * it deliberately reuses the same tag rather than growing a lookalike. */
export const ConsumptionStatusTag = ReceiptStatusTag;
