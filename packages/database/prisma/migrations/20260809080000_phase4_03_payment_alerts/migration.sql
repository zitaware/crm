-- CreateEnum
CREATE TYPE "PaymentAlertSourceType" AS ENUM ('CAPEX_EVENT', 'OPEX_INSTALLMENT');

-- CreateEnum
CREATE TYPE "PaymentAlertStatus" AS ENUM ('OPEN', 'SNOOZED');

-- CreateTable
CREATE TABLE "payment_alerts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source_type" "PaymentAlertSourceType" NOT NULL,
    "source_event_id" UUID,
    "source_installment_id" UUID,
    "status" "PaymentAlertStatus" NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snoozed_until" DATE,
    "snoozed_at" TIMESTAMPTZ,
    "snoozed_by" UUID,
    "snooze_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "payment_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_payment_alerts_source_event_id" ON "payment_alerts"("source_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_payment_alerts_source_installment_id" ON "payment_alerts"("source_installment_id");

-- CreateIndex
CREATE INDEX "idx_payment_alerts_org_project" ON "payment_alerts"("organization_id", "project_id");

-- CreateIndex
CREATE INDEX "idx_payment_alerts_status_snoozed_until" ON "payment_alerts"("status", "snoozed_until");

-- AddForeignKey
ALTER TABLE "payment_alerts" ADD CONSTRAINT "fk_payment_alerts_project_org_consistent" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_alerts" ADD CONSTRAINT "fk_payment_alerts_source_event" FOREIGN KEY ("source_event_id") REFERENCES "milestone_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_alerts" ADD CONSTRAINT "fk_payment_alerts_source_installment" FOREIGN KEY ("source_installment_id") REFERENCES "milestone_installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CheckConstraint: exactly one source FK is set, matching source_type (ADR-064 decision 2)
ALTER TABLE "payment_alerts" ADD CONSTRAINT "chk_payment_alerts_source_matches_type" CHECK (
  (source_type = 'CAPEX_EVENT' AND source_event_id IS NOT NULL AND source_installment_id IS NULL)
  OR
  (source_type = 'OPEX_INSTALLMENT' AND source_installment_id IS NOT NULL AND source_event_id IS NULL)
);

-- CheckConstraint: snoozed_until is set iff status is SNOOZED (ADR-064 decision 5)
ALTER TABLE "payment_alerts" ADD CONSTRAINT "chk_payment_alerts_snoozed_fields_consistent" CHECK (
  (status = 'SNOOZED' AND snoozed_until IS NOT NULL)
  OR
  (status = 'OPEN' AND snoozed_until IS NULL)
);
