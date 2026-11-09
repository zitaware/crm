-- Phase 7, Slice 7.5 — Unified monthly employee allocation (ADR-095).
--
-- Implements docs/04 §13's MERGE of `employee-effort-entry.html` and
-- `employee-contribution-entry.html` into ONE canonical record: exactly one
-- percentage truth per employee-month, never two.
--
-- Posts no journal, ever. docs/06 ("Salary project costing"): allocation
-- "moves cost analytically to project/non-project dimensions without
-- changing total salary expense." Project manpower cost is a derived read
-- over the salary import (ADR-094) and these percentages, never a stored or
-- posted figure.
--
-- Three new tables and one new enum; nothing existing is altered, so this is
-- unconditionally safe on existing data.
--
-- Hand-curated from `prisma migrate diff --from-url`, excluding the same
-- three known phantom lines every prior migration in this project excludes.

-- CreateEnum
CREATE TYPE "EmployeeAllocationStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateTable
CREATE TABLE "allocation_targets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "allocation_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_monthly_allocations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "allocation_month" DATE NOT NULL,
    "status" "EmployeeAllocationStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "submitted_at" TIMESTAMPTZ,
    "submitted_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "employee_monthly_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_allocation_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_monthly_allocation_id" UUID NOT NULL,
    "project_id" UUID,
    "allocation_target_id" UUID,
    "sequence" INTEGER NOT NULL,
    "percentage" DECIMAL(9,4) NOT NULL,
    "contribution_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_allocation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_allocation_targets_org_code" ON "allocation_targets"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_allocation_targets_id_org" ON "allocation_targets"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_employee_allocations_org_month" ON "employee_monthly_allocations"("organization_id", "allocation_month");

-- CreateIndex
CREATE INDEX "idx_employee_allocations_org_status" ON "employee_monthly_allocations"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_employee_allocations_employee_month" ON "employee_monthly_allocations"("organization_id", "employee_id", "allocation_month");

-- CreateIndex
CREATE UNIQUE INDEX "uq_employee_allocations_id_org" ON "employee_monthly_allocations"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_employee_allocation_lines_allocation" ON "employee_allocation_lines"("employee_monthly_allocation_id");

-- CreateIndex
CREATE INDEX "idx_employee_allocation_lines_org_project" ON "employee_allocation_lines"("organization_id", "project_id");

-- AddForeignKey
ALTER TABLE "employee_monthly_allocations" ADD CONSTRAINT "fk_employee_allocations_employee_org_consistent" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_allocation_lines" ADD CONSTRAINT "fk_employee_allocation_lines_allocation" FOREIGN KEY ("employee_monthly_allocation_id") REFERENCES "employee_monthly_allocations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_allocation_lines" ADD CONSTRAINT "fk_employee_allocation_lines_project_org_consistent" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_allocation_lines" ADD CONSTRAINT "fk_employee_allocation_lines_target_org_consistent" FOREIGN KEY ("allocation_target_id", "organization_id") REFERENCES "allocation_targets"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added CHECK: a line targets EITHER a project OR a non-project
-- allocation target, never both and never neither. Same either/or shape
-- chk_vendor_bill_lines_expense_or_inventory uses (ADR-092), for the same
-- reason: the alternative is a nullable pair that a future caller can leave
-- in a meaningless state.
ALTER TABLE "employee_allocation_lines" ADD CONSTRAINT "chk_employee_allocation_lines_one_target"
  CHECK (("project_id" IS NOT NULL) <> ("allocation_target_id" IS NOT NULL));

-- Hand-added CHECK: a share of a month is positive and cannot exceed the
-- whole month. The exactly-100% rule itself is a property of the SET of
-- lines and is enforced at submission in the service, but no single line can
-- ever be nonsense.
ALTER TABLE "employee_allocation_lines" ADD CONSTRAINT "chk_employee_allocation_lines_percentage_range"
  CHECK ("percentage" > 0 AND "percentage" <= 100);

-- Hand-added CHECK: submission is a real event with a time and an actor, and
-- a DRAFT has neither. Keeps the two from drifting apart.
ALTER TABLE "employee_monthly_allocations" ADD CONSTRAINT "chk_employee_allocations_submitted_fields"
  CHECK (("status" = 'SUBMITTED' AND "submitted_at" IS NOT NULL)
      OR ("status" = 'DRAFT'     AND "submitted_at" IS NULL));
