-- Proforma is a document only (ADR-128). ISSUED means it has been given
-- out and is not a receivable. Converting it to a tax invoice is what posts.

ALTER TYPE "InvoiceStatus" ADD VALUE 'ISSUED';

CREATE TYPE "InvoiceKind" AS ENUM ('REGULAR', 'PROFORMA');

ALTER TABLE "invoices" ADD COLUMN "kind" "InvoiceKind" NOT NULL DEFAULT 'REGULAR';

ALTER TABLE "invoices" ADD COLUMN "proforma_number" TEXT;

CREATE UNIQUE INDEX "uq_invoices_proforma_number_scope" ON "invoices"("organization_id", "gst_registration_id", "financial_year_id", "proforma_number") WHERE "proforma_number" IS NOT NULL;
