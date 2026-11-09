export interface StateSummary {
  id: string;
  name: string;
  code: string;
  gstStateCode: string;
  isActive: boolean;
  version: number;
}

export interface DistrictSummary {
  id: string;
  stateId: string;
  name: string;
  isActive: boolean;
  version: number;
}

export interface CitySummary {
  id: string;
  districtId: string;
  stateId: string;
  name: string;
  isActive: boolean;
  version: number;
}

/**
 * Global, statutory reference data — the rows carry no `organization_id`.
 * Editable in Phase 2 (ADR-044, superseding ADR-036's read-only stance) so
 * administrators can add districts/cities the partial seed does not cover.
 * The `organizationId` on the mutating methods is only the acting admin's
 * org, used to attribute the audit event (audit_events requires one); it
 * does not scope the geography row. A row's parent (`stateId`/`districtId`)
 * is fixed at creation — update changes only the name — so cities can never
 * drift out of hierarchy consistency.
 */
export interface GeographyCounts {
  states: number;
  districts: number;
  cities: number;
}

export interface GeographyPort {
  /** Total non-deleted counts for the masters-all geography tiles. */
  getCounts(): Promise<GeographyCounts>;

  listStates(input?: { includeInactive?: boolean | undefined }): Promise<StateSummary[]>;
  listDistricts(input: { stateId: string; includeInactive?: boolean | undefined }): Promise<DistrictSummary[]>;
  listCities(input: { districtId: string; includeInactive?: boolean | undefined }): Promise<CitySummary[]>;

  createState(input: {
    name: string;
    code: string;
    gstStateCode: string;
    actorId: string;
    organizationId: string;
    correlationId: string;
  }): Promise<StateSummary>;
  updateState(input: {
    id: string;
    name: string | undefined;
    code: string | undefined;
    gstStateCode: string | undefined;
    expectedVersion: number;
    actorId: string;
    organizationId: string;
    correlationId: string;
  }): Promise<StateSummary>;
  setStateActive(input: {
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    organizationId: string;
    correlationId: string;
  }): Promise<void>;

  createDistrict(input: {
    stateId: string;
    name: string;
    actorId: string;
    organizationId: string;
    correlationId: string;
  }): Promise<DistrictSummary>;
  updateDistrict(input: {
    id: string;
    name: string | undefined;
    expectedVersion: number;
    actorId: string;
    organizationId: string;
    correlationId: string;
  }): Promise<DistrictSummary>;
  setDistrictActive(input: {
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    organizationId: string;
    correlationId: string;
  }): Promise<void>;

  createCity(input: {
    districtId: string;
    name: string;
    actorId: string;
    organizationId: string;
    correlationId: string;
  }): Promise<CitySummary>;
  updateCity(input: {
    id: string;
    name: string | undefined;
    expectedVersion: number;
    actorId: string;
    organizationId: string;
    correlationId: string;
  }): Promise<CitySummary>;
  setCityActive(input: {
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    organizationId: string;
    correlationId: string;
  }): Promise<void>;
}
