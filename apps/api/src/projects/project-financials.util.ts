import { Prisma } from '@prisma/client';

/**
 * The one shared recognized-expense formula (ADR-089) — reused by all three
 * expense sources (VendorBillLine, DirectExpense, EmployeeExpenseClaim)
 * rather than three independently reimplemented calculations. Excludes
 * recoverable Input GST from cost, matching CBIC's ITC treatment (input
 * GST is a tax-credit asset, not an expense) and the ICAI framework's
 * accounting definition of expense. Ineligible GST stays folded into
 * `grossAmount` by the caller (it was never split out), so it's correctly
 * included here. TDS never appears in either argument — it changes the
 * settlement destination (TDS Payable), not the expense amount.
 */
export function recognizedExpenseAmount(grossAmount: Prisma.Decimal, eligibleGstCredit: Prisma.Decimal): Prisma.Decimal {
  return grossAmount.minus(eligibleGstCredit);
}
