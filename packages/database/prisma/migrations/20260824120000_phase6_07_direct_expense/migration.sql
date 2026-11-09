-- CreateEnum
CREATE TYPE "DirectExpenseStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED');

-- CreateTable
CREATE TABLE "direct_expenses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "expense_category_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "project_id" UUID,
    "amount" DECIMAL(19,4) NOT NULL,
    "expense_date" DATE NOT NULL,
    "gst_invoice_available" BOOLEAN NOT NULL DEFAULT false,
    "gst_credit_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "payment_mode_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "note" TEXT,
    "status" "DirectExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "posted_at" TIMESTAMPTZ,
    "posted_by" UUID,
    "journal_entry_id" UUID,
    "reversal_journal_entry_id" UUID,
    "reversal_reason" TEXT,
    "reversed_by" UUID,
    "reversed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by" UUID,
    "cancelled_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "direct_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_direct_expenses_org_status" ON "direct_expenses"("organization_id", "status");

-- AddForeignKey
ALTER TABLE "direct_expenses" ADD CONSTRAINT "fk_direct_expenses_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_expenses" ADD CONSTRAINT "fk_direct_expenses_expense_category_org_consistent" FOREIGN KEY ("expense_category_id", "organization_id") REFERENCES "expense_categories"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_expenses" ADD CONSTRAINT "fk_direct_expenses_project_org_consistent" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_expenses" ADD CONSTRAINT "fk_direct_expenses_payment_mode" FOREIGN KEY ("payment_mode_id") REFERENCES "payment_modes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_expenses" ADD CONSTRAINT "fk_direct_expenses_bank_account_org_consistent" FOREIGN KEY ("bank_account_id", "organization_id") REFERENCES "bank_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_expenses" ADD CONSTRAINT "fk_direct_expenses_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_expenses" ADD CONSTRAINT "fk_direct_expenses_reversal_journal_entry" FOREIGN KEY ("reversal_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
