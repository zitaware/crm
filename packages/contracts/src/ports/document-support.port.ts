export interface EntityTypeSummary {
  code: string;
  description: string | null;
}

export interface PenaltyCategorySummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  basisType: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
}

export interface PaymentModeSummary {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  requiresReferenceNumber: boolean;
  requiresBankSource: boolean;
  requiresCardSource: boolean;
  isCashLike: boolean;
  isElectronic: boolean;
  version: number;
}

/**
 * Groups the document + finance-support masters that don't fit the pure
 * generic-masters shape: entity_types (fixed global reference, no CRUD),
 * document_category_entity_types (a junction, not a lookup row), and
 * penalty_categories/payment_modes (each carries fields beyond the common
 * baseline — see schema.prisma doc comments).
 */
export interface DocumentSupportPort {
  listEntityTypes(): Promise<EntityTypeSummary[]>;

  /** Empty array means "applies to every entity type" (no row = applies
   * everywhere, per the approved plan's relational design). */
  listDocumentCategoryEntityTypes(input: { documentCategoryId: string }): Promise<string[]>;

  setDocumentCategoryEntityTypes(input: {
    organizationId: string;
    documentCategoryId: string;
    entityTypeCodes: string[];
    actorId: string;
    correlationId: string;
  }): Promise<void>;

  listPenaltyCategories(input: {
    organizationId: string;
    includeInactive: boolean | undefined;
  }): Promise<PenaltyCategorySummary[]>;

  createPenaltyCategory(input: {
    organizationId: string;
    code: string;
    name: string;
    description: string | undefined;
    basisType: string | undefined;
    sortOrder: number | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<PenaltyCategorySummary>;

  updatePenaltyCategory(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    description: string | undefined;
    basisType: string | undefined;
    sortOrder: number | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<PenaltyCategorySummary>;

  setPenaltyCategoryActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void>;

  listPaymentModes(input: { includeInactive: boolean | undefined }): Promise<PaymentModeSummary[]>;

  /** code is intentionally not editable here — payment modes are
   * system-seeded; only label/sortOrder/isActive are Administrator-mutable.
   * `organizationId` is the acting admin's organization, used only for the
   * audit-trail entry — payment_modes itself has no organization_id column
   * (it is a genuinely global catalogue). */
  updatePaymentMode(input: {
    organizationId: string;
    id: string;
    label: string | undefined;
    sortOrder: number | undefined;
    isActive: boolean | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<PaymentModeSummary>;
}
