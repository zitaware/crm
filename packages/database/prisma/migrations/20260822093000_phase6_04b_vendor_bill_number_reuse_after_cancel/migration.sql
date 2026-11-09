-- Phase 6.4b: a CANCELLED vendor bill (like a VOID one) never posted
-- anything and should free up its vendorBillNumber for reuse — the new
-- CANCELLED status (added in 20260822090000) was missed from the existing
-- hand-added partial unique index's WHERE clause. This is a plain
-- hand-written fix (not `prisma migrate diff`-generated, since
-- uq_vendor_bills_vendor_number was never representable in schema.prisma's
-- own DSL to begin with — see the phase6_02 migration's own note).

DROP INDEX "uq_vendor_bills_vendor_number";

CREATE UNIQUE INDEX "uq_vendor_bills_vendor_number" ON "vendor_bills"("organization_id", "vendor_id", "vendor_bill_number") WHERE "status" NOT IN ('VOID', 'CANCELLED');
