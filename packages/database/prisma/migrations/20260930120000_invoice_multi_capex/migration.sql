-- Several CAPEX events may share one invoice (ADR-126). OPEX stays one
-- installment per invoice. Dropping the unique index lets every alert on
-- that invoice point at it. The open-event index keeps each CAPEX event on
-- at most one non-void invoice.

DROP INDEX "uq_payment_alerts_invoice_id";

CREATE INDEX "idx_payment_alerts_invoice_id" ON "payment_alerts"("invoice_id");

ALTER TABLE "invoice_lines" ADD COLUMN "source_event_id" UUID;

ALTER TABLE "invoice_lines" ADD CONSTRAINT "fk_invoice_lines_source_event" FOREIGN KEY ("source_event_id") REFERENCES "milestone_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "invoice_capex_sources" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "payment_alert_id" UUID NOT NULL,
    "source_event_id" UUID NOT NULL,
    "released_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_capex_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_invoice_capex_sources_event_open" ON "invoice_capex_sources"("source_event_id") WHERE "released_at" IS NULL;

CREATE INDEX "idx_invoice_capex_sources_invoice" ON "invoice_capex_sources"("invoice_id");

ALTER TABLE "invoice_capex_sources" ADD CONSTRAINT "fk_invoice_capex_sources_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoice_capex_sources" ADD CONSTRAINT "fk_invoice_capex_sources_alert" FOREIGN KEY ("payment_alert_id") REFERENCES "payment_alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_capex_sources" ADD CONSTRAINT "fk_invoice_capex_sources_event" FOREIGN KEY ("source_event_id") REFERENCES "milestone_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
