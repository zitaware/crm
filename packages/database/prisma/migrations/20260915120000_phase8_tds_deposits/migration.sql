-- Phase 8.5b (ADR-113) — TDS and GST-TDS deposits (challans) and their
-- allocations to the withheld amounts they pay. Posts docs/06 "TDS deposited".

-- CreateEnum
CREATE TYPE "TdsDepositStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "TdsOutwardSourceKind" AS ENUM ('VENDOR_PAYMENT_DEDUCTION', 'DIRECT_EXPENSE', 'INTRODUCER_PAYMENT', 'SALARY_PAYMENT_LINE');

-- CreateTable
CREATE TABLE "tds_deposits" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "deduction_type" "TaxDeductionType" NOT NULL,
    "challan_number" TEXT NOT NULL,
    "deposit_date" DATE NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "remarks" TEXT,
    "status" "TdsDepositStatus" NOT NULL DEFAULT 'POSTED',
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

    CONSTRAINT "tds_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tds_deposit_allocations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deposit_id" UUID NOT NULL,
    "source_kind" "TdsOutwardSourceKind" NOT NULL,
    "source_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tds_deposit_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_tds_deposits_org_status" ON "tds_deposits"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_tds_deposits_org_date" ON "tds_deposits"("organization_id", "deposit_date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tds_deposits_challan" ON "tds_deposits"("organization_id", "deduction_type", "challan_number");

-- CreateIndex
CREATE INDEX "idx_tds_deposit_allocations_source" ON "tds_deposit_allocations"("organization_id", "source_kind", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tds_deposit_allocations_source" ON "tds_deposit_allocations"("deposit_id", "source_kind", "source_id");

-- AddForeignKey
ALTER TABLE "tds_deposits" ADD CONSTRAINT "fk_tds_deposits_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tds_deposits" ADD CONSTRAINT "fk_tds_deposits_bank_account_org_consistent" FOREIGN KEY ("bank_account_id", "organization_id") REFERENCES "bank_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tds_deposits" ADD CONSTRAINT "fk_tds_deposits_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tds_deposits" ADD CONSTRAINT "fk_tds_deposits_reversal_journal_entry" FOREIGN KEY ("reversal_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tds_deposit_allocations" ADD CONSTRAINT "fk_tds_deposit_allocations_deposit" FOREIGN KEY ("deposit_id") REFERENCES "tds_deposits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-added CHECKs: real amounts; a reversal always carries its journal, who and when.
ALTER TABLE "tds_deposits" ADD CONSTRAINT "chk_tds_deposits_amount" CHECK ("amount" > 0);
ALTER TABLE "tds_deposits" ADD CONSTRAINT "chk_tds_deposits_reversal"
  CHECK (("status" = 'REVERSED') = ("reversal_journal_entry_id" IS NOT NULL AND "reversed_at" IS NOT NULL));
ALTER TABLE "tds_deposit_allocations" ADD CONSTRAINT "chk_tds_deposit_allocations_amount" CHECK ("amount" > 0);
