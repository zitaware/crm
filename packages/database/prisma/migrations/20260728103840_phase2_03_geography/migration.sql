-- CreateTable
CREATE TABLE "states" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "gst_state_code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "districts" (
    "id" UUID NOT NULL,
    "state_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" UUID NOT NULL,
    "district_id" UUID NOT NULL,
    "state_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_states_name" ON "states"("name");

-- CreateIndex
CREATE UNIQUE INDEX "uq_states_code" ON "states"("code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_states_gst_state_code" ON "states"("gst_state_code");

-- CreateIndex
CREATE INDEX "idx_districts_state_id" ON "districts"("state_id");

-- CreateIndex
CREATE INDEX "idx_cities_district_id" ON "cities"("district_id");

-- AddForeignKey
ALTER TABLE "districts" ADD CONSTRAINT "districts_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Normalized (case/whitespace-insensitive) per-parent uniqueness. Prisma's
-- @@unique can only express plain-column uniqueness, so these are hand-
-- written to avoid schema/migration drift (see schema.prisma comments).
CREATE UNIQUE INDEX "uq_districts_state_normalized_name" ON "districts"("state_id", lower(trim("name")));
CREATE UNIQUE INDEX "uq_cities_district_normalized_name" ON "cities"("district_id", lower(trim("name")));

-- Composite-unique support constraint: lets `cities` enforce state_id
-- consistency via a real composite FK below rather than an app-layer-only
-- check.
ALTER TABLE "districts" ADD CONSTRAINT "uq_districts_id_state_id" UNIQUE ("id", "state_id");

-- DB-level guarantee that a city's denormalized state_id actually matches
-- its district's state_id.
ALTER TABLE "cities" ADD CONSTRAINT "chk_cities_state_matches_district" FOREIGN KEY ("district_id", "state_id") REFERENCES "districts"("id", "state_id") ON DELETE RESTRICT ON UPDATE CASCADE;
