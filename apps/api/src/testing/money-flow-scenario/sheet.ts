import {
  BILLING,
  CLIENT_FIGURES,
  CLIENT_KEYS,
  CLIENTS,
  DOCUMENT_TOTALS,
  LEDGER_BALANCES,
  MANPOWER,
  MILESTONE_POOLS,
  NOTE_TOTALS,
  OPEX_SCHEDULES,
  PROJECT_FIGURES,
  PROJECT_KEYS,
  PROJECTS,
  SALARY,
  SPEND_FIGURES,
  STOCK,
} from './expected';
import { DEMO_EXTRAS_FIGURES } from './demo-extras';

/** Indian digit grouping (12,34,567.89) — how the screens print money. */
function inr(value: string): string {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = '00'] = value.replace('-', '').split('.');
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${negative ? '−' : ''}${rest ? `${rest},${lastThree}` : lastThree}.${fraction.padEnd(2, '0')}`;
}

const SUMMARY_ROWS: Array<[label: string, key: keyof (typeof PROJECT_FIGURES)['P1']]> = [
  ['Contract value (excl. GST)', 'contractValueExclGst'],
  ['Gross invoice value', 'grossInvoiceValue'],
  ['Debit notes', 'debitNoteAdjustments'],
  ['Credit notes', 'creditNoteAdjustments'],
  ['Net billed', 'netBilled'],
  ['Cash received', 'cashReceived'],
  ['TDS deducted', 'tdsDeducted'],
  ['GST-TDS deducted', 'gstTdsDeducted'],
  ['Retention held', 'retentionHeld'],
  ['Hold', 'otherHoldAmount'],
  ['Penalty / write-off', 'penaltyOrWriteOff'],
  ['Other deductions', 'otherDeductions'],
  ['Total settled', 'totalSettled'],
  ['Invoice outstanding', 'invoiceOutstanding'],
  ['Unreleased retention + hold', 'unreleasedRetentionAndHold'],
  ['Client receivable', 'clientReceivable'],
  ['Purchase expense', 'purchaseExpense'],
  ['Employee claims', 'employeeClaimExpense'],
  ['Direct expense', 'directExpense'],
  ['Material', 'materialExpense'],
  ['Manpower', 'manpowerExpense'],
  ['Introducer', 'introducerExpense'],
  ['Recognized project expense', 'recognizedProjectExpense'],
];

/**
 * The expected-numbers sheet for a person clicking through the demo
 * organization. Rendered from the same constants the integration spec
 * asserts, so the sheet and the test cannot disagree.
 */
export function renderExpectedSheet(login: { url: string; makerEmail: string; checkerEmail: string; password: string }): string {
  const out: string[] = [];
  /** Money tables right-align every column but the first; `align: 'left'` is for prose columns. */
  const table = (head: string[], rows: string[][], align: 'right' | 'left' = 'right') => {
    const rule = head.map((_, i) => (i === 0 || align === 'left' ? '---' : '---:')).join('|');
    out.push(`| ${head.join(' | ')} |`, `|${rule}|`, ...rows.map((r) => `| ${r.join(' | ')} |`), '');
  };

  out.push('# Money-flow scenario — expected numbers', '');
  out.push(`Log in at ${login.url} as \`${login.makerEmail}\` (maker) or \`${login.checkerEmail}\` (checker), password \`${login.password}\`.`, '');
  out.push('Every figure in the scenario sections below is also asserted, to the paisa, by `apps/api/src/testing/money-flow-scenario/money-flow.integration-spec.ts`.', '');
  out.push(
    'The demo organization also carries the **demo extras** (last section): the modules the scenario does not build, loaded only here. Every extra is dated 1 September 2026 or later, so the scenario figures above are unchanged — except the ledger balances the extras section restates.',
    '',
  );

  out.push('## Projects → Financials tab', '');
  table(['', ...PROJECT_KEYS.map((k) => PROJECTS[k].name)], SUMMARY_ROWS.map(([label, key]) => [label, ...PROJECT_KEYS.map((k) => inr(String(PROJECT_FIGURES[k][key])))]));

  out.push('## Clients → Financials', '');
  table(
    ['', ...CLIENT_KEYS.map((k) => CLIENTS[k].name)],
    [
      ['Projects', ...CLIENT_KEYS.map((k) => String(CLIENT_FIGURES[k].projectCount))],
      ['Total contract value', ...CLIENT_KEYS.map((k) => inr(CLIENT_FIGURES[k].totalContractValueExclGst))],
      ...SUMMARY_ROWS.slice(1).map(([label, key]) => [label, ...CLIENT_KEYS.map((k) => inr(String(CLIENT_FIGURES[k][key as keyof (typeof CLIENT_FIGURES)['C1']])))]),
    ],
  );

  out.push('## Projects → Spend tab (document totals, GST included)', '');
  const spendKeys = ['PURCHASE', 'REIMBURSEMENT', 'DIRECT_EXPENSE', 'MATERIAL', 'MANPOWER', 'INTRODUCER', 'total'] as const;
  table(['', ...PROJECT_KEYS.map((k) => PROJECTS[k].name)], spendKeys.map((c) => [c === 'total' ? 'Total' : c, ...PROJECT_KEYS.map((k) => inr(SPEND_FIGURES[k][c]))]));

  out.push('## Projects → Milestones (CAPEX and OPEX)', '');
  table(
    ['', ...PROJECT_KEYS.map((k) => PROJECTS[k].name)],
    [
      ['CAPEX pool', ...PROJECT_KEYS.map((k) => inr(MILESTONE_POOLS[k].capexTotalAmount))],
      ['OPEX pool', ...PROJECT_KEYS.map((k) => inr(MILESTONE_POOLS[k].opexTotalAmount))],
    ],
  );
  table(
    ['OPEX schedule', 'Installments', 'Each', 'Last', 'Total', 'First period / invoice', 'Last period / invoice', 'Billing'],
    (['P2', 'P3'] as const).map((k) => {
      const s = OPEX_SCHEDULES[k];
      const b = BILLING.opex[k];
      return [
        `${PROJECTS[k].name} — ${s.name}`, String(s.installmentCount), inr(s.regularAmount), inr(s.last.scheduledAmount), inr(s.total),
        `${s.first.servicePeriodStart} – ${s.first.servicePeriodEnd} / ${s.first.plannedInvoiceDate}`,
        `${s.last.servicePeriodStart} – ${s.last.servicePeriodEnd} / ${s.last.plannedInvoiceDate}`,
        `Partly invoiced — ${b.invoicedCount} of ${b.billableCount}`,
      ];
    }),
  );
  table(
    ['CAPEX event', 'Project', 'Billing', 'Invoice'],
    BILLING.capexEvents.map((e) => [e.event, PROJECTS[e.project].name, e.billingStatus === 'FULLY_INVOICED' ? 'Invoiced' : 'Not invoiced', e.invoice ?? '—']),
  );

  out.push('## Invoices and notes', '');
  table(
    ['Document', 'Project', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total', 'Status'],
    [
      ...Object.entries(DOCUMENT_TOTALS).map(([key, d]) => [key, PROJECTS[d.project].name, inr(d.taxable), inr(d.cgst), inr(d.sgst), inr(d.igst), inr(d.total), d.status]),
      ...Object.entries(NOTE_TOTALS).map(([key, n]) => [`${key} (${n.type.toLowerCase()} note on ${n.invoice})`, '', inr(n.taxable), inr(n.cgst), inr(n.sgst), inr(n.igst), inr(n.total), 'FINALIZED']),
    ],
  );

  out.push('## Employee Costing → Salary Imports', '');
  table(
    ['Month', 'Employees', 'Gross total'],
    [
      ['July 2026', String(SALARY.july.employeeCount), inr(SALARY.july.totalGrossAmount)],
      ['August 2026', String(SALARY.august.employeeCount), inr(SALARY.august.totalGrossAmount)],
    ],
  );
  out.push(`July payment: gross ${inr(SALARY.julyPayment.grossAmount)}, TDS ${inr(SALARY.julyPayment.tdsAmount)}, net ${inr(SALARY.julyPayment.netAmount)}. August is unpaid.`, '');

  out.push('## Employee Costing → Monthly Allocation → Manpower cost (Jul–Aug 2026)', '');
  table(
    ['Month', 'Project', 'Employees', 'Total %', 'Cost'],
    MANPOWER.rows.map((r) => [r.month.slice(0, 7), PROJECTS[r.project].name, String(r.employeeCount), r.totalPercentage, inr(r.amount)]),
  );
  out.push(`Total ${inr(MANPOWER.totalManpowerCostAmount)}; ${MANPOWER.excludedDraftEmployeeMonths} draft employee-month excluded (Karan Mehta, August).`, '');
  out.push('Karan Mehta, July (the rounding case — gross 55,555.55):', '');
  table(['Project', '%', 'Allocated', 'Carries the paisa'], MANPOWER.e4July.map((l) => [PROJECTS[l.project].name, l.percentage, inr(l.allocatedAmount), l.carriesRoundingRemainder ? 'yes' : '']));

  out.push('## Inventory → Stock', '');
  out.push(`Cat6 Cable Box: ${STOCK.quantity} in stock, value ${inr(STOCK.valueAmount)}, weighted average ${STOCK.weightedAverageRate}.`, '');

  out.push('## Chart of accounts → ledger balances (debit +, credit −)', '');
  out.push('Scenario balances. The six the demo extras move are restated in the next section.', '');
  table(['Ledger', 'Balance'], Object.entries(LEDGER_BALANCES).map(([code, balance]) => [code, inr(balance)]));

  out.push('# Demo extras', '');
  out.push(
    'These are loaded by `scripts/load-money-flow-demo.ts` only, so that every module has something to look at. The integration spec never sees them.',
    '',
  );

  out.push('## What each screen holds', '');
  table(['Module', 'Contents'], DEMO_EXTRAS_FIGURES.modules.map(([module, contents]) => [module, contents]), 'left');

  out.push('## Bank movements the extras add (HDFC, September 2026)', '');
  table(
    ['Date', 'Movement', 'Amount'],
    [
      ...DEMO_EXTRAS_FIGURES.bankMovements.map(([date, description, amount]) => [date, description, inr(amount)]),
      ['', '**Net**', `**${inr(DEMO_EXTRAS_FIGURES.bankNetMovement)}**`],
    ],
  );

  out.push('## Ledger balances in the demo organization', '');
  table(
    ['Ledger', 'Scenario', 'Extras', 'Demo'],
    DEMO_EXTRAS_FIGURES.ledgerDeltas.map(([code, scenario, delta, demo]) => [code, inr(scenario), inr(delta), inr(demo)]),
  );
  out.push('Every other ledger balance is the scenario figure above, unchanged.', '');

  return out.join('\n');
}
