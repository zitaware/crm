-- Place of supply and jurisdiction print on the tax invoice.
-- The bank lines come from the bank account chosen when the invoice is created.
ALTER TABLE "legal_entities" ADD COLUMN "invoice_place_of_supply" TEXT,
ADD COLUMN "invoice_jurisdiction" TEXT;

ALTER TABLE "invoices" ADD COLUMN "bank_account_id" UUID;

ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_bank_account_org_consistent"
  FOREIGN KEY ("bank_account_id", "organization_id") REFERENCES "bank_accounts"("id", "organization_id");
