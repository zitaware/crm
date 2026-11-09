-- Phase 5.3: Credit Note / Debit Note, ADR-070.
-- Partial unique index hand-added below (Prisma's @@unique cannot express
-- a WHERE clause), matching the uq_invoices_number_scope precedent -- type
-- is part of the scope, so Credit and Debit Notes get independent number
-- series rather than sharing one counter.

-- CreateEnum
CREATE TYPE "CreditDebitNoteType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "CreditDebitNoteStatus" AS ENUM ('DRAFT', 'FINALIZED', 'VOID');

-- CreateTable
CREATE TABLE "credit_debit_notes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "gst_registration_id" UUID NOT NULL,
    "type" "CreditDebitNoteType" NOT NULL,
    "status" "CreditDebitNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT NOT NULL,
    "financial_year_id" UUID,
    "note_number" TEXT,
    "note_date" DATE,
    "taxable_amount" DECIMAL(19,4),
    "cgst_amount" DECIMAL(19,4),
    "sgst_amount" DECIMAL(19,4),
    "igst_amount" DECIMAL(19,4),
    "total_amount" DECIMAL(19,4),
    "journal_entry_id" UUID,
    "void_journal_entry_id" UUID,
    "void_reason" TEXT,
    "voided_by" UUID,
    "voided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "credit_debit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_debit_note_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "credit_debit_note_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "hsn_sac" TEXT,
    "quantity" DECIMAL(19,4) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(19,4) NOT NULL,
    "taxable_amount" DECIMAL(19,4) NOT NULL,
    "gst_rate_percent" DECIMAL(5,2) NOT NULL,
    "cgst_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "sgst_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "igst_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_debit_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_credit_debit_notes_invoice_id" ON "credit_debit_notes"("invoice_id");

-- CreateIndex
CREATE INDEX "idx_credit_debit_notes_org_status" ON "credit_debit_notes"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_credit_debit_note_lines_note_id" ON "credit_debit_note_lines"("credit_debit_note_id");

-- CreateIndex (partial unique -- note number scoped to GST registration + financial year + type, once assigned)
CREATE UNIQUE INDEX "uq_credit_debit_notes_number_scope" ON "credit_debit_notes"("organization_id", "gst_registration_id", "financial_year_id", "type", "note_number") WHERE "note_number" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "fk_credit_debit_notes_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "fk_credit_debit_notes_project_org_consistent" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "fk_credit_debit_notes_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "fk_credit_debit_notes_gst_registration_org_consistent" FOREIGN KEY ("gst_registration_id", "organization_id") REFERENCES "gst_registrations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "fk_credit_debit_notes_financial_year_org_consistent" FOREIGN KEY ("financial_year_id", "organization_id") REFERENCES "financial_years"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "fk_credit_debit_notes_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "fk_credit_debit_notes_void_journal_entry" FOREIGN KEY ("void_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_debit_note_lines" ADD CONSTRAINT "fk_credit_debit_note_lines_note" FOREIGN KEY ("credit_debit_note_id") REFERENCES "credit_debit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
