/**
 * Penalty categories are org-scoped lookup masters, but — unlike the 12
 * identical-shape tables behind the generic MasterPort — they carry an
 * extra `basis_type` column (the default basis for a penalty, e.g. a
 * percentage vs a fixed amount). The generic FlatMasterDelegate cannot
 * carry that field (ADR-037 scopes the generic API to identical tables),
 * so penalty categories get this dedicated port so `basis_type` has a real
 * create/update path rather than being silently dropped.
 */
export interface PenaltyCategoryRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  basisType: string | null;
  /** Phase 5.2 (Receipt) — per-category override for which ledger account
   * an accepted/disputed penalty deduction posts to. Nullable; falls back
   * to a default account (PENALTY_REVENUE_DEDUCTION / DISPUTED_DEDUCTION_
   * RECEIVABLE) when unset. */
  acceptedLedgerAccountId: string | null;
  disputedLedgerAccountId: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
}

export interface PenaltyCategoryPort {
  getCount(input: { organizationId: string }): Promise<number>;

  list(input: {
    organizationId: string;
    includeInactive: boolean | undefined;
  }): Promise<PenaltyCategoryRecord[]>;

  create(input: {
    organizationId: string;
    code: string;
    name: string;
    description: string | undefined;
    basisType: string | undefined;
    acceptedLedgerAccountId: string | undefined;
    disputedLedgerAccountId: string | undefined;
    sortOrder: number | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<PenaltyCategoryRecord>;

  update(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    description: string | undefined;
    basisType: string | undefined;
    acceptedLedgerAccountId: string | undefined;
    disputedLedgerAccountId: string | undefined;
    sortOrder: number | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<PenaltyCategoryRecord>;

  setActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void>;
}
