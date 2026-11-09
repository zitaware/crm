-- ADR-178: a vendor bill keeps a link to the vendor's invoice and to the
-- payment receipt, as the purchase register sheet has them.
ALTER TABLE "vendor_bills" ADD COLUMN "bill_url" TEXT,
ADD COLUMN "payment_receipt_url" TEXT;
