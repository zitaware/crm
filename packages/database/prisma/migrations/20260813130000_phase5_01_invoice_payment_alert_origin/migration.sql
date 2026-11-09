-- Adds Invoice.paymentAlertId: the alert an invoice was raised from, set
-- once at draft creation and immutable thereafter. Distinct from
-- payment_alerts.invoice_id, which records which invoice currently CLOSES
-- the alert and is cleared when a finalized invoice is voided (reopen).
-- The invoices table has no rows yet in any deployed environment, so a
-- NOT NULL column can be added directly without a backfill step.

ALTER TABLE "invoices" ADD COLUMN "payment_alert_id" UUID NOT NULL;

CREATE INDEX "idx_invoices_payment_alert_id" ON "invoices"("payment_alert_id");

ALTER TABLE "invoices"
  ADD CONSTRAINT "fk_invoices_payment_alert"
  FOREIGN KEY ("payment_alert_id") REFERENCES "payment_alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
