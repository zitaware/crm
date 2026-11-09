export const BRANDING_IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg'] as const;
export type BrandingImageContentType = (typeof BRANDING_IMAGE_CONTENT_TYPES)[number];

/** PNG or JPEG, raw base64 (no data-URL prefix). The service caps the decoded size. */
export interface BrandingImageInput {
  contentType: BrandingImageContentType;
  dataBase64: string;
}

export interface LegalEntityBranding {
  logo: BrandingImageInput | null;
  seal: BrandingImageInput | null;
  authorizedSign: BrandingImageInput | null;
  placeOfSupply: string | null;
  jurisdiction: string | null;
  stateCode: string | null;
}

export interface LegalEntitySummary {
  id: string;
  legalName: string;
  panNumber: string;
  registeredAddress: string;
  hasLogo: boolean;
  hasSeal: boolean;
  hasAuthorizedSign: boolean;
  isActive: boolean;
  version: number;
}

export interface GstRegistrationSummary {
  id: string;
  legalEntityId: string;
  stateId: string;
  gstin: string;
  tradeName: string | null;
  isActive: boolean;
  version: number;
}

/** Phase 5.2 (Receipt) — a legal-entity-scoped bank account master, reusing
 * legal_entity.read/legal_entity.manage (a sub-resource, same as GST
 * registrations). ledgerAccountId is required — receipts post into it — and
 * is not itself editable after creation (moving a bank account's ledger
 * target would silently change where past receipts' history reads from). */
export interface BankAccountSummary {
  id: string;
  legalEntityId: string;
  ledgerAccountId: string;
  ledgerAccountCode: string;
  ledgerAccountName: string;
  accountName: string;
  bankName: string | null;
  maskedAccountNumber: string | null;
  invoiceAccountNumber: string | null;
  ifsc: string | null;
  isActive: boolean;
  version: number;
}

export type CardType = 'DEBIT_CARD' | 'CREDIT_CARD';

/** Phase 6.8 (ADR-088) -- a minimal debit/credit card master, bundled into
 * the same organization-setup module as BankAccount (same class of
 * financial-infrastructure sub-resource, reusing legal_entity.read/manage).
 * Only a masked last-four digit string is ever stored -- never a full card
 * number, CVV, PIN, OTP, or banking credential. bankAccountId/ledgerAccountId
 * are mutually exclusive by type (enforced by a DB CHECK): a Debit Card
 * always resolves through its linked BankAccount's own ledger; a Credit
 * Card carries its own dedicated payable liability ledger account instead. */
export interface CardAccountSummary {
  id: string;
  legalEntityId: string;
  type: CardType;
  displayName: string;
  issuerName: string | null;
  maskedLastFour: string;
  cardNumber: string | null;
  cardholderEmployeeId: string | null;
  cardholderEmployeeName: string | null;
  bankAccountId: string | null;
  bankAccountName: string | null;
  ledgerAccountId: string | null;
  ledgerAccountName: string | null;
  statementDay: number | null;
  paymentDueDay: number | null;
  isActive: boolean;
  version: number;
}

export interface LegalEntityPort {
  list(input: { organizationId: string; includeInactive: boolean | undefined }): Promise<LegalEntitySummary[]>;

  getBranding(input: { organizationId: string; id: string }): Promise<LegalEntityBranding>;

