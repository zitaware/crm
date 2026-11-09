export type VendorPaymentTerms = 'ADVANCE' | 'NET_15' | 'NET_30' | 'NET_45';

export interface VendorSummary {
  /** Party.id — the stable identity of this counterparty. VendorProfile's
   * own id is an internal implementation detail, never exposed. */
  id: string;
  name: string;
  shortCode: string | null;
  gstin: string | null;
  panNumber: string | null;
  paymentTerms: VendorPaymentTerms | null;
  stateId: string | null;
  stateName: string | null;
  districtId: string | null;
  districtName: string | null;
  cityId: string | null;
  cityName: string | null;
  /** party.isActive && vendorProfile.isActive — both must be true for this
   * vendor to be selectable anywhere (see VendorProfile's schema doc
   * comment). */
  isActive: boolean;
  createdAt: string;
  version: number;
}

export interface VendorDetail extends VendorSummary {
  pinCode: string | null;
  officeAddress: string | null;
  internalNote: string | null;
}

export interface VendorDuplicateMatch {
  partyId: string;
  name: string;
  gstin: string | null;
  panNumber: string | null;
  cityName: string | null;
  matchType: 'EXACT_GSTIN' | 'EXACT_PAN' | 'NAME_CITY';
  /** True when this Party already has a VendorProfile (an exact-GSTIN/PAN
   * match against an existing vendor is a hard duplicate the caller should
   * pick instead of creating a new one); false when it's a Party with no
   * VendorProfile yet (a Client, most likely) that a new VendorProfile
   * could be attached to via `create`'s `existingPartyId`. */
  hasVendorProfile: boolean;
}

export interface VendorPort {
  list(input: { organizationId: string; includeInactive: boolean | undefined }): Promise<VendorSummary[]>;

  getDetail(input: { organizationId: string; id: string }): Promise<VendorDetail>;

  /** Never blocks by itself — returns exact-GSTIN/PAN matches (hard
   * duplicates once `create` is actually called) and normalized-name(+city)
   * soft matches, for the frontend to show before final submit. */
  checkForDuplicates(input: {
    organizationId: string;
    name: string;
    gstin: string | undefined;
    panNumber: string | undefined;
    cityId: string | undefined;
  }): Promise<VendorDuplicateMatch[]>;

  /** `existingPartyId`, when provided, attaches a new VendorProfile to that
   * existing Party (validated: same org, no VendorProfile already on it)
   * instead of creating a new Party — the duplicate-resolution path from
   * `checkForDuplicates`. GSTIN/PAN are normalized (uppercased, trimmed)
   * before every write and comparison. */
  create(input: {
    organizationId: string;
    existingPartyId: string | undefined;
    name: string;
    shortCode: string | undefined;
    gstin: string | undefined;
    panNumber: string | undefined;
    paymentTerms: VendorPaymentTerms | undefined;
    stateId: string | undefined;
    districtId: string | undefined;
    cityId: string | undefined;
    pinCode: string | undefined;
    officeAddress: string | undefined;
    internalNote: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<VendorDetail>;

  update(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    shortCode: string | undefined;
    gstin: string | undefined;
    panNumber: string | undefined;
    paymentTerms: VendorPaymentTerms | undefined;
    stateId: string | undefined;
    districtId: string | undefined;
    cityId: string | undefined;
    pinCode: string | undefined;
    officeAddress: string | undefined;
    internalNote: string | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<VendorDetail>;

  /** Flips ONLY VendorProfile.isActive — never Party.isActive, so a Party
   * that is also an active Client (or any other role) is left untouched
   * (see VendorProfile's schema doc comment). */
  setActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void>;
}
