/**
 * Product / item master (Phase 7.1, ADR-091).
 *
 * Deliberately a dedicated port rather than a generic MasterTypeKey: the
 * table carries unit of measure, HSN/SAC, category, an optional default rate
 * and the `isStockTracked` discriminator, none of which the flat
 * FlatMasterDelegate can represent (ADR-037/038 scopes the generic masters
 * API to identical-shape tables). Same precedent as ExpenseCategory and
 * PenaltyCategory (ADR-062).
 *
 * `code` is server-generated (ITEM-000001) and never accepted from the
 * client, matching the Invoice/Milestone/VendorBill numbering precedent.
 */
export interface InventoryItemRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  unitOfMeasureId: string;
  unitOfMeasureName: string;
  productCategoryId: string | null;
  productCategoryName: string | null;
  hsnSac: string | null;
  /** Decimal string, or null. A convenience default for data entry only —
   * never an accounting figure. Real stock cost is the weighted average
   * derived from posted movements (Slice 7.2). */
  defaultRateAmount: string | null;
  /** docs/01: "Stock-tracked items use Inventory; non-stock goods/services
   * use Expense." Only a stock-tracked item may be received into or
   * consumed from inventory. */
  isStockTracked: boolean;
  isActive: boolean;
  version: number;
}

export interface InventoryItemFilters {
  search: string | undefined;
  productCategoryId: string | undefined;
  isStockTracked: boolean | undefined;
  /** Deactivated items stay visible in filters and read-only views but are
   * never selectable when creating or editing — the project-wide
   * deactivated-master rule. */
  includeInactive: boolean | undefined;
}

export interface InventoryItemPort {
  getCount(input: { organizationId: string }): Promise<number>;

  list(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: InventoryItemFilters;
  }): Promise<{ rows: InventoryItemRecord[]; total: number }>;

  getDetail(input: { organizationId: string; id: string }): Promise<InventoryItemRecord>;

  create(input: {
    organizationId: string;
    name: string;
    description: string | undefined;
    unitOfMeasureId: string;
    productCategoryId: string | undefined;
    hsnSac: string | undefined;
    defaultRateAmount: string | undefined;
    isStockTracked: boolean;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<InventoryItemRecord>;

  update(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    description: string | undefined;
    unitOfMeasureId: string | undefined;
    productCategoryId: string | undefined;
    hsnSac: string | undefined;
    defaultRateAmount: string | undefined;
    isStockTracked: boolean | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<InventoryItemRecord>;

  setActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void>;
}
