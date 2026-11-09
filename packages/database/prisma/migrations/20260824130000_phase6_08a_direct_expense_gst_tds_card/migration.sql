-- Phase 6.8a (docs/12 ADR-088): extend Direct Expense (ADR-087) with a real
-- CGST/SGST/IGST split, optional TDS, an optional vendor link, and
-- Debit/Credit Card posting via the new card_accounts master.
--
-- The 3 lines intentionally NOT included below (chk_cities_state_matches_district
-- drop, uq_districts_id_state_id drop, idx_invoices_payment_alert_id drop) are
-- known phantom diff noise from `prisma migrate diff` against this dev
-- database, unrelated to this change -- excluded the same way every prior
-- hand-curated migration in this project excludes them.

-- AlterTable: a new PaymentMode flag distinct from requires_bank_source --
-- every other consumer of that flag (ClientReceipt, VendorPayment,
-- EmployeeAdvance) has no card-aware logic and must keep asking for a raw
-- BankAccount, never a CardAccount. Only Direct Expense checks this one.
ALTER TABLE "payment_modes" ADD COLUMN "requires_card_source" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "DirectExpenseSupplyType" AS ENUM ('INTRASTATE', 'INTERSTATE');

-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('DEBIT_CARD', 'CREDIT_CARD');

-- CreateTable
CREATE TABLE "card_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "type" "CardType" NOT NULL,
    "display_name" TEXT NOT NULL,
    "issuer_name" TEXT,
    "masked_last_four" TEXT NOT NULL,
    "cardholder_employee_id" UUID,
    "bank_account_id" UUID,
    "ledger_account_id" UUID,
    "statement_day" INTEGER,
    "payment_due_day" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "card_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_card_accounts_org_active" ON "card_accounts"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "uq_card_accounts_id_org" ON "card_accounts"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "card_accounts" ADD CONSTRAINT "fk_card_accounts_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_accounts" ADD CONSTRAINT "fk_card_accounts_cardholder_employee_org_consistent" FOREIGN KEY ("cardholder_employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_accounts" ADD CONSTRAINT "fk_card_accounts_bank_account_org_consistent" FOREIGN KEY ("bank_account_id", "organization_id") REFERENCES "bank_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_accounts" ADD CONSTRAINT "fk_card_accounts_ledger_account_org_consistent" FOREIGN KEY ("ledger_account_id", "organization_id") REFERENCES "ledger_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint: a Debit Card always resolves through a Bank Account and
-- never carries its own payable ledger; a Credit Card always carries its own
-- payable ledger and never a directly-linked Bank Account (ADR-088).
ALTER TABLE "card_accounts" ADD CONSTRAINT "chk_card_accounts_type_matches_linked_account" CHECK (
  (type = 'DEBIT_CARD' AND bank_account_id IS NOT NULL AND ledger_account_id IS NULL)
  OR
  (type = 'CREDIT_CARD' AND ledger_account_id IS NOT NULL AND bank_account_id IS NULL)
);

-- AlterTable: add the new direct_expenses columns first (taxable_amount
-- nullable for now so the backfill below can populate existing rows before
-- the NOT NULL constraint is applied), then migrate gst_credit_amount's
-- data into the new split columns, then drop gst_credit_amount.
ALTER TABLE "direct_expenses"
  ADD COLUMN     "vendor_id" UUID,
  ADD COLUMN     "taxable_amount" DECIMAL(19,4),
  ADD COLUMN     "gst_rate_percent" DECIMAL(5,2),
  ADD COLUMN     "supply_type" "DirectExpenseSupplyType",
  ADD COLUMN     "cgst_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN     "sgst_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN     "igst_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN     "itc_eligible" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN     "tds_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN     "tds_rate_percent" DECIMAL(5,2),
  ADD COLUMN     "card_account_id" UUID,
  ADD COLUMN     "transaction_reference" TEXT,
  ADD COLUMN     "purchased_by_employee_id" UUID;

-- Backfill: every existing row's flat gst_credit_amount becomes its
-- taxable_amount + a wholly-CGST split (the only shape the old flat field
-- could have represented — no supply_type/interstate distinction existed
-- before this migration). Existing rows all predate GST-invoice-required
-- validation, so this is a faithful, non-destructive translation, not a
-- guess about real supply type.
UPDATE "direct_expenses" SET
  "taxable_amount" = "amount" - "gst_credit_amount",
  "cgst_amount" = "gst_credit_amount"
WHERE "taxable_amount" IS NULL;

ALTER TABLE "direct_expenses"
  ALTER COLUMN "taxable_amount" SET NOT NULL,
  ALTER COLUMN "bank_account_id" DROP NOT NULL,
  DROP COLUMN "gst_credit_amount";

-- CreateIndex
CREATE UNIQUE INDEX "uq_direct_expenses_id_org" ON "direct_expenses"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "direct_expenses" ADD CONSTRAINT "fk_direct_expenses_vendor_org_consistent" FOREIGN KEY ("vendor_id", "organization_id") REFERENCES "parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_expenses" ADD CONSTRAINT "fk_direct_expenses_card_account_org_consistent" FOREIGN KEY ("card_account_id", "organization_id") REFERENCES "card_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_expenses" ADD CONSTRAINT "fk_direct_expenses_purchased_by_employee_org_consistent" FOREIGN KEY ("purchased_by_employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: settles part or all of a Credit Card's outstanding payable
-- (Dr CardAccount.ledgerAccountId / Cr the paying BankAccount) -- see the
-- CardSettlement model's own doc comment.
CREATE TABLE "card_settlements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "card_account_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "settlement_date" DATE NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "transaction_reference" TEXT,
    "journal_entry_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "card_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_card_settlements_org_card_account" ON "card_settlements"("organization_id", "card_account_id");

-- AddForeignKey
ALTER TABLE "card_settlements" ADD CONSTRAINT "fk_card_settlements_card_account_org_consistent" FOREIGN KEY ("card_account_id", "organization_id") REFERENCES "card_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_settlements" ADD CONSTRAINT "fk_card_settlements_bank_account_org_consistent" FOREIGN KEY ("bank_account_id", "organization_id") REFERENCES "bank_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_settlements" ADD CONSTRAINT "fk_card_settlements_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
