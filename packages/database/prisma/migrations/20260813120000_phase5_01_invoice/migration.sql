-- Phase 5.1: Invoice (Draft, Finalize, Void), ADR-068.
-- Partial unique indexes hand-added below (Prisma's @@unique cannot
-- express a WHERE clause), matching the uq_legal_entities_org_pan
-- precedent already established in this codebase.

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'FINALIZED', 'VOID');

-- AlterEnum
ALTER TYPE "InstallmentStatus" ADD VALUE 'INVOICE_DRAFT';
ALTER TYPE "InstallmentStatus" ADD VALUE 'INVOICED';

-- AlterEnum
ALTER TYPE "PaymentAlertStatus" ADD VALUE 'CLOSED';

-- AlterTable
ALTER TABLE "payment_alerts" ADD COLUMN     "invoice_id" UUID;

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "gst_registration_id" UUID NOT NULL,
    "milestone_type" "MilestoneType" NOT NULL,
    "source_event_id" UUID,
    "source_installment_id" UUID,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "financial_year_id" UUID,
    "invoice_number" TEXT,
    "invoice_date" DATE,
    "due_date" DATE,
    "payment_terms_days" INTEGER,
    "service_period_start" DATE,
    "service_period_end" DATE,
    "seller_legal_name" TEXT,
    "seller_pan" TEXT,
    "seller_gstin" TEXT,
    "seller_state" TEXT,
    "seller_address" TEXT,
    "buyer_name" TEXT,
    "buyer_gstin" TEXT,
    "buyer_state" TEXT,
    "buyer_address" TEXT,
    "taxable_amount" DECIMAL(19,4),
    "cgst_amount" DECIMAL(19,4),
    "sgst_amount" DECIMAL(19,4),
    "igst_amount" DECIMAL(19,4),
    "total_amount" DECIMAL(19,4),
    "narrative" TEXT,
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

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
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

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_invoices_project_id" ON "invoices"("project_id");

-- CreateIndex
CREATE INDEX "idx_invoices_org_status" ON "invoices"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_invoice_lines_invoice_id" ON "invoice_lines"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_payment_alerts_invoice_id" ON "payment_alerts"("invoice_id");

-- CreateIndex (partial uniques — at most one non-VOID invoice per source)
CREATE UNIQUE INDEX "uq_invoices_source_event_active" ON "invoices"("source_event_id") WHERE "status" != 'VOID';
CREATE UNIQUE INDEX "uq_invoices_source_installment_active" ON "invoices"("source_installment_id") WHERE "status" != 'VOID';

-- CreateIndex (partial unique — invoice number scoped to GST registration + financial year, once assigned)
CREATE UNIQUE INDEX "uq_invoices_number_scope" ON "invoices"("organization_id", "gst_registration_id", "financial_year_id", "invoice_number") WHERE "invoice_number" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "payment_alerts" ADD CONSTRAINT "fk_payment_alerts_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_project_org_consistent" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_gst_registration_org_consistent" FOREIGN KEY ("gst_registration_id", "organization_id") REFERENCES "gst_registrations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_financial_year_org_consistent" FOREIGN KEY ("financial_year_id", "organization_id") REFERENCES "financial_years"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_source_event" FOREIGN KEY ("source_event_id") REFERENCES "milestone_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_source_installment" FOREIGN KEY ("source_installment_id") REFERENCES "milestone_installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_void_journal_entry" FOREIGN KEY ("void_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "fk_invoice_lines_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
