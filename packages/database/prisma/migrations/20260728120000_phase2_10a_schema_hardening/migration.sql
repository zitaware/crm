-- NOTE: Prisma's diff engine proposed dropping chk_cities_state_matches_district
-- and uq_districts_id_state_id here (hand-added, not representable in
-- schema.prisma's DSL — see migration phase2_03_geography). Intentionally
-- not applied.

-- DropForeignKey
ALTER TABLE "employees" DROP CONSTRAINT "employees_user_id_fkey";

-- DropIndex
DROP INDEX "idx_employees_user_id";

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "document_category_id" UUID;

-- AlterTable
ALTER TABLE "employees" DROP COLUMN "is_active";

-- CreateIndex
CREATE UNIQUE INDEX "uq_document_categories_id_org" ON "document_categories"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_documents_storage_key" ON "documents"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_employees_user_id" ON "employees"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_users_id_org" ON "users"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "fk_employees_user_org_consistent" FOREIGN KEY ("user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "fk_documents_category_org_consistent" FOREIGN KEY ("document_category_id", "organization_id") REFERENCES "document_categories"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
