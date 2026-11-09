-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "lead_id" UUID,
    "tender_id" UUID,
    "project_manager_id" UUID,
    "introducer_id" UUID,
    "project_type_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'WON',
    "operational_status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "value" DECIMAL(19,4),
    "budget" DECIMAL(19,4),
    "gst_applicable" BOOLEAN NOT NULL DEFAULT true,
    "work_order_number" TEXT,
    "work_order_date" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_projects_organization_id" ON "projects"("organization_id");

-- CreateIndex
CREATE INDEX "idx_projects_client_id" ON "projects"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_projects_id_org" ON "projects"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_project_types_id_org" ON "project_types"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "fk_projects_client_org_consistent" FOREIGN KEY ("client_id", "organization_id") REFERENCES "parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "fk_projects_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "fk_projects_lead_org_consistent" FOREIGN KEY ("lead_id", "organization_id") REFERENCES "leads"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "fk_projects_tender_org_consistent" FOREIGN KEY ("tender_id", "organization_id") REFERENCES "tenders"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "fk_projects_manager_org_consistent" FOREIGN KEY ("project_manager_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "fk_projects_introducer_org_consistent" FOREIGN KEY ("introducer_id", "organization_id") REFERENCES "introducers"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "fk_projects_project_type_org_consistent" FOREIGN KEY ("project_type_id", "organization_id") REFERENCES "project_types"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
