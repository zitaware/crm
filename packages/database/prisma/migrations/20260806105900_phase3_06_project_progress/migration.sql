-- CreateTable
CREATE TABLE "project_progress" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "percentage" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "created_by_email" TEXT,

    CONSTRAINT "project_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_project_progress_project_id" ON "project_progress"("project_id");

-- AddForeignKey
ALTER TABLE "project_progress" ADD CONSTRAINT "fk_project_progress_project_org_consistent" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
