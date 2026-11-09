-- NOTE: Prisma's diff engine proposed dropping chk_cities_state_matches_district
-- and uq_districts_id_state_id here (hand-added, not representable in
-- schema.prisma's DSL — see migration phase2_03_geography). Intentionally
-- not applied. This composite FK is the ONE still not converted to native
-- Prisma modeling (see docs/12 ADR-039/ADR-040) — a future cleanup could
-- convert it the same way this migration converts every other
-- organization-consistency FK, which would finally stop this recurring
-- spurious-drop proposal for good.

-- DropForeignKey
ALTER TABLE "accounting_periods" DROP CONSTRAINT "accounting_periods_financial_year_id_fkey";

-- DropForeignKey
ALTER TABLE "document_links" DROP CONSTRAINT "document_links_document_id_fkey";

-- DropForeignKey
ALTER TABLE "employees" DROP CONSTRAINT "employees_designation_id_fkey";

-- DropForeignKey
ALTER TABLE "employees" DROP CONSTRAINT "employees_employment_type_id_fkey";

-- DropForeignKey
ALTER TABLE "employees" DROP CONSTRAINT "employees_internal_department_id_fkey";

-- DropForeignKey
ALTER TABLE "financial_years" DROP CONSTRAINT "financial_years_legal_entity_id_fkey";

-- DropForeignKey
ALTER TABLE "gst_registrations" DROP CONSTRAINT "gst_registrations_legal_entity_id_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_source_outbox_event_id_fkey";

-- DropForeignKey
ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "password_reset_tokens_user_id_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_invitations" DROP CONSTRAINT "user_invitations_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_role_id_fkey";

-- DropIndex
DROP INDEX "idx_accounting_period_transitions_period_id";

-- CreateIndex
CREATE INDEX "idx_accounting_period_transitions_period_id" ON "accounting_period_transitions"("accounting_period_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_accounting_periods_id_org" ON "accounting_periods"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_designations_id_org" ON "designations"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_documents_id_org" ON "documents"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_employment_types_id_org" ON "employment_types"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_financial_years_id_org" ON "financial_years"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_internal_departments_id_org" ON "internal_departments"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_legal_entities_id_org" ON "legal_entities"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_notifications_source_outbox_event_org" ON "notifications"("source_outbox_event_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_outbox_events_id_org" ON "outbox_events"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_roles_id_org" ON "roles"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_sessions_rotated_from_session_id" ON "sessions"("rotated_from_session_id");

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "fk_audit_events_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notifications_outbox_event_org_consistent" FOREIGN KEY ("source_outbox_event_id", "organization_id") REFERENCES "outbox_events"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notifications_recipient_user_org_consistent" FOREIGN KEY ("recipient_user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_invitations" ADD CONSTRAINT "fk_user_invitations_user_org_consistent" FOREIGN KEY ("user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "fk_password_reset_tokens_user_org_consistent" FOREIGN KEY ("user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "fk_sessions_user_org_consistent" FOREIGN KEY ("user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "fk_user_roles_user_org_consistent" FOREIGN KEY ("user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "fk_user_roles_role_org_consistent" FOREIGN KEY ("role_id", "organization_id") REFERENCES "roles"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "fk_user_permission_overrides_user_org_consistent" FOREIGN KEY ("user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gst_registrations" ADD CONSTRAINT "fk_gst_registrations_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_years" ADD CONSTRAINT "fk_financial_years_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "fk_accounting_periods_fy_org_consistent" FOREIGN KEY ("financial_year_id", "organization_id") REFERENCES "financial_years"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_period_transitions" ADD CONSTRAINT "fk_accounting_period_transitions_period_org_consistent" FOREIGN KEY ("accounting_period_id", "organization_id") REFERENCES "accounting_periods"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "fk_employees_internal_department_org_consistent" FOREIGN KEY ("internal_department_id", "organization_id") REFERENCES "internal_departments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "fk_employees_designation_org_consistent" FOREIGN KEY ("designation_id", "organization_id") REFERENCES "designations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "fk_employees_employment_type_org_consistent" FOREIGN KEY ("employment_type_id", "organization_id") REFERENCES "employment_types"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "fk_document_links_document_org_consistent" FOREIGN KEY ("document_id", "organization_id") REFERENCES "documents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
