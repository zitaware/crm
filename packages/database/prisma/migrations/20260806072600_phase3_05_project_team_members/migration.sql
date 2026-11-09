-- CreateTable
CREATE TABLE "project_team_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "role" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "project_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_project_team_members_project_id" ON "project_team_members"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_project_team_members_project_employee" ON "project_team_members"("project_id", "employee_id");

-- AddForeignKey
ALTER TABLE "project_team_members" ADD CONSTRAINT "fk_project_team_members_project_org_consistent" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_team_members" ADD CONSTRAINT "fk_project_team_members_employee_org_consistent" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
