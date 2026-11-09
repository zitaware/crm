-- Phase 7 integration (ADR-098) — step 2 of 2: salary revisions, and salary
-- imports that begin life as a DRAFT.
--
-- Two changes in one migration because they are one feature:
--   * `employee_salary_revisions` is the compensation history ADR-047
--     deferred "to when Salary Import is built"; it is what a generated
--     monthly batch reads.
--   * `salary_imports.journal_entry_id` becomes nullable, because a DRAFT
--     has not posted anything yet.
--
-- Hand-curated from `prisma migrate diff --from-url`, excluding the same
-- three known phantom lines every prior migration in this project excludes.

-- AlterTable
ALTER TABLE "salary_imports" ALTER COLUMN "status" SET DEFAULT 'DRAFT',
ALTER COLUMN "journal_entry_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "employee_salary_revisions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "gross_amount" DECIMAL(19,4) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "employee_salary_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_employee_salary_revisions_employee_from" ON "employee_salary_revisions"("organization_id", "employee_id", "effective_from");

-- AddForeignKey
ALTER TABLE "employee_salary_revisions" ADD CONSTRAINT "fk_employee_salary_revisions_employee_org_consistent" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added PARTIAL unique: at most one OPEN revision per employee.
-- Prisma cannot express a filtered unique, the same reason
-- uq_financial_years_one_current and uq_salary_imports_entity_month_posted
-- are hand-written. This is what makes "the current salary" a single,
-- unambiguous row rather than a convention the service has to maintain.
CREATE UNIQUE INDEX "uq_employee_salary_revisions_one_open"
  ON "employee_salary_revisions" ("organization_id", "employee_id")
  WHERE "effective_to" IS NULL;

-- Hand-added CHECK: a revision covers a real, non-inverted period and never
-- a negative salary. Zero is allowed — an unpaid period is a real thing.
ALTER TABLE "employee_salary_revisions" ADD CONSTRAINT "chk_employee_salary_revisions_period"
  CHECK ("gross_amount" >= 0 AND ("effective_to" IS NULL OR "effective_to" >= "effective_from"));

-- Hand-added CHECK: a journal exists exactly when the batch is not a draft.
-- Without this, `journal_entry_id` going nullable would let a POSTED batch
-- claim to have posted nothing.
ALTER TABLE "salary_imports" ADD CONSTRAINT "chk_salary_imports_journal_by_status"
  CHECK (("status" = 'DRAFT' AND "journal_entry_id" IS NULL)
      OR ("status" <> 'DRAFT' AND "journal_entry_id" IS NOT NULL));

-- The reversal-fields CHECK predates DRAFT and would reject every draft, so
-- it is replaced rather than added to.
ALTER TABLE "salary_imports" DROP CONSTRAINT "chk_salary_imports_reversal_fields";
ALTER TABLE "salary_imports" ADD CONSTRAINT "chk_salary_imports_reversal_fields"
  CHECK (("status" = 'REVERSED' AND "reversal_journal_entry_id" IS NOT NULL AND "reversed_at" IS NOT NULL)
      OR ("status" IN ('POSTED', 'DRAFT') AND "reversal_journal_entry_id" IS NULL AND "reversed_at" IS NULL));

-- Hand-added PARTIAL unique: at most one DRAFT per legal entity per month,
-- alongside the existing one-POSTED-per-month rule. Without it the worker
-- could generate a second draft for a month a first draft already covers.
CREATE UNIQUE INDEX "uq_salary_imports_entity_month_draft"
  ON "salary_imports" ("organization_id", "legal_entity_id", "salary_month")
  WHERE "status" = 'DRAFT';
