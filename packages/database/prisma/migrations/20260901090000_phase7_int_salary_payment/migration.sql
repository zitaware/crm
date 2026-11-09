-- Phase 7 integration (ADR-100) — settling the salary payable.
--
-- The salary import credits SALARY_PAYABLE and nothing debited it, so the
-- liability grew every month with no way to record paying it. This table is
-- the debit side: a bank disbursement of the same shape as the vendor and
-- introducer payments that already exist.

CREATE TYPE "SalaryPaymentStatus" AS ENUM ('POSTED', 'REVERSED');

CREATE TABLE "salary_payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "salary_import_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "payment_number" TEXT NOT NULL,
    "payment_date" DATE NOT NULL,
    "payment_mode_id" UUID,
    "reference_number" TEXT,
    "gross_amount" DECIMAL(19,4) NOT NULL,
    "tds_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(19,4) NOT NULL,
    "narrative" TEXT,
    "status" "SalaryPaymentStatus" NOT NULL DEFAULT 'POSTED',
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

    CONSTRAINT "salary_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_salary_payments_org_number" ON "salary_payments"("organization_id", "payment_number");
CREATE UNIQUE INDEX "uq_salary_payments_id_org" ON "salary_payments"("id", "organization_id");
CREATE INDEX "idx_salary_payments_org_status" ON "salary_payments"("organization_id", "status");
CREATE INDEX "idx_salary_payments_import" ON "salary_payments"("salary_import_id");

ALTER TABLE "salary_payments" ADD CONSTRAINT "fk_salary_payments_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "salary_payments" ADD CONSTRAINT "fk_salary_payments_import_org_consistent" FOREIGN KEY ("salary_import_id", "organization_id") REFERENCES "salary_imports"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "salary_payments" ADD CONSTRAINT "fk_salary_payments_bank_account_org_consistent" FOREIGN KEY ("bank_account_id", "organization_id") REFERENCES "bank_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "salary_payments" ADD CONSTRAINT "fk_salary_payments_payment_mode" FOREIGN KEY ("payment_mode_id") REFERENCES "payment_modes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-added CHECK: the row's own arithmetic must hold in the row, not only
-- in the service that wrote it. Gross is the payable discharged; it splits
-- into TDS withheld (which stays a liability, just a different one) and the
-- net that actually left the bank.
ALTER TABLE "salary_payments" ADD CONSTRAINT "chk_salary_payments_amounts"
  CHECK ("gross_amount" > 0
     AND "tds_amount" >= 0
     AND "net_amount" >= 0
     AND "gross_amount" = "tds_amount" + "net_amount");

ALTER TABLE "salary_payments" ADD CONSTRAINT "chk_salary_payments_reversal_fields"
  CHECK (("status" = 'REVERSED' AND "reversal_journal_entry_id" IS NOT NULL AND "reversed_at" IS NOT NULL)
      OR ("status" = 'POSTED'   AND "reversal_journal_entry_id" IS NULL     AND "reversed_at" IS NULL));
