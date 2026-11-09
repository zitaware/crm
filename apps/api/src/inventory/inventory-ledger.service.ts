import { Injectable } from '@nestjs/common';
import { Prisma, generateId } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { applyConsumption, applyReceipt, zeroBalance, type MovementResult, type StockBalance } from './inventory-valuation.util';

export interface RecordMovementInput {
  organizationId: string;
  inventoryItemId: string;
  movementType: 'OPENING' | 'RECEIPT' | 'CONSUMPTION' | 'REVERSAL';
  movementDate: Date;
  /** Positive for an inbound movement, ignored for an outbound one. */
  quantityIn?: Prisma.Decimal;
  quantityOut?: Prisma.Decimal;
  /** Required for every inbound movement — the landed cost per unit. An
   * outbound movement is always valued at the ruling weighted average and
   * ignores this. */
  unitCost?: Prisma.Decimal;
  vendorBillLineId?: string;
  inventoryReceiptId?: string;
  inventoryConsumptionId?: string;
  reversalOfMovementId?: string;
  actorId: string;
}

export interface RecordedMovement extends MovementResult {
  id: string;
  sequenceNumber: number;
}

/**
 * The single writer of the stock ledger (Phase 7.2, ADR-092).
 *
 * Every caller — vendor bill approval, standalone receipt, consumption
 * (7.3) — goes through `recordMovement`, which is the only place that
 * reads a balance, applies the valuation arithmetic and appends a row.
 * Concentrating it here is what makes the running snapshot trustworthy:
 * there is exactly one code path that can advance an item's balance, and
 * it always takes the item's row lock first.
 *
 * Every method takes the caller's own `tx` rather than opening its own
 * transaction, so a movement is always committed together with whatever
 * business event caused it — docs/02's named boundary, "post inventory
 * receipt/consumption + cost entry where applicable".
 */
