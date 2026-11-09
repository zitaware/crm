import type { AgingBucket, ClientFinancialSummary, ProjectFinancialSummary } from '@zitaware/contracts';

/**
 * The money-flow scenario's inputs (names) and its hand-computed results.
 *
 * Every figure below was worked out by hand from docs/06 and the documents
 * `build.ts` creates — never by running the code and copying what came out.
 * That is the whole point: the integration spec compares the application's
 * output against an independent calculation, so a formula that is wrong in
 * the code cannot also be wrong in the expectation. The arithmetic sits
 * beside each figure so a reviewer can re-derive it without the code.
 *
 * GST is 18% throughout. Gujarat (the seller's GST state) → CGST 9% + SGST
 * 9%; Maharashtra and Rajasthan → IGST 18%.
 */

export type ClientKey = 'C1' | 'C2' | 'C3';
export type ProjectKey = 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
export type EmployeeKey = 'E1' | 'E2' | 'E3' | 'E4';

export const CLIENT_KEYS: ClientKey[] = ['C1', 'C2', 'C3'];
export const PROJECT_KEYS: ProjectKey[] = ['P1', 'P2', 'P3', 'P4', 'P5'];

export const CLIENTS: Record<ClientKey, { name: string; stateCode: string }> = {
  C1: { name: 'Gujarat Informatics Ltd', stateCode: 'GJ' },
  C2: { name: 'Maharashtra IT Department', stateCode: 'MH' },
  C3: { name: 'Rajasthan Smart City Ltd', stateCode: 'RJ' },
};

export const PROJECTS: Record<ProjectKey, { name: string; client: ClientKey; value: string; budget: string | undefined }> = {
  P1: { name: 'GIL e-Governance Portal', client: 'C1', value: '2000000', budget: '800000' },
  P2: { name: 'GIL Data Centre AMC', client: 'C1', value: '1200000', budget: '300000' },
  // CAPEX build 15,00,000 + OPEX O&M 5,00,000 — the project carrying both.
  P3: { name: 'MahaIT Citizen Services App', client: 'C2', value: '2000000', budget: '900000' },
  P4: { name: 'RSCL Smart Parking', client: 'C3', value: '800000', budget: '80000' },
  P5: { name: 'RSCL Command Centre', client: 'C3', value: '500000', budget: undefined },
};

export const EMPLOYEES: Record<EmployeeKey, { code: string; name: string }> = {
  E1: { code: 'MF-001', name: 'Asha Patel' },
  E2: { code: 'MF-002', name: 'Ravi Shah' },
  E3: { code: 'MF-003', name: 'Neha Desai' },
  E4: { code: 'MF-004', name: 'Karan Mehta' },
};

/** The project-page figures of ADR-166 are checked by their identities in the spec, not as fixed values here. */
export type ProjectPageFigureKey = 'billedExclGst' | 'billedPercent' | 'billedOverContract' | 'serverExpense' | 'subscriptionExpense' | 'otherDirectExpense' | 'profit' | 'profitMarginPercent' | 'emdLodged' | 'sdLodged';
type ProjectFigures = Omit<ProjectFinancialSummary, 'projectId' | ProjectPageFigureKey>;
type ClientFigures = Omit<ClientFinancialSummary, 'clientId'>;

/**
 * Per-project Financials tab.
 *
 * Invoices (FINALIZED only):
 *   INV1 P1 taxable 5,00,000.00        CGST 45,000.00  SGST 45,000.00   total 5,90,000.00
 *   INV2 P1 taxable 1,23,456.78        tax 22,222.2204 → CGST 11,111.11, SGST 22,222.2204−11,111.11 = 11,111.11
 *                                      total 1,45,679.00
 *   INV3 P2 OPEX installment 1 1,00,000  CGST 9,000 SGST 9,000   total 1,18,000.00
 *   INV4 P2 OPEX installment 2 1,00,000  CGST 9,000 SGST 9,000   total 1,18,000.00
 *   INV5 P3 taxable 6,00,000.00        IGST 1,08,000.00             total 7,08,000.00
 *   INV6 P3 taxable 4,00,000.00        IGST 72,000.00               total 4,72,000.00
 *   INV7 P4 taxable 2,00,000.00        IGST 36,000.00               total 2,36,000.00
 *   INV8 P4 taxable 6,00,000.00        finalized then VOIDED — excluded everywhere
 *   INV9  P3 OPEX O&M installment 1 13,888.88   IGST 2,499.9984 → 2,500.00   total 16,388.88
 *   INV10 P3 OPEX O&M installment 2 13,888.88   IGST 2,500.00                total 16,388.88
 *         (P3 carries CAPEX and OPEX together; its O&M installment is 5,00,000 ÷ 36 rounded down)
 *   DN1 on INV2 taxable 10,000 → CGST 900 SGST 900 → 11,800.00
 *   CN1 on INV5 taxable 50,000 → IGST 9,000 → 59,000.00
 *
 * Receipts (settled = cash + deductions):
 *   R1 C1 cash 6,31,500 → INV1 cash 5,17,500 + TDS 10,000 + CGST-TDS 5,000 + SGST-TDS 5,000
 *                                  + retention 25,000 + hold 20,000 + accepted penalty 7,500 = 5,90,000
 *                         INV3 cash 1,14,000 + TDS 2,000 + CGST-TDS 1,000 + SGST-TDS 1,000 = 1,18,000
 *   R2 C1 cash 1,00,000 → INV2 cash 1,00,000 + TDS 2,469.14 = 1,02,469.14
 *   R3 C1 cash 1,38,000 → INV4 cash 1,18,000 = 1,18,000; INV2 cash 20,000 + disputed penalty 3,000 = 23,000
 *   R4 C2 cash 5,00,000 → INV5 cash 5,00,000 + TDS 12,000 + IGST-TDS 12,000 = 5,24,000
 *   R5 C2 cash 2,00,000 → INV6 — REVERSED (cheque dishonoured), excluded
 *   R6 C3 cash 1,50,000 → INV7 cash 1,50,000 + TDS 4,000 + IGST-TDS 4,000 + other 1,000 = 1,59,000
 *   R7 C2 cash 3,15,833.32 → one receipt across a CAPEX and an OPEX invoice:
 *                         INV9 (OPEX) cash 15,833.32 + TDS 277.78 + IGST-TDS 277.78 = 16,388.88 (full)
 *                         INV6 (CAPEX) cash 3,00,000 + TDS 8,000 + IGST-TDS 8,000 = 3,16,000 (part)
 *                         (2% of 13,888.88 = 277.7776 → 277.78)
 *   Releases: hold 20,000 released 12,000 + 8,000 (fully); retention 25,000 released 10,000.
 *
 * Recognized expense (net of recoverable GST):
 *   VB1 P1: expense line 40,000 (+7,200 eligible GST) and a STOCK line 50,000 (+9,000 eligible GST).
 *           docs/06: a stock line debits Inventory, an asset. It becomes project cost only when
 *           consumed (MATERIAL). So P1 purchase expense is the expense line alone: 40,000.
 *   VB2 P3: 60,000 + 10,800 IGST, ITC ineligible → 70,800 stays in cost.
 *   VB3 P4: SUBMITTED, never finalized → excluded.
 *   Claims: CL1 P3 11,800 − 1,800 GST credit = 10,000; CL2 P1 2,450; CL3 P1 draft → excluded.
 *   Direct: DE1 P4 10,000 + 1,800 eligible IGST → 10,000; DE2 P1 7,500 + 1,350 ineligible → 8,850;
 *           DE3 office rent has no project → excluded; DE4 draft → excluded.
 *   Material (weighted average): 20 boxes @2,500 (VB1) + 10 @2,800 (direct) = 30 @2,600;
 *           P1 issue 12 × 2,600 = 31,200; P4 issue 5 × 2,600 = 13,000.
 *   Manpower: see MANPOWER below — P1 2,00,016.66, P2 63,000, P3 1,56,522.23, P4 59,016.66.
 *   Introducer: P1 accruals 20,000 + 15,000 = 35,000.
 */
export const PROJECT_FIGURES: Record<ProjectKey, ProjectFigures> = {
  P1: {
    contractValueExclGst: '2000000.00',
    grossInvoiceValue: '735679.00', // 5,90,000 + 1,45,679
    debitNoteAdjustments: '11800.00',
    creditNoteAdjustments: '0.00',
    netBilled: '747479.00', // 7,35,679 + 11,800
    cashReceived: '637500.00', // 5,17,500 + 1,00,000 + 20,000
    tdsDeducted: '12469.14', // 10,000 + 2,469.14
    gstTdsDeducted: '10000.00', // 5,000 + 5,000
    retentionHeld: '25000.00',
    otherHoldAmount: '20000.00',
    penaltyOrWriteOff: '10500.00', // 7,500 accepted + 3,000 disputed
    otherDeductions: '0.00',
    totalSettled: '715469.14', // 5,90,000 + 1,02,469.14 + 23,000
    invoiceOutstanding: '32009.86', // 7,47,479 − 7,15,469.14
    unreleasedRetentionAndHold: '15000.00', // hold 0 + retention 25,000 − 10,000
    clientReceivable: '47009.86', // 32,009.86 + 15,000
    purchaseExpense: '40000.00', // VB1 expense line only — the stock line is inventory
    employeeClaimExpense: '2450.00',
    directExpense: '8850.00',
    materialExpense: '31200.00',
    manpowerExpense: '200016.66',
    introducerExpense: '35000.00',
    recognizedProjectExpense: '317516.66', // 40,000 + 2,450 + 8,850 + 31,200 + 2,00,016.66 + 35,000
  },
  P2: {
    contractValueExclGst: '1200000.00',
    grossInvoiceValue: '236000.00', // 1,18,000 × 2
    debitNoteAdjustments: '0.00',
    creditNoteAdjustments: '0.00',
    netBilled: '236000.00',
    cashReceived: '232000.00', // 1,14,000 + 1,18,000
    tdsDeducted: '2000.00',
    gstTdsDeducted: '2000.00',
    retentionHeld: '0.00',
    otherHoldAmount: '0.00',
    penaltyOrWriteOff: '0.00',
    otherDeductions: '0.00',
    totalSettled: '236000.00',
    invoiceOutstanding: '0.00',
    unreleasedRetentionAndHold: '0.00',
    clientReceivable: '0.00',
    purchaseExpense: '0.00',
    employeeClaimExpense: '0.00',
    directExpense: '0.00',
    materialExpense: '0.00',
    manpowerExpense: '63000.00', // Jul 22,500 + Aug 40,500
    introducerExpense: '0.00',
    recognizedProjectExpense: '63000.00',
  },
  P3: {
    contractValueExclGst: '2000000.00',
    grossInvoiceValue: '1212777.76', // CAPEX 7,08,000 + 4,72,000 + OPEX 16,388.88 × 2
    debitNoteAdjustments: '0.00',
    creditNoteAdjustments: '59000.00',
    netBilled: '1153777.76', // 12,12,777.76 − 59,000
    cashReceived: '815833.32', // R4 5,00,000 + R7 3,15,833.32; R5 reversed → excluded
    tdsDeducted: '20277.78', // 12,000 + 277.78 + 8,000
    gstTdsDeducted: '20277.78', // IGST-TDS, same three amounts
    retentionHeld: '0.00',
    otherHoldAmount: '0.00',
    penaltyOrWriteOff: '0.00',
    otherDeductions: '0.00',
    totalSettled: '856388.88', // 5,24,000 + 16,388.88 + 3,16,000
    // 11,53,777.76 − 8,56,388.88. Per invoice: INV5 1,84,000 less CN 59,000
    //   + INV6 1,56,000 + INV9 0 + INV10 16,388.88
    invoiceOutstanding: '297388.88',
    unreleasedRetentionAndHold: '0.00',
    clientReceivable: '297388.88',
    purchaseExpense: '70800.00',
    employeeClaimExpense: '10000.00',
    directExpense: '0.00',
    materialExpense: '0.00',
    manpowerExpense: '156522.23', // Jul 1,14,522.23 + Aug 42,000
    introducerExpense: '0.00',
    recognizedProjectExpense: '237322.23', // 70,800 + 10,000 + 1,56,522.23
  },
  P4: {
    contractValueExclGst: '800000.00',
    grossInvoiceValue: '236000.00', // INV8 void → excluded
    debitNoteAdjustments: '0.00',
    creditNoteAdjustments: '0.00',
    netBilled: '236000.00',
    cashReceived: '150000.00',
    tdsDeducted: '4000.00',
    gstTdsDeducted: '4000.00',
    retentionHeld: '0.00',
    otherHoldAmount: '0.00',
    penaltyOrWriteOff: '0.00',
    otherDeductions: '1000.00',
    totalSettled: '159000.00',
    invoiceOutstanding: '77000.00', // 2,36,000 − 1,59,000
    unreleasedRetentionAndHold: '0.00',
    clientReceivable: '77000.00',
    purchaseExpense: '0.00', // VB3 never finalized
    employeeClaimExpense: '0.00',
    directExpense: '10000.00',
    materialExpense: '13000.00',
    manpowerExpense: '59016.66', // Jul 18,516.66 + Aug 40,500
    introducerExpense: '0.00',
    recognizedProjectExpense: '82016.66', // 10,000 + 13,000 + 59,016.66
  },
  P5: {
    contractValueExclGst: '500000.00',
    grossInvoiceValue: '0.00',
    debitNoteAdjustments: '0.00',
    creditNoteAdjustments: '0.00',
    netBilled: '0.00',
    cashReceived: '0.00',
    tdsDeducted: '0.00',
    gstTdsDeducted: '0.00',
    retentionHeld: '0.00',
    otherHoldAmount: '0.00',
    penaltyOrWriteOff: '0.00',
    otherDeductions: '0.00',
    totalSettled: '0.00',
    invoiceOutstanding: '0.00',
    unreleasedRetentionAndHold: '0.00',
    clientReceivable: '0.00',
    purchaseExpense: '0.00',
    employeeClaimExpense: '0.00',
    directExpense: '0.00',
    materialExpense: '0.00',
    manpowerExpense: '0.00',
    introducerExpense: '0.00',
    recognizedProjectExpense: '0.00',
  },
};

