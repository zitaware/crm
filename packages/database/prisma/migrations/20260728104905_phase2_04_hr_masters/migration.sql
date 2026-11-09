-- NOTE: Prisma's diff engine proposed dropping chk_cities_state_matches_district
-- and uq_districts_id_state_id here because they are hand-added constraints
-- (see migration phase2_03_geography) not representable in schema.prisma's
-- DSL. That drop has been intentionally removed — these constraints must be
-- stripped from every future auto-generated migration's diff, forever, since
-- Prisma will keep proposing to drop what it doesn't know about.

-- CreateTable
CREATE TABLE "internal_departments" (
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

    CONSTRAINT "internal_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "designations" (
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

    CONSTRAINT "designations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_types" (
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

    CONSTRAINT "employment_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_internal_departments_org_code" ON "internal_departments"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_designations_org_code" ON "designations"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_employment_types_org_code" ON "employment_types"("organization_id", "code");

-- Normalized (case/whitespace-insensitive) per-organization name uniqueness.
-- Prisma's @@unique can only express plain-column uniqueness, so these are
-- hand-written (see schema.prisma's note on functional indexes).
CREATE UNIQUE INDEX "uq_internal_departments_org_normalized_name" ON "internal_departments"("organization_id", lower(trim("name")));
CREATE UNIQUE INDEX "uq_designations_org_normalized_name" ON "designations"("organization_id", lower(trim("name")));
CREATE UNIQUE INDEX "uq_employment_types_org_normalized_name" ON "employment_types"("organization_id", lower(trim("name")));
