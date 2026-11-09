# Money-flow scenario — expected numbers

Log in at http://localhost:7400 as `maker@zitaware.test` (maker) or `checker@zitaware.test` (checker), password `MoneyFlow@2026`.

Every figure in the scenario sections below is also asserted, to the paisa, by `apps/api/src/testing/money-flow-scenario/money-flow.integration-spec.ts`.

The demo organization also carries the **demo extras** (last section): the modules the scenario does not build, loaded only here. Every extra is dated 1 September 2026 or later, so the scenario figures above are unchanged — except the six ledger balances the extras section lists.

## Projects → Financials tab

|  | GIL e-Governance Portal | GIL Data Centre AMC | MahaIT Citizen Services App | RSCL Smart Parking | RSCL Command Centre |
|---|---:|---:|---:|---:|---:|
| Contract value (excl. GST) | 20,00,000.00 | 12,00,000.00 | 20,00,000.00 | 8,00,000.00 | 5,00,000.00 |
| Gross invoice value | 7,35,679.00 | 2,36,000.00 | 12,12,777.76 | 2,36,000.00 | 0.00 |
| Debit notes | 11,800.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Credit notes | 0.00 | 0.00 | 59,000.00 | 0.00 | 0.00 |
| Net billed | 7,47,479.00 | 2,36,000.00 | 11,53,777.76 | 2,36,000.00 | 0.00 |
| Cash received | 6,37,500.00 | 2,32,000.00 | 8,15,833.32 | 1,50,000.00 | 0.00 |
| TDS deducted | 12,469.14 | 2,000.00 | 20,277.78 | 4,000.00 | 0.00 |
| GST-TDS deducted | 10,000.00 | 2,000.00 | 20,277.78 | 4,000.00 | 0.00 |
| Retention held | 25,000.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Hold | 20,000.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Penalty / write-off | 10,500.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Other deductions | 0.00 | 0.00 | 0.00 | 1,000.00 | 0.00 |
| Total settled | 7,15,469.14 | 2,36,000.00 | 8,56,388.88 | 1,59,000.00 | 0.00 |
| Invoice outstanding | 32,009.86 | 0.00 | 2,97,388.88 | 77,000.00 | 0.00 |
| Unreleased retention + hold | 15,000.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Client receivable | 47,009.86 | 0.00 | 2,97,388.88 | 77,000.00 | 0.00 |
| Purchase expense | 40,000.00 | 0.00 | 70,800.00 | 0.00 | 0.00 |
| Employee claims | 2,450.00 | 0.00 | 10,000.00 | 0.00 | 0.00 |
| Direct expense | 8,850.00 | 0.00 | 0.00 | 10,000.00 | 0.00 |
| Material | 31,200.00 | 0.00 | 0.00 | 13,000.00 | 0.00 |
| Manpower | 2,00,016.66 | 63,000.00 | 1,56,522.23 | 59,016.66 | 0.00 |
| Introducer | 35,000.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Recognized project expense | 3,17,516.66 | 63,000.00 | 2,37,322.23 | 82,016.66 | 0.00 |

## Clients → Financials

|  | Gujarat Informatics Ltd | Maharashtra IT Department | Rajasthan Smart City Ltd |
|---|---:|---:|---:|
| Projects | 2 | 1 | 2 |
| Total contract value | 32,00,000.00 | 20,00,000.00 | 13,00,000.00 |
| Gross invoice value | 9,71,679.00 | 12,12,777.76 | 2,36,000.00 |
| Debit notes | 11,800.00 | 0.00 | 0.00 |
| Credit notes | 0.00 | 59,000.00 | 0.00 |
| Net billed | 9,83,479.00 | 11,53,777.76 | 2,36,000.00 |
| Cash received | 8,69,500.00 | 8,15,833.32 | 1,50,000.00 |
| TDS deducted | 14,469.14 | 20,277.78 | 4,000.00 |
| GST-TDS deducted | 12,000.00 | 20,277.78 | 4,000.00 |
| Retention held | 25,000.00 | 0.00 | 0.00 |
| Hold | 20,000.00 | 0.00 | 0.00 |
| Penalty / write-off | 10,500.00 | 0.00 | 0.00 |
| Other deductions | 0.00 | 0.00 | 1,000.00 |
| Total settled | 9,51,469.14 | 8,56,388.88 | 1,59,000.00 |
| Invoice outstanding | 32,009.86 | 2,97,388.88 | 77,000.00 |
| Unreleased retention + hold | 15,000.00 | 0.00 | 0.00 |
| Client receivable | 47,009.86 | 2,97,388.88 | 77,000.00 |
| Purchase expense | 40,000.00 | 70,800.00 | 0.00 |
| Employee claims | 2,450.00 | 10,000.00 | 0.00 |
| Direct expense | 8,850.00 | 0.00 | 10,000.00 |
| Material | 31,200.00 | 0.00 | 13,000.00 |
| Manpower | 2,63,016.66 | 1,56,522.23 | 59,016.66 |
| Introducer | 35,000.00 | 0.00 | 0.00 |
| Recognized project expense | 3,80,516.66 | 2,37,322.23 | 82,016.66 |

