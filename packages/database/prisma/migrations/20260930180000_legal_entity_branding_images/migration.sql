-- Optional logo, seal, and authorized-sign images for a legal entity.
ALTER TABLE "legal_entities" ADD COLUMN "logo_content_type" TEXT,
ADD COLUMN "logo_bytes" BYTEA,
ADD COLUMN "seal_content_type" TEXT,
ADD COLUMN "seal_bytes" BYTEA,
ADD COLUMN "authorized_sign_content_type" TEXT,
ADD COLUMN "authorized_sign_bytes" BYTEA;
