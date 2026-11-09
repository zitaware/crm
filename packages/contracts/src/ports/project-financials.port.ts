/** Server-computed project financial rollup (ADR-089). Every field is a
 * Decimal string — never calculated client-side (CLAUDE.md). Deliberately
 * excluded Profit/Margin until manpower cost was modelled (ADR-086); profit
 * is now stated on the GST-exclusive basis (ADR-166).
 *
 * Basis note: `contractValueExclGst` is a taxable-value figure (docs/06
 * "Finalize client invoice": revenue posts at Taxable value, GST posts
 * separately) — a different basis than `netBilled`/`grossInvoiceValue`
 * (GST-inclusive). They are not directly comparable totals.
 *
 * `invoiceOutstanding`/`clientReceivable` are never clamped to zero — a
 * negative value is a genuine credit balance (over-settlement), returned
 * as-is for the frontend to render with its own "Credit Balance" tone. */
export interface ProjectFinancialSummary {
  projectId: string;

  /** Taxable-value contract amount (`Project.value`) — GST-exclusive, see
   * basis note above. `null` when the project has no value entered. */
  contractValueExclGst: string | null;

  // Billing
  grossInvoiceValue: string;
  debitNoteAdjustments: string;
  creditNoteAdjustments: string;
  /** grossInvoiceValue + debitNoteAdjustments - creditNoteAdjustments */
  netBilled: string;

  // Collections and deductions (all from receipts with status != REVERSED,
  // against FINALIZED invoices only)
  cashReceived: string;
  tdsDeducted: string;
  /** CGST_TDS + SGST_TDS + IGST_TDS combined */
  gstTdsDeducted: string;
  retentionHeld: string;
  otherHoldAmount: string;
  /** ACCEPTED_PENALTY + DISPUTED_PENALTY combined */
  penaltyOrWriteOff: string;
  otherDeductions: string;
  /** cashReceived + every deduction bucket above — equals the sum of
   * ReceiptAllocation.settledAmount for this project's invoices. */
  totalSettled: string;

  // Receivable
  /** netBilled - totalSettled. Unclamped — see basis note above. */
  invoiceOutstanding: string;
  /** Sum of (AllocationDeduction.amount - releasedAmount) for HOLD/RETENTION
   * deductions only. TDS/GST-TDS and penalties are excluded — they're
   * tax-recoverable or already-settled, not owed by the client. */
  unreleasedRetentionAndHold: string;
  /** invoiceOutstanding + unreleasedRetentionAndHold. Unclamped. */
  clientReceivable: string;

  // Recognized expense — excludes recoverable Input GST, unlike the
  // Expense/"Spend" ledger tab's gross per-transaction totals (ADR-089).
  purchaseExpense: string;
  employeeClaimExpense: string;
  directExpense: string;
  /** Stock issued to this project, at weighted-average cost. Already net of
   * recoverable ITC — the Inventory debit it derives from carried taxable
   * value plus ineligible tax only. */
  materialExpense: string;
  /** Imported gross salary x allocation percentage, SUBMITTED months only.
   * Derived, never posted: allocation writes no journal (docs/06). */
  manpowerExpense: string;
  /** Accrued introducer commission. No GST treatment is modelled (ADR-096). */
  introducerExpense: string;
  /** purchaseExpense + employeeClaimExpense + directExpense + materialExpense
   * + manpowerExpense + introducerExpense */
  recognizedProjectExpense: string;

  // The project-page view (ADR-166), all on the GST-exclusive basis of the
  // contract value so they compare with it.
  /** Taxable value of FINALIZED invoices, plus debit notes, less credit notes. */
  billedExclGst: string;
  /** billedExclGst as a share of the contract value, one decimal; null without a contract value. */
  billedPercent: string | null;
  /** billedExclGst − contract value when billing has gone past the contract; null otherwise or without a contract value. */
  billedOverContract: string | null;
  /** The parts of directExpense posted by server and subscription cycle payments, and the rest. */
  serverExpense: string;
  subscriptionExpense: string;
  otherDirectExpense: string;
  /** billedExclGst − recognizedProjectExpense: accrual profit, GST out of both sides. */
  profit: string;
  /** profit as a share of billedExclGst, one decimal; null before anything is billed. */
  profitMarginPercent: string | null;
  /** EMD and SD still lodged (not returned), on the project or on the tender it came from. */
  emdLodged: string;
  sdLodged: string;
}

/** Client-wide rollup (ADR-090) — sums `ProjectFinancialSummary` across
 * every project of this client the calling actor can see. Same fields as
 * `ProjectFinancialSummary` (unclamped sums included — a client-level
 * credit balance is just as real as a project-level one), minus
 * `projectId`, plus:
 * - `clientId` in its place.
 * - `projectCount`, distinguishing "genuinely zero activity" from "zero
 *   because this actor can't see any of this client's projects" (a scoped
 *   PM with no assignment here still gets a valid, all-zero summary, not
 *   an error — the client itself is accessible, only its financial data
 *   happens to be invisible to this actor).
 * - `totalContractValueExclGst` is never null (defaults to "0.00"), unlike
 *   the single-project field it sums — there's no "not entered" case to
 *   preserve once you're summing across a set. */
export interface ClientFinancialSummary {
  clientId: string;
  projectCount: number;
  totalContractValueExclGst: string;
  grossInvoiceValue: string;
  debitNoteAdjustments: string;
  creditNoteAdjustments: string;
  netBilled: string;
  cashReceived: string;
  tdsDeducted: string;
  gstTdsDeducted: string;
  retentionHeld: string;
  otherHoldAmount: string;
  penaltyOrWriteOff: string;
  otherDeductions: string;
  totalSettled: string;
  invoiceOutstanding: string;
  unreleasedRetentionAndHold: string;
  clientReceivable: string;
  purchaseExpense: string;
  employeeClaimExpense: string;
  directExpense: string;
  materialExpense: string;
  manpowerExpense: string;
  introducerExpense: string;
  recognizedProjectExpense: string;
}

export interface ProjectFinancialsPort {
  /** Reuses ProjectsService.getDetail's own project-access scope check
   * first (NOT_FOUND for a PM not assigned to this project, same as every
   * other project-scoped read). */
  getFinancialSummary(input: {
    organizationId: string;
    projectId: string;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<ProjectFinancialSummary>;

  /** `projectIds` is the caller's currently-visible batch (e.g. one page of
   * the Projects list) — never trusted directly. The service independently
   * re-derives the actor's full permitted project set and intersects it
   * with `projectIds`, silently dropping any id the actor isn't authorized
   * for, closing the "arbitrary project id via project.read_financials"
   * risk. Returns one row per authorized project actually found. */
  listFinancialSummaries(input: {
    organizationId: string;
    actorId: string;
    canSeeAll: boolean;
    projectIds: string[];
  }): Promise<ProjectFinancialSummary[]>;

  /** Reuses ClientsService.getDetail's own org-scoped existence check first
   * (NOT_FOUND for a cross-org/nonexistent client — client.read has no
   * further per-actor scoping in this codebase). Then reuses
   * ProjectsService.list's own existing scope, exactly like
   * listFinancialSummaries, to find only this client's projects the actor
   * can actually see — never a separate org-wide query. */
  getClientFinancialSummary(input: {
    organizationId: string;
    clientId: string;
    actorId: string;
    canSeeAll: boolean;
  }): Promise<ClientFinancialSummary>;
}
