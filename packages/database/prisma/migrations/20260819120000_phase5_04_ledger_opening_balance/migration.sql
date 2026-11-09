-- Phase 5.4: Ledger Account Opening Balances, ADR-071.
-- Partial unique index hand-added below (Prisma's @@unique cannot express
-- a WHERE clause), matching the uq_invoices_source_event_active precedent
-- -- at most one ACTIVE opening balance per legal-entity+ledger-account at
-- a time; correcting one means voiding it (reverses the journal) then
-- setting a fresh one.

-- CreateEnum
CREATE TYPE "LedgerOpeningBalanceStatus" AS ENUM ('ACTIVE', 'VOID');

-- CreateTable
CREATE TABLE "ledger_opening_balances" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "ledger_account_id" UUID NOT NULL,
    "as_of_date" DATE NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "status" "LedgerOpeningBalanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "journal_entry_id" UUID NOT NULL,
    "void_journal_entry_id" UUID,
    "void_reason" TEXT,
    "voided_by" UUID,
    "voided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "ledger_opening_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_ledger_opening_balances_account_entity" ON "ledger_opening_balances"("ledger_account_id", "legal_entity_id");

-- CreateIndex (partial unique -- at most one ACTIVE opening balance per legal entity + ledger account)
CREATE UNIQUE INDEX "uq_ledger_opening_balances_active" ON "ledger_opening_balances"("organization_id", "legal_entity_id", "ledger_account_id") WHERE "status" != 'VOID';

-- AddForeignKey
ALTER TABLE "ledger_opening_balances" ADD CONSTRAINT "fk_ledger_opening_balances_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_opening_balances" ADD CONSTRAINT "fk_ledger_opening_balances_account_org_consistent" FOREIGN KEY ("ledger_account_id", "organization_id") REFERENCES "ledger_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_opening_balances" ADD CONSTRAINT "fk_ledger_opening_balances_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_opening_balances" ADD CONSTRAINT "fk_ledger_opening_balances_void_journal_entry" FOREIGN KEY ("void_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
