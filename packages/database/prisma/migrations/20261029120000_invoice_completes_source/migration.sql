-- ADR-167: an invoice can be finalized as the full bill for its event(s) or
-- installment even when it bills less than what was left on them.
-- Rollback: ALTER TABLE "invoices" DROP COLUMN "completes_source";
ALTER TABLE "invoices" ADD COLUMN "completes_source" BOOLEAN NOT NULL DEFAULT false;