## Projects → Spend tab (document totals, GST included)

|  | GIL e-Governance Portal | GIL Data Centre AMC | MahaIT Citizen Services App | RSCL Smart Parking | RSCL Command Centre |
|---|---:|---:|---:|---:|---:|
| PURCHASE | 47,200.00 | 0.00 | 70,800.00 | 0.00 | 0.00 |
| REIMBURSEMENT | 2,450.00 | 0.00 | 11,800.00 | 0.00 | 0.00 |
| DIRECT_EXPENSE | 8,850.00 | 0.00 | 0.00 | 11,800.00 | 0.00 |
| MATERIAL | 31,200.00 | 0.00 | 0.00 | 13,000.00 | 0.00 |
| MANPOWER | 2,00,016.66 | 63,000.00 | 1,56,522.23 | 59,016.66 | 0.00 |
| INTRODUCER | 35,000.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Total | 3,24,716.66 | 63,000.00 | 2,39,122.23 | 83,816.66 | 0.00 |

## Projects → Milestones (CAPEX and OPEX)

|  | GIL e-Governance Portal | GIL Data Centre AMC | MahaIT Citizen Services App | RSCL Smart Parking | RSCL Command Centre |
|---|---:|---:|---:|---:|---:|
| CAPEX pool | 20,00,000.00 | 0.00 | 15,00,000.00 | 8,00,000.00 | 0.00 |
| OPEX pool | 0.00 | 12,00,000.00 | 5,00,000.00 | 0.00 | 0.00 |

| OPEX schedule | Installments | Each | Last | Total | First period / invoice | Last period / invoice | Billing |
|---|---:|---:|---:|---:|---:|---:|---:|
| GIL Data Centre AMC — Data centre AMC | 12 | 1,00,000.00 | 1,00,000.00 | 12,00,000.00 | 2026-06-01 – 2026-06-30 / 2026-06-30 | 2027-05-01 – 2027-05-31 / 2027-05-30 | Partly invoiced — 2 of 12 |
| MahaIT Citizen Services App — O&M support | 36 | 13,888.88 | 13,889.20 | 5,00,000.00 | 2026-07-01 – 2026-07-31 / 2026-07-31 | 2029-06-01 – 2029-06-30 / 2029-06-30 | Partly invoiced — 2 of 36 |

| CAPEX event | Project | Billing | Invoice |
|---|---:|---:|---:|
| Design sign-off | GIL e-Governance Portal | Invoiced | INV1 |
| UAT | GIL e-Governance Portal | Invoiced | INV2 |
| Go-live | GIL e-Governance Portal | Not invoiced | — |
| Phase 1 | MahaIT Citizen Services App | Invoiced | INV5 |
| Phase 2 | MahaIT Citizen Services App | Invoiced | INV6 |
| Phase 3 | MahaIT Citizen Services App | Not invoiced | — |
| Survey | RSCL Smart Parking | Invoiced | INV7 |
| Installation | RSCL Smart Parking | Not invoiced | — |

## Invoices and notes

