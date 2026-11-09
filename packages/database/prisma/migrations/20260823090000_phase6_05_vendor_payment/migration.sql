-- Phase 6.5 (Vendor Payment, ADR-080) -- the final step of the procurement
-- chain that actually moves money: VendorBill (6.2/6.4) -> PaymentRequest
-- (6.3, authorization only) -> VendorPayment (this migration). Purely
-- additive: two new enums, three new tables. No data migration.
--
-- Hand-curated from `prisma migrate diff`: three unrelated phantom
-- drop/index lines that the raw diff always proposes for hand-added
-- constraints Prisma's schema DSL can't represent (chk_cities_state_
-- matches_district, uq_districts_id_state_id, idx_invoices_payment_
-- alert_id -- all pre-existing, from earlier migrations) were excluded,
-- matching every prior migration in this project.

-- CreateEnum
CREATE TYPE "VendorPaymentStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "VendorPaymentDeductionType" AS ENUM ('TDS', 'CGST_TDS', 'SGST_TDS', 'IGST_TDS');

-- CreateTable
CREATE TABLE "vendor_payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "payment_mode_id" UUID NOT NULL,
    "payment_date" DATE NOT NULL,
    "utr_reference" TEXT,
    "actual_amount" DECIMAL(19,4) NOT NULL,
    "status" "VendorPaymentStatus" NOT NULL DEFAULT 'POSTED',
    "journal_entry_id" UUID,
    "reversal_journal_entry_id" UUID,
    "reversal_reason" TEXT,
    "reversed_by" UUID,
    "reversed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "vendor_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_payment_allocations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "payment_request_line_id" UUID NOT NULL,
    "vendor_bill_taxable_amount_snapshot" DECIMAL(19,4) NOT NULL,
    "requested_amount_snapshot" DECIMAL(19,4) NOT NULL,
    "cash_paid" DECIMAL(19,4) NOT NULL,
    "settled_amount" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_payment_deductions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "allocation_id" UUID NOT NULL,
    "type" "VendorPaymentDeductionType" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "rate_percent" DECIMAL(5,2),
    "narrative" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_payment_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_vendor_payments_org_legal_entity" ON "vendor_payments"("organization_id", "legal_entity_id");

-- CreateIndex
CREATE INDEX "idx_vendor_payment_allocations_payment_id" ON "vendor_payment_allocations"("payment_id");

-- CreateIndex
CREATE INDEX "idx_vendor_payment_allocations_request_line_id" ON "vendor_payment_allocations"("payment_request_line_id");

-- CreateIndex
CREATE INDEX "idx_vendor_payment_deductions_allocation_id" ON "vendor_payment_deductions"("allocation_id");

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "fk_vendor_payments_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "fk_vendor_payments_bank_account_org_consistent" FOREIGN KEY ("bank_account_id", "organization_id") REFERENCES "bank_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "fk_vendor_payments_payment_mode" FOREIGN KEY ("payment_mode_id") REFERENCES "payment_modes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "fk_vendor_payments_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "fk_vendor_payments_reversal_journal_entry" FOREIGN KEY ("reversal_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payment_allocations" ADD CONSTRAINT "fk_vendor_payment_allocations_payment" FOREIGN KEY ("payment_id") REFERENCES "vendor_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payment_allocations" ADD CONSTRAINT "fk_vendor_payment_allocations_request_line" FOREIGN KEY ("payment_request_line_id") REFERENCES "payment_request_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payment_deductions" ADD CONSTRAINT "fk_vendor_payment_deductions_allocation" FOREIGN KEY ("allocation_id") REFERENCES "vendor_payment_allocations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
