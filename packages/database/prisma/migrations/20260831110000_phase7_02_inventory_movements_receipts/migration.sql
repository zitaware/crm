-- Phase 7.2 (docs/12 ADR-092): the stock ledger, the weighted-average
-- valuation engine's storage, and the Vendor Bill inventory variant.
-- This migration also carries the schema half of promoting TDR-007
-- (inventory costing = weighted average) to an accepted decision.
--
-- Three new tables:
--   * inventory_movements -- append-only. Each row stores the balance it
--     produced (balance_quantity / balance_value_amount /
--     weighted_average_rate), so a past consumption's cost is permanently
--     reproducible and the sum of every item's latest balance_value_amount
--     IS the INVENTORY ledger account balance. That identity is Phase 7's
--     own exit criterion ("inventory movement reconciles to stock value"),
--     true by construction rather than by a reconciliation job.
--     sequence_number gives the ledger one total order per item even when
--     several movements share a movement_date.
--   * inventory_receipts / inventory_receipt_lines -- the non-vendor-bill
--     receipt: OPENING (cutover stock, Dr INVENTORY / Cr
--     OPENING_BALANCE_EQUITY, reusing ADR-071's mechanism) and DIRECT
--     (Dr INVENTORY / Cr ACCOUNTS_PAYABLE_VENDOR).
--
-- One change to an already-posting model: vendor_bill_lines gains a
-- nullable inventory_item_id and DROPS NOT NULL on expense_category_id,
-- because a line is now either an expense line or a stock line. Dropping
-- NOT NULL is unconditionally safe -- no existing row loses data, and
-- every pre-7.2 row satisfies the new CHECK since inventory_item_id is
-- NULL for all of them. Approving a bill with a stock line debits
-- INVENTORY instead of the expense account and creates the movement in the
-- same transaction as the bill's own journal -- it never posts a second
-- journal, per docs/04:464 ("do not duplicate the vendor-bill liability
-- journal").
--
-- Unlike every prior migration in this project, this SQL was produced by
-- `prisma migrate diff --from-schema-datamodel <pre-change snapshot>
-- --to-schema-datamodel <schema>` -- a fully offline file-to-file diff,
-- because the configured database host was unreachable. A side effect is
-- that it contains none of the three phantom drift lines the usual
-- --from-url diff picks up against the dev database, so nothing had to be
-- hand-excluded here.

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('OPENING', 'RECEIPT', 'CONSUMPTION', 'REVERSAL');

-- CreateEnum
CREATE TYPE "InventoryReceiptType" AS ENUM ('OPENING', 'DIRECT');

-- CreateEnum
CREATE TYPE "InventoryDocumentStatus" AS ENUM ('POSTED', 'REVERSED');

-- AlterTable
ALTER TABLE "vendor_bill_lines" ADD COLUMN     "inventory_item_id" UUID,
ALTER COLUMN "expense_category_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "movement_type" "InventoryMovementType" NOT NULL,
    "movement_date" DATE NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "quantity_in" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "quantity_out" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "unit_cost_amount" DECIMAL(19,4) NOT NULL,
    "movement_value_amount" DECIMAL(19,4) NOT NULL,
    "balance_quantity" DECIMAL(19,4) NOT NULL,
    "balance_value_amount" DECIMAL(19,4) NOT NULL,
    "weighted_average_rate" DECIMAL(19,4) NOT NULL,
    "vendor_bill_line_id" UUID,
    "inventory_receipt_id" UUID,
    "reversal_of_movement_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_receipts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "receipt_type" "InventoryReceiptType" NOT NULL,
    "party_id" UUID,
    "received_date" DATE NOT NULL,
    "invoice_challan_number" TEXT,
    "note" TEXT,
    "status" "InventoryDocumentStatus" NOT NULL DEFAULT 'POSTED',
    "total_value_amount" DECIMAL(19,4) NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "reversal_journal_entry_id" UUID,
    "reversed_at" TIMESTAMPTZ,
    "reversed_by" UUID,
    "reversal_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventory_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_receipt_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "inventory_receipt_id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "unit_cost_amount" DECIMAL(19,4) NOT NULL,
    "line_value_amount" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_inventory_movements_item_date" ON "inventory_movements"("organization_id", "inventory_item_id", "movement_date");

-- CreateIndex
CREATE INDEX "idx_inventory_movements_vendor_bill_line" ON "inventory_movements"("vendor_bill_line_id");

-- CreateIndex
CREATE INDEX "idx_inventory_movements_receipt" ON "inventory_movements"("inventory_receipt_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_inventory_movements_item_sequence" ON "inventory_movements"("organization_id", "inventory_item_id", "sequence_number");

-- CreateIndex
CREATE UNIQUE INDEX "uq_inventory_movements_id_org" ON "inventory_movements"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_inventory_receipts_org_status" ON "inventory_receipts"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_inventory_receipts_org_date" ON "inventory_receipts"("organization_id", "received_date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_inventory_receipts_org_number" ON "inventory_receipts"("organization_id", "receipt_number");

-- CreateIndex
CREATE UNIQUE INDEX "uq_inventory_receipts_id_org" ON "inventory_receipts"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_inventory_receipt_lines_receipt" ON "inventory_receipt_lines"("inventory_receipt_id");

-- CreateIndex
CREATE INDEX "idx_inventory_receipt_lines_item" ON "inventory_receipt_lines"("inventory_item_id");

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "fk_inventory_movements_item_org_consistent" FOREIGN KEY ("inventory_item_id", "organization_id") REFERENCES "inventory_items"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "fk_inventory_movements_vendor_bill_line" FOREIGN KEY ("vendor_bill_line_id") REFERENCES "vendor_bill_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "fk_inventory_movements_receipt_org_consistent" FOREIGN KEY ("inventory_receipt_id", "organization_id") REFERENCES "inventory_receipts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "fk_inventory_movements_reversal_of" FOREIGN KEY ("reversal_of_movement_id") REFERENCES "inventory_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_receipts" ADD CONSTRAINT "fk_inventory_receipts_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_receipts" ADD CONSTRAINT "fk_inventory_receipts_party_org_consistent" FOREIGN KEY ("party_id", "organization_id") REFERENCES "parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_receipt_lines" ADD CONSTRAINT "fk_inventory_receipt_lines_receipt" FOREIGN KEY ("inventory_receipt_id") REFERENCES "inventory_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_receipt_lines" ADD CONSTRAINT "fk_inventory_receipt_lines_item_org_consistent" FOREIGN KEY ("inventory_item_id", "organization_id") REFERENCES "inventory_items"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "fk_vendor_bill_lines_inventory_item_org_consistent" FOREIGN KEY ("inventory_item_id", "organization_id") REFERENCES "inventory_items"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Constraints Prisma's DSL cannot express, hand-added below.

-- A vendor bill line is EITHER an expense line or a stock line, never both
-- and never neither. This is what makes the nullable expense_category_id
-- safe: the either/or is enforced by the database, not by convention.
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "chk_vendor_bill_lines_expense_or_inventory"
  CHECK (("expense_category_id" IS NOT NULL) <> ("inventory_item_id" IS NOT NULL));

-- A movement moves stock in exactly one direction. Both-or-neither is the
-- stock analogue of the posting engine's own both-or-neither debit/credit
-- rejection (docs/06 "Mandatory posting controls").
ALTER TABLE "inventory_movements" ADD CONSTRAINT "chk_inventory_movements_one_direction"
  CHECK ("quantity_in" >= 0 AND "quantity_out" >= 0 AND (("quantity_in" > 0) <> ("quantity_out" > 0)));

-- Stock can never be negative in quantity or in value. The service layer
-- refuses to over-issue; this is the last guard behind it.
ALTER TABLE "inventory_movements" ADD CONSTRAINT "chk_inventory_movements_non_negative_balance"
  CHECK ("balance_quantity" >= 0 AND "balance_value_amount" >= 0);

-- A DIRECT receipt credits a vendor payable, so it must name the vendor.
-- An OPENING receipt credits equity and has no counterparty at all.
ALTER TABLE "inventory_receipts" ADD CONSTRAINT "chk_inventory_receipts_party_by_type"
  CHECK (("receipt_type" = 'DIRECT' AND "party_id" IS NOT NULL)
      OR ("receipt_type" = 'OPENING' AND "party_id" IS NULL));

-- A receipt line must actually receive something, at a non-negative cost
-- (zero is legitimate -- free replacement stock).
ALTER TABLE "inventory_receipt_lines" ADD CONSTRAINT "chk_inventory_receipt_lines_positive_quantity"
  CHECK ("quantity" > 0 AND "unit_cost_amount" >= 0);
