-- ADR-169: the Server and Subscription modules (plans with generated
-- cycles) are replaced by a server/subscription tag on Direct Expense,
-- filled by an Excel import. Expenses already paid through a cycle keep
-- their tag before the cycle tables go, so nothing loses its split.

-- CreateEnum
CREATE TYPE "DirectExpenseSpendType" AS ENUM ('SERVER', 'SUBSCRIPTION');

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "fk_subscriptions_legal_entity_org_consistent";

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "fk_subscriptions_vendor_org_consistent";

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "fk_subscriptions_expense_category_org_consistent";

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "fk_subscriptions_project_org_consistent";

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "fk_subscriptions_used_by_employee_org_consistent";

-- DropForeignKey
ALTER TABLE "servers" DROP CONSTRAINT "fk_servers_legal_entity_org_consistent";

-- DropForeignKey
ALTER TABLE "servers" DROP CONSTRAINT "fk_servers_vendor_org_consistent";

-- DropForeignKey
ALTER TABLE "servers" DROP CONSTRAINT "fk_servers_expense_category_org_consistent";

-- DropForeignKey
ALTER TABLE "servers" DROP CONSTRAINT "fk_servers_managed_by_employee_org_consistent";

-- DropForeignKey
ALTER TABLE "server_projects" DROP CONSTRAINT "fk_server_projects_server_org_consistent";

-- DropForeignKey
ALTER TABLE "server_projects" DROP CONSTRAINT "fk_server_projects_project_org_consistent";

-- DropForeignKey
ALTER TABLE "recurring_cycles" DROP CONSTRAINT "fk_recurring_cycles_subscription_org_consistent";

-- DropForeignKey
ALTER TABLE "recurring_cycles" DROP CONSTRAINT "fk_recurring_cycles_server_org_consistent";

-- DropForeignKey
ALTER TABLE "recurring_cycle_payments" DROP CONSTRAINT "fk_recurring_cycle_payments_cycle_org_consistent";

-- DropForeignKey
ALTER TABLE "recurring_cycle_payments" DROP CONSTRAINT "fk_recurring_cycle_payments_direct_expense_org_consistent";

-- AlterTable
ALTER TABLE "direct_expenses" ADD COLUMN     "exchange_rate" DECIMAL(19,6),
ADD COLUMN     "foreign_amount" DECIMAL(19,4),
ADD COLUMN     "spend_type" "DirectExpenseSpendType";

-- Keep the server/subscription split of expenses paid through a cycle.
UPDATE "direct_expenses" d
SET "spend_type" = c."source_type"::text::"DirectExpenseSpendType"
FROM "recurring_cycle_payments" p
JOIN "recurring_cycles" c ON c."id" = p."cycle_id"
WHERE p."direct_expense_id" = d."id";

-- NEFT/RTGS is the same as Bank Transfer: no longer offered. Kept, inactive,
-- for the documents already recorded with it.
UPDATE "payment_modes" SET "is_active" = false WHERE "code" = 'NEFT_RTGS';

-- The removed modules' permissions.
DELETE FROM "role_permissions" WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "key" LIKE 'subscription.%' OR "key" LIKE 'server.%');
DELETE FROM "user_permission_overrides" WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "key" LIKE 'subscription.%' OR "key" LIKE 'server.%');
DELETE FROM "permissions" WHERE "key" LIKE 'subscription.%' OR "key" LIKE 'server.%';

-- DropTable
DROP TABLE "subscriptions";

-- DropTable
DROP TABLE "servers";

-- DropTable
DROP TABLE "server_projects";

-- DropTable
DROP TABLE "recurring_cycles";

-- DropTable
DROP TABLE "recurring_cycle_payments";

-- DropEnum
DROP TYPE "RecurringFrequency";

-- DropEnum
DROP TYPE "RecurringParentStatus";

-- DropEnum
DROP TYPE "RecurringCycleStatus";

-- DropEnum
DROP TYPE "RecurringCycleSourceType";

-- CreateIndex
CREATE INDEX "idx_direct_expenses_org_spend_type_date" ON "direct_expenses"("organization_id", "spend_type", "expense_date");

