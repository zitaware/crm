-- AlterTable
ALTER TABLE "documents" ADD COLUMN "is_encrypted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "documents" ADD COLUMN "encryption_salt" TEXT;
ALTER TABLE "documents" ADD COLUMN "encryption_iv" TEXT;
