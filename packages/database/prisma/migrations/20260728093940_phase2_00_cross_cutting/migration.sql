-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" UUID,
    "actor_email" TEXT,
    "old_values" JSONB,
    "new_values" JSONB,
    "command_payload" JSONB,
    "reason" TEXT,
    "correlation_id" UUID NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ,
    "locked_by" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "recipient_user_id" UUID,
    "recipient_email" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "template" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider_message_id" TEXT,
    "source_outbox_event_id" UUID NOT NULL,
    "sent_at" TIMESTAMPTZ,
    "failed_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "job_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "items_processed" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    "error" TEXT,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "command_type" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "source_record_type" TEXT,
    "source_record_id" UUID,
    "result_reference" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_organizations_code" ON "organizations"("code");

-- CreateIndex
CREATE INDEX "idx_audit_events_org_created_at" ON "audit_events"("organization_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "idx_audit_events_entity" ON "audit_events"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_audit_events_actor" ON "audit_events"("actor_id");

-- CreateIndex
CREATE INDEX "idx_outbox_events_status_next_attempt" ON "outbox_events"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "idx_outbox_events_aggregate" ON "outbox_events"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_notifications_source_outbox_event_id" ON "notifications"("source_outbox_event_id");

-- CreateIndex
CREATE INDEX "idx_notifications_recipient_user_id" ON "notifications"("recipient_user_id");

-- CreateIndex
CREATE INDEX "idx_notifications_status" ON "notifications"("status");

-- CreateIndex
CREATE INDEX "idx_job_runs_job_name_started_at" ON "job_runs"("job_name", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_idempotency_keys_org_command_key" ON "idempotency_keys"("organization_id", "command_type", "idempotency_key");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_source_outbox_event_id_fkey" FOREIGN KEY ("source_outbox_event_id") REFERENCES "outbox_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint (not expressible in schema.prisma; see docs/07-database-conventions.md)
ALTER TABLE "outbox_events" ADD CONSTRAINT "chk_outbox_events_status" CHECK ("status" IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'DEAD_LETTERED'));

ALTER TABLE "notifications" ADD CONSTRAINT "chk_notifications_channel" CHECK ("channel" IN ('EMAIL'));

ALTER TABLE "notifications" ADD CONSTRAINT "chk_notifications_status" CHECK ("status" IN ('PENDING', 'SENT', 'FAILED'));

ALTER TABLE "job_runs" ADD CONSTRAINT "chk_job_runs_status" CHECK ("status" IN ('RUNNING', 'SUCCEEDED', 'FAILED'));
