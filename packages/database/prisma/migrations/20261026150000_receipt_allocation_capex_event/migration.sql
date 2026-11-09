-- A receipt allocation on an invoice that bills several CAPEX events may
-- name the one event it pays (ADR-151). Null means the whole invoice, which
-- is every allocation before this migration.

ALTER TABLE "receipt_allocations" ADD COLUMN "source_event_id" UUID;

CREATE INDEX "idx_receipt_allocations_source_event_id" ON "receipt_allocations"("source_event_id");

ALTER TABLE "receipt_allocations" ADD CONSTRAINT "fk_receipt_allocations_source_event" FOREIGN KEY ("source_event_id") REFERENCES "milestone_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