| Document | Project | Taxable | CGST | SGST | IGST | Total | Status |
|---|---:|---:|---:|---:|---:|---:|---:|
| INV1 | GIL e-Governance Portal | 5,00,000.00 | 45,000.00 | 45,000.00 | 0.00 | 5,90,000.00 | FINALIZED |
| INV2 | GIL e-Governance Portal | 1,23,456.78 | 11,111.11 | 11,111.11 | 0.00 | 1,45,679.00 | FINALIZED |
| INV3 | GIL Data Centre AMC | 1,00,000.00 | 9,000.00 | 9,000.00 | 0.00 | 1,18,000.00 | FINALIZED |
| INV4 | GIL Data Centre AMC | 1,00,000.00 | 9,000.00 | 9,000.00 | 0.00 | 1,18,000.00 | FINALIZED |
| INV5 | MahaIT Citizen Services App | 6,00,000.00 | 0.00 | 0.00 | 1,08,000.00 | 7,08,000.00 | FINALIZED |
| INV6 | MahaIT Citizen Services App | 4,00,000.00 | 0.00 | 0.00 | 72,000.00 | 4,72,000.00 | FINALIZED |
| INV7 | RSCL Smart Parking | 2,00,000.00 | 0.00 | 0.00 | 36,000.00 | 2,36,000.00 | FINALIZED |
| INV8 | RSCL Smart Parking | 6,00,000.00 | 0.00 | 0.00 | 1,08,000.00 | 7,08,000.00 | VOID |
| INV9 | MahaIT Citizen Services App | 13,888.88 | 0.00 | 0.00 | 2,500.00 | 16,388.88 | FINALIZED |
| INV10 | MahaIT Citizen Services App | 13,888.88 | 0.00 | 0.00 | 2,500.00 | 16,388.88 | FINALIZED |
| DN1 (debit note on INV2) |  | 10,000.00 | 900.00 | 900.00 | 0.00 | 11,800.00 | FINALIZED |
| CN1 (credit note on INV5) |  | 50,000.00 | 0.00 | 0.00 | 9,000.00 | 59,000.00 | FINALIZED |

## Employee Costing → Salary Imports

| Month | Employees | Gross total |
|---|---:|---:|
| July 2026 | 4 | 2,80,555.55 |
| August 2026 | 4 | 2,86,555.55 |

July payment: gross 2,80,555.55, TDS 17,000.00, net 2,63,555.55. August is unpaid.

## Employee Costing → Monthly Allocation → Manpower cost (Jul–Aug 2026)

| Month | Project | Employees | Total % | Cost |
|---|---:|---:|---:|---:|
| 2026-07 | GIL e-Governance Portal | 3 | 143.3300 | 1,10,016.66 |
| 2026-07 | GIL Data Centre AMC | 1 | 30.0000 | 22,500.00 |
| 2026-07 | MahaIT Citizen Services App | 3 | 173.3400 | 1,14,522.23 |
| 2026-07 | RSCL Smart Parking | 1 | 33.3300 | 18,516.66 |
| 2026-08 | GIL e-Governance Portal | 1 | 100.0000 | 90,000.00 |
| 2026-08 | GIL Data Centre AMC | 1 | 50.0000 | 40,500.00 |
| 2026-08 | MahaIT Citizen Services App | 1 | 70.0000 | 42,000.00 |
| 2026-08 | RSCL Smart Parking | 1 | 50.0000 | 40,500.00 |

Total 4,78,555.55; 1 draft employee-month excluded (Karan Mehta, August).

Karan Mehta, July (the rounding case — gross 55,555.55):

| Project | % | Allocated | Carries the paisa |
|---|---:|---:|---:|
| GIL e-Governance Portal | 33.3300 | 18,516.66 |  |
| RSCL Smart Parking | 33.3300 | 18,516.66 |  |
| MahaIT Citizen Services App | 33.3400 | 18,522.23 | yes |

## Inventory → Stock

Cat6 Cable Box: 17.0000 in stock, value 43,800.00, weighted average 2576.4706.

## Chart of accounts → ledger balances (debit +, credit −)

Scenario balances. The six the demo extras move are restated in the next section.

| Ledger | Balance |
|---|---:|
| ACCOUNTS_RECEIVABLE | 4,06,398.74 |
| SOFTWARE_PROJECT_REVENUE | −20,11,234.54 |
| OUTPUT_CGST_PAYABLE | −75,011.11 |
| OUTPUT_SGST_PAYABLE | −75,011.11 |
| OUTPUT_IGST_PAYABLE | −2,12,000.00 |
| TDS_RECEIVABLE | 38,746.92 |
| GST_TDS_RECEIVABLE_CGST | 6,000.00 |
| GST_TDS_RECEIVABLE_SGST | 6,000.00 |
| GST_TDS_RECEIVABLE_IGST | 24,277.78 |
| HOLD_RECEIVABLE | 0.00 |
| RETENTION_RECEIVABLE | 15,000.00 |
| PENALTY_REVENUE_DEDUCTION | 7,500.00 |
| DISPUTED_DEDUCTION_RECEIVABLE | 3,000.00 |
| BANK_CHARGES | 1,000.00 |
| INVENTORY | 43,800.00 |
| PROJECT_MATERIAL_COST | 44,200.00 |
| HARDWARE_EXPENSE | 1,20,800.00 |
| OFFICE_EXPENSE | 28,850.00 |
| TRAVEL_EXPENSE | 12,450.00 |
| INPUT_CGST_RECEIVABLE | 9,000.00 |
| INPUT_SGST_RECEIVABLE | 9,000.00 |
| INPUT_IGST_RECEIVABLE | 1,800.00 |
| INPUT_GST_RECEIVABLE_EXPENSE | 1,800.00 |
| ACCOUNTS_PAYABLE_VENDOR | −1,10,600.00 |
| TDS_PAYABLE | −8,000.00 |
| SALARIES_WAGES_EXPENSE | 5,67,111.10 |
| SALARY_PAYABLE | −2,86,555.55 |
| INTRODUCER_COMMISSION_EXPENSE | 35,000.00 |
| INTRODUCER_PAYABLE | −5,000.00 |
| EMPLOYEE_ADVANCE_RECEIVABLE | −2,450.00 |
| BANK_HDFC_CURRENT | 14,04,127.77 |

