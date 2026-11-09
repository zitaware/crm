-- Phase 7.1 (docs/12 ADR-091): Product / item master.
--
-- Two tables:
--   * product_categories -- a 15th generic MasterTypeKey, flat baseline shape,
--     served by the existing MastersService. Deliberately carries no
--     ledger_account_id (unlike expense_categories): inventory always debits
--     the single INVENTORY account regardless of category, per docs/06's
--     "Finalize vendor bill for inventory" rule.
--   * inventory_items -- a dedicated model, NOT a generic master, because it
--     carries five columns beyond the flat baseline (unit of measure,
--     category, HSN/SAC, default rate, is_stock_tracked). Same precedent as
--     expense_categories and penalty_categories, both forced out of the
--     generic registry for exactly this reason (ADR-037/044/062).
--
-- is_stock_tracked is docs/01's own discriminator -- "stock-tracked items use
-- Inventory; non-stock goods/services use Expense". No fixed-asset or
-- depreciation columns, ever (ADR-018, docs/04 section 14, docs/16 section 7.7).
--
-- Both FKs are composite (id, organization_id) org-consistency constraints per
-- docs/07 and ADR-039, backed by the uq_*_id_org support indexes.
--
-- The 3 lines intentionally NOT included below (chk_cities_state_matches_district
-- drop, uq_districts_id_state_id drop, idx_invoices_payment_alert_id drop) are
-- known phantom diff noise from `prisma migrate diff` against this dev
-- database, unrelated to this change -- excluded the same way every prior
-- hand-curated migration in this project excludes them.

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit_of_measure_id" UUID NOT NULL,
    "product_category_id" UUID,
    "hsn_sac" TEXT,
    "default_rate_amount" DECIMAL(19,4),
    "is_stock_tracked" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_product_categories_org_code" ON "product_categories"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_product_categories_id_org" ON "product_categories"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_inventory_items_org_active" ON "inventory_items"("organization_id", "is_active");

-- CreateIndex
CREATE INDEX "idx_inventory_items_org_category" ON "inventory_items"("organization_id", "product_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_inventory_items_org_code" ON "inventory_items"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_inventory_items_id_org" ON "inventory_items"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "fk_inventory_items_unit_of_measure_org_consistent" FOREIGN KEY ("unit_of_measure_id", "organization_id") REFERENCES "units_of_measure"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "fk_inventory_items_product_category_org_consistent" FOREIGN KEY ("product_category_id", "organization_id") REFERENCES "product_categories"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
