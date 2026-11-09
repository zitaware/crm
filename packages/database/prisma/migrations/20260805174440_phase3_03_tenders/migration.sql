-- CreateTable
CREATE TABLE "tenders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "lead_id" UUID,
    "tender_portal_id" UUID,
    "assigned_to_employee_id" UUID,
    "tender_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "submission_status" TEXT NOT NULL DEFAULT 'IDENTIFIED',
    "result" TEXT NOT NULL DEFAULT 'PENDING',
    "estimated_value" DECIMAL(19,4),
    "tender_date" DATE NOT NULL,
    "submission_deadline" DATE,
    "submitted_date" DATE,
    "result_date" DATE,
    "reminder_offset" TEXT,
    "internal_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_updates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "created_by_email" TEXT,

    CONSTRAINT "tender_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_tenders_organization_id" ON "tenders"("organization_id");

-- CreateIndex
CREATE INDEX "idx_tenders_client_id" ON "tenders"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tenders_id_org" ON "tenders"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_tender_updates_tender_id" ON "tender_updates"("tender_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tender_portals_id_org" ON "tender_portals"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "fk_tenders_client_org_consistent" FOREIGN KEY ("client_id", "organization_id") REFERENCES "parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "fk_tenders_lead_org_consistent" FOREIGN KEY ("lead_id", "organization_id") REFERENCES "leads"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "fk_tenders_tender_portal_org_consistent" FOREIGN KEY ("tender_portal_id", "organization_id") REFERENCES "tender_portals"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "fk_tenders_assigned_employee_org_consistent" FOREIGN KEY ("assigned_to_employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_updates" ADD CONSTRAINT "fk_tender_updates_tender_org_consistent" FOREIGN KEY ("tender_id", "organization_id") REFERENCES "tenders"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
