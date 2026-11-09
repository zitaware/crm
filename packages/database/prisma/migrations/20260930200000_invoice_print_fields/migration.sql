-- Printed state code (for example GUJ) and the bank account number shown on the tax invoice.
ALTER TABLE "legal_entities" ADD COLUMN "invoice_state_code" TEXT;

ALTER TABLE "bank_accounts" ADD COLUMN "invoice_account_number" TEXT;
