-- NOTE: Prisma's diff engine proposed dropping chk_cities_state_matches_district
-- and uq_districts_id_state_id here (hand-added, not representable in
-- schema.prisma's DSL — see migration phase2_03_geography). Intentionally
-- not applied — same recurring spurious-drop proposal noted in every
-- migration since phase2_04_hr_masters.

-- DropIndex
DROP INDEX "uq_gst_registrations_gstin";

-- DropIndex
DROP INDEX "uq_legal_entities_org_pan";

-- Recreate both as partial unique indexes filtered on deleted_at IS NULL,
-- so a soft-deleted legal entity's PAN (and a soft-deleted GST
-- registration's GSTIN) can be reused by a new row. Prisma's @@unique/
-- @unique cannot express a WHERE clause — same pattern as
-- uq_financial_years_one_current (this migration's own sibling model) and
-- uq_user_permission_overrides_* (phase2_02_rbac).
CREATE UNIQUE INDEX "uq_legal_entities_org_pan" ON "legal_entities"("organization_id", "pan_number") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "uq_gst_registrations_gstin" ON "gst_registrations"("gstin") WHERE "deleted_at" IS NULL;
