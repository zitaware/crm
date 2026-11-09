/**
 * Generic port for the organization-scoped flat lookup masters that all
 * share the same common baseline shape (id/organization_id/code/name/
 * description/sort_order/is_active/audit-stamps/version) — HR masters
 * (2.4), CRM/tender/project masters (2.5), and document/finance-support
 * masters (2.8) all ride on this one API rather than a bespoke service per
 * table. `code` is immutable once set (enforced by not accepting it in
 * update()); geography (states/districts/cities) is NOT part of this port
 * since it is global/statutory/system-seeded, not organization-scoped.
 */
export type MasterTypeKey =
  | 'internal_departments'
  | 'designations'
  | 'employment_types'
  | 'government_body_types'
  | 'client_types'
  | 'lead_types'
  | 'lead_sources'
  | 'tender_portals'
  | 'project_types'
  | 'security_instrument_purposes'
  | 'security_instrument_types'
  | 'document_categories'
  | 'expense_categories'
  | 'units_of_measure'
  | 'product_categories'
  | 'allocation_targets';

export interface MasterRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
}

export interface MasterCatalogEntry {
  type: MasterTypeKey;
  count: number;
}

export interface MasterPort {
  /** Record counts per master type, for the masters-all catalogue tiles. */
  getCatalog(input: { organizationId: string }): Promise<MasterCatalogEntry[]>;

  list(input: {
    organizationId: string;
    type: MasterTypeKey;
    includeInactive: boolean | undefined;
  }): Promise<MasterRecord[]>;

  create(input: {
    organizationId: string;
    type: MasterTypeKey;
    code: string;
    name: string;
    description: string | undefined;
    sortOrder: number | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<MasterRecord>;

  update(input: {
    organizationId: string;
    type: MasterTypeKey;
    id: string;
    name: string | undefined;
    description: string | undefined;
    sortOrder: number | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<MasterRecord>;

  setActive(input: {
    organizationId: string;
    type: MasterTypeKey;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void>;
}
