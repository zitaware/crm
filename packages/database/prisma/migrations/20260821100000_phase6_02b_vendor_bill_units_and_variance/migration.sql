-- Phase 6.2 polish: Vendor Bill units of measure (ADR-076).
-- Generated via `npm run prisma:migrate:diff` and hand-curated: the raw
-- diff also proposed dropping three pre-existing, unrelated hand-added
-- constraints/indexes (chk_cities_state_matches_district,
-- uq_districts_id_state_id, idx_invoices_payment_alert_id) that Prisma's
-- schema DSL cannot represent and therefore always appears to want to drop
-- — deliberately omitted here, per docs/07-database-conventions.md's
-- "Migration development procedure".
--
-- unit_of_measure_id is nullable at the DB layer despite being required by
-- every new create/update call (enforced in the zod schema, not here) --
-- one real, already-VOID vendor_bill_lines row predates this column with
-- no UnitOfMeasure data to backfill it from. Same nullable shape as the
-- existing expense_categories.ledger_account_id column on a sibling table.

-- CreateTable
CREATE TABLE "units_of_measure" (
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

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_units_of_measure_org_code" ON "units_of_measure"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_units_of_measure_id_org" ON "units_of_measure"("id", "organization_id");

-- AlterTable
ALTER TABLE "vendor_bill_lines" ADD COLUMN     "unit_of_measure_id" UUID;

-- AddForeignKey
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "fk_vendor_bill_lines_unit_of_measure_org_consistent" FOREIGN KEY ("unit_of_measure_id", "organization_id") REFERENCES "units_of_measure"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
