-- A converted proforma no longer holds the billing event, so the tax
-- invoice draft can occupy it. VOID already worked this way.

DROP INDEX "uq_invoices_source_event_active";
DROP INDEX "uq_invoices_source_installment_active";

CREATE UNIQUE INDEX "uq_invoices_source_event_active" ON "invoices"("source_event_id") WHERE "status" NOT IN ('VOID', 'CONVERTED');
CREATE UNIQUE INDEX "uq_invoices_source_installment_active" ON "invoices"("source_installment_id") WHERE "status" NOT IN ('VOID', 'CONVERTED');
