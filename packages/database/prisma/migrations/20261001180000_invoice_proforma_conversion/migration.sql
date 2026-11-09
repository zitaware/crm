-- An issued proforma stays on record. Converting it opens a separate
-- tax invoice (ADR-147). CONVERTED is added on its own so the new value
-- is committed before the billing-slot indexes use it.

ALTER TYPE "InvoiceStatus" ADD VALUE 'CONVERTED';

ALTER TABLE "invoices" ADD COLUMN "converted_from_invoice_id" UUID;

CREATE UNIQUE INDEX "uq_invoices_converted_from" ON "invoices"("converted_from_invoice_id");

ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_converted_from"
  FOREIGN KEY ("converted_from_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