  create(input: {
    organizationId: string;
    legalName: string;
    panNumber: string;
    registeredAddress: string;
    logo?: BrandingImageInput | undefined;
    seal?: BrandingImageInput | undefined;
    authorizedSign?: BrandingImageInput | undefined;
    placeOfSupply?: string | null | undefined;
    jurisdiction?: string | null | undefined;
    stateCode?: string | null | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<LegalEntitySummary>;

  update(input: {
    organizationId: string;
    id: string;
    legalName: string | undefined;
    registeredAddress: string | undefined;
    /** Undefined leaves the stored image. Null removes it. */
    logo?: BrandingImageInput | null | undefined;
    seal?: BrandingImageInput | null | undefined;
    authorizedSign?: BrandingImageInput | null | undefined;
    placeOfSupply?: string | null | undefined;
    jurisdiction?: string | null | undefined;
    stateCode?: string | null | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<LegalEntitySummary>;

  setActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void>;

  /** Soft-delete, freeing this entity's PAN for reuse. Rejected if any GST
   * registration or financial year still references this entity — remove
   * those first. Final — there is no restore. */
  delete(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void>;

  listGstRegistrations(input: {
    organizationId: string;
    legalEntityId: string;
  }): Promise<GstRegistrationSummary[]>;

  createGstRegistration(input: {
    organizationId: string;
    legalEntityId: string;
    stateId: string;
    gstin: string;
    tradeName: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<GstRegistrationSummary>;

  /** Trade name only — gstin/stateId/legalEntityId are permanent once a
   * registration is created (a registration is tied to one state/GSTIN for
   * its lifetime, matching real GST rules). */
  updateGstRegistration(input: {
    organizationId: string;
    id: string;
    tradeName: string | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<GstRegistrationSummary>;

  setGstRegistrationActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void>;

  /** Soft-delete, freeing this GSTIN for reuse (including re-adding it to
   * the same legal entity). No dependent guard — nothing references a GST
   * registration. Final — there is no restore. */
  deleteGstRegistration(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void>;

  listBankAccounts(input: {
    organizationId: string;
    legalEntityId: string | undefined;
    includeInactive: boolean | undefined;
  }): Promise<BankAccountSummary[]>;

  createBankAccount(input: {
    organizationId: string;
    legalEntityId: string;
    /** Omitted: a ledger of its own is created under Bank Accounts (ADR-160). */
    ledgerAccountId: string | undefined;
    accountName: string;
    bankName: string | undefined;
    maskedAccountNumber: string | undefined;
    invoiceAccountNumber?: string | undefined;
    ifsc: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<BankAccountSummary>;

  /** accountName/bankName/maskedAccountNumber/ifsc only — legalEntityId and
   * ledgerAccountId are permanent once created (see BankAccountSummary's
   * own doc comment). */
  updateBankAccount(input: {
    organizationId: string;
    id: string;
    accountName?: string | undefined;
    bankName?: string | null | undefined;
    maskedAccountNumber?: string | null | undefined;
    invoiceAccountNumber?: string | null | undefined;
    ifsc?: string | null | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<BankAccountSummary>;

  setBankAccountActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void>;

  listCardAccounts(input: {
    organizationId: string;
    legalEntityId: string | undefined;
    includeInactive: boolean | undefined;
  }): Promise<CardAccountSummary[]>;

  /** type/bankAccountId/ledgerAccountId are permanent once created (same
   * reasoning as BankAccount's own ledgerAccountId — moving a card's target
   * account would silently change where past Direct Expense postings'
   * history reads from). Exactly one of bankAccountId (DEBIT_CARD) /
   * ledgerAccountId (CREDIT_CARD) must be supplied, matching the type. */
  createCardAccount(input: {
    organizationId: string;
    legalEntityId: string;
    type: CardType;
    displayName: string;
    issuerName: string | undefined;
    maskedLastFour: string;
    cardNumber?: string | undefined;
    cardholderEmployeeId: string | undefined;
    bankAccountId: string | undefined;
    ledgerAccountId: string | undefined;
    statementDay: number | undefined;
    paymentDueDay: number | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<CardAccountSummary>;

  updateCardAccount(input: {
    organizationId: string;
    id: string;
    displayName?: string | undefined;
    issuerName?: string | null | undefined;
    maskedLastFour?: string | undefined;
    cardNumber?: string | null | undefined;
    cardholderEmployeeId?: string | null | undefined;
    statementDay?: number | null | undefined;
    paymentDueDay?: number | null | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<CardAccountSummary>;

  setCardAccountActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void>;
}
