-- Phase 4.5: EMD / SD (Security Instruments), ADR-066.
-- Hand-written per the established procedure: prisma migrate diff's raw
-- output is used as the base, with the two pre-existing/unrelated drift
-- lines (chk_cities_state_matches_district, uq_districts_id_state_id)
-- stripped, and the new NOT NULL "category" column on
-- security_instrument_purposes backfilled before the constraint is applied
-- (existing seeded rows would otherwise violate NOT NULL on ADD COLUMN).

-- CreateEnum
CREATE TYPE "SecurityInstrumentCategory" AS ENUM ('EMD', 'SD');

-- CreateEnum
CREATE TYPE "SecurityInstrumentStatus" AS ENUM ('LODGED', 'RETURNED');

-- AlterTable: category is nullable (not backfilled to NOT NULL) — the
-- generic Masters catalogue's create/update path (masters.service.ts) only
-- ever sets code/name/description/sortOrder for this table, so a NOT NULL
-- category would crash on any admin-created purpose row. A null category
-- simply means "excluded from the EMD/SD tile split," not an invalid state.
ALTER TABLE "security_instrument_purposes" ADD COLUMN "category" "SecurityInstrumentCategory";
ALTER TABLE "security_instrument_purposes" ADD COLUMN "default_recoverable_ledger_account_id" UUID;

UPDATE "security_instrument_purposes" SET "category" = 'EMD'
  WHERE "code" IN ('earnest_money_deposit', 'advance_payment_guarantee');
UPDATE "security_instrument_purposes" SET "category" = 'SD'
  WHERE "code" IN ('security_deposit', 'performance_bank_guarantee', 'performance_security', 'retention_money');

-- AlterTable
ALTER TABLE "security_instrument_types" ADD COLUMN "requires_cash_posting" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "security_instruments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "project_id" UUID,
    "tender_id" UUID,
    "purpose_id" UUID NOT NULL,
    "type_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "instrument_reference_no" TEXT,
    "issuing_bank" TEXT,
    "lodged_with_authority" TEXT,
    "bank_ledger_account_id" UUID,
    "submitted_on" DATE NOT NULL,
    "return_due_on" DATE NOT NULL,
    "status" "SecurityInstrumentStatus" NOT NULL DEFAULT 'LODGED',
    "lodge_journal_entry_id" UUID,
    "funded_by_legal_entity_id" UUID,
    "funded_by_party_id" UUID,
    "funded_by_bank_account_details" TEXT,
    "funded_by_transfer_amount" DECIMAL(19,4),
    "funded_by_transfer_mode" TEXT,
    "funded_by_note" TEXT,
    "returned_amount" DECIMAL(19,4),
    "returned_on" DATE,
    "returned_to_legal_entity_id" UUID,
    "returned_to_party_id" UUID,
    "returned_to_bank_account_details" TEXT,
    "return_journal_entry_id" UUID,
    "narrative" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "security_instruments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_security_instruments_org_status_return_due" ON "security_instruments"("organization_id", "status", "return_due_on");

-- CreateIndex
CREATE INDEX "idx_security_instruments_project_id" ON "security_instruments"("project_id");

-- CreateIndex
CREATE INDEX "idx_security_instruments_tender_id" ON "security_instruments"("tender_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_security_instrument_purposes_id_org" ON "security_instrument_purposes"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_security_instrument_types_id_org" ON "security_instrument_types"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "security_instrument_purposes" ADD CONSTRAINT "fk_security_instrument_purposes_ledger_account_org_consistent" FOREIGN KEY ("default_recoverable_ledger_account_id", "organization_id") REFERENCES "ledger_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_instruments" ADD CONSTRAINT "fk_security_instruments_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_instruments" ADD CONSTRAINT "fk_security_instruments_project_org_consistent" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_instruments" ADD CONSTRAINT "fk_security_instruments_tender_org_consistent" FOREIGN KEY ("tender_id", "organization_id") REFERENCES "tenders"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_instruments" ADD CONSTRAINT "fk_security_instruments_purpose_org_consistent" FOREIGN KEY ("purpose_id", "organization_id") REFERENCES "security_instrument_purposes"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_instruments" ADD CONSTRAINT "fk_security_instruments_type_org_consistent" FOREIGN KEY ("type_id", "organization_id") REFERENCES "security_instrument_types"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_instruments" ADD CONSTRAINT "fk_security_instruments_bank_ledger_account_org_consistent" FOREIGN KEY ("bank_ledger_account_id", "organization_id") REFERENCES "ledger_accounts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_instruments" ADD CONSTRAINT "fk_security_instruments_lodge_journal_entry" FOREIGN KEY ("lodge_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_instruments" ADD CONSTRAINT "fk_security_instruments_return_journal_entry" FOREIGN KEY ("return_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_instruments" ADD CONSTRAINT "fk_security_instruments_funded_by_legal_entity_org_consistent" FOREIGN KEY ("funded_by_legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_instruments" ADD CONSTRAINT "fk_security_instruments_funded_by_party_org_consistent" FOREIGN KEY ("funded_by_party_id", "organization_id") REFERENCES "parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_instruments" ADD CONSTRAINT "fk_security_instruments_returned_to_legal_entity_org_consistent" FOREIGN KEY ("returned_to_legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_instruments" ADD CONSTRAINT "fk_security_instruments_returned_to_party_org_consistent" FOREIGN KEY ("returned_to_party_id", "organization_id") REFERENCES "parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
