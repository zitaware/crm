-- Phase 6.3 (Payment Request, ADR-078) -- the maker-checker
-- authorization/reservation gate between VendorBill (Phase 6.2) and the
-- not-yet-built VendorPayment (Phase 6.4). Purely additive: two new enums,
-- three new tables, one new composite-unique support constraint on the
-- pre-existing vendor_bills table (PaymentRequestLine is the first model
-- that needs an org-consistent composite FK into it). No data migration.
--
-- Hand-curated from `prisma migrate diff`: three unrelated phantom
-- drop/index lines that the raw diff always proposes for hand-added
-- constraints Prisma's schema DSL can't represent (chk_cities_state_
-- matches_district, uq_districts_id_state_id, idx_invoices_payment_
-- alert_id -- all pre-existing, from earlier migrations) were excluded,
-- matching every prior migration in this project.

-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PaymentRequestDecisionType" AS ENUM ('APPROVED', 'REJECTED', 'REVOKED');

-- CreateTable
CREATE TABLE "payment_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "request_number" TEXT,
    "vendor_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "requested_payment_date" DATE NOT NULL,
    "priority" "PurchaseRequestPriority" NOT NULL DEFAULT 'NORMAL',
    "remarks" TEXT,
    "total_requested_amount" DECIMAL(19,4),
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by" UUID,
    "cancelled_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_request_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "payment_request_id" UUID NOT NULL,
    "vendor_bill_id" UUID NOT NULL,
    "requested_amount" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_request_decisions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "payment_request_id" UUID NOT NULL,
    "decision" "PaymentRequestDecisionType" NOT NULL,
    "actor_id" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "is_self_approval" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "payment_request_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_payment_requests_org_status" ON "payment_requests"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_payment_requests_vendor_id" ON "payment_requests"("vendor_id");

-- CreateIndex
CREATE INDEX "idx_payment_requests_legal_entity_id" ON "payment_requests"("legal_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_payment_requests_org_number" ON "payment_requests"("organization_id", "request_number");

-- CreateIndex
CREATE INDEX "idx_payment_request_lines_request_id" ON "payment_request_lines"("payment_request_id");

-- CreateIndex
CREATE INDEX "idx_payment_request_lines_vendor_bill_id" ON "payment_request_lines"("vendor_bill_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_payment_request_lines_request_bill" ON "payment_request_lines"("payment_request_id", "vendor_bill_id");

-- CreateIndex
CREATE INDEX "idx_payment_request_decisions_request_id" ON "payment_request_decisions"("payment_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_vendor_bills_id_org" ON "vendor_bills"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "fk_payment_requests_vendor_org_consistent" FOREIGN KEY ("vendor_id", "organization_id") REFERENCES "parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "fk_payment_requests_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_lines" ADD CONSTRAINT "fk_payment_request_lines_request" FOREIGN KEY ("payment_request_id") REFERENCES "payment_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_lines" ADD CONSTRAINT "fk_payment_request_lines_vendor_bill_org_consistent" FOREIGN KEY ("vendor_bill_id", "organization_id") REFERENCES "vendor_bills"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_decisions" ADD CONSTRAINT "fk_payment_request_decisions_request" FOREIGN KEY ("payment_request_id") REFERENCES "payment_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