@Injectable()
export class InventoryLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Appends one movement, advancing the item's running balance.
   *
   * Takes `SELECT ... FOR UPDATE` on the item row first. That lock is what
   * makes two concurrent issues of the same item safe: the second waits,
   * then re-reads a balance that already reflects the first, so stock can
   * never be double-spent (docs/07: "lock rows when allocating ...
   * outstanding balances", applied to stock).
   */
  /**
   * Takes the item's `FOR UPDATE` lock and returns the balance that lock
   * protects (Phase 7.3, ADR-093).
   *
   * Extracted from `recordMovement`, which now calls it, so that a caller
   * whose POSTED AMOUNT is the balance — Inventory Consumption, valued at
   * the ruling weighted average — can read that figure under exactly the
   * lock the subsequent movement will be written under. Reading it any
   * earlier would be reading a number another transaction is still free to
   * change.
   *
   * Callers holding several items must acquire them in a deterministic
   * order (sorted by item id) or two concurrent multi-item documents can
   * deadlock against each other.
   */
  async lockAndGetBalance(
    tx: Prisma.TransactionClient,
    organizationId: string,
    inventoryItemId: string,
  ): Promise<{ balance: StockBalance; latestSequenceNumber: number; latestMovementDate: Date | null }> {
    await tx.$queryRaw`SELECT id FROM inventory_items WHERE id::text = ${inventoryItemId} FOR UPDATE`;

    const latest = await tx.inventoryMovement.findFirst({
      where: { organizationId, inventoryItemId },
      orderBy: { sequenceNumber: 'desc' },
    });

    return {
      balance: latest
        ? { quantity: latest.balanceQuantity, valueAmount: latest.balanceValueAmount, weightedAverageRate: latest.weightedAverageRate }
        : zeroBalance(),
      latestSequenceNumber: latest?.sequenceNumber ?? 0,
      latestMovementDate: latest?.movementDate ?? null,
    };
  }

  async recordMovement(tx: Prisma.TransactionClient, input: RecordMovementInput): Promise<RecordedMovement> {
    const locked = await this.lockAndGetBalance(tx, input.organizationId, input.inventoryItemId);

    const item = await tx.inventoryItem.findFirst({
      where: { id: input.inventoryItemId, organizationId: input.organizationId, deletedAt: null },
    });
    if (!item) throwAppError('NOT_FOUND', 'Stock item not found.');
    if (!item.isStockTracked) {
      throwAppError('VALIDATION_FAILED', `"${item.name}" is not a stock-tracked item and cannot hold stock.`);
    }

    const latest = locked.latestMovementDate
      ? { movementDate: locked.latestMovementDate, sequenceNumber: locked.latestSequenceNumber }
      : null;

    // Movements are strictly chronological per item. A backdated movement
    // would silently invalidate every weighted-average rate already stamped
    // on later rows, so it is refused outright — the correction path is a
    // reversal plus a fresh movement, exactly as it is for a posted journal.
    if (latest && input.movementDate < latest.movementDate) {
      throwAppError(
        'VALIDATION_FAILED',
        `This item already has stock movement on ${latest.movementDate.toISOString().slice(0, 10)}. A movement cannot be backdated before it — reverse the later movement instead.`,
      );
    }

    const current: StockBalance = locked.balance;

    const inbound = input.quantityIn !== undefined;
    let result: MovementResult;
    if (inbound) {
      if (input.unitCost === undefined) throwAppError('VALIDATION_FAILED', 'A unit cost is required to receive stock.');
      result = applyReceipt(current, input.quantityIn!, input.unitCost);
    } else {
      if (input.quantityOut === undefined) throwAppError('VALIDATION_FAILED', 'A movement must move stock in one direction.');
      result = applyConsumption(current, input.quantityOut);
    }

    const id = generateId();
    const sequenceNumber = (latest?.sequenceNumber ?? 0) + 1;

    await tx.inventoryMovement.create({
      data: {
        id,
        organizationId: input.organizationId,
        inventoryItemId: input.inventoryItemId,
        movementType: input.movementType,
        movementDate: input.movementDate,
        sequenceNumber,
        quantityIn: inbound ? input.quantityIn! : new Prisma.Decimal(0),
        quantityOut: inbound ? new Prisma.Decimal(0) : input.quantityOut!,
        unitCostAmount: result.unitCostAmount,
        movementValueAmount: result.movementValueAmount,
        balanceQuantity: result.balance.quantity,
        balanceValueAmount: result.balance.valueAmount,
        weightedAverageRate: result.balance.weightedAverageRate,
        vendorBillLineId: input.vendorBillLineId ?? null,
        inventoryReceiptId: input.inventoryReceiptId ?? null,
        inventoryConsumptionId: input.inventoryConsumptionId ?? null,
        reversalOfMovementId: input.reversalOfMovementId ?? null,
        createdBy: input.actorId,
      },
    });

    return { ...result, id, sequenceNumber };
  }

  /**
   * Pre-flight for the chronology rule, callable outside a transaction.
   *
   * Exists because every caller in this codebase posts its journal BEFORE
   * opening the transaction that writes its business rows (the established
   * PostingService pattern — it opens its own transaction and cannot join
   * one). If `recordMovement` were the first place a backdated movement was
   * rejected, the rollback would leave an already-posted journal with no
   * stock behind it. Callers therefore run this first, so the transaction
   * body has no business reason left to fail.
   */
  async assertCanAcceptMovementOn(organizationId: string, inventoryItemId: string, movementDate: Date): Promise<void> {
    const latest = await this.prisma.client.inventoryMovement.findFirst({
      where: { organizationId, inventoryItemId },
      orderBy: { sequenceNumber: 'desc' },
      select: { movementDate: true },
    });
    if (latest && movementDate < latest.movementDate) {
      throwAppError(
        'VALIDATION_FAILED',
        `This item already has stock movement on ${latest.movementDate.toISOString().slice(0, 10)}. A movement cannot be backdated before it — reverse the later movement instead.`,
      );
    }
  }

  /** The item's current balance, read straight off its latest movement —
   * never recomputed by replaying the ledger (docs/04:463). */
  async getBalance(organizationId: string, inventoryItemId: string): Promise<StockBalance> {
    const latest = await this.prisma.client.inventoryMovement.findFirst({
      where: { organizationId, inventoryItemId },
      orderBy: { sequenceNumber: 'desc' },
    });
    if (!latest) return zeroBalance();
    return {
      quantity: latest.balanceQuantity,
      valueAmount: latest.balanceValueAmount,
      weightedAverageRate: latest.weightedAverageRate,
    };
  }
}
