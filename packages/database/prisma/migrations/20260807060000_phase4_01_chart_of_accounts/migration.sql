-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "account_groups" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "account_type" "AccountType" NOT NULL,
    "normal_balance" "NormalBalance" NOT NULL,
    "parent_group_id" UUID,
    "is_system_defined" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "account_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_group_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "allow_manual_posting" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_account_groups_organization_id" ON "account_groups"("organization_id");

-- CreateIndex
CREATE INDEX "idx_account_groups_parent_group_id" ON "account_groups"("parent_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_account_groups_org_code" ON "account_groups"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_account_groups_id_org" ON "account_groups"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_ledger_accounts_organization_id" ON "ledger_accounts"("organization_id");

-- CreateIndex
CREATE INDEX "idx_ledger_accounts_account_group_id" ON "ledger_accounts"("account_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ledger_accounts_org_code" ON "ledger_accounts"("organization_id", "code");

-- AddForeignKey
ALTER TABLE "account_groups" ADD CONSTRAINT "fk_account_groups_parent_org_consistent" FOREIGN KEY ("parent_group_id", "organization_id") REFERENCES "account_groups"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "fk_ledger_accounts_group_org_consistent" FOREIGN KEY ("account_group_id", "organization_id") REFERENCES "account_groups"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Defense-in-depth: even though ChartOfAccountsService always normalizes
-- (trim + uppercase) `code` before every write, these expression indexes
-- enforce normalized uniqueness at the database level independent of the
-- application write path (ADR-062 decision 15).
CREATE UNIQUE INDEX "uq_account_groups_org_code_normalized" ON "account_groups" ("organization_id", upper(btrim("code")));
CREATE UNIQUE INDEX "uq_ledger_accounts_org_code_normalized" ON "ledger_accounts" ("organization_id", upper(btrim("code")));
