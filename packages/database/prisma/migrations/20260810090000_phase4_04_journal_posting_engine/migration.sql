-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "accounting_date" DATE NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "accounting_period_id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "posting_event" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "description" TEXT,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'POSTED',
    "posted_by" UUID,
    "posted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "ledger_account_id" UUID NOT NULL,
    "debit_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "credit_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "project_id" UUID,
    "party_id" UUID,
    "employee_id" UUID,
    "gst_registration_id" UUID,
    "tax_code" TEXT,
    "narrative" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_journal_entries_legal_entity_date" ON "journal_entries"("legal_entity_id", "accounting_date");

-- CreateIndex
CREATE INDEX "idx_journal_entries_accounting_period_id" ON "journal_entries"("accounting_period_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_journal_entries_org_source" ON "journal_entries"("organization_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "idx_journal_lines_journal_entry_id" ON "journal_lines"("journal_entry_id");

-- CreateIndex
CREATE INDEX "idx_journal_lines_ledger_account_id" ON "journal_lines"("ledger_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_gst_registrations_id_org" ON "gst_registrations"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ledger_accounts_id_org" ON "ledger_accounts"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "fk_journal_entries_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "fk_journal_entries_period_org_consistent" FOREIGN KEY ("accounting_period_id", "organization_id") REFERENCES "accounting_periods"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines_ledger_account_org_consistent" FOREIGN KEY ("ledger_account_id", "organization_id") REFERENCES "ledger_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines_project_org_consistent" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines_party_org_consistent" FOREIGN KEY ("party_id", "organization_id") REFERENCES "parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines_employee_org_consistent" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines_gst_registration_org_consistent" FOREIGN KEY ("gst_registration_id", "organization_id") REFERENCES "gst_registrations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint: amounts never negative (ADR-065, docs/06 mandatory posting controls)
ALTER TABLE "journal_lines" ADD CONSTRAINT "chk_journal_lines_amounts_nonneg" CHECK (debit_amount >= 0 AND credit_amount >= 0);

-- CheckConstraint: exactly one of debit/credit is set per line, never both, never neither (docs/06: "Each line has either a debit or credit amount, never both")
ALTER TABLE "journal_lines" ADD CONSTRAINT "chk_journal_lines_debit_xor_credit" CHECK (
  (debit_amount > 0 AND credit_amount = 0) OR (credit_amount > 0 AND debit_amount = 0)
);
