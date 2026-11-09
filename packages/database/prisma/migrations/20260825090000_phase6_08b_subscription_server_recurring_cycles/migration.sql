-- Phase 6.8b (docs/12 ADR-088): Subscription & Server recurring-cycle
-- engine. Both reuse the existing Vendor/Party foundation and share one
-- RecurringCycle table, disambiguated by a real FK pair (subscription_id/
-- server_id) rather than an unconstrained polymorphic entityId -- mirrors
-- PaymentAlert's own sourceType + per-source FK shape.
--
-- The 3 lines intentionally NOT included below (chk_cities_state_matches_district
-- drop, uq_districts_id_state_id drop, idx_invoices_payment_alert_id drop) are
-- known phantom diff noise from `prisma migrate diff` against this dev
-- database, unrelated to this change -- excluded the same way every prior
-- hand-curated migration in this project excludes them.

-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "RecurringParentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecurringCycleStatus" AS ENUM ('PENDING', 'PAID', 'SKIPPED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RecurringCycleSourceType" AS ENUM ('SUBSCRIPTION', 'SERVER');

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "expense_category_id" UUID NOT NULL,
    "project_id" UUID,
    "used_by_employee_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "frequency" "RecurringFrequency" NOT NULL,
    "first_due_date" DATE NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "approx_amount_per_cycle" DECIMAL(19,4) NOT NULL,
    "status" "RecurringParentStatus" NOT NULL DEFAULT 'ACTIVE',
    "paused_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_reason" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "expense_category_id" UUID NOT NULL,
    "managed_by_employee_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "region" TEXT,
    "frequency" "RecurringFrequency" NOT NULL,
    "first_due_date" DATE NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "approx_amount_per_cycle" DECIMAL(19,4) NOT NULL,
    "status" "RecurringParentStatus" NOT NULL DEFAULT 'ACTIVE',
    "paused_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_reason" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "server_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_cycles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subscription_id" UUID,
    "server_id" UUID,
    "source_type" "RecurringCycleSourceType" NOT NULL,
    "sequence_index" INTEGER NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "RecurringCycleStatus" NOT NULL DEFAULT 'PENDING',
    "skipped_reason" TEXT,
    "skipped_at" TIMESTAMPTZ,
    "skipped_by" UUID,
    "superseded_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recurring_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_cycle_payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "direct_expense_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by" UUID,

    CONSTRAINT "recurring_cycle_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_subscriptions_org_status" ON "subscriptions"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_subscriptions_id_org" ON "subscriptions"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_servers_org_status" ON "servers"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_servers_id_org" ON "servers"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_server_projects_server_id" ON "server_projects"("server_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_server_projects_server_project" ON "server_projects"("server_id", "project_id");

-- CreateIndex
CREATE INDEX "idx_recurring_cycles_org_status_due_date" ON "recurring_cycles"("organization_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_recurring_cycles_id_org" ON "recurring_cycles"("id", "organization_id");

-- CreateIndex: Postgres treats NULLs as distinct, so each of these two
-- unique indexes only constrains its own source type's rows -- this is
-- what makes cycle generation idempotent under concurrent worker/manual
-- execution (ADR-088).
CREATE UNIQUE INDEX "uq_recurring_cycles_subscription_period_start" ON "recurring_cycles"("subscription_id", "period_start");

CREATE UNIQUE INDEX "uq_recurring_cycles_server_period_start" ON "recurring_cycles"("server_id", "period_start");

-- CreateIndex
CREATE INDEX "idx_recurring_cycle_payments_cycle_id" ON "recurring_cycle_payments"("cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_recurring_cycle_payments_direct_expense_id_org" ON "recurring_cycle_payments"("direct_expense_id", "organization_id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "fk_subscriptions_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "fk_subscriptions_vendor_org_consistent" FOREIGN KEY ("vendor_id", "organization_id") REFERENCES "parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "fk_subscriptions_expense_category_org_consistent" FOREIGN KEY ("expense_category_id", "organization_id") REFERENCES "expense_categories"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "fk_subscriptions_project_org_consistent" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "fk_subscriptions_used_by_employee_org_consistent" FOREIGN KEY ("used_by_employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servers" ADD CONSTRAINT "fk_servers_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servers" ADD CONSTRAINT "fk_servers_vendor_org_consistent" FOREIGN KEY ("vendor_id", "organization_id") REFERENCES "parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servers" ADD CONSTRAINT "fk_servers_expense_category_org_consistent" FOREIGN KEY ("expense_category_id", "organization_id") REFERENCES "expense_categories"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servers" ADD CONSTRAINT "fk_servers_managed_by_employee_org_consistent" FOREIGN KEY ("managed_by_employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_projects" ADD CONSTRAINT "fk_server_projects_server_org_consistent" FOREIGN KEY ("server_id", "organization_id") REFERENCES "servers"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_projects" ADD CONSTRAINT "fk_server_projects_project_org_consistent" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_cycles" ADD CONSTRAINT "fk_recurring_cycles_subscription_org_consistent" FOREIGN KEY ("subscription_id", "organization_id") REFERENCES "subscriptions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_cycles" ADD CONSTRAINT "fk_recurring_cycles_server_org_consistent" FOREIGN KEY ("server_id", "organization_id") REFERENCES "servers"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_cycle_payments" ADD CONSTRAINT "fk_recurring_cycle_payments_cycle_org_consistent" FOREIGN KEY ("cycle_id", "organization_id") REFERENCES "recurring_cycles"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_cycle_payments" ADD CONSTRAINT "fk_recurring_cycle_payments_direct_expense_org_consistent" FOREIGN KEY ("direct_expense_id", "organization_id") REFERENCES "direct_expenses"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint: exactly one source FK is set, matching source_type
-- (ADR-088, mirrors chk_payment_alerts_source_matches_type).
ALTER TABLE "recurring_cycles" ADD CONSTRAINT "chk_recurring_cycles_source_matches_type" CHECK (
  (source_type = 'SUBSCRIPTION' AND subscription_id IS NOT NULL AND server_id IS NULL)
  OR
  (source_type = 'SERVER' AND server_id IS NOT NULL AND subscription_id IS NULL)
);

-- CheckConstraint: Server never has a Weekly frequency (ADR-088, service-
-- level enforced too, but this catches any bypass of the application layer).
ALTER TABLE "servers" ADD CONSTRAINT "chk_servers_frequency_not_weekly" CHECK (frequency != 'WEEKLY');
