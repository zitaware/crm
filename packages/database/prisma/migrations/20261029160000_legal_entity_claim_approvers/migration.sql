-- ADR-171: who approves each legal entity's employee expense claims.
-- CreateTable
CREATE TABLE "legal_entity_claim_approvers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "legal_entity_claim_approvers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_legal_entity_claim_approvers_org" ON "legal_entity_claim_approvers"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_legal_entity_claim_approvers_entity_user" ON "legal_entity_claim_approvers"("legal_entity_id", "user_id");

-- AddForeignKey
ALTER TABLE "legal_entity_claim_approvers" ADD CONSTRAINT "fk_legal_entity_claim_approvers_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_entity_claim_approvers" ADD CONSTRAINT "fk_legal_entity_claim_approvers_user_org_consistent" FOREIGN KEY ("user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

