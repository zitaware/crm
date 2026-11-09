-- Phase 7, Slice 7.6 — Introducer agreement, accrual, payment and allocation
-- (ADR-096). The last of Phase 7's three verticals.
--
-- Implements docs/04 §15's three screens and docs/06's "Introducer" rules:
-- accrual is Dr Introducer Commission Expense / Cr Introducer Payable;
-- payment "follows vendor-style payable settlement with TDS where
-- applicable", and "excess payment posts to Introducer Advance Receivable".
--
-- Four new tables and two new enums; nothing existing is altered, so this is
-- unconditionally safe on existing data.
--
-- Hand-curated from `prisma migrate diff --from-url`, excluding the same
-- three known phantom lines every prior migration in this project excludes.

-- CreateEnum
CREATE TYPE "IntroducerCommissionBasis" AS ENUM ('PERCENT_OF_PROJECT_VALUE', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "IntroducerDocumentStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "introducer_agreements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "introducer_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "basis_type" "IntroducerCommissionBasis" NOT NULL,
    "rate_percent" DECIMAL(9,4),
    "fixed_amount" DECIMAL(19,4),
    "agreement_date" DATE NOT NULL,
    "remarks" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "introducer_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "introducer_accruals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "introducer_agreement_id" UUID NOT NULL,
    "accrual_number" TEXT NOT NULL,
    "accrual_date" DATE NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "narrative" TEXT,
    "status" "IntroducerDocumentStatus" NOT NULL DEFAULT 'POSTED',
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

    CONSTRAINT "introducer_accruals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "introducer_payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "introducer_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "payment_number" TEXT NOT NULL,
    "payment_date" DATE NOT NULL,
    "payment_mode_id" UUID,
    "reference_number" TEXT,
    "gross_amount" DECIMAL(19,4) NOT NULL,
    "tds_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(19,4) NOT NULL,
    "advance_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "narrative" TEXT,
    "status" "IntroducerDocumentStatus" NOT NULL DEFAULT 'POSTED',
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

    CONSTRAINT "introducer_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "introducer_payment_allocations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "introducer_payment_id" UUID NOT NULL,
    "introducer_accrual_id" UUID NOT NULL,
    "allocated_amount" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "introducer_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_introducer_agreements_org_introducer" ON "introducer_agreements"("organization_id", "introducer_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_introducer_agreements_project_introducer" ON "introducer_agreements"("organization_id", "project_id", "introducer_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_introducer_agreements_id_org" ON "introducer_agreements"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_introducer_accruals_org_status" ON "introducer_accruals"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_introducer_accruals_agreement" ON "introducer_accruals"("introducer_agreement_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_introducer_accruals_org_number" ON "introducer_accruals"("organization_id", "accrual_number");

-- CreateIndex
CREATE UNIQUE INDEX "uq_introducer_accruals_id_org" ON "introducer_accruals"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_introducer_payments_org_status" ON "introducer_payments"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_introducer_payments_org_introducer" ON "introducer_payments"("organization_id", "introducer_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_introducer_payments_org_number" ON "introducer_payments"("organization_id", "payment_number");

-- CreateIndex
CREATE UNIQUE INDEX "uq_introducer_payments_id_org" ON "introducer_payments"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_introducer_payment_allocations_accrual" ON "introducer_payment_allocations"("introducer_accrual_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_introducer_payment_allocations_payment_accrual" ON "introducer_payment_allocations"("introducer_payment_id", "introducer_accrual_id");

-- AddForeignKey
ALTER TABLE "introducer_agreements" ADD CONSTRAINT "fk_introducer_agreements_introducer_org_consistent" FOREIGN KEY ("introducer_id", "organization_id") REFERENCES "introducers"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "introducer_agreements" ADD CONSTRAINT "fk_introducer_agreements_project_org_consistent" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "introducer_agreements" ADD CONSTRAINT "fk_introducer_agreements_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "introducer_accruals" ADD CONSTRAINT "fk_introducer_accruals_agreement_org_consistent" FOREIGN KEY ("introducer_agreement_id", "organization_id") REFERENCES "introducer_agreements"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "introducer_payments" ADD CONSTRAINT "fk_introducer_payments_introducer_org_consistent" FOREIGN KEY ("introducer_id", "organization_id") REFERENCES "introducers"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "introducer_payments" ADD CONSTRAINT "fk_introducer_payments_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "introducer_payments" ADD CONSTRAINT "fk_introducer_payments_bank_account_org_consistent" FOREIGN KEY ("bank_account_id", "organization_id") REFERENCES "bank_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "introducer_payments" ADD CONSTRAINT "fk_introducer_payments_payment_mode" FOREIGN KEY ("payment_mode_id") REFERENCES "payment_modes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "introducer_payment_allocations" ADD CONSTRAINT "fk_introducer_payment_allocations_payment" FOREIGN KEY ("introducer_payment_id") REFERENCES "introducer_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "introducer_payment_allocations" ADD CONSTRAINT "fk_introducer_payment_allocations_accrual_org_consistent" FOREIGN KEY ("introducer_accrual_id", "organization_id") REFERENCES "introducer_accruals"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added CHECK: the commission basis and its figure must agree. A
-- PERCENT_OF_PROJECT_VALUE agreement carries a rate and no fixed amount; a
-- FIXED_AMOUNT agreement carries the amount and no rate. Without this the
-- two columns can hold contradictory terms and nothing in the data says
-- which one is the agreement.
ALTER TABLE "introducer_agreements" ADD CONSTRAINT "chk_introducer_agreements_basis_figure"
  CHECK (("basis_type" = 'PERCENT_OF_PROJECT_VALUE' AND "rate_percent" IS NOT NULL AND "rate_percent" > 0 AND "fixed_amount" IS NULL)
      OR ("basis_type" = 'FIXED_AMOUNT'             AND "fixed_amount" IS NOT NULL AND "fixed_amount" > 0 AND "rate_percent" IS NULL));

-- Hand-added CHECK: an accrual recognises a real liability.
ALTER TABLE "introducer_accruals" ADD CONSTRAINT "chk_introducer_accruals_positive_amount"
  CHECK ("amount" > 0);

ALTER TABLE "introducer_accruals" ADD CONSTRAINT "chk_introducer_accruals_reversal_fields"
  CHECK (("status" = 'REVERSED' AND "reversal_journal_entry_id" IS NOT NULL AND "reversed_at" IS NOT NULL)
      OR ("status" = 'POSTED'   AND "reversal_journal_entry_id" IS NULL     AND "reversed_at" IS NULL));

-- Hand-added CHECK: a payment's own arithmetic must hold in the row itself,
-- not merely in the service that wrote it. Gross is what was settled, and it
-- is split two ways twice over — into TDS withheld plus cash actually paid,
-- and into what cleared a payable plus what became an advance.
ALTER TABLE "introducer_payments" ADD CONSTRAINT "chk_introducer_payments_amounts"
  CHECK ("gross_amount" > 0
     AND "tds_amount" >= 0
     AND "net_amount" >= 0
     AND "advance_amount" >= 0
     AND "advance_amount" <= "gross_amount"
     AND "gross_amount" = "tds_amount" + "net_amount");

ALTER TABLE "introducer_payments" ADD CONSTRAINT "chk_introducer_payments_reversal_fields"
  CHECK (("status" = 'REVERSED' AND "reversal_journal_entry_id" IS NOT NULL AND "reversed_at" IS NOT NULL)
      OR ("status" = 'POSTED'   AND "reversal_journal_entry_id" IS NULL     AND "reversed_at" IS NULL));

-- Hand-added CHECK: an allocation moves a real amount.
ALTER TABLE "introducer_payment_allocations" ADD CONSTRAINT "chk_introducer_payment_allocations_positive"
  CHECK ("allocated_amount" > 0);