# Demo extras

These are loaded by `scripts/load-money-flow-demo.ts` only, so that every module has something to look at. The integration spec never sees them.

## What each screen holds

| Module | Contents |
|---|---:|
| Leads | 3 leads — GIL Helpdesk Modernization (tender filled, 15,00,000), MahaIT Phase 2 (proposal sent, 25,00,000), RSCL ANPR (presentation done, 8,00,000), with 4 updates between them. |
| Tenders | 3 tenders — GIL/2026-27/IT/114 submitted (pending), RSCL/SC/2026/08 won, MAHAIT/2026/APP/07 in preparation. |
| EMD / SD | 3 instruments — EMD demand draft 50,000 returned 12 Sep, SD demand draft 80,000 still lodged, EMD bank guarantee 1,00,000 overdue since 10 Sep. |
| Subscriptions | 2 — a monthly plan at 5,000 (first cycle paid 8 Sep) and a yearly plan at 60,000 (first cycle due 15 Nov). |
| Servers | 1 — quarterly hosting at 90,000, first cycle due 10 Oct, shared by two projects. |
| Card Accounts | 2 — a credit card (one 4,720 purchase on 3 Sep, settled in full on 15 Sep) and a debit card. |
| Employee Advances | 1 — 25,000 to Ravi Shah on 10 Sep, unadjusted. |
| Bank Reconciliation | June–August statement imported (23 lines) and auto-matched; June and July clean, August carries the approved −590 bank-only charge; June locked. September is left open. |
| Projects | Team members on four projects and a progress timeline on three (P1 at 70%, P3 at 60%, P4 at 35%). |
| Masters | 11 lists filled — departments, designations, employment types, government body types, client types, lead types, lead sources, tender portals, project types, product categories and document categories. |
| Clients / Vendors | Contacts on all three clients and all three vendors; each client classified by type, each project by project type. |

## Bank movements the extras add (HDFC, September 2026)

| Date | Movement | Amount |
|---|---:|---:|
| 2026-09-02 | EMD demand draft lodged — RSCL Smart Parking | −50,000.00 |
| 2026-09-05 | Security deposit demand draft lodged — GIL e-Governance Portal | −80,000.00 |
| 2026-09-08 | Subscription cycle paid — source control and CI | −5,900.00 |
| 2026-09-10 | Employee advance — Ravi Shah | −25,000.00 |
| 2026-09-12 | EMD demand draft returned in full | 50,000.00 |
| 2026-09-15 | Credit-card statement settled | −4,720.00 |
|  | **Net** | **−1,15,620.00** |

## Ledger balances in the demo organization

| Ledger | Scenario | Extras | Demo |
|---|---:|---:|---:|
| BANK_HDFC_CURRENT | 14,04,127.77 | −1,15,620.00 | 12,88,507.77 |
| OFFICE_EXPENSE | 28,850.00 | 9,720.00 | 38,570.00 |
| INPUT_IGST_RECEIVABLE | 1,800.00 | 900.00 | 2,700.00 |
| EMPLOYEE_ADVANCE_RECEIVABLE | −2,450.00 | 25,000.00 | 22,550.00 |
| EMD_SD_RECOVERABLE | 0.00 | 80,000.00 | 80,000.00 |
| CREDIT_CARD_PAYABLE | 0.00 | 0.00 | 0.00 |

Every other ledger balance is the scenario figure above, unchanged.
