export type SecurityInstrumentStatus = 'LODGED' | 'RETURNED';
export type SecurityInstrumentCategory = 'EMD' | 'SD';

/** Same "derive at query time, never store a third state" reasoning
 * PaymentAlertPort's derivedLabel already uses — RETURN_DUE is LODGED plus
 * a passed returnDueOn, not a stored status. */
export type SecurityInstrumentDerivedLabel = 'LODGED' | 'RETURN_DUE' | 'RETURNED';

export interface SecurityInstrumentSummary {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  projectId: string | null;
  projectName: string | null;
  tenderId: string | null;
  tenderName: string | null;
  purposeId: string;
  purposeName: string;
  purposeCategory: SecurityInstrumentCategory | null;
  typeId: string;
  typeName: string;
  requiresCashPosting: boolean;
  amount: string;
  instrumentReferenceNo: string | null;
  issuingBank: string | null;
  lodgedWithAuthority: string | null;
  bankLedgerAccountId: string | null;
  bankLedgerAccountName: string | null;
  submittedOn: string;
  returnDueOn: string;
  status: SecurityInstrumentStatus;
  derivedLabel: SecurityInstrumentDerivedLabel;
  lodgeJournalEntryId: string | null;
  returnedAmount: string | null;
  returnedOn: string | null;
  returnJournalEntryId: string | null;
}

export interface SecurityInstrumentDetail extends SecurityInstrumentSummary {
  narrative: string | null;
  fundedByLegalEntityId: string | null;
  fundedByLegalEntityName: string | null;
  fundedByPartyId: string | null;
  fundedByPartyName: string | null;
  fundedByBankAccountDetails: string | null;
  fundedByTransferAmount: string | null;
  fundedByTransferMode: string | null;
  fundedByNote: string | null;
  returnedToLegalEntityId: string | null;
  returnedToLegalEntityName: string | null;
  returnedToPartyId: string | null;
  returnedToPartyName: string | null;
  returnedToBankAccountDetails: string | null;
}

export interface SecurityInstrumentFilters {
  category?: SecurityInstrumentCategory | undefined;
  projectId?: string | undefined;
  tenderId?: string | undefined;
  status?: SecurityInstrumentStatus | undefined;
  returnDueFrom?: string | undefined;
  returnDueTo?: string | undefined;
}

/** The EMD/SD list screen's five summary tiles (docs/16 emdsd-all.html) —
 * computed server-side from real data, never the prototype's static
 * numbers, and never computed client-side. */
export interface SecurityInstrumentTiles {
  emdLodgedAmount: string;
  emdLodgedCount: number;
  sdLodgedAmount: string;
  sdLodgedCount: number;
  returnedAmount: string;
  returnedCount: number;
  returnOverdueAmount: string;
  returnOverdueCount: number;
  toRecoverAmount: string;
}

export interface LodgeSecurityInstrumentInput {
  organizationId: string;
  legalEntityId: string;
  projectId: string | undefined;
  tenderId: string | undefined;
  purposeId: string;
  typeId: string;
  amount: string;
  instrumentReferenceNo: string | undefined;
  issuingBank: string | undefined;
  lodgedWithAuthority: string | undefined;
  bankLedgerAccountId: string | undefined;
  submittedOn: string;
  returnDueOn: string;
  narrative: string | undefined;
  fundedByLegalEntityId: string | undefined;
  fundedByPartyId: string | undefined;
  fundedByBankAccountDetails: string | undefined;
  fundedByTransferAmount: string | undefined;
  fundedByTransferMode: string | undefined;
  fundedByNote: string | undefined;
  idempotencyKey: string;
  actorId: string;
  correlationId: string;
}

export interface RecordSecurityInstrumentReturnInput {
  organizationId: string;
  id: string;
  returnedAmount: string;
  returnedOn: string;
  returnedToLegalEntityId: string | undefined;
  returnedToPartyId: string | undefined;
  returnedToBankAccountDetails: string | undefined;
  idempotencyKey: string;
  actorId: string;
  correlationId: string;
}

export interface SecurityInstrumentPurposeOption {
  id: string;
  code: string;
  name: string;
  category: SecurityInstrumentCategory | null;
  hasDefaultLedgerAccount: boolean;
}

export interface SecurityInstrumentTypeOption {
  id: string;
  code: string;
  name: string;
  requiresCashPosting: boolean;
}

export interface SecurityInstrumentPort {
  /** Lookup data for the lodge form's Purpose/Type selects — gated
   * security_instrument.create, same "supporting data for a create form"
   * precedent as milestones.previewOpexSchedule. Richer than the generic
   * Masters catalogue's flat MasterRecord shape (category/
   * requiresCashPosting drive the form's own conditional fields). */
  listPurposes(input: { organizationId: string }): Promise<SecurityInstrumentPurposeOption[]>;
  listTypes(input: { organizationId: string }): Promise<SecurityInstrumentTypeOption[]>;

  lodge(input: LodgeSecurityInstrumentInput): Promise<SecurityInstrumentSummary>;

  /** Only reachable when returnedAmount equals the instrument's lodged
   * amount exactly — penalty-deducted (partial) returns are deferred, not
   * silently accepted or partially posted (ADR-066). */
  recordReturn(input: RecordSecurityInstrumentReturnInput): Promise<SecurityInstrumentSummary>;

  list(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: SecurityInstrumentFilters;
  }): Promise<{ rows: SecurityInstrumentSummary[]; total: number }>;

  getDetail(input: { organizationId: string; id: string }): Promise<SecurityInstrumentDetail>;

  getTiles(input: { organizationId: string; projectId: string | undefined }): Promise<SecurityInstrumentTiles>;
}
