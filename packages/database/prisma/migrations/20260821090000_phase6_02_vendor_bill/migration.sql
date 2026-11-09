-- Phase 6.2: Vendor Bill (ADR-075).
-- Generated via `npm run prisma:migrate:diff` and hand-curated: the raw
-- diff also proposed dropping three pre-existing, unrelated hand-added
-- constraints/indexes (chk_cities_state_matches_district,
-- uq_districts_id_state_id, idx_invoices_payment_alert_id) that Prisma's
-- schema DSL cannot represent and therefore always appears to want to drop
-- — deliberately omitted here, per docs/07-database-conventions.md's
-- "Migration development procedure". No hand-added CHECK constraints on
-- vendor_bill_lines' amount columns, matching invoice_lines' own precedent
-- (Phase 5.1 migration) exactly — validation lives in the shared
-- computeLines() helper this slice reuses, not the database layer.

-- CreateEnum
CREATE TYPE "VendorBillStatus" AS ENUM ('DRAFT', 'FINALIZED', 'VOID');

-- AlterTable
ALTER TABLE "expense_categories" ADD COLUMN     "ledger_account_id" UUID;

-- CreateTable
CREATE TABLE "vendor_bills" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "purchase_request_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "gst_registration_id" UUID NOT NULL,
    "financial_year_id" UUID,
    "vendor_bill_number" TEXT NOT NULL,
    "vendor_bill_date" DATE NOT NULL,
    "status" "VendorBillStatus" NOT NULL DEFAULT 'DRAFT',
    "taxable_amount" DECIMAL(19,4),
    "cgst_amount" DECIMAL(19,4),
    "sgst_amount" DECIMAL(19,4),
    "igst_amount" DECIMAL(19,4),
    "total_amount" DECIMAL(19,4),
    "journal_entry_id" UUID,
    "void_journal_entry_id" UUID,
    "void_reason" TEXT,
    "voided_by" UUID,
    "voided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "vendor_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bill_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "vendor_bill_id" UUID NOT NULL,
    "expense_category_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "hsn_sac" TEXT,
    "quantity" DECIMAL(19,4) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(19,4) NOT NULL,
    "taxable_amount" DECIMAL(19,4) NOT NULL,
    "gst_rate_percent" DECIMAL(5,2) NOT NULL,
    "cgst_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "sgst_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "igst_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "itc_eligible" BOOLEAN NOT NULL DEFAULT true,
    "line_total" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_vendor_bills_purchase_request_id" ON "vendor_bills"("purchase_request_id");

-- CreateIndex
CREATE INDEX "idx_vendor_bills_project_id" ON "vendor_bills"("project_id");

-- CreateIndex
CREATE INDEX "idx_vendor_bills_org_status" ON "vendor_bills"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_vendor_bill_lines_vendor_bill_id" ON "vendor_bill_lines"("vendor_bill_id");

-- CreateIndex (partial unique -- the same vendor invoice can't be recorded
-- twice while active, but a voided entry's number can be reused).
CREATE UNIQUE INDEX "uq_vendor_bills_vendor_number" ON "vendor_bills"("organization_id", "vendor_id", "vendor_bill_number") WHERE "status" != 'VOID';

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "fk_expense_categories_ledger_account_org_consistent" FOREIGN KEY ("ledger_account_id", "organization_id") REFERENCES "ledger_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "fk_vendor_bills_purchase_request" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "fk_vendor_bills_project_org_consistent" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "fk_vendor_bills_vendor_org_consistent" FOREIGN KEY ("vendor_id", "organization_id") REFERENCES "parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "fk_vendor_bills_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "fk_vendor_bills_gst_registration_org_consistent" FOREIGN KEY ("gst_registration_id", "organization_id") REFERENCES "gst_registrations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "fk_vendor_bills_financial_year_org_consistent" FOREIGN KEY ("financial_year_id", "organization_id") REFERENCES "financial_years"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "fk_vendor_bills_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "fk_vendor_bills_void_journal_entry" FOREIGN KEY ("void_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "fk_vendor_bill_lines_vendor_bill" FOREIGN KEY ("vendor_bill_id") REFERENCES "vendor_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "fk_vendor_bill_lines_expense_category_org_consistent" FOREIGN KEY ("expense_category_id", "organization_id") REFERENCES "expense_categories"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
