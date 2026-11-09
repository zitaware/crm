/** Shared count-then-pad sequential document-number generator (Phase 6.3
 * design review: "reuse one bounded organization-document number allocator
 * without redesigning unrelated modules"). Used by PaymentRequest
 * ("PMR-000001"). Purchase Request's own former use of this helper
 * ("PR-000001") was removed when Purchase Request was merged into Vendor
 * Bill (Phase 6.4, docs/12 ADR-079) — VendorBill.vendorBillNumber is the
 * vendor's own free-text invoice number, never system-generated. Invoice
 * numbering is NOT migrated to this helper either — its scoping key shape
 * (per-gstRegistration+financialYear, not flat per-org) is materially
 * different. The caller supplies its own scoped `count` query and its own
 * retry-on-collision loop around this call, matching the existing pattern:
 * `attempt` shifts the candidate number forward on a unique-constraint
 * collision. */
export async function generateSequentialNumber(input: {
  count: () => Promise<number>;
  prefix: string;
  padLength: number;
  attempt: number;
}): Promise<string> {
  const n = (await input.count()) + 1 + input.attempt;
  return `${input.prefix}${String(n).padStart(input.padLength, '0')}`;
}