/** Client Financials — each client's projects summed field by field. */
export const CLIENT_FIGURES: Record<ClientKey, ClientFigures> = {
  C1: {
    projectCount: 2,
    totalContractValueExclGst: '3200000.00', // 20,00,000 + 12,00,000
    grossInvoiceValue: '971679.00',
    debitNoteAdjustments: '11800.00',
    creditNoteAdjustments: '0.00',
    netBilled: '983479.00',
    cashReceived: '869500.00',
    tdsDeducted: '14469.14',
    gstTdsDeducted: '12000.00',
    retentionHeld: '25000.00',
    otherHoldAmount: '20000.00',
    penaltyOrWriteOff: '10500.00',
    otherDeductions: '0.00',
    totalSettled: '951469.14',
    invoiceOutstanding: '32009.86',
    unreleasedRetentionAndHold: '15000.00',
    clientReceivable: '47009.86',
    purchaseExpense: '40000.00',
    employeeClaimExpense: '2450.00',
    directExpense: '8850.00',
    materialExpense: '31200.00',
    manpowerExpense: '263016.66',
    introducerExpense: '35000.00',
    recognizedProjectExpense: '380516.66',
  },
  C2: {
    projectCount: 1,
    totalContractValueExclGst: '2000000.00',
    grossInvoiceValue: '1212777.76',
    debitNoteAdjustments: '0.00',
    creditNoteAdjustments: '59000.00',
    netBilled: '1153777.76',
    cashReceived: '815833.32',
    tdsDeducted: '20277.78',
    gstTdsDeducted: '20277.78',
    retentionHeld: '0.00',
    otherHoldAmount: '0.00',
    penaltyOrWriteOff: '0.00',
    otherDeductions: '0.00',
    totalSettled: '856388.88',
    invoiceOutstanding: '297388.88',
    unreleasedRetentionAndHold: '0.00',
    clientReceivable: '297388.88',
    purchaseExpense: '70800.00',
    employeeClaimExpense: '10000.00',
    directExpense: '0.00',
    materialExpense: '0.00',
    manpowerExpense: '156522.23',
    introducerExpense: '0.00',
    recognizedProjectExpense: '237322.23',
  },
  C3: {
    projectCount: 2,
    totalContractValueExclGst: '1300000.00', // 8,00,000 + 5,00,000
    grossInvoiceValue: '236000.00',
    debitNoteAdjustments: '0.00',
    creditNoteAdjustments: '0.00',
    netBilled: '236000.00',
    cashReceived: '150000.00',
    tdsDeducted: '4000.00',
    gstTdsDeducted: '4000.00',
    retentionHeld: '0.00',
    otherHoldAmount: '0.00',
    penaltyOrWriteOff: '0.00',
    otherDeductions: '1000.00',
    totalSettled: '159000.00',
    invoiceOutstanding: '77000.00',
    unreleasedRetentionAndHold: '0.00',
    clientReceivable: '77000.00',
    purchaseExpense: '0.00',
    employeeClaimExpense: '0.00',
    directExpense: '10000.00',
    materialExpense: '13000.00',
    manpowerExpense: '59016.66',
    introducerExpense: '0.00',
    recognizedProjectExpense: '82016.66',
  },
};

/**
 * Project Spend tab — a DOCUMENT-basis list: a vendor bill contributes its
 * expense lines' totals, a claim its full amount and a direct expense its
 * full paid amount (GST included), unlike the Financials tab above, which is
 * net of recoverable GST. A bill's stock lines are left out — they arrive
 * as MATERIAL when issued (ADR-103).
 *   P1 PURCHASE: VB1 expense line 40,000 + 7,200 GST = 47,200 (the 59,000 stock line is not here)
 */
export const SPEND_FIGURES: Record<ProjectKey, { PURCHASE: string; REIMBURSEMENT: string; DIRECT_EXPENSE: string; MATERIAL: string; MANPOWER: string; INTRODUCER: string; total: string }> = {
  P1: { PURCHASE: '47200.00', REIMBURSEMENT: '2450.00', DIRECT_EXPENSE: '8850.00', MATERIAL: '31200.00', MANPOWER: '200016.66', INTRODUCER: '35000.00', total: '324716.66' },
  P2: { PURCHASE: '0.00', REIMBURSEMENT: '0.00', DIRECT_EXPENSE: '0.00', MATERIAL: '0.00', MANPOWER: '63000.00', INTRODUCER: '0.00', total: '63000.00' },
  P3: { PURCHASE: '70800.00', REIMBURSEMENT: '11800.00', DIRECT_EXPENSE: '0.00', MATERIAL: '0.00', MANPOWER: '156522.23', INTRODUCER: '0.00', total: '239122.23' },
  P4: { PURCHASE: '0.00', REIMBURSEMENT: '0.00', DIRECT_EXPENSE: '11800.00', MATERIAL: '13000.00', MANPOWER: '59016.66', INTRODUCER: '0.00', total: '83816.66' },
  P5: { PURCHASE: '0.00', REIMBURSEMENT: '0.00', DIRECT_EXPENSE: '0.00', MATERIAL: '0.00', MANPOWER: '0.00', INTRODUCER: '0.00', total: '0.00' },
};

/** Invoice and note totals as stored on the document. */
export const DOCUMENT_TOTALS = {
  INV1: { project: 'P1', taxable: '500000.00', cgst: '45000.00', sgst: '45000.00', igst: '0.00', total: '590000.00', status: 'FINALIZED' },
  INV2: { project: 'P1', taxable: '123456.78', cgst: '11111.11', sgst: '11111.11', igst: '0.00', total: '145679.00', status: 'FINALIZED' },
  INV3: { project: 'P2', taxable: '100000.00', cgst: '9000.00', sgst: '9000.00', igst: '0.00', total: '118000.00', status: 'FINALIZED' },
  INV4: { project: 'P2', taxable: '100000.00', cgst: '9000.00', sgst: '9000.00', igst: '0.00', total: '118000.00', status: 'FINALIZED' },
  INV5: { project: 'P3', taxable: '600000.00', cgst: '0.00', sgst: '0.00', igst: '108000.00', total: '708000.00', status: 'FINALIZED' },
  INV6: { project: 'P3', taxable: '400000.00', cgst: '0.00', sgst: '0.00', igst: '72000.00', total: '472000.00', status: 'FINALIZED' },
  INV7: { project: 'P4', taxable: '200000.00', cgst: '0.00', sgst: '0.00', igst: '36000.00', total: '236000.00', status: 'FINALIZED' },
  INV8: { project: 'P4', taxable: '600000.00', cgst: '0.00', sgst: '0.00', igst: '108000.00', total: '708000.00', status: 'VOID' },
  INV9: { project: 'P3', taxable: '13888.88', cgst: '0.00', sgst: '0.00', igst: '2500.00', total: '16388.88', status: 'FINALIZED' },
  INV10: { project: 'P3', taxable: '13888.88', cgst: '0.00', sgst: '0.00', igst: '2500.00', total: '16388.88', status: 'FINALIZED' },
} as const;
export type InvoiceKey = keyof typeof DOCUMENT_TOTALS;

export const NOTE_TOTALS = {
  DN1: { invoice: 'INV2', type: 'DEBIT', taxable: '10000.00', cgst: '900.00', sgst: '900.00', igst: '0.00', total: '11800.00' },
  CN1: { invoice: 'INV5', type: 'CREDIT', taxable: '50000.00', cgst: '0.00', sgst: '0.00', igst: '9000.00', total: '59000.00' },
} as const;

/**
 * Salary. Revisions: E1 90,000; E2 75,000 then 81,000 from 1 Aug; E3 60,000;
 * E4 55,555.55 — an odd figure chosen so a three-way split leaves a paisa.
 *   July gross  90,000 + 75,000 + 60,000 + 55,555.55 = 2,80,555.55
 *   August gross 90,000 + 81,000 + 60,000 + 55,555.55 = 2,86,555.55
 *   July paid with TDS 9,000 + 5,000 + 3,000 + 0 = 17,000 → net 2,63,555.55
 */
export const SALARY = {
  july: { employeeCount: 4, totalGrossAmount: '280555.55' },
  august: { employeeCount: 4, totalGrossAmount: '286555.55' },
  julyPayment: { grossAmount: '280555.55', tdsAmount: '17000.00', netAmount: '263555.55' },
} as const;

/**
 * Monthly allocation → Manpower cost report (1 Jul – 1 Aug), SUBMITTED only.
 *   July:  E1 90,000   → P1 60% 54,000.00 · P3 40% 36,000.00
 *          E2 75,000   → P1 50% 37,500.00 · P2 30% 22,500.00 · bench 20% 15,000.00
 *          E3 60,000   → P3 100% 60,000.00
 *          E4 55,555.55 → P1 33.33% 18,516.66 · P4 33.33% 18,516.66 · P3 33.34% 18,522.22
 *                         = 55,555.54, one paisa short → it lands on the largest share
 *                         (P3 33.34%): 18,522.23
 *   August: E1 → P1 100% 90,000 · E2 81,000 → P2 50% 40,500 · P4 50% 40,500
 *           E3 → P3 70% 42,000 · bench 30% 18,000 · E4 left in DRAFT → excluded
 *   Check: July projects 2,65,555.55 = gross 2,80,555.55 − bench 15,000.
 *          August projects 2,13,000 = gross 2,86,555.55 − bench 18,000 − E4 draft 55,555.55.
 */
export const MANPOWER = {
  rows: [
    { project: 'P1', month: '2026-07-01', employeeCount: 3, totalPercentage: '143.3300', amount: '110016.66' },
    { project: 'P2', month: '2026-07-01', employeeCount: 1, totalPercentage: '30.0000', amount: '22500.00' },
    { project: 'P3', month: '2026-07-01', employeeCount: 3, totalPercentage: '173.3400', amount: '114522.23' },
    { project: 'P4', month: '2026-07-01', employeeCount: 1, totalPercentage: '33.3300', amount: '18516.66' },
    { project: 'P1', month: '2026-08-01', employeeCount: 1, totalPercentage: '100.0000', amount: '90000.00' },
    { project: 'P2', month: '2026-08-01', employeeCount: 1, totalPercentage: '50.0000', amount: '40500.00' },
    { project: 'P3', month: '2026-08-01', employeeCount: 1, totalPercentage: '70.0000', amount: '42000.00' },
    { project: 'P4', month: '2026-08-01', employeeCount: 1, totalPercentage: '50.0000', amount: '40500.00' },
  ] as Array<{ project: ProjectKey; month: string; employeeCount: number; totalPercentage: string; amount: string }>,
  totalManpowerCostAmount: '478555.55',
  excludedDraftEmployeeMonths: 1,
  /** E4's July split, the rounding case. */
  e4July: [
    { project: 'P1', percentage: '33.3300', allocatedAmount: '18516.66', carriesRoundingRemainder: false },
    { project: 'P4', percentage: '33.3300', allocatedAmount: '18516.66', carriesRoundingRemainder: false },
    { project: 'P3', percentage: '33.3400', allocatedAmount: '18522.23', carriesRoundingRemainder: true },
  ] as Array<{ project: ProjectKey; percentage: string; allocatedAmount: string; carriesRoundingRemainder: boolean }>,
};

/**
 * Stock of the one inventory item: 30 − 12 − 5 = 13 boxes worth 33,800 after
 * both issues, then VB4 (P2, all stock) adds 4 @ 2,500 = 10,000 →
 * 17 boxes, 43,800, rate 43,800 ÷ 17 = 2,576.470588… → 2,576.4706.
 */
export const STOCK = { quantity: '17.0000', valueAmount: '43800.00', weightedAverageRate: '2576.4706' };

/** PURCHASE rows on each project's Spend tab: P2's all-stock bill must produce none. */
export const PURCHASE_ROW_COUNTS: Record<ProjectKey, number> = { P1: 1, P2: 0, P3: 1, P4: 0, P5: 0 };

/**
 * Ledger balances, debit positive and credit negative, across every journal
 * line in the organization (a reversal's original and its opposite both
 * count, so a voided invoice or reversed receipt nets to zero).
 *
 * Accounts absent here must be zero. The balances sum to zero — debits
 * 27,99,662.31 = credits 27,99,662.31 — which is the trial balance.
 */
export const LEDGER_BALANCES: Record<string, string> = {
  // AR: invoices 24,20,456.76 + DN 11,800 − CN 59,000 − receipts settled 19,66,858.02
  //   = the projects' invoice outstanding 32,009.86 + 2,97,388.88 + 77,000
  ACCOUNTS_RECEIVABLE: '406398.74',
  // Taxable CAPEX 18,23,456.78 + OPEX 2,27,777.76 (P2 1,00,000 × 2, P3 13,888.88 × 2) = 20,51,234.54
  //   + DN 10,000 − CN 50,000
  SOFTWARE_PROJECT_REVENUE: '-2011234.54',
  OUTPUT_CGST_PAYABLE: '-75011.11', // 45,000 + 11,111.11 + 9,000 + 9,000 + 900
  OUTPUT_SGST_PAYABLE: '-75011.11',
  OUTPUT_IGST_PAYABLE: '-212000.00', // 1,08,000 + 72,000 + 36,000 + 2,500 + 2,500 − 9,000
  TDS_RECEIVABLE: '38746.92', // 10,000 + 2,000 + 2,469.14 + 12,000 + 4,000 + 277.78 + 8,000
  GST_TDS_RECEIVABLE_CGST: '6000.00',
  GST_TDS_RECEIVABLE_SGST: '6000.00',
  GST_TDS_RECEIVABLE_IGST: '24277.78', // 12,000 + 4,000 + 277.78 + 8,000
  HOLD_RECEIVABLE: '0.00', // 20,000 − 12,000 − 8,000
  RETENTION_RECEIVABLE: '15000.00', // 25,000 − 10,000
  PENALTY_REVENUE_DEDUCTION: '7500.00',
  DISPUTED_DEDUCTION_RECEIVABLE: '3000.00',
  BANK_CHARGES: '1000.00',
  INVENTORY: '43800.00', // 50,000 + 28,000 − 31,200 − 13,000 + VB4 10,000
  PROJECT_MATERIAL_COST: '44200.00',
  HARDWARE_EXPENSE: '120800.00', // VB1 40,000 + VB2 70,800 + DE1 10,000
  OFFICE_EXPENSE: '28850.00', // DE2 8,850 + DE3 20,000
  TRAVEL_EXPENSE: '12450.00', // CL1 10,000 + CL2 2,450
  INPUT_CGST_RECEIVABLE: '9000.00', // VB1 3,600 + 4,500 + VB4 900
  INPUT_SGST_RECEIVABLE: '9000.00',
  INPUT_IGST_RECEIVABLE: '1800.00', // DE1
  INPUT_GST_RECEIVABLE_EXPENSE: '1800.00', // CL1
  ACCOUNTS_PAYABLE_VENDOR: '-110600.00', // VB1 1,06,200 + VB2 70,800 + direct stock 28,000 + VB4 11,800 − paid 1,06,200
  TDS_PAYABLE: '-8000.00', // withheld: vendor 1,800 + salary 17,000 + introducer 3,000; deposited 1,800 + 12,000 (the 5,000 challan was reversed)
  SALARIES_WAGES_EXPENSE: '567111.10', // 2,80,555.55 + 2,86,555.55
  SALARY_PAYABLE: '-286555.55', // August still unpaid
  INTRODUCER_COMMISSION_EXPENSE: '35000.00',
  INTRODUCER_PAYABLE: '-5000.00', // 35,000 accrued − 30,000 paid
  EMPLOYEE_ADVANCE_RECEIVABLE: '-2450.00', // CL2 approved, not yet reimbursed
  // Receipts cash 18,35,333.32 + releases 30,000 − vendor 1,04,400 − direct 40,650
  //   − claim 11,800 − salary net 2,63,555.55 − introducer net 27,000 − TDS deposited 13,800
  BANK_HDFC_CURRENT: '1404127.77',
};

