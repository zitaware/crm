-- ADR-163: a voided invoice keeps its number on record, but the number may be
-- used again by a later invoice in the same GST registration and financial
-- year. Only invoices that are not voided hold a number exclusively.
-- Rollback: recreate the index without the status condition (fails if a
-- number has been reused meanwhile).
DROP INDEX IF EXISTS "uq_invoices_number_scope";
CREATE UNIQUE INDEX "uq_invoices_number_scope" ON "invoices"("organization_id", "gst_registration_id", "financial_year_id", "invoice_number") WHERE "invoice_number" IS NOT NULL AND "status" != 'VOID';
