-- Phase 7, Slice 7.4 — Monthly gross salary import (ADR-094).
--
-- Implements docs/04 §13's `employee-salary-upload.html` contract ("import
-- monthly gross salary only ... preview before atomic commit; preserve
-- source file/checksum and audit batch") and docs/06's "Salary project
-- costing" posting (Dr Salaries & Wages Expense; Cr Salary Payable).
--
-- Two new tables and one new enum; nothing existing is altered, so this is
-- unconditionally safe on existing data.
--
-- Hand-curated from `prisma migrate diff --from-url`, excluding the same
-- three known phantom lines (chk_cities_state_matches_district,
-- uq_districts_id_state_id, idx_invoices_payment_alert_id) every prior
-- migration in this project excludes.

-- CreateEnum
CREATE TYPE "SalaryImportStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "salary_imports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "salary_month" DATE NOT NULL,
    "accounting_date" DATE NOT NULL,
    "source_file_name" TEXT,
    "source_checksum" TEXT,
    "employee_count" INTEGER NOT NULL,
    "total_gross_amount" DECIMAL(19,4) NOT NULL,
    "status" "SalaryImportStatus" NOT NULL DEFAULT 'POSTED',
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

    CONSTRAINT "salary_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_import_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "salary_import_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employee_code_raw" TEXT NOT NULL,
    "employee_name_raw" TEXT,
    "gross_salary_amount" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_import_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_salary_imports_org_month" ON "salary_imports"("organization_id", "salary_month");

-- CreateIndex
CREATE INDEX "idx_salary_imports_org_status" ON "salary_imports"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_salary_imports_id_org" ON "salary_imports"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_salary_import_lines_org_employee" ON "salary_import_lines"("organization_id", "employee_id");

-- CreateIndex
CREATE INDEX "idx_salary_import_lines_import" ON "salary_import_lines"("salary_import_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_salary_import_lines_import_employee" ON "salary_import_lines"("salary_import_id", "employee_id");

-- AddForeignKey
ALTER TABLE "salary_imports" ADD CONSTRAINT "fk_salary_imports_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_import_lines" ADD CONSTRAINT "fk_salary_import_lines_import" FOREIGN KEY ("salary_import_id") REFERENCES "salary_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_import_lines" ADD CONSTRAINT "fk_salary_import_lines_employee_org_consistent" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added PARTIAL unique index: one POSTED salary import per legal
-- entity per month. Deliberately NOT a plain composite unique — reversing a
-- batch must free the month for a corrected re-import, and a total unique
-- index would block that forever while the reversed row still exists. This
-- is docs/04 §13's "validate month uniqueness" enforced by the database
-- rather than only by the service.
CREATE UNIQUE INDEX "uq_salary_imports_entity_month_posted"
  ON "salary_imports" ("organization_id", "legal_entity_id", "salary_month")
  WHERE "status" = 'POSTED';

-- Hand-added CHECK: a batch carries a non-negative gross and a real head
-- count; and, as elsewhere in this codebase, the reversal fields are
-- settable only together with the REVERSED status they describe.
ALTER TABLE "salary_imports" ADD CONSTRAINT "chk_salary_imports_totals"
  CHECK ("employee_count" > 0 AND "total_gross_amount" >= 0);

ALTER TABLE "salary_imports" ADD CONSTRAINT "chk_salary_imports_reversal_fields"
  CHECK (("status" = 'REVERSED' AND "reversal_journal_entry_id" IS NOT NULL AND "reversed_at" IS NOT NULL)
      OR ("status" = 'POSTED'   AND "reversal_journal_entry_id" IS NULL     AND "reversed_at" IS NULL));

-- Hand-added CHECK: a line's gross salary is never negative. Zero is
-- allowed — an employee on unpaid leave for a whole month is a real case,
-- and refusing it would push the accountant into omitting the row instead,
-- which loses the fact that they were considered.
ALTER TABLE "salary_import_lines" ADD CONSTRAINT "chk_salary_import_lines_non_negative"
  CHECK ("gross_salary_amount" >= 0);