/**
 * Milestones screen — CAPEX pools and OPEX schedules. P3 carries both.
 * An OPEX installment is the pool ÷ count rounded DOWN to the paisa, with
 * the whole remainder on the last one; invoice dates step a month from the
 * first invoice date, clamped to the month's last day.
 *   P2 12,00,000 ÷ 12 = 1,00,000 exactly.
 *   P3 5,00,000 ÷ 36 = 13,888.888… → 13,888.88 × 35 = 4,86,110.80; last = 13,889.20.
 *      Invoice dates from 31 Jul 2026: 31 Aug, 30 Sep (clamped) … the 36th is 30 Jun 2029.
 */
export const MILESTONE_POOLS: Record<ProjectKey, { capexTotalAmount: string; opexTotalAmount: string }> = {
  P1: { capexTotalAmount: '2000000.00', opexTotalAmount: '0.00' },
  P2: { capexTotalAmount: '0.00', opexTotalAmount: '1200000.00' },
  P3: { capexTotalAmount: '1500000.00', opexTotalAmount: '500000.00' },
  P4: { capexTotalAmount: '800000.00', opexTotalAmount: '0.00' },
  P5: { capexTotalAmount: '0.00', opexTotalAmount: '0.00' },
};

/**
 * Milestone billing status, derived from FINALIZED invoices (ADR-104). An
 * event is invoiced by its own invoice; INV8 was voided, so P4's
 * Installation is NOT invoiced. Each OPEX schedule has two of its
 * installments invoiced.
 */
export const BILLING: {
  capexEvents: Array<{ project: ProjectKey; event: string; billingStatus: 'NOT_INVOICED' | 'FULLY_INVOICED'; invoice: InvoiceKey | null }>;
  opex: Record<'P2' | 'P3', { billingStatus: 'PARTIALLY_INVOICED'; invoicedCount: number; billableCount: number; invoicedInstallments: Array<{ sequenceNumber: number; invoice: InvoiceKey }> }>;
} = {
  capexEvents: [
    { project: 'P1', event: 'Design sign-off', billingStatus: 'FULLY_INVOICED', invoice: 'INV1' },
    { project: 'P1', event: 'UAT', billingStatus: 'FULLY_INVOICED', invoice: 'INV2' },
    { project: 'P1', event: 'Go-live', billingStatus: 'NOT_INVOICED', invoice: null },
    { project: 'P3', event: 'Phase 1', billingStatus: 'FULLY_INVOICED', invoice: 'INV5' },
    { project: 'P3', event: 'Phase 2', billingStatus: 'FULLY_INVOICED', invoice: 'INV6' },
    { project: 'P3', event: 'Phase 3', billingStatus: 'NOT_INVOICED', invoice: null },
    { project: 'P4', event: 'Survey', billingStatus: 'FULLY_INVOICED', invoice: 'INV7' },
    { project: 'P4', event: 'Installation', billingStatus: 'NOT_INVOICED', invoice: null },
  ],
  opex: {
    P2: { billingStatus: 'PARTIALLY_INVOICED', invoicedCount: 2, billableCount: 12, invoicedInstallments: [{ sequenceNumber: 1, invoice: 'INV3' }, { sequenceNumber: 2, invoice: 'INV4' }] },
    P3: { billingStatus: 'PARTIALLY_INVOICED', invoicedCount: 2, billableCount: 36, invoicedInstallments: [{ sequenceNumber: 1, invoice: 'INV9' }, { sequenceNumber: 2, invoice: 'INV10' }] },
  },
};

/**
 * Phase 8.1 receivables reports as of 31 Aug 2026 (ADR-108).
 *
 * Both notes carry the day the scenario runs as their note date, so on
 * 31 Aug neither had happened yet. R5's reversal and INV8's void had.
 *   INV5  7,08,000 − R4 5,24,000                  = 1,84,000.00  due 15 Jul → 47 days → 31–60
 *   INV2  1,45,679 − (R2 1,02,469.14 + R3 23,000) =   20,209.86  due 28 Jul → 34 days → 31–60
 *   INV7  2,36,000 − R6 1,59,000                  =   77,000.00  due 14 Aug → 17 days → 0–30
 *   INV6  4,72,000 − R7 3,16,000                  = 1,56,000.00  due 24 Aug →  7 days → 0–30
 *   INV10 16,388.88, nothing received             =   16,388.88  due 30 Sep → −30    → not due
 *   INV1, INV3, INV4, INV9 settled in full, INV8 void → no row.
 *   Total 4,53,598.74 — the ledger's AR on 31 Aug: today's 4,06,398.74
 *   before DN1 (+11,800) and CN1 (−59,000).
 * Hold and retention (INV1, withheld by R1 on 10 Jul):
 *   retention 25,000 − 10,000 released = 15,000, 52 days held → 31–60
 *   hold 20,000 − 12,000 − 8,000 = 0 → no row.
 */
export const REPORT_AS_OF = '2026-08-31';

export const RECEIVABLE_AGING_AUG_31 = {
  invoices: [
    { invoice: 'INV5', invoiceDate: '2026-06-15', dueDate: '2026-07-15', totalAmount: '708000.00', settledAmount: '524000.00', noteAdjustmentAmount: '0.00', outstandingAmount: '184000.00', daysPastDue: 47, bucket: 'DAYS_31_60' },
    { invoice: 'INV2', invoiceDate: '2026-06-28', dueDate: '2026-07-28', totalAmount: '145679.00', settledAmount: '125469.14', noteAdjustmentAmount: '0.00', outstandingAmount: '20209.86', daysPastDue: 34, bucket: 'DAYS_31_60' },
    { invoice: 'INV7', invoiceDate: '2026-07-15', dueDate: '2026-08-14', totalAmount: '236000.00', settledAmount: '159000.00', noteAdjustmentAmount: '0.00', outstandingAmount: '77000.00', daysPastDue: 17, bucket: 'DAYS_0_30' },
    { invoice: 'INV6', invoiceDate: '2026-07-25', dueDate: '2026-08-24', totalAmount: '472000.00', settledAmount: '316000.00', noteAdjustmentAmount: '0.00', outstandingAmount: '156000.00', daysPastDue: 7, bucket: 'DAYS_0_30' },
    { invoice: 'INV10', invoiceDate: '2026-08-31', dueDate: '2026-09-30', totalAmount: '16388.88', settledAmount: '0.00', noteAdjustmentAmount: '0.00', outstandingAmount: '16388.88', daysPastDue: -30, bucket: 'NOT_DUE' },
  ] as Array<{ invoice: InvoiceKey; invoiceDate: string; dueDate: string; totalAmount: string; settledAmount: string; noteAdjustmentAmount: string; outstandingAmount: string; daysPastDue: number; bucket: AgingBucket }>,
  invoiceBuckets: [
    { bucket: 'NOT_DUE', amount: '16388.88', count: 1 },
    { bucket: 'DAYS_0_30', amount: '233000.00', count: 2 }, // 77,000 + 1,56,000
    { bucket: 'DAYS_31_60', amount: '204209.86', count: 2 }, // 1,84,000 + 20,209.86
    { bucket: 'DAYS_61_90', amount: '0.00', count: 0 },
    { bucket: 'DAYS_90_PLUS', amount: '0.00', count: 0 },
  ] as Array<{ bucket: AgingBucket; amount: string; count: number }>,
  invoiceTotal: '453598.74',
  held: [{ type: 'RETENTION', invoice: 'INV1', receiptDate: '2026-07-10', amount: '25000.00', releasedAmount: '10000.00', outstandingAmount: '15000.00', daysHeld: 52, bucket: 'DAYS_31_60' }] as Array<{
    type: 'HOLD' | 'RETENTION';
    invoice: InvoiceKey;
    receiptDate: string;
    amount: string;
    releasedAmount: string;
    outstandingAmount: string;
    daysHeld: number;
    bucket: AgingBucket;
  }>,
  heldTotal: '15000.00',
  /** Report total and ledger balance on 31 Aug — equal, so every line reconciles. */
  reconciliation: { INVOICE_OUTSTANDING: '453598.74', HOLD: '0.00', RETENTION: '15000.00' } as Record<string, string>,
};

/**
 * Outstanding Summary on 31 Aug — every receipt was dated by then, so each
 * deduction measure equals its ledger balance above.
 *   TDS 10,000 + 2,000 + 2,469.14 + 12,000 + 4,000 + 277.78 + 8,000 = 38,746.92 (7 items)
 *   CGST-TDS and SGST-TDS 5,000 + 1,000 each (2 items); IGST-TDS 12,000 + 4,000 + 277.78 + 8,000 (4 items)
 *   Hold released in full → 0 (no item); retention 15,000 (1); disputed penalty on INV2 3,000 (1).
 *   The accepted penalty (7,500) and "other" (1,000) settle the invoice for good and are not receivable.
 */
export const OUTSTANDING_SUMMARY_AUG_31: Array<{ key: string; amount: string; itemCount: number }> = [
  { key: 'INVOICE_OUTSTANDING', amount: '453598.74', itemCount: 5 },
  { key: 'TDS', amount: '38746.92', itemCount: 7 },
  { key: 'CGST_TDS', amount: '6000.00', itemCount: 2 },
  { key: 'SGST_TDS', amount: '6000.00', itemCount: 2 },
  { key: 'IGST_TDS', amount: '24277.78', itemCount: 4 },
  { key: 'HOLD', amount: '0.00', itemCount: 0 },
  { key: 'RETENTION', amount: '15000.00', itemCount: 1 },
  { key: 'DISPUTED_PENALTY', amount: '3000.00', itemCount: 1 },
];

/** P3 alone on 31 Aug: INV5 1,84,000 + INV6 1,56,000 + INV10 16,388.88. */
export const P3_AGING_AUG_31 = { invoices: ['INV5', 'INV6', 'INV10'] as InvoiceKey[], invoiceTotal: '356388.88' };

/**
 * Phase 8.2 Accrual Project P&L and Cost to Company (ADR-109).
 *
 * Income is credit − debit on income accounts carrying the project; expense is
 * debit − credit on expense accounts carrying it. Receipt deductions now carry
 * their invoice's project, so R1's accepted penalty (7,500) reduces P1's income
 * and R6's "other" bank charge (1,000, posted to BANK_CHARGES) is P4's expense.
 *
 * All dates (period ending 2099-12-31, so the notes count):
 *   P1 income 5,00,000 + 1,23,456.78 + DN 10,000 − penalty 7,500 = 6,25,956.78
 *      expense VB1 40,000 + CL2 2,450 + DE2 8,850 + material 31,200 + introducer 35,000 = 1,17,500
 *   P2 income 1,00,000 × 2 = 2,00,000; expense 0 (VB4 was all stock)
 *   P3 income 6,00,000 + 4,00,000 + 13,888.88 × 2 − CN 50,000 = 9,77,777.76
 *      expense VB2 70,800 + CL1 10,000 = 80,800
 *   P4 income INV7 2,00,000 (INV8 6,00,000 voided nets to 0); expense DE1 10,000 + material 13,000 + bank charge 1,000 = 24,000
 *   Not assigned: salary 5,67,111.10 + office rent 20,000 = 5,87,111.10 expense
 *   Totals: income 20,03,734.54 = revenue 20,11,234.54 − penalty 7,500 (the ledger's income accounts);
 *           expense 8,09,411.10 = every expense ledger balance summed.
 *   Manpower is the Manpower report's figures; the total row has none, as salary is already in "not assigned".
 */
export const PL_ALL_TIME_TO = '2099-12-31';
type PlFigures = { income: string; expense: string; contribution: string; manpower: string | null; contributionAfterManpower: string | null };
export const PROJECT_PL_ALL_TIME: { projects: Record<ProjectKey, PlFigures>; unassigned: PlFigures; totals: PlFigures } = {
  projects: {
    P1: { income: '625956.78', expense: '117500.00', contribution: '508456.78', manpower: '200016.66', contributionAfterManpower: '308440.12' },
    P2: { income: '200000.00', expense: '0.00', contribution: '200000.00', manpower: '63000.00', contributionAfterManpower: '137000.00' },
    P3: { income: '977777.76', expense: '80800.00', contribution: '896977.76', manpower: '156522.23', contributionAfterManpower: '740455.53' },
    P4: { income: '200000.00', expense: '24000.00', contribution: '176000.00', manpower: '59016.66', contributionAfterManpower: '116983.34' },
    P5: { income: '0.00', expense: '0.00', contribution: '0.00', manpower: '0.00', contributionAfterManpower: '0.00' },
  },
  unassigned: { income: '0.00', expense: '587111.10', contribution: '-587111.10', manpower: null, contributionAfterManpower: null },
  totals: { income: '2003734.54', expense: '809411.10', contribution: '1194323.44', manpower: null, contributionAfterManpower: null },
};

/** Per ledger account, split between lines on a project and lines without one. */
export const PROJECT_PL_ACCOUNTS: Array<{ code: string; accountType: 'INCOME' | 'EXPENSE'; assignedAmount: string; unassignedAmount: string; totalAmount: string }> = [
  { code: 'PENALTY_REVENUE_DEDUCTION', accountType: 'INCOME', assignedAmount: '-7500.00', unassignedAmount: '0.00', totalAmount: '-7500.00' },
  { code: 'SOFTWARE_PROJECT_REVENUE', accountType: 'INCOME', assignedAmount: '2011234.54', unassignedAmount: '0.00', totalAmount: '2011234.54' },
  { code: 'BANK_CHARGES', accountType: 'EXPENSE', assignedAmount: '1000.00', unassignedAmount: '0.00', totalAmount: '1000.00' },
  { code: 'HARDWARE_EXPENSE', accountType: 'EXPENSE', assignedAmount: '120800.00', unassignedAmount: '0.00', totalAmount: '120800.00' },
  { code: 'INTRODUCER_COMMISSION_EXPENSE', accountType: 'EXPENSE', assignedAmount: '35000.00', unassignedAmount: '0.00', totalAmount: '35000.00' },
  { code: 'OFFICE_EXPENSE', accountType: 'EXPENSE', assignedAmount: '8850.00', unassignedAmount: '20000.00', totalAmount: '28850.00' },
  { code: 'PROJECT_MATERIAL_COST', accountType: 'EXPENSE', assignedAmount: '44200.00', unassignedAmount: '0.00', totalAmount: '44200.00' },
  { code: 'SALARIES_WAGES_EXPENSE', accountType: 'EXPENSE', assignedAmount: '0.00', unassignedAmount: '567111.10', totalAmount: '567111.10' },
  { code: 'TRAVEL_EXPENSE', accountType: 'EXPENSE', assignedAmount: '12450.00', unassignedAmount: '0.00', totalAmount: '12450.00' },
];

