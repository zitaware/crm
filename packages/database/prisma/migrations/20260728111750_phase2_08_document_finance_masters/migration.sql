-- NOTE: Prisma's diff engine proposed dropping chk_cities_state_matches_district
-- and uq_districts_id_state_id here (hand-added, not representable in
-- schema.prisma's DSL — see migration phase2_03_geography). Intentionally
-- not applied.

-- CreateTable
CREATE TABLE "entity_types" (
    "code" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "entity_types_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "document_categories" (
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

    CONSTRAINT "document_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_category_entity_types" (
    "document_category_id" UUID NOT NULL,
    "entity_type_code" TEXT NOT NULL,

    CONSTRAINT "document_category_entity_types_pkey" PRIMARY KEY ("document_category_id","entity_type_code")
);

-- CreateTable
CREATE TABLE "expense_categories" (
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

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "penalty_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "basis_type" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "penalty_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_modes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "requires_reference_number" BOOLEAN NOT NULL DEFAULT false,
    "requires_bank_source" BOOLEAN NOT NULL DEFAULT false,
    "is_cash_like" BOOLEAN NOT NULL DEFAULT false,
    "is_electronic" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "payment_modes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_document_categories_org_code" ON "document_categories"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_expense_categories_org_code" ON "expense_categories"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_penalty_categories_org_code" ON "penalty_categories"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_payment_modes_code" ON "payment_modes"("code");

-- AddForeignKey
ALTER TABLE "document_category_entity_types" ADD CONSTRAINT "document_category_entity_types_document_category_id_fkey" FOREIGN KEY ("document_category_id") REFERENCES "document_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_category_entity_types" ADD CONSTRAINT "document_category_entity_types_entity_type_code_fkey" FOREIGN KEY ("entity_type_code") REFERENCES "entity_types"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Normalized (case/whitespace-insensitive) per-organization name uniqueness.
-- Prisma's @@unique can only express plain-column uniqueness, so these are
-- hand-written (see schema.prisma's note on functional indexes).
CREATE UNIQUE INDEX "uq_document_categories_org_normalized_name" ON "document_categories"("organization_id", lower(trim("name")));
CREATE UNIQUE INDEX "uq_expense_categories_org_normalized_name" ON "expense_categories"("organization_id", lower(trim("name")));
CREATE UNIQUE INDEX "uq_penalty_categories_org_normalized_name" ON "penalty_categories"("organization_id", lower(trim("name")));
