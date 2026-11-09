-- Phase 7, Slice 7.3 — Inventory Consumption (ADR-093).
--
-- Adds the one document that takes stock OUT of the ledger for a business
-- reason, implementing docs/06's "Inventory / Project consumption" rule
-- (Dr Project Material Cost; Cr Inventory, at weighted average) and
-- docs/04 §14's inventory-add-consumption.html contract.
--
-- Two new tables plus one nullable column on inventory_movements — the
-- third and final movement source, kept as a real FK per source exactly
-- as vendor_bill_line_id and inventory_receipt_id already are. Adding a
-- nullable column and new tables is unconditionally safe on existing data.
--
-- Hand-curated from `prisma migrate diff --from-url`, excluding the same
-- three known phantom lines (chk_cities_state_matches_district,
-- uq_districts_id_state_id, idx_invoices_payment_alert_id) every prior
-- migration in this project excludes.

-- AlterTable
ALTER TABLE "inventory_movements" ADD COLUMN     "inventory_consumption_id" UUID;

-- CreateTable
CREATE TABLE "inventory_consumptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "consumption_number" TEXT NOT NULL,
    "project_id" UUID NOT NULL,
    "consumed_date" DATE NOT NULL,
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

    CONSTRAINT "inventory_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_consumption_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "inventory_consumption_id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "unit_cost_amount" DECIMAL(19,4) NOT NULL,
    "line_value_amount" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_consumption_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_inventory_consumptions_org_status" ON "inventory_consumptions"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_inventory_consumptions_org_date" ON "inventory_consumptions"("organization_id", "consumed_date");

-- CreateIndex
CREATE INDEX "idx_inventory_consumptions_org_project" ON "inventory_consumptions"("organization_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_inventory_consumptions_org_number" ON "inventory_consumptions"("organization_id", "consumption_number");

-- CreateIndex
CREATE UNIQUE INDEX "uq_inventory_consumptions_id_org" ON "inventory_consumptions"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_inventory_consumption_lines_consumption" ON "inventory_consumption_lines"("inventory_consumption_id");

-- CreateIndex
CREATE INDEX "idx_inventory_consumption_lines_item" ON "inventory_consumption_lines"("inventory_item_id");

-- CreateIndex
CREATE INDEX "idx_inventory_movements_consumption" ON "inventory_movements"("inventory_consumption_id");

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "fk_inventory_movements_consumption_org_consistent" FOREIGN KEY ("inventory_consumption_id", "organization_id") REFERENCES "inventory_consumptions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "fk_inventory_consumptions_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "fk_inventory_consumptions_project_org_consistent" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_consumption_lines" ADD CONSTRAINT "fk_inventory_consumption_lines_consumption" FOREIGN KEY ("inventory_consumption_id") REFERENCES "inventory_consumptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_consumption_lines" ADD CONSTRAINT "fk_inventory_consumption_lines_item_org_consistent" FOREIGN KEY ("inventory_item_id", "organization_id") REFERENCES "inventory_items"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added CHECK: a consumption line must move a real, positive quantity,
-- and can never be valued negatively. Mirrors
-- chk_inventory_receipt_lines_positive_quantity on the inbound side, so
-- neither direction of the stock ledger can be fed a degenerate line even
-- if a future caller bypasses the service.
ALTER TABLE "inventory_consumption_lines" ADD CONSTRAINT "chk_inventory_consumption_lines_positive_quantity"
  CHECK ("quantity" > 0 AND "unit_cost_amount" >= 0 AND "line_value_amount" >= 0);

-- Hand-added CHECK: a posted consumption carries a value; only a reversal
-- may name a reversal journal. Keeps the reversal fields from being set
-- independently of the status they describe.
ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "chk_inventory_consumptions_reversal_fields"
  CHECK (("status" = 'REVERSED' AND "reversal_journal_entry_id" IS NOT NULL AND "reversed_at" IS NOT NULL)
      OR ("status" = 'POSTED'   AND "reversal_journal_entry_id" IS NULL     AND "reversed_at" IS NULL));
