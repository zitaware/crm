-- Phase 8.5a (ADR-112) — TDS and GST-TDS certificates and statement credits,
-- and their matches to client deductions (docs/04 §18 "TDS Certificate/26AS
-- Reconciliation"). Reconciliation data only: nothing here posts to the ledger.

CREATE TYPE "TdsCertificateSource" AS ENUM ('CERTIFICATE', 'STATEMENT');
CREATE TYPE "TaxDeductionType" AS ENUM ('TDS', 'CGST_TDS', 'SGST_TDS', 'IGST_TDS');
CREATE TYPE "TdsCertificateStatus" AS ENUM ('ACTIVE', 'CANCELLED');

CREATE TABLE "tds_certificates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "source" "TdsCertificateSource" NOT NULL,
    "deduction_type" "TaxDeductionType" NOT NULL,
    "reference_number" TEXT NOT NULL,
    "deductor_tan" TEXT,
    "deductor_gstin" TEXT,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "credit_date" DATE NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "remarks" TEXT,
    "status" "TdsCertificateStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by" UUID,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tds_certificates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tds_certificate_matches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "certificate_id" UUID NOT NULL,
    "allocation_deduction_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "unmatched_at" TIMESTAMPTZ,
    "unmatched_by" UUID,
    "unmatch_reason" TEXT,

    CONSTRAINT "tds_certificate_matches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_tds_certificates_reference" ON "tds_certificates"("organization_id", "party_id", "source", "deduction_type", "reference_number");
CREATE INDEX "idx_tds_certificates_org_status" ON "tds_certificates"("organization_id", "status");
CREATE INDEX "idx_tds_certificates_org_party" ON "tds_certificates"("organization_id", "party_id");
CREATE INDEX "idx_tds_certificate_matches_certificate" ON "tds_certificate_matches"("certificate_id");
CREATE INDEX "idx_tds_certificate_matches_deduction" ON "tds_certificate_matches"("allocation_deduction_id");
CREATE INDEX "idx_tds_certificate_matches_org" ON "tds_certificate_matches"("organization_id");

ALTER TABLE "tds_certificates" ADD CONSTRAINT "fk_tds_certificates_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tds_certificates" ADD CONSTRAINT "fk_tds_certificates_party_org_consistent" FOREIGN KEY ("party_id", "organization_id") REFERENCES "parties"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tds_certificate_matches" ADD CONSTRAINT "fk_tds_certificate_matches_certificate" FOREIGN KEY ("certificate_id") REFERENCES "tds_certificates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tds_certificate_matches" ADD CONSTRAINT "fk_tds_certificate_matches_deduction" FOREIGN KEY ("allocation_deduction_id") REFERENCES "allocation_deductions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added CHECKs: a credit is a real amount over a real period; a match
-- moves a real amount; a cancellation or unmatch always says who and why.
ALTER TABLE "tds_certificates" ADD CONSTRAINT "chk_tds_certificates_amount_period"
  CHECK ("amount" > 0 AND "period_start" <= "period_end");
ALTER TABLE "tds_certificates" ADD CONSTRAINT "chk_tds_certificates_cancellation"
  CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL));
ALTER TABLE "tds_certificate_matches" ADD CONSTRAINT "chk_tds_certificate_matches_amount"
  CHECK ("amount" > 0);
ALTER TABLE "tds_certificate_matches" ADD CONSTRAINT "chk_tds_certificate_matches_unmatch"
  CHECK (("unmatched_at" IS NULL) = ("unmatched_by" IS NULL));