/**
 * July 2026 only (1–31 Jul):
 *   income  P1 −7,500 (R1's penalty, 10 Jul); P2 INV4 1,00,000 (31 Jul);
 *           P3 INV6 4,00,000 (25 Jul) + INV9 13,888.88 (31 Jul) = 4,13,888.88; P4 INV7 2,00,000 (15 Jul)
 *   expense P1 CL2 2,450 (18 Jul); P3 CL1 10,000 (8 Jul); P4 DE1 10,000 (12 Jul) + material 13,000 (10 Jul) = 23,000;
 *           not assigned: office rent 20,000 (1 Jul) + July salary 2,80,555.55 (31 Jul) = 3,00,555.55
 *   manpower (July allocations) P1 1,10,016.66, P2 22,500, P3 1,14,522.23, P4 18,516.66
 *   totals income 7,06,388.88, expense 3,36,005.55
 */
export const PROJECT_PL_JULY: { dateFrom: string; dateTo: string; projects: Record<ProjectKey, PlFigures>; totals: { income: string; expense: string } } = {
  dateFrom: '2026-07-01',
  dateTo: '2026-07-31',
  projects: {
    P1: { income: '-7500.00', expense: '2450.00', contribution: '-9950.00', manpower: '110016.66', contributionAfterManpower: '-119966.66' },
    P2: { income: '100000.00', expense: '0.00', contribution: '100000.00', manpower: '22500.00', contributionAfterManpower: '77500.00' },
    P3: { income: '413888.88', expense: '10000.00', contribution: '403888.88', manpower: '114522.23', contributionAfterManpower: '289366.65' },
    P4: { income: '200000.00', expense: '23000.00', contribution: '177000.00', manpower: '18516.66', contributionAfterManpower: '158483.34' },
    P5: { income: '0.00', expense: '0.00', contribution: '0.00', manpower: '0.00', contributionAfterManpower: '0.00' },
  },
  totals: { income: '706388.88', expense: '336005.55' },
};

/**
 * Cost to Company, all dates. Posted categories come from the event that
 * posted each expense line; manpower from allocations. P4's total is 1,000
 * above its Financials-tab figure: the Financials tab counts an "other" receipt
 * deduction as a settlement, while on the ledger it is a BANK_CHARGES expense.
 *   Totals: purchases 1,10,800; direct 18,850; reimbursements 12,450; material 44,200;
 *           introducer 35,000; other 1,000 → posted 2,22,300; manpower 4,78,555.55 → 7,00,855.55.
 *   Posted 2,22,300 + not assigned 5,87,111.10 = 8,09,411.10 = expense ledger.
 */
type CostFigures = { PURCHASE: string; DIRECT_EXPENSE: string; RECURRING: string; REIMBURSEMENT: string; MATERIAL: string; INTRODUCER: string; OTHER: string; MANPOWER: string };
const zeroCost: CostFigures = { PURCHASE: '0.00', DIRECT_EXPENSE: '0.00', RECURRING: '0.00', REIMBURSEMENT: '0.00', MATERIAL: '0.00', INTRODUCER: '0.00', OTHER: '0.00', MANPOWER: '0.00' };
export const COST_TO_COMPANY_ALL_TIME: { rows: Record<ProjectKey, { amounts: CostFigures; postedTotal: string; total: string }>; totals: { amounts: CostFigures; postedTotal: string; total: string }; unassignedPostedCost: string } = {
  rows: {
    P1: { amounts: { ...zeroCost, PURCHASE: '40000.00', DIRECT_EXPENSE: '8850.00', REIMBURSEMENT: '2450.00', MATERIAL: '31200.00', INTRODUCER: '35000.00', MANPOWER: '200016.66' }, postedTotal: '117500.00', total: '317516.66' },
    P2: { amounts: { ...zeroCost, MANPOWER: '63000.00' }, postedTotal: '0.00', total: '63000.00' },
    P3: { amounts: { ...zeroCost, PURCHASE: '70800.00', REIMBURSEMENT: '10000.00', MANPOWER: '156522.23' }, postedTotal: '80800.00', total: '237322.23' },
    P4: { amounts: { ...zeroCost, DIRECT_EXPENSE: '10000.00', MATERIAL: '13000.00', OTHER: '1000.00', MANPOWER: '59016.66' }, postedTotal: '24000.00', total: '83016.66' },
    P5: { amounts: { ...zeroCost }, postedTotal: '0.00', total: '0.00' },
  },
  totals: { amounts: { PURCHASE: '110800.00', DIRECT_EXPENSE: '18850.00', RECURRING: '0.00', REIMBURSEMENT: '12450.00', MATERIAL: '44200.00', INTRODUCER: '35000.00', OTHER: '1000.00', MANPOWER: '478555.55' }, postedTotal: '222300.00', total: '700855.55' },
  unassignedPostedCost: '587111.10',
};

type ScheduleRow = { servicePeriodStart: string; servicePeriodEnd: string; plannedInvoiceDate: string; scheduledAmount: string };
export const OPEX_SCHEDULES: Record<'P2' | 'P3', { name: string; installmentCount: number; regularAmount: string; total: string; first: ScheduleRow; second: ScheduleRow; third: ScheduleRow; last: ScheduleRow }> = {
  P2: {
    name: 'Data centre AMC',
    installmentCount: 12,
    regularAmount: '100000.00',
    total: '1200000.00',
    first: { servicePeriodStart: '2026-06-01', servicePeriodEnd: '2026-06-30', plannedInvoiceDate: '2026-06-30', scheduledAmount: '100000.00' },
    second: { servicePeriodStart: '2026-07-01', servicePeriodEnd: '2026-07-31', plannedInvoiceDate: '2026-07-30', scheduledAmount: '100000.00' },
    third: { servicePeriodStart: '2026-08-01', servicePeriodEnd: '2026-08-31', plannedInvoiceDate: '2026-08-30', scheduledAmount: '100000.00' },
    last: { servicePeriodStart: '2027-05-01', servicePeriodEnd: '2027-05-31', plannedInvoiceDate: '2027-05-30', scheduledAmount: '100000.00' },
  },
  P3: {
    name: 'O&M support',
    installmentCount: 36,
    regularAmount: '13888.88',
    total: '500000.00',
    first: { servicePeriodStart: '2026-07-01', servicePeriodEnd: '2026-07-31', plannedInvoiceDate: '2026-07-31', scheduledAmount: '13888.88' },
    second: { servicePeriodStart: '2026-08-01', servicePeriodEnd: '2026-08-31', plannedInvoiceDate: '2026-08-31', scheduledAmount: '13888.88' },
    third: { servicePeriodStart: '2026-09-01', servicePeriodEnd: '2026-09-30', plannedInvoiceDate: '2026-09-30', scheduledAmount: '13888.88' },
    last: { servicePeriodStart: '2029-06-01', servicePeriodEnd: '2029-06-30', plannedInvoiceDate: '2029-06-30', scheduledAmount: '13889.20' },
  },
};

// ------------------------------------------------ Phase 8.3 (ADR-110)

type CashFigures = Partial<Record<'CLIENT_RECEIPT' | 'DEDUCTION_RELEASE' | 'VENDOR_PAYMENT' | 'DIRECT_EXPENSE' | 'REIMBURSEMENT' | 'INTRODUCER_PAYMENT' | 'SALARY_PAYMENT' | 'TAX_DEPOSIT', string>>;
type CashRowFigures = { amounts: CashFigures; cashIn: string; cashOut: string; netCash: string; cashMarginPercent: string | null };

/**
 * Cash Profitability, all dates (every bank line is on or before 31 Aug).
 * Each bank movement goes to the project its document names:
 *   P1 in:  R1 → INV1 5,17,500 (10 Jul) + R2 → INV2 1,00,000 (20 Jul) + R3 → INV2 20,000 (18 Aug) = 6,37,500
 *           INV1 hold/retention released 12,000 (1 Aug) + 8,000 (20 Aug) + 10,000 (25 Aug) = 30,000
 *      out: vendor payment 1,04,400 (5 Jun; cash, TDS 1,800 withheld) + DE2 8,850 (22 Jun)
 *           + introducer payment 27,000 (25 Aug; net of 3,000 TDS, both accruals on P1)
 *   P2 in:  R1 → INV3 1,14,000 + R3 → INV4 1,18,000 = 2,32,000
 *   P3 in:  R4 5,00,000 (5 Jul) + R5 2,00,000 (10 Aug) − its reversal 2,00,000 (12 Aug)
 *           + R7 15,833.32 + 3,00,000 (31 Aug) = 8,15,833.32;  out: CL1 reimbursed 11,800 (15 Jul)
 *   P4 in:  R6 1,50,000 (28 Aug);  out: DE1 11,800 (12 Jul, with its IGST)
 *   not assigned out: DE3 office rent 20,000 (1 Jul) + salary payments 81,000 + 57,000 + 55,555.55 + 70,000 = 2,63,555.55
 *   not assigned also: TDS deposited 1,800 (7 Jul) + 12,000 (5 Sep) + 5,000 − its reversal 5,000 (6 Sep) = 13,800
 *   net 14,04,127.77 = HDFC's balance, the only bank account.
 */
export const CASH_PROFITABILITY_ALL_TIME: { projects: Record<ProjectKey, CashRowFigures>; unassigned: CashRowFigures; totals: CashRowFigures } = {
  projects: {
    P1: { amounts: { CLIENT_RECEIPT: '637500.00', DEDUCTION_RELEASE: '30000.00', VENDOR_PAYMENT: '104400.00', DIRECT_EXPENSE: '8850.00', INTRODUCER_PAYMENT: '27000.00' }, cashIn: '667500.00', cashOut: '140250.00', netCash: '527250.00', cashMarginPercent: '78.99' },
    P2: { amounts: { CLIENT_RECEIPT: '232000.00' }, cashIn: '232000.00', cashOut: '0.00', netCash: '232000.00', cashMarginPercent: '100.00' },
    P3: { amounts: { CLIENT_RECEIPT: '815833.32', REIMBURSEMENT: '11800.00' }, cashIn: '815833.32', cashOut: '11800.00', netCash: '804033.32', cashMarginPercent: '98.55' },
    P4: { amounts: { CLIENT_RECEIPT: '150000.00', DIRECT_EXPENSE: '11800.00' }, cashIn: '150000.00', cashOut: '11800.00', netCash: '138200.00', cashMarginPercent: '92.13' },
    P5: { amounts: {}, cashIn: '0.00', cashOut: '0.00', netCash: '0.00', cashMarginPercent: null },
  },
  unassigned: { amounts: { DIRECT_EXPENSE: '20000.00', SALARY_PAYMENT: '263555.55', TAX_DEPOSIT: '13800.00' }, cashIn: '0.00', cashOut: '297355.55', netCash: '-297355.55', cashMarginPercent: null },
  totals: {
    amounts: { CLIENT_RECEIPT: '1835333.32', DEDUCTION_RELEASE: '30000.00', VENDOR_PAYMENT: '104400.00', DIRECT_EXPENSE: '40650.00', REIMBURSEMENT: '11800.00', INTRODUCER_PAYMENT: '27000.00', SALARY_PAYMENT: '263555.55', TAX_DEPOSIT: '13800.00' },
    cashIn: '1865333.32',
    cashOut: '461205.55',
    netCash: '1404127.77',
    cashMarginPercent: '75.27',
  },
};

/**
 * July 2026 only: P1 R1 5,17,500 + R2 1,00,000; P2 R1 1,14,000; P3 R4 5,00,000 − CL1 11,800;
 * P4 − DE1 11,800; not assigned − DE3 rent 20,000 − TDS deposit 1,800 (7 Jul). Bank before 1 Jul: −1,04,400 − 8,850 = −1,13,250.
 */
export const CASH_PROFITABILITY_JULY: { dateFrom: string; dateTo: string; netCash: Record<ProjectKey, string>; unassignedNetCash: string; totals: { cashIn: string; cashOut: string; netCash: string }; bank: { opening: string; movement: string; closing: string } } = {
  dateFrom: '2026-07-01',
  dateTo: '2026-07-31',
  netCash: { P1: '617500.00', P2: '114000.00', P3: '488200.00', P4: '-11800.00', P5: '0.00' },
  unassignedNetCash: '-21800.00', // rent 20,000 + TDS deposited 7 Jul 1,800
  totals: { cashIn: '1231500.00', cashOut: '45400.00', netCash: '1186100.00' },
  bank: { opening: '-113250.00', movement: '1186100.00', closing: '1072850.00' },
};

type ContractFigures = {
  contractValue: string | null; billedToDate: string; billedPercent: string | null; remainingToBill: string | null; budget: string | null;
  postedCostToDate: string; manpowerToDate: string; costToDate: string; budgetUsedPercent: string | null; budgetRemaining: string | null;
};

/**
 * Contract & Budget Performance to PL_ALL_TIME_TO: billed = PROJECT_PL_ALL_TIME income,
 * cost = COST_TO_COMPANY_ALL_TIME total. Budgets P1 8,00,000, P2 3,00,000, P3 9,00,000,
 * P4 80,000 (over by 3,016.66), P5 none. Totals' percentages and remaining amounts
 * cover only projects that have a value/budget (all have a value; four have a budget).
 */
