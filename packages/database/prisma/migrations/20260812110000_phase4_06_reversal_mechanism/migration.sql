-- Phase 4.6: Reversal Mechanism, ADR-067.
-- Purely additive to journal_entries — no backfill needed, all four new
-- columns nullable. reversal_of_journal_entry_id is set only on the new
-- reversal entry, pointing back at the original; the original is found via
-- Prisma's automatic back-relation, not a second physical column.

-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "reversal_of_journal_entry_id" UUID,
ADD COLUMN     "reversal_reason" TEXT,
ADD COLUMN     "reversed_at" TIMESTAMPTZ,
ADD COLUMN     "reversed_by" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversal_of_journal_entry_id_key" ON "journal_entries"("reversal_of_journal_entry_id");

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversal_of_journal_entry_id_fkey" FOREIGN KEY ("reversal_of_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
