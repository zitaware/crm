-- chk_payment_alerts_snoozed_fields_consistent predates the CLOSED status
-- (added earlier in this same phase) and only allowed OPEN/SNOOZED, so
-- InvoicesService.finalize's `status: 'CLOSED'` update violated it. CLOSED
-- alerts never carry snooze fields either, same as OPEN.

ALTER TABLE "payment_alerts" DROP CONSTRAINT "chk_payment_alerts_snoozed_fields_consistent";

ALTER TABLE "payment_alerts" ADD CONSTRAINT "chk_payment_alerts_snoozed_fields_consistent" CHECK (
  (status = 'SNOOZED' AND snoozed_until IS NOT NULL)
  OR
  (status IN ('OPEN', 'CLOSED') AND snoozed_until IS NULL)
);
