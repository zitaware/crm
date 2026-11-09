-- Phase 6.4: merge Purchase Request into Vendor Bill (ADR-079).
-- Generated via `npm run prisma:migrate:diff` and hand-curated: the raw
-- diff also proposed dropping three pre-existing, unrelated hand-added
-- constraints/indexes (chk_cities_state_matches_district,
-- uq_districts_id_state_id, idx_invoices_payment_alert_id) that Prisma's
-- schema DSL cannot represent and therefore always appears to want to drop
-- — deliberately omitted here, per docs/07-database-conventions.md's
-- "Migration development procedure".
--
-- One further hand-curation beyond the standard three-line exclusion: the
-- raw diff represented PurchaseRequestPriority -> VendorBillPriority as
-- "drop the old enum, create a new one, then DROP COLUMN + ADD COLUMN
-- payment_requests.priority" — which would have silently destroyed every
-- existing PaymentRequest row's own priority value. Replaced below with a
-- plain `ALTER TYPE ... RENAME TO`, which Postgres supports natively and
-- which correctly leaves payment_requests.priority's data untouched (its
-- column type is simply renamed out from under it, not recreated).

-- Rename (not drop-and-recreate) the enum PaymentRequest.priority already
-- depends on — see header note above.
ALTER TYPE "PurchaseRequestPriority" RENAME TO "VendorBillPriority";

-- CreateEnum
CREATE TYPE "VendorBillDecisionType" AS ENUM ('APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "VendorBillStatus" ADD VALUE 'SUBMITTED';
ALTER TYPE "VendorBillStatus" ADD VALUE 'REJECTED';
ALTER TYPE "VendorBillStatus" ADD VALUE 'CANCELLED';

-- DropForeignKey
ALTER TABLE "purchase_request_decisions" DROP CONSTRAINT "fk_purchase_request_decisions_request";

-- DropForeignKey
ALTER TABLE "purchase_request_lines" DROP CONSTRAINT "fk_purchase_request_lines_request";

-- DropForeignKey
ALTER TABLE "purchase_requests" DROP CONSTRAINT "fk_purchase_requests_expense_category_org_consistent";

-- DropForeignKey
ALTER TABLE "purchase_requests" DROP CONSTRAINT "fk_purchase_requests_project_org_consistent";

-- DropForeignKey
ALTER TABLE "purchase_requests" DROP CONSTRAINT "fk_purchase_requests_vendor_org_consistent";

-- DropForeignKey
ALTER TABLE "vendor_bills" DROP CONSTRAINT "fk_vendor_bills_purchase_request";

-- DropIndex
DROP INDEX "idx_vendor_bills_purchase_request_id";

-- AlterTable
ALTER TABLE "vendor_bills"
  DROP COLUMN "purchase_request_id",
  ADD COLUMN "priority" "VendorBillPriority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "submitted_at" TIMESTAMPTZ,
  ADD COLUMN "cancelled_at" TIMESTAMPTZ,
  ADD COLUMN "cancelled_by" UUID,
  ADD COLUMN "cancelled_reason" TEXT;

-- DropTable
DROP TABLE "purchase_request_decisions";

-- DropTable
DROP TABLE "purchase_request_lines";

-- DropTable
DROP TABLE "purchase_requests";

-- DropEnum
DROP TYPE "PurchaseRequestDecisionType";

-- DropEnum
DROP TYPE "PurchaseRequestStatus";

-- DropEnum
DROP TYPE "PurchaseRequestSupplyType";

-- CreateTable
CREATE TABLE "vendor_bill_decisions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "vendor_bill_id" UUID NOT NULL,
    "decision" "VendorBillDecisionType" NOT NULL,
    "actor_id" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "is_self_approval" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "vendor_bill_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_vendor_bill_decisions_vendor_bill_id" ON "vendor_bill_decisions"("vendor_bill_id");

-- CreateIndex
CREATE INDEX "idx_vendor_bills_vendor_id" ON "vendor_bills"("vendor_id");

-- AddForeignKey
ALTER TABLE "vendor_bill_decisions" ADD CONSTRAINT "fk_vendor_bill_decisions_vendor_bill" FOREIGN KEY ("vendor_bill_id") REFERENCES "vendor_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