export const CONTRACT_PERFORMANCE_ALL_TIME: { rows: Record<ProjectKey, ContractFigures & { overBudget: boolean }>; totals: ContractFigures & { projectsWithoutValue: number; projectsWithoutBudget: number } } = {
  rows: {
    P1: { contractValue: '2000000.00', billedToDate: '625956.78', billedPercent: '31.30', remainingToBill: '1374043.22', budget: '800000.00', postedCostToDate: '117500.00', manpowerToDate: '200016.66', costToDate: '317516.66', budgetUsedPercent: '39.69', budgetRemaining: '482483.34', overBudget: false },
    P2: { contractValue: '1200000.00', billedToDate: '200000.00', billedPercent: '16.67', remainingToBill: '1000000.00', budget: '300000.00', postedCostToDate: '0.00', manpowerToDate: '63000.00', costToDate: '63000.00', budgetUsedPercent: '21.00', budgetRemaining: '237000.00', overBudget: false },
    P3: { contractValue: '2000000.00', billedToDate: '977777.76', billedPercent: '48.89', remainingToBill: '1022222.24', budget: '900000.00', postedCostToDate: '80800.00', manpowerToDate: '156522.23', costToDate: '237322.23', budgetUsedPercent: '26.37', budgetRemaining: '662677.77', overBudget: false },
    P4: { contractValue: '800000.00', billedToDate: '200000.00', billedPercent: '25.00', remainingToBill: '600000.00', budget: '80000.00', postedCostToDate: '24000.00', manpowerToDate: '59016.66', costToDate: '83016.66', budgetUsedPercent: '103.77', budgetRemaining: '-3016.66', overBudget: true },
    P5: { contractValue: '500000.00', billedToDate: '0.00', billedPercent: '0.00', remainingToBill: '500000.00', budget: null, postedCostToDate: '0.00', manpowerToDate: '0.00', costToDate: '0.00', budgetUsedPercent: null, budgetRemaining: null, overBudget: false },
  },
  totals: {
    contractValue: '6500000.00', billedToDate: '2003734.54', billedPercent: '30.83', remainingToBill: '4496265.46', budget: '2080000.00',
    postedCostToDate: '222300.00', manpowerToDate: '478555.55', costToDate: '700855.55', budgetUsedPercent: '33.69', budgetRemaining: '1379144.45',
    projectsWithoutValue: 0, projectsWithoutBudget: 1,
  },
};

/** Business Overview to PL_ALL_TIME_TO — each card equals its source report's figure. */
export const BUSINESS_OVERVIEW_ALL_TIME: Record<string, string | null> = {
  ACCRUAL_INCOME: '2003734.54',
  ACCRUAL_EXPENSE: '809411.10',
  ACCRUAL_CONTRIBUTION: '1194323.44',
  CASH_IN: '1865333.32',
  CASH_OUT: '461205.55',
  NET_CASH: '1404127.77',
  CONTRACT_VALUE: '6500000.00',
  BILLED_TO_DATE: '2003734.54',
  REMAINING_TO_BILL: '4496265.46',
  BUDGET: '2080000.00',
  COST_TO_DATE: '700855.55',
  BANK_OPENING: '0.00',
  BANK_MOVEMENT: '1404127.77',
  BANK_CLOSING: '1404127.77',
};

// ------------------------------------------------ Phase 8.4 (ADR-111)

type TaxFigures = { taxable: string; cgst: string; sgst: string; igst: string; total: string };
type InputTaxFigures = { cgst: string; sgst: string; igst: string; notSplit: string; total: string };
const noInput: InputTaxFigures = { cgst: '0.00', sgst: '0.00', igst: '0.00', notSplit: '0.00', total: '0.00' };

/**
 * GST Output, all dates. One GST registration (Gujarat). Each document in the
 * month of its own journal; INV8's void (6 Aug) in August, cancelling INV8 (5 Aug).
 * DN1 and CN1 are finalized on the day the scenario is built, so their month
 * is the build month — the spec reads it from the note.
 */
export const GST_OUTPUT_ALL_TIME: {
  documents: Array<{ key: InvoiceKey | 'DN1' | 'CN1'; documentType: string; ledgerDate: string | null } & TaxFigures>;
  periods: Array<{ taxPeriod: string; documentCount: number } & TaxFigures>;
  notesPeriod: { documentCount: number } & TaxFigures;
  totals: TaxFigures;
} = {
  documents: [
    { key: 'INV1', documentType: 'INVOICE', ledgerDate: '2026-05-25', taxable: '500000.00', cgst: '45000.00', sgst: '45000.00', igst: '0.00', total: '590000.00' },
    { key: 'INV5', documentType: 'INVOICE', ledgerDate: '2026-06-15', taxable: '600000.00', cgst: '0.00', sgst: '0.00', igst: '108000.00', total: '708000.00' },
    { key: 'INV2', documentType: 'INVOICE', ledgerDate: '2026-06-28', taxable: '123456.78', cgst: '11111.11', sgst: '11111.11', igst: '0.00', total: '145679.00' },
    { key: 'INV3', documentType: 'INVOICE', ledgerDate: '2026-06-30', taxable: '100000.00', cgst: '9000.00', sgst: '9000.00', igst: '0.00', total: '118000.00' },
    { key: 'INV7', documentType: 'INVOICE', ledgerDate: '2026-07-15', taxable: '200000.00', cgst: '0.00', sgst: '0.00', igst: '36000.00', total: '236000.00' },
    { key: 'INV6', documentType: 'INVOICE', ledgerDate: '2026-07-25', taxable: '400000.00', cgst: '0.00', sgst: '0.00', igst: '72000.00', total: '472000.00' },
    { key: 'INV4', documentType: 'INVOICE', ledgerDate: '2026-07-31', taxable: '100000.00', cgst: '9000.00', sgst: '9000.00', igst: '0.00', total: '118000.00' },
    { key: 'INV9', documentType: 'INVOICE', ledgerDate: '2026-07-31', taxable: '13888.88', cgst: '0.00', sgst: '0.00', igst: '2500.00', total: '16388.88' },
    { key: 'INV8', documentType: 'INVOICE', ledgerDate: '2026-08-05', taxable: '600000.00', cgst: '0.00', sgst: '0.00', igst: '108000.00', total: '708000.00' },
    { key: 'INV8', documentType: 'INVOICE_VOID', ledgerDate: '2026-08-06', taxable: '-600000.00', cgst: '0.00', sgst: '0.00', igst: '-108000.00', total: '-708000.00' },
    { key: 'INV10', documentType: 'INVOICE', ledgerDate: '2026-08-31', taxable: '13888.88', cgst: '0.00', sgst: '0.00', igst: '2500.00', total: '16388.88' },
    // Same day: by number, CN-0001 before DN-0001.
    { key: 'CN1', documentType: 'CREDIT_NOTE', ledgerDate: null, taxable: '-50000.00', cgst: '0.00', sgst: '0.00', igst: '-9000.00', total: '-59000.00' },
    { key: 'DN1', documentType: 'DEBIT_NOTE', ledgerDate: null, taxable: '10000.00', cgst: '900.00', sgst: '900.00', igst: '0.00', total: '11800.00' },
  ],
  periods: [
    { taxPeriod: '2026-05', documentCount: 1, taxable: '500000.00', cgst: '45000.00', sgst: '45000.00', igst: '0.00', total: '590000.00' },
    { taxPeriod: '2026-06', documentCount: 3, taxable: '823456.78', cgst: '20111.11', sgst: '20111.11', igst: '108000.00', total: '971679.00' },
    { taxPeriod: '2026-07', documentCount: 4, taxable: '713888.88', cgst: '9000.00', sgst: '9000.00', igst: '110500.00', total: '842388.88' },
    { taxPeriod: '2026-08', documentCount: 3, taxable: '13888.88', cgst: '0.00', sgst: '0.00', igst: '2500.00', total: '16388.88' },
  ],
  notesPeriod: { documentCount: 2, taxable: '-40000.00', cgst: '900.00', sgst: '900.00', igst: '-9000.00', total: '-47200.00' },
  // Taxable equals SOFTWARE_PROJECT_REVENUE (20,11,234.54); tax equals the output GST ledger.
  totals: { taxable: '2011234.54', cgst: '75011.11', sgst: '75011.11', igst: '212000.00', total: '2373256.76' },
};

/**
 * GST Input, all dates:
 *   AN-1001 (5 May) P1: expense 40,000 + stock 50,000, both ITC-eligible → CGST 8,100 + SGST 8,100
 *   PHT-77 (20 Jun) P3: 60,000, IGST 10,800 ineligible (kept in cost)
 *   Printing and stationery (22 Jun) P1 direct expense: 7,500, CGST 675 + SGST 675 ineligible
 *   Travel to Mumbai client site (8 Jul) P3 claim: 11,800 with 1,800 GST credit (not split) → taxable 10,000
 *   Survey equipment hire (12 Jul) P4 direct expense: 10,000, IGST 1,800 eligible
 *   AN-1003 (10 Aug) P2: stock 10,000, CGST 900 + SGST 900 eligible
 *   Pending: AN-1002 (1 Aug) P4, submitted never approved: 25,000, CGST 2,250 + SGST 2,250.
 * Office rent (no GST) and the drafts are not GST documents here.
 */
export const GST_INPUT_ALL_TIME: {
  documents: Array<{ number: string; documentType: string; ledgerDate: string; taxable: string; eligible: InputTaxFigures; ineligible: InputTaxFigures }>;
  periods: Array<{ registered: boolean; taxPeriod: string; documentCount: number; taxable: string; eligibleTotal: string; ineligibleTotal: string }>;
  totals: { taxable: string; eligible: InputTaxFigures; ineligible: InputTaxFigures };
  pending: Array<{ number: string; documentDate: string; taxable: string; eligible: InputTaxFigures }>;
} = {
  documents: [
    { number: 'AN-1001', documentType: 'VENDOR_BILL', ledgerDate: '2026-05-05', taxable: '90000.00', eligible: { ...noInput, cgst: '8100.00', sgst: '8100.00', total: '16200.00' }, ineligible: noInput },
    { number: 'PHT-77', documentType: 'VENDOR_BILL', ledgerDate: '2026-06-20', taxable: '60000.00', eligible: noInput, ineligible: { ...noInput, igst: '10800.00', total: '10800.00' } },
    { number: 'Printing and stationery', documentType: 'DIRECT_EXPENSE', ledgerDate: '2026-06-22', taxable: '7500.00', eligible: noInput, ineligible: { ...noInput, cgst: '675.00', sgst: '675.00', total: '1350.00' } },
    { number: 'Travel to Mumbai client site', documentType: 'EXPENSE_CLAIM', ledgerDate: '2026-07-08', taxable: '10000.00', eligible: { ...noInput, notSplit: '1800.00', total: '1800.00' }, ineligible: noInput },
    { number: 'Survey equipment hire', documentType: 'DIRECT_EXPENSE', ledgerDate: '2026-07-12', taxable: '10000.00', eligible: { ...noInput, igst: '1800.00', total: '1800.00' }, ineligible: noInput },
    { number: 'AN-1003', documentType: 'VENDOR_BILL', ledgerDate: '2026-08-10', taxable: '10000.00', eligible: { ...noInput, cgst: '900.00', sgst: '900.00', total: '1800.00' }, ineligible: noInput },
  ],
  periods: [
    { registered: true, taxPeriod: '2026-05', documentCount: 1, taxable: '90000.00', eligibleTotal: '16200.00', ineligibleTotal: '0.00' },
    { registered: true, taxPeriod: '2026-06', documentCount: 1, taxable: '60000.00', eligibleTotal: '0.00', ineligibleTotal: '10800.00' },
    { registered: true, taxPeriod: '2026-08', documentCount: 1, taxable: '10000.00', eligibleTotal: '1800.00', ineligibleTotal: '0.00' },
    { registered: false, taxPeriod: '2026-06', documentCount: 1, taxable: '7500.00', eligibleTotal: '0.00', ineligibleTotal: '1350.00' },
    { registered: false, taxPeriod: '2026-07', documentCount: 2, taxable: '20000.00', eligibleTotal: '3600.00', ineligibleTotal: '0.00' },
  ],
  totals: {
    taxable: '187500.00',
    eligible: { cgst: '9000.00', sgst: '9000.00', igst: '1800.00', notSplit: '1800.00', total: '21600.00' },
    ineligible: { cgst: '675.00', sgst: '675.00', igst: '10800.00', notSplit: '0.00', total: '12150.00' },
  },
  pending: [{ number: 'AN-1002', documentDate: '2026-08-01', taxable: '25000.00', eligible: { ...noInput, cgst: '2250.00', sgst: '2250.00', total: '4500.00' } }],
};

/** GST Net, all dates: output − eligible input, no adjustments in the scenario. */
export const GST_NET_ALL_TIME = {
  components: [
    { component: 'CGST', output: '75011.11', eligibleInput: '9000.00', adjustments: '0.00', net: '66011.11' },
    { component: 'SGST', output: '75011.11', eligibleInput: '9000.00', adjustments: '0.00', net: '66011.11' },
    { component: 'IGST', output: '212000.00', eligibleInput: '1800.00', adjustments: '0.00', net: '210200.00' },
    { component: 'NOT_SPLIT', output: '0.00', eligibleInput: '1800.00', adjustments: '0.00', net: '-1800.00' },
  ],
  totals: { output: '362022.22', eligibleInput: '21600.00', adjustments: '0.00', net: '340422.22' },
  periods: [
    { taxPeriod: '2026-05', output: '90000.00', eligibleInput: '16200.00', adjustments: '0.00', net: '73800.00' },
    { taxPeriod: '2026-06', output: '148222.22', eligibleInput: '0.00', adjustments: '0.00', net: '148222.22' },
    { taxPeriod: '2026-07', output: '128500.00', eligibleInput: '3600.00', adjustments: '0.00', net: '124900.00' },
    { taxPeriod: '2026-08', output: '2500.00', eligibleInput: '1800.00', adjustments: '0.00', net: '700.00' },
  ],
  notesPeriod: { output: '-7200.00', eligibleInput: '0.00', adjustments: '0.00', net: '-7200.00' },
};

/** Register totals, all dates, void documents excluded (INV8). AN-1002 was never finalized. */
export const GST_REGISTER_ALL_TIME = [
  { documentType: 'INVOICE', documentCount: 9, lineCount: 9, taxable: '2051234.54', cgst: '74111.11', sgst: '74111.11', igst: '221000.00', total: '2420456.76' },
  { documentType: 'DEBIT_NOTE', documentCount: 1, lineCount: 1, taxable: '10000.00', cgst: '900.00', sgst: '900.00', igst: '0.00', total: '11800.00' },
  { documentType: 'CREDIT_NOTE', documentCount: 1, lineCount: 1, taxable: '50000.00', cgst: '0.00', sgst: '0.00', igst: '9000.00', total: '59000.00' },
  { documentType: 'VENDOR_BILL', documentCount: 3, lineCount: 4, taxable: '160000.00', cgst: '9000.00', sgst: '9000.00', igst: '10800.00', total: '188800.00' },
];

// ------------------------------------------------ Phase 8.5a (ADR-112)

type TdsRowFigures = { invoice: InvoiceKey; type: 'TDS' | 'CGST_TDS' | 'SGST_TDS' | 'IGST_TDS'; receiptDate: string; amount: string; certificateMatched: string; statementMatched: string; lifecycle: string; partiallyMatched: boolean };

