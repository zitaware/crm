-- Phase 6.6 (Employee Advance & Expense Claim, ADR-081) -- the next
-- unbuilt Phase 6 deliverable now that the procurement chain (Vendor Bill
-- -> Payment Request -> Vendor Payment) is complete end to end. Purely
-- additive: three new enums, three new tables. No data migration.
--
-- Hand-curated from `prisma migrate diff`: three unrelated phantom
-- drop/index lines that the raw diff always proposes for hand-added
-- constraints Prisma's schema DSL can't represent (chk_cities_state_
-- matches_district, uq_districts_id_state_id, idx_invoices_payment_
-- alert_id -- all pre-existing, from earlier migrations) were excluded,
-- matching every prior migration in this project.

-- CreateEnum
CREATE TYPE "EmployeeAdvanceStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "EmployeeExpenseClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'REIMBURSED');

-- CreateEnum
CREATE TYPE "EmployeeExpenseClaimDecisionType" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "employee_advances" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "project_id" UUID,
    "amount" DECIMAL(19,4) NOT NULL,
    "advance_date" DATE NOT NULL,
    "payment_mode_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "utr_reference" TEXT,
    "purpose" TEXT,
    "note" TEXT,
    "status" "EmployeeAdvanceStatus" NOT NULL DEFAULT 'POSTED',
    "journal_entry_id" UUID,
    "reversal_journal_entry_id" UUID,
    "reversal_reason" TEXT,
    "reversed_by" UUID,
    "reversed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "employee_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_expense_claims" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "expense_category_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "project_id" UUID,
    "amount" DECIMAL(19,4) NOT NULL,
    "expense_date" DATE NOT NULL,
    "gst_invoice_available" BOOLEAN NOT NULL DEFAULT false,
    "gst_credit_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" "EmployeeExpenseClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by" UUID,
    "cancelled_reason" TEXT,
    "journal_entry_id" UUID,
    "reimbursement_journal_entry_id" UUID,
    "reimbursement_reversal_journal_entry_id" UUID,
    "reimbursement_reversal_reason" TEXT,
    "reimbursed_at" TIMESTAMPTZ,
    "reimbursed_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "employee_expense_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_expense_claim_decisions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "decision" "EmployeeExpenseClaimDecisionType" NOT NULL,
    "actor_id" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "is_self_approval" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "employee_expense_claim_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_employee_advances_org_employee" ON "employee_advances"("organization_id", "employee_id");

-- CreateIndex
CREATE INDEX "idx_employee_expense_claims_org_employee" ON "employee_expense_claims"("organization_id", "employee_id");

-- CreateIndex
CREATE INDEX "idx_employee_expense_claims_org_status" ON "employee_expense_claims"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_employee_expense_claim_decisions_claim_id" ON "employee_expense_claim_decisions"("claim_id");

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "fk_employee_advances_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "fk_employee_advances_employee_org_consistent" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "fk_employee_advances_project_org_consistent" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "fk_employee_advances_payment_mode" FOREIGN KEY ("payment_mode_id") REFERENCES "payment_modes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "fk_employee_advances_bank_account_org_consistent" FOREIGN KEY ("bank_account_id", "organization_id") REFERENCES "bank_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "fk_employee_advances_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "fk_employee_advances_reversal_journal_entry" FOREIGN KEY ("reversal_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_expense_claims" ADD CONSTRAINT "fk_employee_expense_claims_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_expense_claims" ADD CONSTRAINT "fk_employee_expense_claims_employee_org_consistent" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_expense_claims" ADD CONSTRAINT "fk_employee_expense_claims_expense_category_org_consistent" FOREIGN KEY ("expense_category_id", "organization_id") REFERENCES "expense_categories"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_expense_claims" ADD CONSTRAINT "fk_employee_expense_claims_project_org_consistent" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_expense_claims" ADD CONSTRAINT "fk_employee_expense_claims_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_expense_claims" ADD CONSTRAINT "fk_employee_expense_claims_reimbursement_journal_entry" FOREIGN KEY ("reimbursement_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_expense_claims" ADD CONSTRAINT "fk_employee_expense_claims_reimbursement_reversal_journal_entry" FOREIGN KEY ("reimbursement_reversal_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_expense_claim_decisions" ADD CONSTRAINT "fk_employee_expense_claim_decisions_claim" FOREIGN KEY ("claim_id") REFERENCES "employee_expense_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
