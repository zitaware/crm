-- ADR-169: a server or subscription bill paid in another currency keeps its
-- basic amount in that currency too, so a correction starts from the bill
-- as it was (bills imported before this have only the total); and any
-- direct expense can carry a link to the bill (a portal or drive URL).
ALTER TABLE "direct_expenses" ADD COLUMN "foreign_taxable_amount" DECIMAL(19,4),
ADD COLUMN "bill_url" TEXT;
