-- A project names its sales manager alongside its project manager
-- (ADR-152). Both are optional employees of the same organization.

ALTER TABLE "projects" ADD COLUMN "sales_manager_id" UUID;

ALTER TABLE "projects" ADD CONSTRAINT "fk_projects_sales_manager_org_consistent" FOREIGN KEY ("sales_manager_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
