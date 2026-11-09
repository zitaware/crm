-- ADR-179: a vendor bill can be paid by credit card: the payment credits the
-- card's payable instead of the bank. Exactly one of the two is set.
-- AlterTable
ALTER TABLE "vendor_payments" ADD COLUMN     "card_account_id" UUID,
ALTER COLUMN "bank_account_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "fk_vendor_payments_card_account_org_consistent" FOREIGN KEY ("card_account_id", "organization_id") REFERENCES "card_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "vendor_payments" ADD CONSTRAINT "chk_vendor_payments_one_source" CHECK (("bank_account_id" IS NULL) <> ("card_account_id" IS NULL));
