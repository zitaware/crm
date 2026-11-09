-- Phase 8.6b (ADR-115) — monthly bank reconciliation periods (docs/05).

-- CreateEnum
CREATE TYPE "BankReconciliationPeriodStatus" AS ENUM ('IN_PROGRESS', 'RECONCILED', 'LOCKED');




-- CreateTable
CREATE TABLE "bank_reconciliation_periods" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "BankReconciliationPeriodStatus" NOT NULL,
    "statement_opening_balance" DECIMAL(19,4) NOT NULL,
    "statement_closing_balance" DECIMAL(19,4) NOT NULL,
    "book_closing_balance" DECIMAL(19,4) NOT NULL,
    "uncleared_book_amount" DECIMAL(19,4) NOT NULL,
    "exception_amount" DECIMAL(19,4) NOT NULL,
    "prepared_at" TIMESTAMPTZ NOT NULL,
    "prepared_by" UUID NOT NULL,
    "locked_at" TIMESTAMPTZ,
    "locked_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "bank_reconciliation_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_bank_reconciliation_periods_org_status" ON "bank_reconciliation_periods"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_bank_reconciliation_periods_month" ON "bank_reconciliation_periods"("bank_account_id", "period_start");

-- AddForeignKey
ALTER TABLE "bank_reconciliation_periods" ADD CONSTRAINT "fk_bank_reconciliation_periods_bank_account_org_consistent" FOREIGN KEY ("bank_account_id", "organization_id") REFERENCES "bank_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added CHECKs: a period is one calendar month; a lock comes after a
-- preparation and never from the preparer (docs/09 maker-checker).
ALTER TABLE "bank_reconciliation_periods" ADD CONSTRAINT "chk_bank_reconciliation_periods_month"
  CHECK (date_trunc('month', "period_start") = "period_start"
     AND "period_end" = (date_trunc('month', "period_start") + interval '1 month - 1 day')::date);
ALTER TABLE "bank_reconciliation_periods" ADD CONSTRAINT "chk_bank_reconciliation_periods_lock"
  CHECK (("status" = 'LOCKED') = ("locked_at" IS NOT NULL AND "locked_by" IS NOT NULL)
     AND ("locked_by" IS NULL OR "locked_by" <> "prepared_by"));