/**
 * TDS Inward, all dates (every reporting period over). Certificates built by the scenario:
 *   GIL/16A/Q2/0001   C1 Form 16A   TDS 14,469.14 → INV1 10,000 + INV3 2,000 + INV2 2,469.14
 *   26AS-GIL-202607   C1 26AS       TDS 12,000    → INV1 10,000 + INV3 2,000
 *   MAHA/16A/Q2/0007  C2 Form 16A   TDS 15,000    → INV5 12,000 (3,000 unmatched)
 *   RSCL/GSTR7A/2026-08 C3 GSTR-7A  IGST-TDS 4,000 → INV7 2,500 (partial; 1,500 unmatched)
 *   GST-CR-GIL-2607-X C1 statement  CGST-TDS 6,000, cancelled → ignored
 * So INV1/INV3 TDS are RECONCILED (26AS covers them), INV2/INV5 TDS CERTIFICATE_RECEIVED,
 * and every other deduction CERTIFICATE_PENDING.
 */
export const TDS_INWARD_ALL_TIME: { rows: TdsRowFigures[]; summary: Record<'TDS' | 'CGST_TDS' | 'SGST_TDS' | 'IGST_TDS', { count: number; amount: string; certificateMatched: string; statementMatched: string; pending: string; received: string; reconciled: string }> } = {
  rows: [
    { invoice: 'INV5', type: 'TDS', receiptDate: '2026-07-05', amount: '12000.00', certificateMatched: '12000.00', statementMatched: '0.00', lifecycle: 'CERTIFICATE_RECEIVED', partiallyMatched: false },
    { invoice: 'INV5', type: 'IGST_TDS', receiptDate: '2026-07-05', amount: '12000.00', certificateMatched: '0.00', statementMatched: '0.00', lifecycle: 'CERTIFICATE_PENDING', partiallyMatched: false },
    { invoice: 'INV1', type: 'TDS', receiptDate: '2026-07-10', amount: '10000.00', certificateMatched: '10000.00', statementMatched: '10000.00', lifecycle: 'RECONCILED', partiallyMatched: false },
    { invoice: 'INV1', type: 'CGST_TDS', receiptDate: '2026-07-10', amount: '5000.00', certificateMatched: '0.00', statementMatched: '0.00', lifecycle: 'CERTIFICATE_PENDING', partiallyMatched: false },
    { invoice: 'INV1', type: 'SGST_TDS', receiptDate: '2026-07-10', amount: '5000.00', certificateMatched: '0.00', statementMatched: '0.00', lifecycle: 'CERTIFICATE_PENDING', partiallyMatched: false },
    { invoice: 'INV3', type: 'TDS', receiptDate: '2026-07-10', amount: '2000.00', certificateMatched: '2000.00', statementMatched: '2000.00', lifecycle: 'RECONCILED', partiallyMatched: false },
    { invoice: 'INV3', type: 'CGST_TDS', receiptDate: '2026-07-10', amount: '1000.00', certificateMatched: '0.00', statementMatched: '0.00', lifecycle: 'CERTIFICATE_PENDING', partiallyMatched: false },
    { invoice: 'INV3', type: 'SGST_TDS', receiptDate: '2026-07-10', amount: '1000.00', certificateMatched: '0.00', statementMatched: '0.00', lifecycle: 'CERTIFICATE_PENDING', partiallyMatched: false },
    { invoice: 'INV2', type: 'TDS', receiptDate: '2026-07-20', amount: '2469.14', certificateMatched: '2469.14', statementMatched: '0.00', lifecycle: 'CERTIFICATE_RECEIVED', partiallyMatched: false },
    { invoice: 'INV7', type: 'TDS', receiptDate: '2026-08-28', amount: '4000.00', certificateMatched: '0.00', statementMatched: '0.00', lifecycle: 'CERTIFICATE_PENDING', partiallyMatched: false },
    { invoice: 'INV7', type: 'IGST_TDS', receiptDate: '2026-08-28', amount: '4000.00', certificateMatched: '2500.00', statementMatched: '0.00', lifecycle: 'CERTIFICATE_PENDING', partiallyMatched: true },
    { invoice: 'INV6', type: 'TDS', receiptDate: '2026-08-31', amount: '8000.00', certificateMatched: '0.00', statementMatched: '0.00', lifecycle: 'CERTIFICATE_PENDING', partiallyMatched: false },
    { invoice: 'INV6', type: 'IGST_TDS', receiptDate: '2026-08-31', amount: '8000.00', certificateMatched: '0.00', statementMatched: '0.00', lifecycle: 'CERTIFICATE_PENDING', partiallyMatched: false },
    { invoice: 'INV9', type: 'TDS', receiptDate: '2026-08-31', amount: '277.78', certificateMatched: '0.00', statementMatched: '0.00', lifecycle: 'CERTIFICATE_PENDING', partiallyMatched: false },
    { invoice: 'INV9', type: 'IGST_TDS', receiptDate: '2026-08-31', amount: '277.78', certificateMatched: '0.00', statementMatched: '0.00', lifecycle: 'CERTIFICATE_PENDING', partiallyMatched: false },
  ],
  summary: {
    TDS: { count: 7, amount: '38746.92', certificateMatched: '26469.14', statementMatched: '12000.00', pending: '12277.78', received: '14469.14', reconciled: '12000.00' },
    CGST_TDS: { count: 2, amount: '6000.00', certificateMatched: '0.00', statementMatched: '0.00', pending: '6000.00', received: '0.00', reconciled: '0.00' },
    SGST_TDS: { count: 2, amount: '6000.00', certificateMatched: '0.00', statementMatched: '0.00', pending: '6000.00', received: '0.00', reconciled: '0.00' },
    IGST_TDS: { count: 4, amount: '24277.78', certificateMatched: '2500.00', statementMatched: '0.00', pending: '24277.78', received: '0.00', reconciled: '0.00' },
  },
};

/**
 * Reconciliation, all dates. Credits: TDS certificates 14,469.14 + 15,000 = 29,469.14, statement 12,000;
 * IGST-TDS certificate 4,000; the cancelled CGST-TDS statement line counts nowhere.
 * Pending amount = unmatched part of each overdue deduction:
 *   INV5 IGST 12,000 + INV1/INV3 CGST+SGST 12,000 + INV7 TDS 4,000 + INV7 IGST 1,500 + INV6 16,000 + INV9 555.56 = 46,055.56
 */
export const TDS_RECONCILIATION_ALL_TIME = {
  summary: [
    { deductionType: 'TDS', deducted: '38746.92', certificateCredits: '29469.14', statementCredits: '12000.00', statementDifference: '26746.92' },
    { deductionType: 'CGST_TDS', deducted: '6000.00', certificateCredits: '0.00', statementCredits: '0.00', statementDifference: '6000.00' },
    { deductionType: 'SGST_TDS', deducted: '6000.00', certificateCredits: '0.00', statementCredits: '0.00', statementDifference: '6000.00' },
    { deductionType: 'IGST_TDS', deducted: '24277.78', certificateCredits: '4000.00', statementCredits: '0.00', statementDifference: '24277.78' },
  ],
  pendingCount: 11,
  partial: [{ invoice: 'INV7' as InvoiceKey, type: 'IGST_TDS' }],
  unmatchedCredits: [
    { reference: 'RSCL/GSTR7A/2026-08', unmatchedAmount: '1500.00' },
    { reference: 'MAHA/16A/Q2/0007', unmatchedAmount: '3000.00' },
  ],
  totals: { pendingAmount: '46055.56', unmatchedCreditAmount: '4500.00', exceptionCount: 13 },
};

// ------------------------------------------------ Phase 8.5b (ADR-113)

/**
 * TDS Outward, all dates. Withheld: vendor payment AN-PAY-0605 (bill AN-1001) 1,800 on 5 Jun;
 * salary payment SALP-000001 on 5 Aug — Asha Patel 9,000, Neha Desai 3,000, Ravi Shah 5,000
 * (Karan Mehta 0); introducer payment INTP-000001 3,000 on 25 Aug. Challans:
 *   CIN-0001 (7 Jul)  1,800 → the vendor payment
 *   CIN-0002 (5 Sep) 12,000 → introducer 3,000 + Asha 9,000
 *   CIN-0099 (5 Sep)  5,000 → Ravi, reversed 6 Sep
 * Payable 8,000 = Neha 3,000 + Ravi 5,000, both overdue after 7 Sep.
 */
export const TDS_OUTWARD_ALL_TIME = {
  rows: [
    { deductionDate: '2026-06-05', deducteeName: 'Ahmedabad Networks Pvt Ltd', sourceKind: 'VENDOR_PAYMENT_DEDUCTION', amount: '1800.00', deposited: '1800.00', remaining: '0.00', challanNumbers: ['CIN-0001'], dueDate: '2026-07-07', overdue: false },
    { deductionDate: '2026-08-05', deducteeName: 'Asha Patel', sourceKind: 'SALARY_PAYMENT_LINE', amount: '9000.00', deposited: '9000.00', remaining: '0.00', challanNumbers: ['CIN-0002'], dueDate: '2026-09-07', overdue: false },
    { deductionDate: '2026-08-05', deducteeName: 'Neha Desai', sourceKind: 'SALARY_PAYMENT_LINE', amount: '3000.00', deposited: '0.00', remaining: '3000.00', challanNumbers: [], dueDate: '2026-09-07', overdue: true },
    { deductionDate: '2026-08-05', deducteeName: 'Ravi Shah', sourceKind: 'SALARY_PAYMENT_LINE', amount: '5000.00', deposited: '0.00', remaining: '5000.00', challanNumbers: [], dueDate: '2026-09-07', overdue: true },
    { deductionDate: '2026-08-25', deducteeName: 'Mehul Consultancy', sourceKind: 'INTRODUCER_PAYMENT', amount: '3000.00', deposited: '3000.00', remaining: '0.00', challanNumbers: ['CIN-0002'], dueDate: '2026-09-07', overdue: false },
  ],
  tds: { count: 5, deducted: '21800.00', deposited: '13800.00', payable: '8000.00', overdueCount: 2, overdueAmount: '8000.00' },
  /** On 5 Sep the 5,000 challan still stood; nothing was overdue yet. */
  sept5: { deposited: '18800.00', payable: '3000.00', overdueCount: 0, raviRemaining: '0.00' },
};

// ------------------------------------------------ Phase 8.6a (ADR-114)

/**
 * HDFC's own statement for June–August, as a bank CSV (withdrawal and deposit columns,
 * DD/MM/YYYY). It mirrors the books with the usual differences:
 *   - clearing lags of a day (DE2 23 Jun, R4 6 Jul, R2 21 Jul);
 *   - DE1 and CL1 both −11,800 three days apart — auto-match must not guess between them;
 *   - a −590 bank charge the books never recorded (an exception to explain);
 *   - no September lines, so the September challans stay unmatched in the books;
 *   - a blank row and a closing-balance row, both skipped.
 * 23 lines: in 20,65,333.32, out 6,49,795.55 (books June–August out 6,49,205.55: the same less the 590 charge).
 */
export const HDFC_STATEMENT_CSV = {
  fileName: 'hdfc-jun-aug-2026.csv',
  headers: ['Txn Date', 'Narration', 'Chq/Ref No', 'Withdrawal Amt', 'Deposit Amt'],
  rows: [
    ['05/06/2026', 'NEFT AHMEDABAD NETWORKS', 'AN-PAY-0605', '1,04,400.00', ''],
    ['23/06/2026', 'POS PRINTING AND STATIONERY', '', '8,850.00', ''],
    ['01/07/2026', 'IMPS OFFICE RENT JULY', '', '20,000.00', ''],
    ['06/07/2026', 'NEFT MAHAIT DEPT', 'MAHA-UTR-0705', '', '5,00,000.00'],
    ['07/07/2026', 'TAX PAYMENT CIN-0001', 'CIN-0001', '1,800.00', ''],
    ['10/07/2026', 'RTGS GUJARAT INFORMATICS', 'GIL-UTR-0710', '', '6,31,500.00'],
    ['12/07/2026', 'NEFT SURVEY EQUIPMENT HIRE', '', '11,800.00', ''],
    ['15/07/2026', 'NEFT ASHA PATEL CLAIM', '', '11,800.00', ''],
    ['21/07/2026', 'NEFT GUJARAT INFORMATICS', 'GIL-UTR-0720', '', '1,00,000.00'],
    ['01/08/2026', 'NEFT HOLD RELEASE GIL', '', '', '12,000.00'],
    ['05/08/2026', 'SALARY ASHA PATEL', 'SAL-JUL-MF-001', '81,000.00', ''],
    ['05/08/2026', 'SALARY RAVI SHAH', 'SAL-JUL-MF-002', '70,000.00', ''],
    ['05/08/2026', 'SALARY NEHA DESAI', 'SAL-JUL-MF-003', '57,000.00', ''],
    ['05/08/2026', 'SALARY KARAN MEHTA', 'SAL-JUL-MF-004', '55,555.55', ''],
    ['', '', '', '', ''],
    ['10/08/2026', 'CHQ DEP MAHAIT', 'MAHA-CHQ-0810', '', '2,00,000.00'],
    ['12/08/2026', 'CHQ RETURN MAHAIT', 'MAHA-CHQ-0810', '2,00,000.00', ''],
    ['18/08/2026', 'NEFT GUJARAT INFORMATICS', 'GIL-UTR-0818', '', '1,38,000.00'],
    ['20/08/2026', 'NEFT HOLD RELEASE GIL', '', '', '8,000.00'],
    ['25/08/2026', 'NEFT MEHUL CONSULTANCY', 'INTRO-NEFT-0825', '27,000.00', ''],
    ['25/08/2026', 'NEFT RETENTION RELEASE GIL', '', '', '10,000.00'],
    ['28/08/2026', 'NEFT RAJASTHAN SMART CITY', 'RSCL-UTR-0828', '', '1,50,000.00'],
    ['31/08/2026', 'NEFT MAHAIT DEPT', 'MAHA-UTR-0831', '', '3,15,833.32'],
    ['31/08/2026', 'SMS AND ACCOUNT CHARGES', '', '590.00', ''],
    ['Closing Balance', '', '', '', '14,16,137.77'],
  ],
};

export const BANK_RECONCILIATION_JUN_AUG = {
  from: '2026-06-01',
  to: '2026-08-31',
  preview: { readyCount: 23, duplicateCount: 0, skippedCount: 2, errorCount: 0, firstDate: '2026-06-05', lastDate: '2026-08-31', totalIn: '2065333.32', totalOut: '649795.55' },
  /** 23 lines less the two −11,800 (ambiguous) and the −590 (no book entry). */
  autoMatched: 20,
  afterAutoMatch: {
    statementIn: '2065333.32', statementOut: '649795.55', bookIn: '2065333.32', bookOut: '649205.55',
    unmatchedStatementCount: 3, unmatchedStatementAmount: '-24190.00', unmatchedBookCount: 2, unmatchedBookAmount: '-23600.00', pendingExceptionCount: 0,
  },
};

