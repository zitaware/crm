-- Phase 8.6a (ADR-114) — bank statement import (CSV, columns mapped per bank
-- account) and reconciliation matches to bank journal lines.

-- CreateEnum
CREATE TYPE "BankStatementAmountMode" AS ENUM ('DEBIT_CREDIT_COLUMNS', 'SIGNED_AMOUNT', 'AMOUNT_WITH_INDICATOR');

-- CreateEnum
CREATE TYPE "BankStatementDateFormat" AS ENUM ('YYYY_MM_DD', 'DD_MM_YYYY_SLASH', 'DD_MM_YYYY_DASH', 'DD_MMM_YYYY', 'MM_DD_YYYY_SLASH');




-- CreateTable
CREATE TABLE "bank_statement_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "date_column" TEXT NOT NULL,
    "date_format" "BankStatementDateFormat" NOT NULL,
    "description_column" TEXT NOT NULL,
    "reference_column" TEXT,
    "amount_mode" "BankStatementAmountMode" NOT NULL,
    "debit_column" TEXT,
    "credit_column" TEXT,
    "amount_column" TEXT,
    "indicator_column" TEXT,
    "credit_indicator" TEXT,
    "balance_column" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "bank_statement_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_imports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "line_count" INTEGER NOT NULL,
    "duplicate_count" INTEGER NOT NULL,
    "first_date" DATE NOT NULL,
    "last_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "bank_statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "import_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "transaction_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(19,4) NOT NULL,
    "balance" DECIMAL(19,4),
    "fingerprint" TEXT NOT NULL,
    "exception_reason" TEXT,
    "exception_marked_at" TIMESTAMPTZ,
    "exception_marked_by" UUID,
    "exception_approved_at" TIMESTAMPTZ,
    "exception_approved_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_reconciliation_matches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "statement_line_id" UUID NOT NULL,
    "journal_line_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "unmatched_at" TIMESTAMPTZ,
    "unmatched_by" UUID,
    "unmatch_reason" TEXT,

    CONSTRAINT "bank_reconciliation_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_bank_statement_profiles_org" ON "bank_statement_profiles"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_bank_statement_profiles_bank_account" ON "bank_statement_profiles"("bank_account_id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_bank_statement_imports_org_account" ON "bank_statement_imports"("organization_id", "bank_account_id");

-- CreateIndex
CREATE INDEX "idx_bank_statement_lines_account_date" ON "bank_statement_lines"("bank_account_id", "transaction_date");

-- CreateIndex
CREATE INDEX "idx_bank_statement_lines_import" ON "bank_statement_lines"("import_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_bank_statement_lines_fingerprint" ON "bank_statement_lines"("bank_account_id", "fingerprint");

-- CreateIndex
CREATE INDEX "idx_bank_reconciliation_matches_statement_line" ON "bank_reconciliation_matches"("statement_line_id");

-- CreateIndex
CREATE INDEX "idx_bank_reconciliation_matches_journal_line" ON "bank_reconciliation_matches"("journal_line_id");

-- CreateIndex
CREATE INDEX "idx_bank_reconciliation_matches_org_account" ON "bank_reconciliation_matches"("organization_id", "bank_account_id");

-- AddForeignKey
ALTER TABLE "bank_statement_profiles" ADD CONSTRAINT "fk_bank_statement_profiles_bank_account_org_consistent" FOREIGN KEY ("bank_account_id", "organization_id") REFERENCES "bank_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "fk_bank_statement_imports_bank_account_org_consistent" FOREIGN KEY ("bank_account_id", "organization_id") REFERENCES "bank_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "fk_bank_statement_lines_bank_account_org_consistent" FOREIGN KEY ("bank_account_id", "organization_id") REFERENCES "bank_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "fk_bank_statement_lines_import" FOREIGN KEY ("import_id") REFERENCES "bank_statement_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "fk_bank_reconciliation_matches_bank_account_org_consistent" FOREIGN KEY ("bank_account_id", "organization_id") REFERENCES "bank_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "fk_bank_reconciliation_matches_statement_line" FOREIGN KEY ("statement_line_id") REFERENCES "bank_statement_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "fk_bank_reconciliation_matches_journal_line" FOREIGN KEY ("journal_line_id") REFERENCES "journal_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added CHECKs: a statement line moves money; a match moves a real
-- amount; an exception is approved only after it is marked, by someone else;
-- an unmatch always says who.
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "chk_bank_statement_lines_amount" CHECK ("amount" <> 0);
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "chk_bank_statement_lines_exception"
  CHECK (("exception_reason" IS NULL) = ("exception_marked_at" IS NULL)
     AND ("exception_approved_at" IS NULL OR "exception_marked_at" IS NOT NULL)
     AND ("exception_approved_by" IS NULL OR "exception_approved_by" <> "exception_marked_by"));
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "chk_bank_reconciliation_matches_amount" CHECK ("amount" <> 0);
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "chk_bank_reconciliation_matches_unmatch"
  CHECK (("unmatched_at" IS NULL) = ("unmatched_by" IS NULL));
