-- Unfinished form text, kept per user. Not a business document.
CREATE TABLE "form_drafts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "form_key" VARCHAR(200) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_form_drafts_owner_key" ON "form_drafts"("organization_id", "user_id", "form_key");
CREATE INDEX "idx_form_drafts_organization_id" ON "form_drafts"("organization_id");
