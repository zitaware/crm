-- ADR-156: a CAPEX event or OPEX installment may be billed across several
-- finalized invoices until its amount is reached. Only one invoice per
-- event or installment may be open (a draft or an issued proforma) at a time.
-- Rollback: recreate the previous indexes, which fails while any event or
-- installment has two non-void invoices; then drop finalized_at.

DROP INDEX "uq_invoices_source_event_active";
DROP INDEX "uq_invoices_source_installment_active";

CREATE UNIQUE INDEX "uq_invoices_source_event_open" ON "invoices"("source_event_id") WHERE "status" IN ('DRAFT', 'ISSUED');
CREATE UNIQUE INDEX "uq_invoices_source_installment_open" ON "invoices"("source_installment_id") WHERE "status" IN ('DRAFT', 'ISSUED');

-- Set when the invoice is finalized: the event stays billed by it but is free
-- for the next invoice. released_at still means the invoice was voided or
-- converted.
ALTER TABLE "invoice_capex_sources" ADD COLUMN "finalized_at" TIMESTAMPTZ;

UPDATE "invoice_capex_sources" AS s
SET "finalized_at" = i."updated_at"
FROM "invoices" AS i
WHERE i."id" = s."invoice_id" AND i."status" = 'FINALIZED' AND s."released_at" IS NULL;

DROP INDEX "uq_invoice_capex_sources_event_open";
CREATE UNIQUE INDEX "uq_invoice_capex_sources_event_open" ON "invoice_capex_sources"("source_event_id") WHERE "released_at" IS NULL AND "finalized_at" IS NULL;
