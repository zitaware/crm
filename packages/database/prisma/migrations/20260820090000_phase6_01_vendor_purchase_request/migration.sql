-- Phase 6.1: Vendor Master + Purchase Request (ADR-074).
-- Generated via `npm run prisma:migrate:diff` and hand-curated: the raw
-- diff also proposed dropping three pre-existing, unrelated hand-added
-- constraints/indexes (chk_cities_state_matches_district,
-- uq_districts_id_state_id, idx_invoices_payment_alert_id) that Prisma's
-- schema DSL cannot represent and therefore always appears to want to drop
-- — those three lines are deliberately omitted here, per the hand-edit
-- workflow documented in docs/07-database-conventions.md "Migration
-- development procedure". CHECK constraints and the partial-unique GSTIN
-- index below are hand-added for the same reason (no Prisma DSL primitive).

-- CreateEnum
CREATE TYPE "VendorPaymentTerms" AS ENUM ('ADVANCE', 'NET_15', 'NET_30', 'NET_45');

-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseRequestPriority" AS ENUM ('NORMAL', 'URGENT', 'LOW');

-- CreateEnum
CREATE TYPE "PurchaseRequestSupplyType" AS ENUM ('INTRASTATE', 'INTERSTATE');

-- CreateEnum
CREATE TYPE "PurchaseRequestDecisionType" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "vendor_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "gstin" TEXT,
    "pan_number" TEXT,
    "payment_terms" "VendorPaymentTerms",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "vendor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "request_number" TEXT,
    "project_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "expense_category_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "PurchaseRequestPriority" NOT NULL DEFAULT 'NORMAL',
    "gst_invoice_available" BOOLEAN NOT NULL DEFAULT true,
    "itc_available" BOOLEAN NOT NULL DEFAULT false,
    "supply_type" "PurchaseRequestSupplyType",
    "taxable_amount" DECIMAL(19,4),
    "cgst_amount" DECIMAL(19,4),
    "sgst_amount" DECIMAL(19,4),
    "igst_amount" DECIMAL(19,4),
    "total_gst" DECIMAL(19,4),
    "grand_total" DECIMAL(19,4),
    "estimated_amount" DECIMAL(19,4),
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by" UUID,
    "cancelled_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "purchase_request_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_decisions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "purchase_request_id" UUID NOT NULL,
    "decision" "PurchaseRequestDecisionType" NOT NULL,
    "actor_id" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "is_self_approval" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "purchase_request_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_vendor_profiles_organization_id" ON "vendor_profiles"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_vendor_profiles_party_id_org" ON "vendor_profiles"("party_id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_purchase_requests_org_status" ON "purchase_requests"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_purchase_requests_project_id" ON "purchase_requests"("project_id");

-- CreateIndex
CREATE INDEX "idx_purchase_requests_vendor_id" ON "purchase_requests"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_purchase_requests_org_number" ON "purchase_requests"("organization_id", "request_number");

-- CreateIndex
CREATE INDEX "idx_purchase_request_lines_request_id" ON "purchase_request_lines"("purchase_request_id");

-- CreateIndex
CREATE INDEX "idx_purchase_request_decisions_request_id" ON "purchase_request_decisions"("purchase_request_id");

-- CreateIndex (composite-unique support constraint so PurchaseRequest.
-- expenseCategoryId can enforce organization consistency via a real
-- composite FK, same precedent as uq_penalty_categories_id_org etc.)
CREATE UNIQUE INDEX "uq_expense_categories_id_org" ON "expense_categories"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "vendor_profiles" ADD CONSTRAINT "fk_vendor_profiles_party_org_consistent" FOREIGN KEY ("party_id", "organization_id") REFERENCES "parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "fk_purchase_requests_project_org_consistent" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "fk_purchase_requests_vendor_org_consistent" FOREIGN KEY ("vendor_id", "organization_id") REFERENCES "parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "fk_purchase_requests_expense_category_org_consistent" FOREIGN KEY ("expense_category_id", "organization_id") REFERENCES "expense_categories"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "fk_purchase_request_lines_request" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_decisions" ADD CONSTRAINT "fk_purchase_request_decisions_request" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added CHECK/partial-unique constraints below (Prisma's schema DSL
-- has no primitive for either).

