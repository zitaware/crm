/*
  Warnings:

  - A unique constraint covering the columns `[id,organization_id]` on the table `employees` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,organization_id]` on the table `lead_sources` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,organization_id]` on the table `lead_types` will be added. If there are existing duplicate values, this will fail.

*/
-- NOTE: Prisma's diff engine always spuriously proposes dropping
-- chk_cities_state_matches_district and uq_districts_id_state_id (hand-added
-- constraints with no Prisma-DSL representation) on every migration since
-- phase2_04_hr_masters. Intentionally NOT applying that drop here — see
-- docs/12-decisions-log.md.

-- CreateTable
CREATE TABLE "introducers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "introducers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "lead_type_id" UUID NOT NULL,
    "lead_source_id" UUID NOT NULL,
    "introducer_id" UUID,
    "assigned_to_employee_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'PROPOSAL_SENT',
    "estimated_value" DECIMAL(19,4),
    "lead_date" DATE NOT NULL,
    "expected_close_date" DATE,
    "expected_tender_date" DATE,
    "reminder_offset" TEXT,
    "internal_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_updates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "created_by_email" TEXT,

    CONSTRAINT "lead_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_introducers_organization_id" ON "introducers"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_introducers_id_org" ON "introducers"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_leads_organization_id" ON "leads"("organization_id");

-- CreateIndex
CREATE INDEX "idx_leads_client_id" ON "leads"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_leads_id_org" ON "leads"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_lead_updates_lead_id" ON "lead_updates"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_employees_id_org" ON "employees"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_lead_sources_id_org" ON "lead_sources"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_lead_types_id_org" ON "lead_types"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "fk_leads_client_org_consistent" FOREIGN KEY ("client_id", "organization_id") REFERENCES "parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "fk_leads_lead_type_org_consistent" FOREIGN KEY ("lead_type_id", "organization_id") REFERENCES "lead_types"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "fk_leads_lead_source_org_consistent" FOREIGN KEY ("lead_source_id", "organization_id") REFERENCES "lead_sources"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "fk_leads_introducer_org_consistent" FOREIGN KEY ("introducer_id", "organization_id") REFERENCES "introducers"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "fk_leads_assigned_employee_org_consistent" FOREIGN KEY ("assigned_to_employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_updates" ADD CONSTRAINT "fk_lead_updates_lead_org_consistent" FOREIGN KEY ("lead_id", "organization_id") REFERENCES "leads"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
