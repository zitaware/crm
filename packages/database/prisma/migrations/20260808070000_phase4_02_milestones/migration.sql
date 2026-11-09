-- CreateEnum
CREATE TYPE "MilestoneType" AS ENUM ('CAPEX', 'OPEX');

-- CreateEnum
CREATE TYPE "MilestoneAchievementStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'ACHIEVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InstallmentFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PLANNED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AlertRecipient" AS ENUM ('ACCOUNT_TEAM', 'PROJECT_MANAGER', 'BOTH');

-- CreateTable
CREATE TABLE "project_milestones" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "type" "MilestoneType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "approved_amount" DECIMAL(19,4) NOT NULL,
    "reference_number" TEXT,
    "approval_date" DATE,
    "description" TEXT,
    "achievement_status" "MilestoneAchievementStatus",
    "frequency" "InstallmentFrequency",
    "installment_count" INTEGER,
    "schedule_start_date" DATE,
    "first_invoice_date" DATE,
    "alert_recipient" "AlertRecipient" NOT NULL DEFAULT 'ACCOUNT_TEAM',
    "reminder_offset_days" INTEGER NOT NULL DEFAULT 3,
    "achieved_on" DATE,
    "achieved_by" UUID,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by" UUID,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "project_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "milestone_type" "MilestoneType" NOT NULL DEFAULT 'CAPEX',
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "percent_of_pool" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "due_date" DATE NOT NULL,
    "achievement_status" "MilestoneAchievementStatus" NOT NULL DEFAULT 'PLANNED',
    "achieved_on" DATE,
    "achieved_by" UUID,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by" UUID,
    "cancel_reason" TEXT,
    "sequence" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "milestone_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_installments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "milestone_type" "MilestoneType" NOT NULL DEFAULT 'OPEX',
    "sequence_number" INTEGER NOT NULL,
    "service_period_start" DATE NOT NULL,
    "service_period_end" DATE NOT NULL,
    "planned_invoice_date" DATE NOT NULL,
    "scheduled_amount" DECIMAL(19,4) NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PLANNED',
    "skip_reason" TEXT,
    "cancel_reason" TEXT,
    "closed_at" TIMESTAMPTZ,
    "closed_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "milestone_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_creation_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "result_milestone_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestone_creation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_project_milestones_project_id" ON "project_milestones"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_project_milestones_project_code" ON "project_milestones"("project_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_project_milestones_id_org" ON "project_milestones"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_project_milestones_id_org_type" ON "project_milestones"("id", "organization_id", "type");

-- CreateIndex
CREATE INDEX "idx_milestone_events_milestone_id" ON "milestone_events"("milestone_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_milestone_events_milestone_code" ON "milestone_events"("milestone_id", "code");

-- CreateIndex
CREATE INDEX "idx_milestone_installments_milestone_id" ON "milestone_installments"("milestone_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_milestone_installments_milestone_sequence" ON "milestone_installments"("milestone_id", "sequence_number");

-- CreateIndex
CREATE UNIQUE INDEX "uq_milestone_creation_requests_org_key" ON "milestone_creation_requests"("organization_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "project_milestones" ADD CONSTRAINT "fk_project_milestones_project_org_consistent" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_events" ADD CONSTRAINT "fk_milestone_events_milestone_org_type_consistent" FOREIGN KEY ("milestone_id", "organization_id", "milestone_type") REFERENCES "project_milestones"("id", "organization_id", "type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_installments" ADD CONSTRAINT "fk_milestone_installments_milestone_org_type_consistent" FOREIGN KEY ("milestone_id", "organization_id", "milestone_type") REFERENCES "project_milestones"("id", "organization_id", "type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints (ADR-063 decision 3) — Prisma's schema DSL has no CHECK
-- primitive, so these are hand-added regardless of migration-history health.
ALTER TABLE "project_milestones" ADD CONSTRAINT "chk_project_milestones_approved_amount_positive" CHECK (approved_amount > 0);
ALTER TABLE "project_milestones" ADD CONSTRAINT "chk_project_milestones_installment_count_positive" CHECK (installment_count IS NULL OR installment_count >= 1);
ALTER TABLE "project_milestones" ADD CONSTRAINT "chk_project_milestones_reminder_offset_nonneg" CHECK (reminder_offset_days >= 0);
ALTER TABLE "project_milestones" ADD CONSTRAINT "chk_project_milestones_type_fields" CHECK (
  (type = 'CAPEX' AND achievement_status IS NULL AND frequency IS NULL AND installment_count IS NULL AND schedule_start_date IS NULL AND first_invoice_date IS NULL)
  OR
  (type = 'OPEX' AND achievement_status IS NOT NULL AND frequency IS NOT NULL AND installment_count IS NOT NULL AND schedule_start_date IS NOT NULL AND first_invoice_date IS NOT NULL)
);
ALTER TABLE "milestone_events" ADD CONSTRAINT "chk_milestone_events_amount_positive" CHECK (amount > 0);
ALTER TABLE "milestone_events" ADD CONSTRAINT "chk_milestone_events_percent_range" CHECK (percent_of_pool >= 0 AND percent_of_pool <= 100);
ALTER TABLE "milestone_events" ADD CONSTRAINT "chk_milestone_events_sequence_positive" CHECK (sequence >= 1);
ALTER TABLE "milestone_events" ADD CONSTRAINT "chk_milestone_events_type_fixed" CHECK (milestone_type = 'CAPEX');
ALTER TABLE "milestone_installments" ADD CONSTRAINT "chk_milestone_installments_amount_positive" CHECK (scheduled_amount > 0);
ALTER TABLE "milestone_installments" ADD CONSTRAINT "chk_milestone_installments_sequence_positive" CHECK (sequence_number >= 1);
ALTER TABLE "milestone_installments" ADD CONSTRAINT "chk_milestone_installments_period_valid" CHECK (service_period_end >= service_period_start);
ALTER TABLE "milestone_installments" ADD CONSTRAINT "chk_milestone_installments_type_fixed" CHECK (milestone_type = 'OPEX');
