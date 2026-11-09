-- Phase 5.2: Client Receipt (multi-invoice allocation, typed deductions,
-- hold/retention release), ADR-069.

-- AlterTable (PenaltyCategory gains accepted/disputed ledger-account overrides)
ALTER TABLE "penalty_categories" ADD COLUMN "accepted_ledger_account_id" UUID;
ALTER TABLE "penalty_categories" ADD COLUMN "disputed_ledger_account_id" UUID;

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "ledger_account_id" UUID NOT NULL,
    "account_name" TEXT NOT NULL,
    "bank_name" TEXT,
    "masked_account_number" TEXT,
    "ifsc" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateEnum
CREATE TYPE "ClientReceiptStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "client_receipts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "payment_mode_id" UUID NOT NULL,
    "receipt_date" DATE NOT NULL,
    "utr_reference" TEXT,
    "actual_amount" DECIMAL(19,4) NOT NULL,
    "status" "ClientReceiptStatus" NOT NULL DEFAULT 'POSTED',
    "journal_entry_id" UUID,
    "reversal_journal_entry_id" UUID,
    "reversal_reason" TEXT,
    "reversed_by" UUID,
    "reversed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "client_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_allocations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "invoice_taxable_amount_snapshot" DECIMAL(19,4) NOT NULL,
    "invoice_cgst_snapshot" DECIMAL(19,4) NOT NULL,
    "invoice_sgst_snapshot" DECIMAL(19,4) NOT NULL,
    "invoice_igst_snapshot" DECIMAL(19,4) NOT NULL,
    "invoice_total_snapshot" DECIMAL(19,4) NOT NULL,
    "cash_allocated" DECIMAL(19,4) NOT NULL,
    "settled_amount" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateEnum
CREATE TYPE "AllocationDeductionType" AS ENUM ('TDS', 'CGST_TDS', 'SGST_TDS', 'IGST_TDS', 'HOLD', 'RETENTION', 'ACCEPTED_PENALTY', 'DISPUTED_PENALTY', 'OTHER');

-- CreateTable
CREATE TABLE "allocation_deductions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "allocation_id" UUID NOT NULL,
    "type" "AllocationDeductionType" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "rate_percent" DECIMAL(5,2),
    "penalty_category_id" UUID,
    "other_ledger_account_id" UUID,
    "narrative" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deduction_releases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deduction_id" UUID NOT NULL,
    "released_amount" DECIMAL(19,4) NOT NULL,
    "released_on" DATE NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "utr_reference" TEXT,
    "journal_entry_id" UUID,
    "actor_id" UUID,
    "correlation_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deduction_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_bank_accounts_id_org" ON "bank_accounts"("id", "organization_id");
CREATE INDEX "idx_bank_accounts_legal_entity_id" ON "bank_accounts"("legal_entity_id");

-- CreateIndex
CREATE INDEX "idx_client_receipts_org_legal_entity" ON "client_receipts"("organization_id", "legal_entity_id");

-- CreateIndex
CREATE INDEX "idx_receipt_allocations_receipt_id" ON "receipt_allocations"("receipt_id");
CREATE INDEX "idx_receipt_allocations_invoice_id" ON "receipt_allocations"("invoice_id");

-- CreateIndex
CREATE INDEX "idx_allocation_deductions_allocation_id" ON "allocation_deductions"("allocation_id");

-- CreateIndex
CREATE INDEX "idx_deduction_releases_deduction_id" ON "deduction_releases"("deduction_id");

-- AddForeignKey (PenaltyCategory accepted/disputed ledger accounts)
ALTER TABLE "penalty_categories" ADD CONSTRAINT "fk_penalty_categories_accepted_ledger_account_org_consistent" FOREIGN KEY ("accepted_ledger_account_id", "organization_id") REFERENCES "ledger_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "penalty_categories" ADD CONSTRAINT "fk_penalty_categories_disputed_ledger_account_org_consistent" FOREIGN KEY ("disputed_ledger_account_id", "organization_id") REFERENCES "ledger_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "penalty_categories" ADD CONSTRAINT "uq_penalty_categories_id_org" UNIQUE ("id", "organization_id");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "fk_bank_accounts_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_accounts" ADD CONSTRAINT "fk_bank_accounts_ledger_account_org_consistent" FOREIGN KEY ("ledger_account_id", "organization_id") REFERENCES "ledger_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_receipts" ADD CONSTRAINT "fk_client_receipts_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_receipts" ADD CONSTRAINT "fk_client_receipts_bank_account_org_consistent" FOREIGN KEY ("bank_account_id", "organization_id") REFERENCES "bank_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_receipts" ADD CONSTRAINT "fk_client_receipts_payment_mode" FOREIGN KEY ("payment_mode_id") REFERENCES "payment_modes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_receipts" ADD CONSTRAINT "fk_client_receipts_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "client_receipts" ADD CONSTRAINT "fk_client_receipts_reversal_journal_entry" FOREIGN KEY ("reversal_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "fk_receipt_allocations_receipt" FOREIGN KEY ("receipt_id") REFERENCES "client_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "fk_receipt_allocations_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_deductions" ADD CONSTRAINT "fk_allocation_deductions_allocation" FOREIGN KEY ("allocation_id") REFERENCES "receipt_allocations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "allocation_deductions" ADD CONSTRAINT "fk_allocation_deductions_penalty_category_org_consistent" FOREIGN KEY ("penalty_category_id", "organization_id") REFERENCES "penalty_categories"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allocation_deductions" ADD CONSTRAINT "fk_allocation_deductions_other_ledger_account_org_consistent" FOREIGN KEY ("other_ledger_account_id", "organization_id") REFERENCES "ledger_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deduction_releases" ADD CONSTRAINT "fk_deduction_releases_deduction" FOREIGN KEY ("deduction_id") REFERENCES "allocation_deductions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deduction_releases" ADD CONSTRAINT "fk_deduction_releases_bank_account_org_consistent" FOREIGN KEY ("bank_account_id", "organization_id") REFERENCES "bank_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deduction_releases" ADD CONSTRAINT "fk_deduction_releases_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