-- Same 15-character GSTIN format as chk_client_profiles_gstin_format /
-- chk_gst_registrations_gstin_format, nullable.
ALTER TABLE "vendor_profiles" ADD CONSTRAINT "chk_vendor_profiles_gstin_format"
  CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$');

-- Standard 10-character Indian PAN format, nullable.
ALTER TABLE "vendor_profiles" ADD CONSTRAINT "chk_vendor_profiles_pan_format"
  CHECK ("pan_number" IS NULL OR "pan_number" ~ '^[A-Z]{5}[0-9]{4}[A-Z]{1}$');

-- Exact-GSTIN-duplicate rejection at the database layer, defense-in-depth
-- alongside VendorsService's own pre-insert check (§1 of the Phase 6.1
-- plan). Partial: only enforced among non-null, non-deleted rows, same
-- precedent as uq_legal_entities_org_pan / uq_gst_registrations_gstin.
CREATE UNIQUE INDEX "uq_vendor_profiles_org_gstin" ON "vendor_profiles"("organization_id", "gstin") WHERE "gstin" IS NOT NULL AND "deleted_at" IS NULL;

ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "chk_purchase_request_lines_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "purchase_requests" ADD CONSTRAINT "chk_purchase_requests_taxable_amount_nonneg" CHECK ("taxable_amount" IS NULL OR "taxable_amount" >= 0);
ALTER TABLE "purchase_requests" ADD CONSTRAINT "chk_purchase_requests_cgst_amount_nonneg" CHECK ("cgst_amount" IS NULL OR "cgst_amount" >= 0);
ALTER TABLE "purchase_requests" ADD CONSTRAINT "chk_purchase_requests_sgst_amount_nonneg" CHECK ("sgst_amount" IS NULL OR "sgst_amount" >= 0);
ALTER TABLE "purchase_requests" ADD CONSTRAINT "chk_purchase_requests_igst_amount_nonneg" CHECK ("igst_amount" IS NULL OR "igst_amount" >= 0);
ALTER TABLE "purchase_requests" ADD CONSTRAINT "chk_purchase_requests_total_gst_nonneg" CHECK ("total_gst" IS NULL OR "total_gst" >= 0);
ALTER TABLE "purchase_requests" ADD CONSTRAINT "chk_purchase_requests_grand_total_nonneg" CHECK ("grand_total" IS NULL OR "grand_total" >= 0);
ALTER TABLE "purchase_requests" ADD CONSTRAINT "chk_purchase_requests_estimated_amount_nonneg" CHECK ("estimated_amount" IS NULL OR "estimated_amount" >= 0);

-- Phase 6.1 plan §3: gstInvoiceAvailable=false clears itc/supplyType/CGST/
-- SGST/IGST entirely; gstInvoiceAvailable=true requires a supplyType, and
-- INTRASTATE/INTERSTATE each zero out the tax component that cannot apply
-- to them. Enforced at every write (create/update/submit), not just
-- submit, since PurchaseRequestsService always resolves this whole group
-- of fields together in one command, never as a partial patch — see
-- PurchaseRequestsService's own doc comment.
ALTER TABLE "purchase_requests" ADD CONSTRAINT "chk_purchase_requests_gst_fields_consistent" CHECK (
  (
    "gst_invoice_available" = false
    AND "itc_available" = false
    AND "supply_type" IS NULL
    AND "cgst_amount" IS NULL
    AND "sgst_amount" IS NULL
    AND "igst_amount" IS NULL
  )
  OR
  (
    "gst_invoice_available" = true
    AND "supply_type" IS NOT NULL
    AND (
      ("supply_type" = 'INTRASTATE' AND ("igst_amount" IS NULL OR "igst_amount" = 0))
      OR
      ("supply_type" = 'INTERSTATE' AND ("cgst_amount" IS NULL OR "cgst_amount" = 0) AND ("sgst_amount" IS NULL OR "sgst_amount" = 0))
    )
  )
);
