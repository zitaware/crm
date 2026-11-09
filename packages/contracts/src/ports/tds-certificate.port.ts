/**
 * TDS and GST-TDS certificates and statement credits (Phase 8.5a, ADR-112):
 * what clients report having deducted from our receipts, matched to the
 * deductions recorded on those receipts. Reconciliation only — nothing here
 * posts to the ledger.
 */

export type TdsCertificateSource = 'CERTIFICATE' | 'STATEMENT';
export type TaxDeductionType = 'TDS' | 'CGST_TDS' | 'SGST_TDS' | 'IGST_TDS';
export type TdsCertificateStatus = 'ACTIVE' | 'CANCELLED';

/** docs/05 "Deduction lifecycle — TDS and GST-TDS". Derived from matches, never stored. */
export type TdsDeductionLifecycle = 'RECORDED' | 'CERTIFICATE_PENDING' | 'CERTIFICATE_RECEIVED' | 'RECONCILED';
export const TDS_DEDUCTION_LIFECYCLES: readonly TdsDeductionLifecycle[] = ['RECORDED', 'CERTIFICATE_PENDING', 'CERTIFICATE_RECEIVED', 'RECONCILED'];
export const TAX_DEDUCTION_TYPES: readonly TaxDeductionType[] = ['TDS', 'CGST_TDS', 'SGST_TDS', 'IGST_TDS'];

export interface TdsCertificateSummary {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  partyId: string;
  partyName: string;
  source: TdsCertificateSource;
  deductionType: TaxDeductionType;
  referenceNumber: string;
  deductorTan: string | null;
  deductorGstin: string | null;
  periodStart: string;
  periodEnd: string;
  creditDate: string;
  amount: string;
  /** Σ active matches. */
  matchedAmount: string;
  unmatchedAmount: string;
  remarks: string | null;
  status: TdsCertificateStatus;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  version: number;
}

export interface TdsCertificateMatchRow {
  id: string;
  certificateId: string;
  deductionId: string;
  deductionType: TaxDeductionType;
  receiptId: string;
  receiptDate: string;
  invoiceId: string;
  invoiceNumber: string | null;
  projectId: string;
  projectName: string;
  amount: string;
  createdAt: string;
  unmatchedAt: string | null;
  unmatchReason: string | null;
}

export interface TdsCertificateDetail extends TdsCertificateSummary {
  matches: TdsCertificateMatchRow[];
}

/** A client deduction the certificate could be matched to. */
export interface TdsMatchCandidate {
  deductionId: string;
  deductionType: TaxDeductionType;
  receiptId: string;
  receiptDate: string;
  invoiceId: string;
  invoiceNumber: string | null;
  projectId: string;
  projectName: string;
  amount: string;
  /** Already matched to credits of this certificate's source (certificate or statement). */
  matchedFromSource: string;
  remaining: string;
  /** The receipt date falls inside the certificate's period. */
  inPeriod: boolean;
}

export interface TdsCertificateInput {
  legalEntityId: string;
  partyId: string;
  source: TdsCertificateSource;
  deductionType: TaxDeductionType;
  referenceNumber: string;
  deductorTan: string | undefined;
  deductorGstin: string | undefined;
  periodStart: string;
  periodEnd: string;
  creditDate: string;
  amount: string;
  remarks: string | undefined;
}

/** One CSV template row, as parsed in the browser; the server does all validation. */
export interface TdsCertificateImportRow {
  source: string;
  deductionType: string;
  /** The client's GSTIN or exact name. */
  client: string;
  deductorTan: string;
  deductorGstin: string;
  referenceNumber: string;
  periodStart: string;
  periodEnd: string;
  creditDate: string;
  amount: string;
  remarks: string;
}

export interface TdsCertificateImportPreview {
  rows: Array<{ rowNumber: number; clientName: string | null; errors: string[] }>;
  validCount: number;
  errorCount: number;
}

export interface TdsCertificatePort {
  list(input: { organizationId: string; status: TdsCertificateStatus | undefined; partyId: string | undefined; source: TdsCertificateSource | undefined }): Promise<TdsCertificateSummary[]>;
  getDetail(input: { organizationId: string; id: string }): Promise<TdsCertificateDetail>;
  record(input: TdsCertificateInput & { organizationId: string; actorId: string; correlationId: string }): Promise<TdsCertificateSummary>;
  cancel(input: { organizationId: string; id: string; reason: string; expectedVersion: number; actorId: string; correlationId: string }): Promise<TdsCertificateSummary>;
  listMatchCandidates(input: { organizationId: string; certificateId: string }): Promise<TdsMatchCandidate[]>;
  match(input: { organizationId: string; certificateId: string; matches: Array<{ deductionId: string; amount: string }>; actorId: string; correlationId: string }): Promise<TdsCertificateDetail>;
  unmatch(input: { organizationId: string; matchId: string; reason: string; actorId: string; correlationId: string }): Promise<TdsCertificateDetail>;
  previewImport(input: { organizationId: string; legalEntityId: string; rows: TdsCertificateImportRow[] }): Promise<TdsCertificateImportPreview>;
  importRows(input: { organizationId: string; legalEntityId: string; rows: TdsCertificateImportRow[]; actorId: string; correlationId: string }): Promise<{ created: number }>;
}
