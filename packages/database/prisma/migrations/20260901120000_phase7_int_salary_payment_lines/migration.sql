-- Phase 7 integration (ADR-101) — per-employee salary payment lines.
--
-- ADR-100 settled a month as one anonymous figure with one reference. Salary
-- does not leave the bank that way: each person is credited separately and
-- each credit carries its own UTR, and a single reference field had nowhere
-- to put them. The import already credits Salary Payable one line per
-- employee; this is the matching debit.

CREATE TABLE "salary_payment_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "salary_payment_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "paid_amount" DECIMAL(19,4) NOT NULL,
    "tds_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "reference_number" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_payment_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_salary_payment_lines_payment_employee" ON "salary_payment_lines"("salary_payment_id", "employee_id");
CREATE INDEX "idx_salary_payment_lines_org_employee" ON "salary_payment_lines"("organization_id", "employee_id");
CREATE INDEX "idx_salary_payment_lines_payment" ON "salary_payment_lines"("salary_payment_id");

ALTER TABLE "salary_payment_lines" ADD CONSTRAINT "fk_salary_payment_lines_payment" FOREIGN KEY ("salary_payment_id") REFERENCES "salary_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "salary_payment_lines" ADD CONSTRAINT "fk_salary_payment_lines_employee_org_consistent" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added CHECK: a line moves a real amount, and TDS is withheld FROM it
-- rather than added to it — so it can never exceed what was settled.
ALTER TABLE "salary_payment_lines" ADD CONSTRAINT "chk_salary_payment_lines_amounts"
  CHECK ("paid_amount" > 0
     AND "tds_amount" >= 0
     AND "tds_amount" <= "paid_amount");