// ------------------------------------------------ Phase 8.6b (ADR-115)

/**
 * Monthly bank reconciliation statements for HDFC, after the June–August statement is matched
 * (the −590 charge an approved exception). Adjusted book = book closing − book opening at the start
 * (0 on 1 Jun) + statement opening at the start (0) − uncleared book entries + bank-only items.
 *   June:  book −1,13,250                         = statement −1,13,250
 *   July:  book 10,72,850                         = statement −1,13,250 + 11,86,100 = 10,72,850
 *   Aug:   book 14,16,127.77 + bank-only −590     = statement 10,72,850 + 3,42,687.77 = 14,15,537.77
 *          (entering the book figure 14,16,127.77 leaves 590 unexplained)
 *   Sept:  book 14,04,127.77 − uncleared −12,000 − 590 = 14,15,537.77, the statement unchanged (no September lines).
 *          Uncleared entries: challans −12,000, −5,000, +5,000, and the 8.5b spec's own test challan −3,000
 *          with its reversal +3,000 (both 10 Sep) — five entries netting −12,000.
 */
export const BANK_RECONCILIATION_STATEMENTS = {
  june: { statementClosingBalance: '-113250.00', bookClosingBalance: '-113250.00', unclearedBookAmount: '0.00', bankOnlyAmount: '0.00', adjustedBookBalance: '-113250.00' },
  july: { statementClosingBalance: '1072850.00', bookClosingBalance: '1072850.00', unclearedBookAmount: '0.00', bankOnlyAmount: '0.00', adjustedBookBalance: '1072850.00' },
  august: { statementClosingBalance: '1415537.77', bookClosingBalance: '1416127.77', unclearedBookAmount: '0.00', bankOnlyAmount: '-590.00', exceptionAmount: '-590.00', adjustedBookBalance: '1415537.77', statementLinesTotal: '342687.77' },
  september: { statementClosingBalance: '1415537.77', bookClosingBalance: '1404127.77', unclearedBookAmount: '-12000.00', unclearedBookCount: 5, bankOnlyAmount: '-590.00', adjustedBookBalance: '1415537.77' },
};

/** Cash Flow for HDFC, 1 Jun – 30 Sep 2026 (gross debits in, credits out). September includes the 8.5b spec's test challan of 3,000 and its reversal. */
export const CASH_FLOW_JUN_SEP = {
  dateFrom: '2026-06-01',
  asOfDate: '2026-09-30',
  months: [
    { month: '2026-06', opening: '0.00', inflow: '0.00', outflow: '113250.00', closing: '-113250.00', matchedInflow: '0.00', matchedOutflow: '113250.00' },
    { month: '2026-07', opening: '-113250.00', inflow: '1231500.00', outflow: '45400.00', closing: '1072850.00', matchedInflow: '1231500.00', matchedOutflow: '45400.00' },
    { month: '2026-08', opening: '1072850.00', inflow: '833833.32', outflow: '490555.55', closing: '1416127.77', matchedInflow: '833833.32', matchedOutflow: '490555.55' },
    { month: '2026-09', opening: '1416127.77', inflow: '8000.00', outflow: '20000.00', closing: '1404127.77', matchedInflow: '0.00', matchedOutflow: '0.00' },
  ],
  totals: { opening: '0.00', inflow: '2073333.32', outflow: '669205.55', closing: '1404127.77' },
  byCategory: [
    ['CLIENT_RECEIPT', '1835333.32'],
    ['DEDUCTION_RELEASE', '30000.00'],
    ['VENDOR_PAYMENT', '-104400.00'],
    ['DIRECT_EXPENSE', '-40650.00'],
    ['REIMBURSEMENT', '-11800.00'],
    ['INTRODUCER_PAYMENT', '-27000.00'],
    ['SALARY_PAYMENT', '-263555.55'],
    ['TAX_DEPOSIT', '-13800.00'],
  ],
};

/**
 * Payables Aging as of 31 Aug 2026 (age = days from the document date; vendor
 * bills carry no due date):
 *   STK-000001  direct stock receipt 20 May, 10 × 2,800 = 28,000     — 11+30+31+31 = 103 days → 90+
 *   PHT-77      20 Jun, 4 × 15,000 + IGST 10,800 = 70,800            — 10+31+31 = 72 days → 61–90
 *   AN-1003     10 Aug, 4 × 2,500 + CGST/SGST 1,800 = 11,800          — 21 days → 0–30
 *   AN-1001     1,06,200, settled 5 Jun by 1,04,400 cash + 1,800 TDS  — nothing outstanding
 *   AN-1002     never approved                                        — not a payable
 * Total 1,10,600 = Accounts Payable −1,10,600 (LEDGER_BALANCES).
 * On 1 Jun AN-1001 was still unpaid (the payment is dated 5 Jun) and on an
 * approved request: 1,06,200 + 28,000 = 1,34,200, of which 1,06,200 approved.
 */
export const PAYABLES_AGING = {
  aug31: {
    rows: [
      { number: 'STK-000001', documentType: 'STOCK_RECEIPT', vendorName: 'Ahmedabad Networks Pvt Ltd', outstandingAmount: '28000.00', ageDays: 103, bucket: 'DAYS_90_PLUS' },
      { number: 'PHT-77', documentType: 'VENDOR_BILL', vendorName: 'Pune Hardware Traders', outstandingAmount: '70800.00', ageDays: 72, bucket: 'DAYS_61_90' },
      { number: 'AN-1003', documentType: 'VENDOR_BILL', vendorName: 'Ahmedabad Networks Pvt Ltd', outstandingAmount: '11800.00', ageDays: 21, bucket: 'DAYS_0_30' },
    ],
    total: '110600.00',
    approvedForPaymentTotal: '0.00',
    vendors: [
      ['Ahmedabad Networks Pvt Ltd', '39800.00'],
      ['Pune Hardware Traders', '70800.00'],
    ],
  },
  jun1: { total: '134200.00', approvedForPaymentTotal: '106200.00', numbers: ['AN-1001', 'STK-000001'] },
};

/** Vendor Payments, June 2026: AN-PAY-0605 — 1,04,400 cash + 1,800 TDS settles AN-1001's 1,06,200. */
export const VENDOR_PAYMENTS_JUNE = {
  dateFrom: '2026-06-01',
  asOfDate: '2026-06-30',
  totals: { cashPaid: '104400.00', deductions: { TDS: '1800.00', CGST_TDS: '0.00', SGST_TDS: '0.00', IGST_TDS: '0.00' }, settledAmount: '106200.00' },
};

/**
 * Expenses, all dates. Recognized = gross − input GST posted as recoverable.
 *   AN-1001 switches     47,200 gross, 7,200 eligible  → 40,000  Hardware  P1 (the stock line is inventory, not expense)
 *   PHT-77 tablets       70,800 gross, ineligible      → 70,800  Hardware  P3
 *   Survey equipment     11,800 gross, 1,800 eligible  → 10,000  Hardware  P4
 *   Printing             8,850 gross, ineligible       →  8,850  Office    P1
 *   Office rent          20,000 no GST                 → 20,000  Office    none
 *   Travel claim         11,800 gross, 1,800 credit    → 10,000  Travel    P3
 *   Local conveyance      2,450 no GST                 →  2,450  Travel    P1
 * Gross 1,72,900; eligible GST 10,800; recognized 1,62,100.
 */
export const EXPENSES_ALL_TIME = {
  totals: { grossAmount: '172900.00', eligibleGst: '10800.00', recognizedAmount: '162100.00' },
  byCategory: [
    ['Hardware & Equipment', '120800.00'],
    ['Office & Admin', '28850.00'],
    ['Travel', '12450.00'],
  ],
  byProject: [
    ['GIL e-Governance Portal', '51300.00'],
    ['MahaIT Citizen Services App', '80800.00'],
    ['RSCL Smart Parking', '10000.00'],
    ['Not assigned to a project', '20000.00'],
  ],
  // P1 only: switches 40,000 + printing 8,850 + conveyance 2,450
  p1Recognized: '51300.00',
};

/**
 * Reimbursements, July 2026 (Asha Patel's claims; approval posts on the expense date):
 *   Travel to Mumbai 11,800 — approved 8 Jul, reimbursed 15 Jul
 *   Local conveyance  2,450 — approved 18 Jul, still awaiting payment
 *   Parking receipts    500 — a draft, never submitted: not listed
 */
export const REIMBURSEMENTS_JULY = {
  dateFrom: '2026-07-01',
  asOfDate: '2026-07-31',
  totals: {
    approvedInPeriod: { count: 2, amount: '14250.00' },
    reimbursedInPeriod: { count: 1, amount: '11800.00' },
    awaitingReimbursement: { count: 1, amount: '2450.00' },
    awaitingApproval: { count: 0, amount: '0.00' },
    rejected: { count: 0, amount: '0.00' },
  },
  statuses: [
    ['Travel to Mumbai client site', 'REIMBURSED', '2026-07-08', '2026-07-15'],
    ['Local conveyance', 'APPROVED', '2026-07-18', null],
  ],
};

/**
 * Employee Advances. Asha Patel: claims approved 14,250 (credit), reimbursed
 * 11,800 (debit) → closing −2,450 — the company owes her 2,450.
 * The spec then gives Neha Desai a 5,000 advance on 5 Oct; October shows
 * Asha's −2,450 as opening and closing, Neha 0 → 5,000; total 2,550.
 */
export const EMPLOYEE_ADVANCES = {
  allTime: [{ employeeName: 'Asha Patel', opening: '0.00', advances: '0.00', claimsAdjusted: '14250.00', reimbursements: '11800.00', other: '0.00', closing: '-2450.00' }],
  october: {
    rows: [
      { employeeName: 'Asha Patel', opening: '-2450.00', advances: '0.00', claimsAdjusted: '0.00', reimbursements: '0.00', other: '0.00', closing: '-2450.00' },
      { employeeName: 'Neha Desai', opening: '0.00', advances: '5000.00', claimsAdjusted: '0.00', reimbursements: '0.00', other: '0.00', closing: '5000.00' },
    ],
    closing: '2550.00',
  },
};

/**
 * Payment Holds. R1 (10 Jul) withheld on INV1: hold 20,000 and retention 25,000.
 *   Hold released 12,000 on 1 Aug and 8,000 on 20 Aug → released in full.
 *   Retention released 10,000 on 25 Aug → 15,000 still to recover.
 * On 10 Aug only the first hold release had happened: hold 8,000, retention 25,000.
 */
export const PAYMENT_HOLDS = {
  aug31: [
    { type: 'HOLD', amount: '20000.00', releasedAmount: '20000.00', outstandingAmount: '0.00', status: 'RELEASED', lastReleasedOn: '2026-08-20', releases: [['2026-08-01', '12000.00'], ['2026-08-20', '8000.00']] },
    { type: 'RETENTION', amount: '25000.00', releasedAmount: '10000.00', outstandingAmount: '15000.00', status: 'PARTIALLY_RELEASED', lastReleasedOn: '2026-08-25', releases: [['2026-08-25', '10000.00']] },
  ],
  aug10: [
    ['HOLD', '12000.00', '8000.00', 'PARTIALLY_RELEASED'],
    ['RETENTION', '0.00', '25000.00', 'OUTSTANDING'],
  ],
};

/**
 * Penalties (category Liquidated Damages, both on P1):
 *   R1 10 Jul, INV1 — accepted 7,500 "Delay in design sign-off" → Penalty — Revenue Deduction
 *   R3 18 Aug, INV2 — disputed 3,000 "Client claims SLA breach" → Disputed Deduction Receivable
 * July alone holds only the accepted one.
 */
export const PENALTIES = {
  allTime: [
    ['2026-07-10', 'ACCEPTED', '7500.00', 'Penalty — Revenue Deduction'],
    ['2026-08-18', 'DISPUTED', '3000.00', 'Disputed Deduction Receivable'],
  ],
  totals: { accepted: '7500.00', disputed: '3000.00', acceptedCount: 1, disputedCount: 1 },
  byCategory: [{ categoryName: 'Liquidated Damages', accepted: '7500.00', disputed: '3000.00' }],
};

/**
 * Introducer Statement — Mehul Consultancy on P1 (2.5% of project value 20,00,000 = 50,000 entitlement):
 *   20 Jun accrual 20,000 → 20,000
 *    5 Aug accrual 15,000 → 35,000
 *   25 Aug payment 30,000 allocated (20,000 + 10,000; TDS 3,000, net 27,000, no advance) → 5,000
 * Accrued to date 35,000, not yet accrued 15,000. Closing 5,000 = Introducer Payable −5,000.
 * August alone: opening 20,000 + 15,000 − 30,000 = 5,000.
 */
export const INTRODUCER_STATEMENT = {
  allTime: {
    account: { introducerName: 'Mehul Consultancy', projectName: 'GIL e-Governance Portal', basisDescription: '2.5% of project value', entitlement: '50000.00', accruedToDate: '35000.00', notYetAccrued: '15000.00', opening: '0.00', accrued: '35000.00', paid: '30000.00', closing: '5000.00' },
    lines: [
      ['2026-06-20', 'ACCRUAL', '20000.00', '0.00', '20000.00'],
      ['2026-08-05', 'ACCRUAL', '15000.00', '0.00', '35000.00'],
      ['2026-08-25', 'PAYMENT', '0.00', '30000.00', '5000.00'],
    ],
    payment: { entryType: 'PAYMENT', ledgerDate: '2026-08-25', referenceNumber: 'INTRO-NEFT-0825', allocatedAmount: '30000.00', grossAmount: '30000.00', advanceAmount: '0.00', tdsAmount: '3000.00', netAmount: '27000.00' },
  },
  august: { opening: '20000.00', accrued: '15000.00', paid: '30000.00', closing: '5000.00', lineCount: 2 },
};

/**
 * EMD/SD Recovery — instruments the 8.8a spec lodges in October:
 *   A  EMD, demand draft (cash) 50,000 on P5, submitted 1 Oct, due 15 Oct, returned 20 Oct
 *   B  SD, demand draft (cash)  80,000 on P3, submitted 2 Oct, due 31 Dec
 *   C  EMD, bank guarantee    1,00,000 on P4, submitted 3 Oct, due 10 Oct (never posted: contingent)
 * On 31 Oct: C overdue 21 days, A returned, B lodged → cash 80,000, guarantees 1,00,000, returned 50,000.
 * On 17 Oct: C overdue 7 days, A overdue 2 days, B lodged → cash 1,30,000; overdue 2 items, 1,50,000.
 */
