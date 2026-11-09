-- NOTE: Prisma's diff engine proposed dropping chk_cities_state_matches_district
-- and uq_districts_id_state_id here (hand-added, not representable in
-- schema.prisma's DSL — see migration phase2_03_geography). Intentionally
-- not applied.

-- CreateTable
CREATE TABLE "legal_entities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "pan_number" TEXT NOT NULL,
    "registered_address" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "legal_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gst_registrations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "state_id" UUID NOT NULL,
    "gstin" TEXT NOT NULL,
    "trade_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "gst_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_years" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "financial_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_periods" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "period_number" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "locked_at" TIMESTAMPTZ,
    "locked_by" UUID,
    "reopened_at" TIMESTAMPTZ,
    "reopened_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_period_transitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "accounting_period_id" UUID NOT NULL,
    "previous_status" TEXT NOT NULL,
    "new_status" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "correlation_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_period_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_legal_entities_org_pan" ON "legal_entities"("organization_id", "pan_number");

-- CreateIndex
CREATE UNIQUE INDEX "uq_gst_registrations_gstin" ON "gst_registrations"("gstin");

-- CreateIndex
CREATE INDEX "idx_gst_registrations_legal_entity_id" ON "gst_registrations"("legal_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_financial_years_legal_entity_label" ON "financial_years"("legal_entity_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "uq_accounting_periods_fy_period_number" ON "accounting_periods"("financial_year_id", "period_number");

-- CreateIndex
CREATE INDEX "idx_accounting_period_transitions_period_id" ON "accounting_period_transitions"("accounting_period_id");

-- AddForeignKey
ALTER TABLE "gst_registrations" ADD CONSTRAINT "gst_registrations_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gst_registrations" ADD CONSTRAINT "gst_registrations_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_years" ADD CONSTRAINT "financial_years_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Standard 15-character GSTIN format: 2-digit state code, 10-char PAN,
-- 1-char entity code, 'Z' literal, 1 checksum char. Prisma's schema DSL has
-- no regex CHECK expression, so this is hand-written.
ALTER TABLE "gst_registrations" ADD CONSTRAINT "chk_gst_registrations_gstin_format"
  CHECK ("gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$');

-- At most one "current" financial year per legal entity. Prisma's @@unique
-- cannot express a partial (WHERE) index.
CREATE UNIQUE INDEX "uq_financial_years_one_current" ON "financial_years"("legal_entity_id") WHERE "is_current";

ALTER TABLE "accounting_periods" ADD CONSTRAINT "chk_accounting_periods_status"
  CHECK ("status" IN ('OPEN', 'SOFT_CLOSED', 'LOCKED'));

-- Maker-checker: the actor who reopens a locked period must differ from the
-- actor who locked it (self-approval is never allowed). Trivially satisfied
-- when either side is null (period never locked, or never reopened).
ALTER TABLE "accounting_periods" ADD CONSTRAINT "chk_accounting_periods_reopener_differs"
  CHECK ("reopened_by" IS NULL OR "locked_by" IS NULL OR "reopened_by" <> "locked_by");
