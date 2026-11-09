export interface ContactInput {
  id: string | undefined;
  name: string;
  designation: string | undefined;
  phone: string | undefined;
  email: string | undefined;
}

export interface ContactSummary {
  id: string;
  name: string;
  designation: string | null;
  phone: string | null;
  email: string | null;
}

export interface ClientSummary {
  /** Party.id — the stable identity of this counterparty. ClientProfile's
   * own id is an internal implementation detail, never exposed. */
  id: string;
  name: string;
  shortCode: string | null;
  department: string | null;
  clientTypeId: string | null;
  clientTypeName: string | null;
  stateId: string | null;
  stateName: string | null;
  districtId: string | null;
  districtName: string | null;
  cityId: string | null;
  cityName: string | null;
  contactCount: number;
  /** Every lead and project raised for this client, whatever their stage. */
  leadCount: number;
  projectCount: number;
  isActive: boolean;
  createdAt: string;
  version: number;
}

export interface ClientDetail extends ClientSummary {
  pinCode: string | null;
  officeAddress: string | null;
  internalNote: string | null;
  gstin: string | null;
  contacts: ContactSummary[];
}

export interface ClientPort {
  list(input: { organizationId: string; includeInactive: boolean | undefined }): Promise<ClientSummary[]>;

  getDetail(input: { organizationId: string; id: string }): Promise<ClientDetail>;

  create(input: {
    organizationId: string;
    name: string;
    shortCode: string | undefined;
    clientTypeId: string | undefined;
    department: string | undefined;
    stateId: string | undefined;
    districtId: string | undefined;
    cityId: string | undefined;
    pinCode: string | undefined;
    officeAddress: string | undefined;
    gstin: string | undefined;
    internalNote: string | undefined;
    contacts: ContactInput[];
    actorId: string;
    correlationId: string;
  }): Promise<ClientDetail>;

  /** Contacts are replaced wholesale from the caller's full list each save
   * (add/remove/edit all expressed as one new `contacts` array) — matching
   * how the add/edit form's repeatable rows are edited as a set. */
  update(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    shortCode: string | undefined;
    clientTypeId: string | undefined;
    department: string | undefined;
    stateId: string | undefined;
    districtId: string | undefined;
    cityId: string | undefined;
    pinCode: string | undefined;
    officeAddress: string | undefined;
    gstin: string | undefined;
    internalNote: string | undefined;
    contacts: ContactInput[] | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<ClientDetail>;

  setActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void>;
}