export const EMD_SD = {
  oct31: {
    rows: [
      ['C', 'EMD', 'GUARANTEE', 'OVERDUE', '100000.00', 21],
      ['A', 'EMD', 'CASH', 'RETURNED', '0.00', null],
      ['B', 'SD', 'CASH', 'LODGED', '80000.00', null],
    ],
    totals: { cashOutstanding: '80000.00', guaranteeOutstanding: '100000.00', returned: '50000.00', overdueCount: 1, overdueAmount: '100000.00' },
    byCategory: [
      { category: 'EMD', count: 2, cashOutstanding: '0.00', guaranteeOutstanding: '100000.00', returned: '50000.00' },
      { category: 'SD', count: 1, cashOutstanding: '80000.00', guaranteeOutstanding: '0.00', returned: '0.00' },
    ],
  },
  oct17: { statuses: [['C', 'OVERDUE', 7], ['A', 'OVERDUE', 2], ['B', 'LODGED', null]], cashOutstanding: '130000.00', overdueCount: 2, overdueAmount: '150000.00' },
};

/**
 * Pending Invoices on 31 Aug — the Receivable Aging invoices (RECEIVABLE_AGING_AUG_31):
 * INV10 is unpaid, the other four part paid. Overdue (past due): 1,84,000 + 20,209.86 + 77,000 + 1,56,000 = 4,37,209.86.
 * Billing pending: INV8 was voided, which reopened its alert — P4 "Installation", 6,00,000 before GST, due 31 Aug.
 * And P2 AMC installment 3 (1,00,000, planned 30 Aug): only installments 1–2 are invoiced, and its
 * alert opened when the schedule was created, 30 Aug less the 3-day reminder being past on the
 * scenario's 15 Sep. Installments 4 onward and P3 Go-live are planned 30 Sep, so not yet open.
 * Total 7,00,000.
 */
export const PENDING_INVOICES_AUG_31 = {
  invoices: [
    ['INV5', 'PARTIALLY_SETTLED'],
    ['INV2', 'PARTIALLY_SETTLED'],
    ['INV7', 'PARTIALLY_SETTLED'],
    ['INV6', 'PARTIALLY_SETTLED'],
    ['INV10', 'UNSETTLED'],
  ] as Array<[InvoiceKey, string]>,
  invoiceTotal: '453598.74',
  overdueTotal: '437209.86',
  billingPending: [
    { projectName: 'GIL Data Centre AMC', sourceType: 'OPEX_INSTALLMENT', sourceLabel: 'Installment 3 (2026-08-01 – 2026-08-31)', amount: '100000.00', dueDate: '2026-08-30', alertStatus: 'OPEN' },
    { projectName: 'RSCL Smart Parking', sourceType: 'CAPEX_EVENT', sourceLabel: 'Installation', amount: '600000.00', dueDate: '2026-08-31', alertStatus: 'OPEN' },
  ],
  billingPendingTotal: '700000.00',
};

/**
 * Client Payments, 1 Jun – 31 Aug (receipt journal dates; R5 and its reversal both in the period):
 *   R4  5 Jul MAHA-UTR-0705  5,00,000 → settled 5,24,000
 *   R1 10 Jul GIL-UTR-0710   6,31,500 → settled 7,08,000
 *   R2 20 Jul GIL-UTR-0720   1,00,000 → settled 1,02,469.14
 *   R5 10 Aug MAHA-CHQ-0810  2,00,000, reversed 12 Aug −2,00,000
 *   R3 18 Aug GIL-UTR-0818   1,38,000 → settled 1,41,000
 *   R6 28 Aug RSCL-UTR-0828  1,50,000 → settled 1,59,000
 *   R7 31 Aug MAHA-UTR-0831  3,15,833.32 → settled 3,32,388.88
 * Cash 18,35,333.32 + deductions 1,31,524.70 = settled 19,66,858.02.
 * By client: Gujarat 8,69,500 + 81,969.14 = 9,51,469.14; Maharashtra 8,15,833.32 + 40,555.56 = 8,56,388.88; Rajasthan 1,50,000 + 9,000 = 1,59,000.
 */
export const CLIENT_PAYMENTS_JUN_AUG = {
  dateFrom: '2026-06-01',
  asOfDate: '2026-08-31',
  rows: [
    ['2026-07-05', 'RECEIPT', 'MAHA-UTR-0705', '500000.00', '524000.00'],
    ['2026-07-10', 'RECEIPT', 'GIL-UTR-0710', '631500.00', '708000.00'],
    ['2026-07-20', 'RECEIPT', 'GIL-UTR-0720', '100000.00', '102469.14'],
    ['2026-08-10', 'RECEIPT', 'MAHA-CHQ-0810', '200000.00', '200000.00'],
    ['2026-08-12', 'REVERSAL', 'MAHA-CHQ-0810', '-200000.00', '-200000.00'],
    ['2026-08-18', 'RECEIPT', 'GIL-UTR-0818', '138000.00', '141000.00'],
    ['2026-08-28', 'RECEIPT', 'RSCL-UTR-0828', '150000.00', '159000.00'],
    ['2026-08-31', 'RECEIPT', 'MAHA-UTR-0831', '315833.32', '332388.88'],
  ],
  totals: {
    actualAmount: '1835333.32',
    invoiceSettled: '1966858.02',
    deductions: { TDS: '38746.92', CGST_TDS: '6000.00', SGST_TDS: '6000.00', IGST_TDS: '24277.78', HOLD: '20000.00', RETENTION: '25000.00', ACCEPTED_PENALTY: '7500.00', DISPUTED_PENALTY: '3000.00', OTHER: '1000.00' },
    deductionTotal: '131524.70',
    unallocatedCash: '0.00',
  },
  byClient: [
    { clientName: 'Gujarat Informatics Ltd', actualAmount: '869500.00', invoiceSettled: '951469.14', deductionTotal: '81969.14' },
    { clientName: 'Maharashtra IT Department', actualAmount: '815833.32', invoiceSettled: '856388.88', deductionTotal: '40555.56' },
    { clientName: 'Rajasthan Smart City Ltd', actualAmount: '150000.00', invoiceSettled: '159000.00', deductionTotal: '9000.00' },
  ],
};

/**
 * Manpower Utilization, July–August (see MANPOWER and SALARY for the splits):
 *   July    Asha 100/0 90,000 · Karan 100/0 55,555.55 · Neha 100/0 60,000 · Ravi 80/20 75,000 → 60,000 / 15,000
 *   August  Asha 100/0 90,000 · Karan DRAFT (P1 100) 55,555.55 not attributed · Neha 70/30 60,000 → 42,000 / 18,000 · Ravi 100/0 81,000
 * July gross 2,80,555.55 = project 2,65,555.55 + non-project 15,000.
 * August gross 2,86,555.55 = project 2,13,000 + non-project 18,000 + Karan's draft 55,555.55.
 * P3 only: July Asha 40% 36,000, Karan 33.34% 18,522.23, Neha 100% 60,000; August Neha 70% 42,000.
 */
export const MANPOWER_UTILIZATION_JUL_AUG = {
  rows: [
    ['2026-07-01', 'Asha Patel', 'SUBMITTED', '100.0000', '0.0000', '0.0000', '90000.00', '90000.00', '0.00'],
    ['2026-07-01', 'Karan Mehta', 'SUBMITTED', '100.0000', '0.0000', '0.0000', '55555.55', '55555.55', '0.00'],
    ['2026-07-01', 'Neha Desai', 'SUBMITTED', '100.0000', '0.0000', '0.0000', '60000.00', '60000.00', '0.00'],
    ['2026-07-01', 'Ravi Shah', 'SUBMITTED', '80.0000', '20.0000', '0.0000', '75000.00', '60000.00', '15000.00'],
    ['2026-08-01', 'Asha Patel', 'SUBMITTED', '100.0000', '0.0000', '0.0000', '90000.00', '90000.00', '0.00'],
    ['2026-08-01', 'Karan Mehta', 'DRAFT', '100.0000', '0.0000', '0.0000', '55555.55', null, null],
    ['2026-08-01', 'Neha Desai', 'SUBMITTED', '70.0000', '30.0000', '0.0000', '60000.00', '42000.00', '18000.00'],
    ['2026-08-01', 'Ravi Shah', 'SUBMITTED', '100.0000', '0.0000', '0.0000', '81000.00', '81000.00', '0.00'],
  ],
  byMonth: [
    { month: '2026-07-01', employees: 4, submitted: 4, draft: 0, notStarted: 0, grossSalary: '280555.55', projectCost: '265555.55', nonProjectCost: '15000.00', unallocatedSalary: '0.00' },
    { month: '2026-08-01', employees: 4, submitted: 3, draft: 1, notStarted: 0, grossSalary: '286555.55', projectCost: '213000.00', nonProjectCost: '18000.00', unallocatedSalary: '55555.55' },
  ],
  totals: { grossSalary: '567111.10', projectCost: '478555.55', nonProjectCost: '33000.00', unallocatedSalary: '55555.55' },
  p3: [
    ['2026-07-01', 'Asha Patel', '40.0000', '36000.00'],
    ['2026-07-01', 'Karan Mehta', '33.3400', '18522.23'],
    ['2026-07-01', 'Neha Desai', '100.0000', '60000.00'],
    ['2026-08-01', 'Neha Desai', '70.0000', '42000.00'],
  ],
};

/**
 * Dashboard for 1 Jun – 31 Aug 2026 (balances as of 31 Aug) — each figure is the linked report's:
 *   Invoice outstanding 4,53,598.74 and hold/retention 15,000 (RECEIVABLE_AGING_AUG_31)
 *   Past due 4,37,209.86 and billing pending 6,00,000 (PENDING_INVOICES_AUG_31)
 *   Income: all-time 20,03,734.54 − INV1 5,00,000 (25 May) − DN1 10,000 + CN1 50,000 (both dated after August) = 15,43,734.54
 *   Expense: all-time 8,09,411.10 − VB1's 40,000 (5 May) = 7,69,411.10 → contribution 7,74,323.44
 *   Bank 14,16,127.77 (CASH_FLOW_JUN_SEP, August closing)
 *   TDS to deposit on 31 Aug: salary 17,000 (5 Aug) + introducer 3,000 (25 Aug); the vendor's 1,800 was deposited 7 Jul → 20,000
 *   Owed to vendors 1,10,600 (PAYABLES_AGING); expenses June–August 70,800 + 10,000 + 8,850 + 20,000 + 10,000 + 2,450 = 1,22,100
 *   EMD/SD cash 0 — the spec's instruments are lodged in October
 * Attention: the four past-due invoices, most overdue first, then INV8's reopened Installation milestone due 31 Aug.
 */
export const DASHBOARD_JUN_AUG = {
  dateFrom: '2026-06-01',
  asOfDate: '2026-08-31',
  cards: {
    INVOICE_OUTSTANDING: '453598.74',
    HOLD_RETENTION: '15000.00',
    PAST_DUE: '437209.86',
    BILLING_PENDING: '700000.00',
    INCOME: '1543734.54',
    CONTRIBUTION: '774323.44',
    BANK_BALANCE: '1416127.77',
    TDS_PAYABLE: '20000.00',
    OWED_TO_VENDORS: '110600.00',
    EXPENSES: '122100.00',
    EMD_SD_CASH: '0.00',
  },
  cashTrend: [
    { month: '2026-06', inflow: '0.00', outflow: '113250.00' },
    { month: '2026-07', inflow: '1231500.00', outflow: '45400.00' },
    { month: '2026-08', inflow: '833833.32', outflow: '490555.55' },
  ],
  attention: [
    ['OVERDUE_INVOICE', '184000.00', '2026-07-15'],
    ['OVERDUE_INVOICE', '20209.86', '2026-07-28'],
    ['OVERDUE_INVOICE', '77000.00', '2026-08-14'],
    ['OVERDUE_INVOICE', '156000.00', '2026-08-24'],
    ['BILLING_DUE', '100000.00', '2026-08-30'],
    ['BILLING_DUE', '600000.00', '2026-08-31'],
  ],
};

/**
 * Exceptions at the end of the scenario (as of 2099-12-31, after every spec above has run):
 *   Ledger checks: all ten balance reports agree with the ledger.
 *   Bank: every June–September statement line is matched or an approved exception; June is locked and
 *         July–September reconciled (8.6b) → nothing open.
 *   TDS: 13 certificate/26AS exceptions (TDS_RECONCILIATION_ALL_TIME) + the 26AS credit 26AS-RSCL-0828 (4,000) the
 *        8.5a CSV test imports and never matches = 14; Neha 3,000 + Ravi 5,000 withheld and
 *        past the 7 Sep due date (TDS_OUTWARD_ALL_TIME) → 2 items, 8,000.
 *   Approvals: AN-1002 submitted, never approved — 25,000 + CGST/SGST 4,500 = 29,500. No payment request or claim waiting.
 *   Billing: INV8's reopened Installation milestone, 6,00,000 due 31 Aug (a draft exists, not finalized).
 *   Allocations: Karan Mehta's August left in draft — 55,555.55 of posted salary unallocated.
 * Open: TDS exceptions, TDS overdue, vendor bill, billing, salary = 5.
 */
export const EXCEPTIONS_END = {
  items: {
    UNMATCHED_STATEMENT_LINES: { count: 0, amount: '0.00', oldestDate: null },
    EXCEPTIONS_AWAITING_APPROVAL: { count: 0, amount: '0.00', oldestDate: null },
    MONTHS_NOT_RECONCILED: { count: 0, amount: null, oldestDate: null },
    TDS_RECONCILIATION_EXCEPTIONS: { count: 14, amount: null, oldestDate: null },
    TDS_DEPOSITS_OVERDUE: { count: 2, amount: '8000.00', oldestDate: '2026-09-07' },
    VENDOR_BILLS_AWAITING_APPROVAL: { count: 1, amount: '29500.00' },
    PAYMENT_REQUESTS_AWAITING_APPROVAL: { count: 0, amount: '0.00', oldestDate: null },
    EXPENSE_CLAIMS_AWAITING_APPROVAL: { count: 0, amount: '0.00', oldestDate: null },
    BILLING_OVERDUE: { count: 2, amount: '700000.00', oldestDate: '2026-08-30' },
    SALARY_NOT_ALLOCATED: { count: 1, amount: '55555.55', oldestDate: '2026-08-01' },
  } as Record<string, { count: number; amount: string | null; oldestDate?: string | null }>,
  ledgerCheckCount: 10,
  openCount: 5,
};
