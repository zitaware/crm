import { generateId } from '@zitaware/database';
import type { MasterTypeKey } from '@zitaware/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { CardSettlementsService } from '../../card-accounts/card-settlements.service';
import { EmployeesService } from '../../employees/employees.service';
import { LeadsService } from '../../leads/leads.service';
import { MastersService } from '../../masters/masters.service';
import { SecurityInstrumentsService } from '../../security-instruments/security-instruments.service';
import { TendersService } from '../../tenders/tenders.service';
import { createScenarioServices, type MoneyFlowScenario } from './build';
import { HDFC_STATEMENT_CSV } from './expected';

/**
 * Everything the demo organization needs that the money-flow scenario itself
 * does not build.
 *
 * The scenario is the integration spec's fixture: every figure it produces is
 * asserted to the paisa, so it may not grow a module just to make a screen
 * non-empty. But the demo organization is also the organization the browser
 * pass and hand-checking run against, and fifteen of its modules had no rows
 * at all — Leads, Tenders, EMD/SD, Subscriptions, Servers, Card Accounts,
 * Employee Advances, project team/progress, client and vendor contacts, ten
 * master lists, and the bank statement flow that a demo rebuild kept dropping.
 *
 * So the extras live here, outside the scenario, loaded only by
 * scripts/load-money-flow-demo.ts. The spec's organization never sees them and
 * its numbers do not move.
 *
 * Everything goes through the same real services the application uses, so
 * every posting, audit event and reconciliation is the real one. The only rows
 * written directly are the ones with no service of their own — two ledger
 * accounts, the security-instrument purpose/type masters (whose category,
 * recoverable account and cash-posting flag the generic Masters port does not
 * carry) and vendor contacts — the same exception the scenario builder makes.
 * The figures the extras add are listed in DEMO_EXTRAS_FIGURES below and
 * rendered into the expected-numbers sheet.
 *
 * Dates: every cash movement the extras add is dated September 2026, after the
 * 31 August as-of date most of the scenario's asserted figures use, so the
 * scenario's own reports read the same in the demo as in the spec. Only the
 * all-time and September figures move — see DEMO_EXTRAS_FIGURES.
 */

/** Ledger accounts the extras need that the scenario's chart does not carry. */
const EXTRA_CHART = [
  { code: 'EMD_SD_RECOVERABLE', name: 'EMD / Security Deposit Recoverable', group: 'ASSET' as const },
  { code: 'CREDIT_CARD_PAYABLE', name: 'Credit Card Payable — HDFC', group: 'LIABILITY' as const },
];

const MASTERS: Array<{ type: MasterTypeKey; rows: Array<[code: string, name: string]> }> = [
  {
    type: 'internal_departments',
    rows: [
      ['DELIVERY', 'Delivery'],
      ['FINANCE', 'Finance & Accounts'],
      ['PRESALES', 'Sales & Pre-sales'],
    ],
  },
  {
    type: 'designations',
    rows: [
      ['PM', 'Project Manager'],
      ['SE', 'Senior Engineer'],
      ['BA', 'Business Analyst'],
      ['ACC', 'Accounts Executive'],
    ],
  },
  {
    type: 'employment_types',
    rows: [
      ['PERM', 'Permanent'],
      ['CONTRACT', 'Contract'],
    ],
  },
  {
    type: 'government_body_types',
    rows: [
      ['STATE_DEPT', 'State Government Department'],
      ['STATE_PSU', 'State Public Sector Undertaking'],
      ['ULB', 'Urban Local Body'],
    ],
  },
  {
    type: 'client_types',
    rows: [
      ['GOVT', 'Government Department'],
      ['PSU', 'Public Sector Undertaking'],
      ['SPV', 'Special Purpose Vehicle'],
    ],
  },
  {
    type: 'lead_types',
    rows: [
      ['DIRECT', 'Direct Enquiry'],
      ['TENDER', 'Tender Opportunity'],
      ['REPEAT', 'Repeat Business'],
    ],
  },
  {
    type: 'lead_sources',
    rows: [
      ['PORTAL', 'Government Tender Portal'],
      ['REFERRAL', 'Referral'],
      ['EXISTING', 'Existing Client'],
    ],
  },
  {
    type: 'tender_portals',
    rows: [
      ['GEM', 'GeM'],
      ['NPROCURE', 'nProcure (Gujarat)'],
      ['MAHATENDERS', 'MahaTenders'],
    ],
  },
  {
    type: 'project_types',
    rows: [
      ['TURNKEY', 'Turnkey Implementation'],
      ['AMC', 'AMC / O&M'],
      ['CONSULTING', 'Consultancy'],
    ],
  },
  {
    type: 'product_categories',
    rows: [
      ['NETWORK', 'Networking'],
      ['HARDWARE', 'Hardware'],
      ['LICENCE', 'Software Licences'],
    ],
  },
  {
    type: 'document_categories',
    rows: [
      ['CONTRACT', 'Contract & Work Order'],
      ['INVOICE_COPY', 'Invoice Copy'],
      ['COMPLIANCE', 'Compliance Certificate'],
    ],
  },
];

/**
 * Every figure the extras add, hand-computed here and rendered into the
 * expected-numbers sheet so the demo can be checked by hand the same way the
 * scenario can.
 *
 * Bank (HDFC) — the extras' September cash movements, in order:
 *   02 Sep  EMD demand draft lodged, RSCL Smart Parking      −50,000.00
 *   03 Sep  Credit-card purchase (no bank movement)                0.00
 *   05 Sep  SD demand draft lodged, GIL e-Governance Portal  −80,000.00
 *   08 Sep  Subscription paid (5,000 + 900 GST)               −5,900.00
 *   10 Sep  Employee advance to Ravi Shah                    −25,000.00
 *   12 Sep  EMD demand draft returned in full                +50,000.00
 *   15 Sep  Credit-card statement settled                     −4,720.00
 *                                                     net   −1,15,620.00
 *   Scenario September closing 14,04,127.77 − 1,15,620.00 = 12,88,507.77
 */
export const DEMO_EXTRAS_FIGURES = {
  /** What a person should see on each screen the extras fill. */
  modules: [
    ['Leads', '3 leads — GIL Helpdesk Modernization (tender filled, 15,00,000), MahaIT Phase 2 (proposal sent, 25,00,000), RSCL ANPR (presentation done, 8,00,000), with 4 updates between them.'],
    ['Tenders', '3 tenders — GIL/2026-27/IT/114 submitted (pending), RSCL/SC/2026/08 won, MAHAIT/2026/APP/07 in preparation.'],
    ['EMD / SD', '3 instruments — EMD demand draft 50,000 returned 12 Sep, SD demand draft 80,000 still lodged, EMD bank guarantee 1,00,000 overdue since 10 Sep.'],
    ['Servers & Subscriptions', '1 — source control and CI, 5,000 + 900 IGST paid 8 Sep from HDFC, charged to P3.'],
    ['Card Accounts', '2 — a credit card (one 4,720 purchase on 3 Sep, settled in full on 15 Sep) and a debit card.'],
    ['Employee Advances', '1 — 25,000 to Ravi Shah on 10 Sep, unadjusted.'],
    ['Bank Reconciliation', 'June–August statement imported (23 lines) and auto-matched; June and July clean, August carries the approved −590 bank-only charge; June locked. September is left open.'],
    ['Projects', 'Team members on four projects and a progress timeline on three (P1 at 70%, P3 at 60%, P4 at 35%).'],
    ['Masters', '11 lists filled — departments, designations, employment types, government body types, client types, lead types, lead sources, tender portals, project types, product categories and document categories.'],
    ['Clients / Vendors', 'Contacts on all three clients and all three vendors; each client classified by type, each project by project type.'],
  ] as Array<[module: string, contents: string]>,

  /**
   * The extras' September cash movements against HDFC, in order:
   *   02 Sep  EMD demand draft lodged, RSCL Smart Parking      −50,000.00
   *   03 Sep  Credit-card purchase (no bank movement)                0.00
   *   05 Sep  SD demand draft lodged, GIL e-Governance Portal  −80,000.00
   *   08 Sep  Subscription paid (5,000 + 900 IGST)              −5,900.00
   *   10 Sep  Employee advance to Ravi Shah                    −25,000.00
   *   12 Sep  EMD demand draft returned in full                +50,000.00
   *   15 Sep  Credit-card statement settled                     −4,720.00
   *                                                     net   −1,15,620.00
   */
  bankMovements: [
    ['2026-09-02', 'EMD demand draft lodged — RSCL Smart Parking', '-50000.00'],
    ['2026-09-05', 'Security deposit demand draft lodged — GIL e-Governance Portal', '-80000.00'],
    ['2026-09-08', 'Subscription paid — source control and CI', '-5900.00'],
    ['2026-09-10', 'Employee advance — Ravi Shah', '-25000.00'],
    ['2026-09-12', 'EMD demand draft returned in full', '50000.00'],
    ['2026-09-15', 'Credit-card statement settled', '-4720.00'],
  ] as Array<[date: string, description: string, amount: string]>,
  bankNetMovement: '-115620.00',

  /**
   * The ledger balances the extras move, and what they become in the demo
   * organization. Every other balance in the sheet is untouched: no extra is
   * dated before 1 September 2026.
   */
  ledgerDeltas: [
    // 14,04,127.77 − 1,15,620.00
    ['BANK_HDFC_CURRENT', '1404127.77', '-115620.00', '1288507.77'],
    // 28,850 + subscription 5,000 + card purchase 4,720 (its GST is not recoverable)
    ['OFFICE_EXPENSE', '28850.00', '9720.00', '38570.00'],
    // 1,800 + the subscription cycle's 900
    ['INPUT_IGST_RECEIVABLE', '1800.00', '900.00', '2700.00'],
    // −2,450 (claim awaiting reimbursement) + 25,000 advance
    ['EMPLOYEE_ADVANCE_RECEIVABLE', '-2450.00', '25000.00', '22550.00'],
    // 50,000 lodged − 50,000 returned + 80,000 still lodged
    ['EMD_SD_RECOVERABLE', '0.00', '80000.00', '80000.00'],
    // 4,720 charged, 4,720 settled
    ['CREDIT_CARD_PAYABLE', '0.00', '0.00', '0.00'],
  ] as Array<[code: string, scenario: string, delta: string, demo: string]>,
} as const;

/** Bank-statement column mapping for the HDFC CSV — the same one the spec saves. */
const HDFC_MAPPING = {
  dateColumn: 'Txn Date',
  dateFormat: 'DD_MM_YYYY_SLASH' as const,
  descriptionColumn: 'Narration',
  referenceColumn: 'Chq/Ref No',
  amountMode: 'DEBIT_CREDIT_COLUMNS' as const,
  debitColumn: 'Withdrawal Amt',
  creditColumn: 'Deposit Amt',
  amountColumn: undefined,
  indicatorColumn: undefined,
  creditIndicator: undefined,
  balanceColumn: undefined,
};

export async function buildDemoExtras(
  prisma: PrismaService,
  scenario: MoneyFlowScenario,
  options: { makerId: string; checkerId: string },
): Promise<void> {
  const s = createScenarioServices(prisma);
  const db = prisma.client;
  const { organizationId, legalEntityId, clientIds, projectIds, employeeIds } = scenario;
  const { makerId, checkerId } = options;
  const ids = () => ({ idempotencyKey: generateId(), correlationId: generateId() });
  const ctx = (actorId = makerId) => ({ organizationId, actorId, correlationId: generateId() });

  const masters = new MastersService(prisma);
  const employees = new EmployeesService(prisma);
  const leads = new LeadsService(prisma);
  const tenders = new TendersService(prisma);
  const securityInstruments = new SecurityInstrumentsService(prisma, s.posting);
  const cardSettlements = new CardSettlementsService(prisma, s.posting);

  const bankAccount = await db.bankAccount.findFirstOrThrow({ where: { organizationId }, include: { ledgerAccount: true } });
  const bankTransferModeId = (await db.paymentMode.findFirstOrThrow({ where: { code: 'BANK_TRANSFER' } })).id;

  // ------------------------------------------------------ extra chart rows
  const assetGroupId = (await db.accountGroup.findFirstOrThrow({ where: { organizationId, accountType: 'ASSET' } })).id;
  const liabilityGroupId = (await db.accountGroup.findFirstOrThrow({ where: { organizationId, accountType: 'LIABILITY' } })).id;
  const extraLedgerIdByCode = new Map<string, string>();
  for (const account of EXTRA_CHART) {
    const row = await db.ledgerAccount.create({
      data: {
        id: generateId(),
        organizationId,
        accountGroupId: account.group === 'ASSET' ? assetGroupId : liabilityGroupId,
        code: account.code,
        name: account.name,
        allowManualPosting: true,
        isActive: true,
      },
    });
    extraLedgerIdByCode.set(account.code, row.id);
  }

  // ---------------------------------------------------------------- masters
  const masterIdByCode = new Map<string, string>();
  for (const { type, rows } of MASTERS) {
    for (const [index, [code, name]] of rows.entries()) {
      const created = await masters.create({
        organizationId,
        type,
        code,
        name,
        description: undefined,
        sortOrder: index,
        actorId: makerId,
        correlationId: generateId(),
      });
      masterIdByCode.set(`${type}:${code}`, created.id);
    }
  }
  const master = (type: MasterTypeKey, code: string): string => {
    const id = masterIdByCode.get(`${type}:${code}`);
    if (!id) throw new Error(`Demo extras: master ${type}/${code} was not created.`);
    return id;
  };

  // ------------------------------------------------- clients and projects
  // The scenario creates its clients and projects before these masters exist,
  // so classify them now — a client with no type and a project with no type
  // read as half-filled on their own screens. Each client picks up its
  // contacts in the same update.
  const CLIENT_CONTACTS: Record<keyof typeof clientIds, Array<{ name: string; designation: string; phone: string; email: string }>> = {
    C1: [
      { name: 'Hiren Joshi', designation: 'General Manager (IT)', phone: '+91 79 2325 1100', email: 'hiren.joshi@zitaware.test' },
      { name: 'Palak Mehta', designation: 'Accounts Officer', phone: '+91 79 2325 1142', email: 'palak.mehta@zitaware.test' },
    ],
    C2: [{ name: 'Sameer Kulkarni', designation: 'Deputy Secretary (IT)', phone: '+91 22 2202 4410', email: 'sameer.kulkarni@zitaware.test' }],
    C3: [
      { name: 'Vikram Rathore', designation: 'Chief Executive Officer', phone: '+91 141 222 8800', email: 'vikram.rathore@zitaware.test' },
      { name: 'Anita Sharma', designation: 'Finance Controller', phone: '+91 141 222 8815', email: 'anita.sharma@zitaware.test' },
    ],
  };
  const clientTypeByKey = { C1: 'PSU', C2: 'GOVT', C3: 'SPV' } as const;
  for (const [key, typeCode] of Object.entries(clientTypeByKey) as Array<[keyof typeof clientIds, string]>) {
    const detail = await s.clients.getDetail({ organizationId, id: clientIds[key] });
    await s.clients.update({
      organizationId,
      id: clientIds[key],
      name: undefined,
      shortCode: undefined,
      clientTypeId: master('client_types', typeCode),
      department: undefined,
      stateId: undefined,
      districtId: undefined,
      cityId: undefined,
      pinCode: undefined,
      officeAddress: undefined,
      gstin: undefined,
      internalNote: undefined,
      contacts: CLIENT_CONTACTS[key].map((c) => ({ id: undefined, ...c })),
      expectedVersion: detail.version,
      actorId: makerId,
      correlationId: generateId(),
    });
  }

  const projectTypeByKey = { P1: 'TURNKEY', P2: 'AMC', P3: 'TURNKEY', P4: 'TURNKEY', P5: 'CONSULTING' } as const;
  for (const [key, typeCode] of Object.entries(projectTypeByKey) as Array<[keyof typeof projectIds, string]>) {
    const detail = await s.projects.getDetail({ organizationId, id: projectIds[key], actorId: makerId, canSeeAll: true });
    await s.projects.update({
      organizationId,
      id: projectIds[key],
      leadId: undefined,
      tenderId: undefined,
      projectManagerId: undefined,
      introducerId: undefined,
      projectTypeId: master('project_types', typeCode),
      name: undefined,
      description: undefined,
      value: undefined,
      budget: undefined,
      gstApplicable: undefined,
      workOrderNumber: undefined,
      workOrderDate: undefined,
      expectedVersion: detail.version,
      actorId: makerId,
      canSeeAll: true,
      correlationId: generateId(),
    });
  }

  // --------------------------------------------------- vendor contacts
  // Vendors have no contact list on their own create/update port, so these
  // are written directly — the same "a master with no service of its own"
  // exception the scenario builder already makes.
  for (const vendor of await db.vendorProfile.findMany({ where: { organizationId }, select: { partyId: true, party: { select: { name: true } } } })) {
    await db.contact.create({
      data: {
        id: generateId(),
        organizationId,
        partyId: vendor.partyId,
        name: 'Accounts Desk',
        designation: 'Accounts & Billing',
        phone: '+91 79 4000 0000',
        email: `accounts@${vendor.party.name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}.demo`,
        sortOrder: 0,
        createdBy: makerId,
      },
    });
  }

  // -------------------------------------------------------------- employees
  // The scenario creates its four employees before the department, designation
  // and employment-type masters exist, so classify them here. Ravi Shah also
  // becomes reimbursement-eligible — the extras issue him an advance below,
  // and only Asha Patel was eligible in the scenario.
  const employeeProfile: Record<keyof typeof employeeIds, { department: string; designation: string; employment: string; reimbursable: boolean }> = {
    E1: { department: 'DELIVERY', designation: 'PM', employment: 'PERM', reimbursable: true },
    E2: { department: 'DELIVERY', designation: 'SE', employment: 'PERM', reimbursable: true },
    E3: { department: 'DELIVERY', designation: 'BA', employment: 'PERM', reimbursable: false },
    E4: { department: 'DELIVERY', designation: 'SE', employment: 'CONTRACT', reimbursable: false },
  };
  for (const [key, profile] of Object.entries(employeeProfile) as Array<[keyof typeof employeeIds, (typeof employeeProfile)['E1']]>) {
    const current = await db.employee.findFirstOrThrow({ where: { organizationId, id: employeeIds[key] }, select: { version: true } });
    await employees.update({
      organizationId,
      id: employeeIds[key],
      userId: undefined,
      internalDepartmentId: master('internal_departments', profile.department),
      designationId: master('designations', profile.designation),
      employmentTypeId: master('employment_types', profile.employment),
      fullName: undefined,
      isReimbursable: profile.reimbursable,
      displayedSalaryAmount: undefined,
      expectedVersion: current.version,
      actorId: makerId,
      correlationId: generateId(),
    });
  }

  // ------------------------------------------------- project team, progress
  const team = async (projectKey: keyof typeof projectIds, members: Array<[employeeKey: keyof typeof employeeIds, role: string]>) => {
    for (const [employeeKey, role] of members) {
      await s.projects.addTeamMember({
        organizationId,
        projectId: projectIds[projectKey],
        employeeId: employeeIds[employeeKey],
        role,
        actorId: makerId,
        correlationId: generateId(),
      });
    }
  };
  await team('P1', [['E1', 'Project Manager'], ['E2', 'Senior Engineer']]);
  await team('P2', [['E3', 'Support Engineer']]);
  await team('P3', [['E1', 'Project Manager'], ['E4', 'Developer']]);
  await team('P4', [['E2', 'Site Engineer']]);

  const progress = async (projectKey: keyof typeof projectIds, rows: Array<[title: string, percentage: number, note: string]>) => {
    for (const [title, percentage, note] of rows) {
      await s.projects.addProgress({
        organizationId,
        projectId: projectIds[projectKey],
        title,
        percentage,
        note,
        actorId: makerId,
        canSeeAll: true,
        correlationId: generateId(),
      });
    }
  };
  await progress('P1', [
    ['Requirement sign-off', 20, 'SRS signed off by GIL on 12 May 2026.'],
    ['Core portal build', 55, 'Citizen registration and grievance modules in UAT.'],
    ['Go-live readiness', 70, 'Security audit scheduled; data migration rehearsal done.'],
  ]);
  await progress('P3', [
    ['Discovery', 25, 'Field study across four districts completed.'],
    ['App build', 60, 'Android build released to the department for review.'],
  ]);
  await progress('P4', [['Site survey', 35, 'Survey of 12 parking sites completed.']]);

  // ------------------------------------------------------------------ leads
  const lead = (input: {
    clientKey: keyof typeof clientIds;
    type: string;
    source: string;
    title: string;
    stage: string;
    estimatedValue: string;
    leadDate: string;
    expectedCloseDate: string;
    description: string;
  }) =>
    leads.create({
      organizationId,
      clientId: clientIds[input.clientKey],
      leadTypeId: master('lead_types', input.type),
      leadSourceId: master('lead_sources', input.source),
      introducerId: undefined,
      title: input.title,
      description: input.description,
      stage: input.stage,
      estimatedValue: input.estimatedValue,
      leadDate: input.leadDate,
      expectedCloseDate: input.expectedCloseDate,
      expectedTenderDate: undefined,
      tenderNumber: undefined,
      tenderDate: undefined,
      submissionDeadline: undefined,
      reminderOffset: undefined,
      internalNote: undefined,
      actorId: makerId,
      correlationId: generateId(),
    });

  const l1 = await lead({
    clientKey: 'C1', type: 'TENDER', source: 'PORTAL', title: 'GIL Helpdesk Modernization',
    stage: 'TENDER_FILLED', estimatedValue: '1500000', leadDate: '2026-07-10', expectedCloseDate: '2026-10-31',
    description: 'Replacement of the existing helpdesk with a ticketing and SLA platform for 40 departments.',
  });
  const l2 = await lead({
    clientKey: 'C2', type: 'REPEAT', source: 'EXISTING', title: 'MahaIT Citizen App — Phase 2',
    stage: 'PROPOSAL_SENT', estimatedValue: '2500000', leadDate: '2026-08-05', expectedCloseDate: '2026-12-15',
    description: 'Payments, DigiLocker integration and regional languages on top of the Phase 1 app.',
  });
  const l3 = await lead({
    clientKey: 'C3', type: 'DIRECT', source: 'REFERRAL', title: 'RSCL ANPR Camera Expansion',
    stage: 'PRESENTATION_DONE', estimatedValue: '800000', leadDate: '2026-09-01', expectedCloseDate: '2027-01-31',
    description: 'Thirty additional ANPR cameras feeding the existing command centre.',
  });

  const leadUpdate = (leadId: string, title: string, note: string) =>
    leads.createUpdate({ organizationId, leadId, title, note, actorId: makerId, correlationId: generateId() });
  await leadUpdate(l1.id, 'Pre-bid meeting attended', 'Clarifications on the SLA penalty clause raised; corrigendum expected.');
  await leadUpdate(l1.id, 'Bid submitted', 'Technical and financial bids uploaded on nProcure.');
  await leadUpdate(l2.id, 'Proposal sent', 'Commercial proposal of 25,00,000 emailed to the Deputy Secretary.');
  await leadUpdate(l3.id, 'Solution demo', 'Demonstrated the ANPR dashboard at the RSCL office.');

  // ---------------------------------------------------------------- tenders
  const tender = (input: {
    clientKey: keyof typeof clientIds;
    leadId: string | undefined;
    portal: string;
    tenderNumber: string;
    title: string;
    submissionStatus: string;
    result: string;
    estimatedValue: string;
    tenderDate: string;
    submissionDeadline: string;
    submittedDate: string | undefined;
    resultDate: string | undefined;
    description: string;
  }) =>
    tenders.create({
      organizationId,
      clientId: clientIds[input.clientKey],
      leadId: input.leadId,
      tenderPortalId: master('tender_portals', input.portal),
      tenderNumber: input.tenderNumber,
      title: input.title,
      description: input.description,
      submissionStatus: input.submissionStatus,
      result: input.result,
      estimatedValue: input.estimatedValue,
      tenderDate: input.tenderDate,
      submissionDeadline: input.submissionDeadline,
      submittedDate: input.submittedDate,
      resultDate: input.resultDate,
      reminderOffset: undefined,
      internalNote: undefined,
      actorId: makerId,
      correlationId: generateId(),
    });

  const t1 = await tender({
    clientKey: 'C1', leadId: l1.id, portal: 'NPROCURE', tenderNumber: 'GIL/2026-27/IT/114',
    title: 'Supply and implementation of an IT helpdesk platform', submissionStatus: 'SUBMITTED', result: 'PENDING',
    estimatedValue: '1500000', tenderDate: '2026-06-01', submissionDeadline: '2026-06-30', submittedDate: '2026-06-28',
    resultDate: undefined, description: 'Two-bid tender; EMD of 1,00,000 furnished as a bank guarantee.',
  });
  const t2 = await tender({
    clientKey: 'C3', leadId: undefined, portal: 'GEM', tenderNumber: 'RSCL/SC/2026/08',
    title: 'Smart parking automation — package B', submissionStatus: 'SUBMITTED', result: 'WON',
    estimatedValue: '800000', tenderDate: '2026-03-02', submissionDeadline: '2026-03-25', submittedDate: '2026-03-24',
    resultDate: '2026-04-18', description: 'Awarded; delivered as the RSCL Smart Parking project.',
  });
  await tender({
    clientKey: 'C2', leadId: l2.id, portal: 'MAHATENDERS', tenderNumber: 'MAHAIT/2026/APP/07',
    title: 'Citizen services application — Phase 2', submissionStatus: 'IN_PREPARATION', result: 'PENDING',
    estimatedValue: '2500000', tenderDate: '2026-09-05', submissionDeadline: '2026-10-10', submittedDate: undefined,
    resultDate: undefined, description: 'Bid under preparation; documents being collated.',
  });

  const tenderUpdate = (tenderId: string, title: string, note: string) =>
    tenders.createUpdate({ organizationId, tenderId, title, note, actorId: makerId, correlationId: generateId() });
  await tenderUpdate(t1.id, 'Technical bid opened', 'Qualified technically; financial bid opening awaited.');
  await tenderUpdate(t2.id, 'Award letter received', 'Work order issued on 18 Apr 2026 for 8,00,000.');

  // ------------------------------------------------------- EMD / SD (8.8a)
  const recoverableLedgerId = extraLedgerIdByCode.get('EMD_SD_RECOVERABLE')!;
  const purposeId = async (code: string, name: string, category: 'EMD' | 'SD', sortOrder: number) =>
    (await db.securityInstrumentPurpose.create({
      data: { id: generateId(), organizationId, code, name, category, defaultRecoverableLedgerAccountId: recoverableLedgerId, sortOrder, createdBy: makerId },
    })).id;
  const typeId = async (code: string, name: string, requiresCashPosting: boolean, sortOrder: number) =>
    (await db.securityInstrumentType.create({
      data: { id: generateId(), organizationId, code, name, requiresCashPosting, sortOrder, createdBy: makerId },
    })).id;

  const emdPurposeId = await purposeId('EMD', 'Earnest Money Deposit', 'EMD', 0);
  const sdPurposeId = await purposeId('SD', 'Security Deposit', 'SD', 1);
  const ddTypeId = await typeId('DD', 'Demand Draft', true, 0);
  const bgTypeId = await typeId('BG', 'Bank Guarantee', false, 1);
  await typeId('FDR', 'Fixed Deposit Receipt', true, 2);

  const lodge = (input: {
    purposeId: string;
    typeId: string;
    amount: string;
    projectId: string | undefined;
    tenderId: string | undefined;
    reference: string;
    issuingBank: string | undefined;
    authority: string;
    submittedOn: string;
    returnDueOn: string;
    cash: boolean;
    narrative: string;
  }) =>
    securityInstruments.lodge({
      organizationId,
      legalEntityId,
      projectId: input.projectId,
      tenderId: input.tenderId,
      purposeId: input.purposeId,
      typeId: input.typeId,
      amount: input.amount,
      instrumentReferenceNo: input.reference,
      issuingBank: input.issuingBank,
      lodgedWithAuthority: input.authority,
      bankLedgerAccountId: input.cash ? bankAccount.ledgerAccount.id : undefined,
      submittedOn: input.submittedOn,
      returnDueOn: input.returnDueOn,
      narrative: input.narrative,
      fundedByLegalEntityId: input.cash ? legalEntityId : undefined,
      fundedByPartyId: undefined,
      fundedByBankAccountDetails: input.cash ? 'HDFC Bank ****4321' : undefined,
      fundedByTransferAmount: input.cash ? input.amount : undefined,
      fundedByTransferMode: input.cash ? 'BANK_TRANSFER' : undefined,
      fundedByNote: undefined,
      actorId: makerId,
      ...ids(),
    });

  // Cash EMD for the RSCL package, returned in full ten days later.
  const emdCash = await lodge({
    purposeId: emdPurposeId, typeId: ddTypeId, amount: '50000', projectId: projectIds.P4, tenderId: undefined,
    reference: 'DD/HDFC/551204', issuingBank: 'HDFC Bank', authority: 'Rajasthan Smart City Ltd',
    submittedOn: '2026-09-02', returnDueOn: '2026-12-31', cash: true, narrative: 'EMD for the smart parking package B extension.',
  });
  await securityInstruments.recordReturn({
    organizationId,
    id: emdCash.id,
    returnedAmount: '50000',
    returnedOn: '2026-09-12',
    returnedToLegalEntityId: legalEntityId,
    returnedToPartyId: undefined,
    returnedToBankAccountDetails: 'HDFC Bank ****4321',
    actorId: checkerId,
    ...ids(),
  });

  // Cash security deposit still lodged, and a bank guarantee already past its return date.
  await lodge({
    purposeId: sdPurposeId, typeId: ddTypeId, amount: '80000', projectId: projectIds.P1, tenderId: undefined,
    reference: 'DD/HDFC/551377', issuingBank: 'HDFC Bank', authority: 'Gujarat Informatics Ltd',
    submittedOn: '2026-09-05', returnDueOn: '2027-03-31', cash: true, narrative: 'Performance security for the e-Governance portal.',
  });
  await lodge({
    purposeId: emdPurposeId, typeId: bgTypeId, amount: '100000', projectId: undefined, tenderId: t1.id,
    reference: 'BG/HDFC/0026/114', issuingBank: 'HDFC Bank', authority: 'Gujarat Informatics Ltd',
    submittedOn: '2026-06-15', returnDueOn: '2026-09-10', cash: false, narrative: 'EMD bank guarantee for tender GIL/2026-27/IT/114.',
  });

  // ------------------------------------- servers & subscriptions (ADR-169)
  const cloudVendor = await s.vendors.create({
    organizationId,
    existingPartyId: undefined,
    name: 'CloudWorks India Pvt Ltd',
    shortCode: 'CLOUDWORKS',
    gstin: undefined,
    panNumber: undefined,
    paymentTerms: 'NET_15',
    stateId: (await db.party.findFirstOrThrow({ where: { organizationId, id: clientIds.C1 }, select: { stateId: true } })).stateId ?? undefined,
    districtId: undefined,
    cityId: undefined,
    pinCode: undefined,
    officeAddress: 'Bengaluru, Karnataka',
    internalNote: undefined,
    actorId: makerId,
    correlationId: generateId(),
  });
  const officeCategoryId = (await db.expenseCategory.findFirstOrThrow({ where: { organizationId, code: 'MF-OFFICE' } })).id;

  // A subscription bill, as the Server & Subscription import posts one (ADR-169).
  await s.directExpenses.createAndPostDraft({
    organizationId,
    legalEntityId: undefined,
    projectId: projectIds.P3,
    vendorId: cloudVendor.id,
    expenseCategoryId: officeCategoryId,
    title: 'Source control and CI — team plan',
    taxableAmount: '5000',
    expenseDate: '2026-09-08',
    gstInvoiceAvailable: true,
    gstRatePercent: '9',
    supplyType: 'INTERSTATE',
    itcEligible: true,
    paymentModeId: bankTransferModeId,
    bankAccountId: bankAccount.id,
    transactionReference: 'SUB-SEP-0908',
    purchasedByEmployeeId: employeeIds.E1,
    spendType: 'SUBSCRIPTION',
    actorId: makerId,
    ...ids(),
  });

  // --------------------------------------------------- card accounts (6.8)
  const creditCard = await s.legalEntities.createCardAccount({
    organizationId,
    legalEntityId,
    type: 'CREDIT_CARD',
    displayName: 'HDFC Business Credit Card',
    issuerName: 'HDFC Bank',
    maskedLastFour: '7788',
    cardholderEmployeeId: employeeIds.E1,
    bankAccountId: undefined,
    ledgerAccountId: extraLedgerIdByCode.get('CREDIT_CARD_PAYABLE')!,
    statementDay: 20,
    paymentDueDay: 5,
    actorId: makerId,
    correlationId: generateId(),
  });
  await s.legalEntities.createCardAccount({
    organizationId,
    legalEntityId,
    type: 'DEBIT_CARD',
    displayName: 'HDFC Operating Debit Card',
    issuerName: 'HDFC Bank',
    maskedLastFour: '4321',
    cardholderEmployeeId: employeeIds.E3,
    bankAccountId: bankAccount.id,
    ledgerAccountId: undefined,
    statementDay: undefined,
    paymentDueDay: undefined,
    actorId: makerId,
    correlationId: generateId(),
  });

  // A purchase on the credit card, then the statement settled from the bank.
  await s.directExpenses.createAndPostDraft({
    organizationId,
    expenseCategoryId: officeCategoryId,
    vendorId: undefined,
    title: 'Office consumables — September',
    projectId: undefined,
    legalEntityId,
    taxableAmount: '4000',
    expenseDate: '2026-09-03',
    gstInvoiceAvailable: true,
    gstRatePercent: '9',
    supplyType: 'INTRASTATE',
    itcEligible: false,
    tdsAmount: undefined,
    tdsRatePercent: undefined,
    paymentModeId: (await db.paymentMode.findFirstOrThrow({ where: { code: 'CREDIT_CARD' } })).id,
    bankAccountId: undefined,
    cardAccountId: creditCard.id,
    transactionReference: 'CC-7788-0903',
    purchasedByEmployeeId: employeeIds.E1,
    note: undefined,
    actorId: makerId,
    ...ids(),
  });
  await cardSettlements.settleCreditCard({
    organizationId,
    cardAccountId: creditCard.id,
    amount: '4720',
    settlementDate: '2026-09-15',
    bankAccountId: bankAccount.id,
    transactionReference: 'CC-SETTLE-0915',
    actorId: makerId,
    ...ids(),
  });

  // ------------------------------------------------- employee advance (6.6)
  await s.employeeExpenses.issueAdvance({
    organizationId,
    employeeId: employeeIds.E2,
    projectId: projectIds.P1,
    legalEntityId,
    amount: '25000',
    advanceDate: '2026-09-10',
    paymentModeId: bankTransferModeId,
    bankAccountId: bankAccount.id,
    utrReference: 'ADV-0910-RS',
    purpose: 'Site travel and local purchases for the portal rollout',
    note: undefined,
    actorId: makerId,
    ...ids(),
  });

  // ------------------------------------- bank statement and reconciliation
  // The same June–August HDFC statement the spec imports. It covers the
  // scenario's own movements only, so the extras' September cash sits
  // uncleared — which is what an unreconciled current month looks like.
  await s.bankReconciliation.saveProfile({
    ...ctx(),
    bankAccountId: bankAccount.id,
    expectedVersion: undefined,
    ...HDFC_MAPPING,
  });
  await s.bankReconciliation.importStatement({
    ...ctx(),
    bankAccountId: bankAccount.id,
    ...HDFC_STATEMENT_CSV,
  });
  for (const [from, to] of [
    ['2026-06-01', '2026-06-30'],
    ['2026-07-01', '2026-07-31'],
    ['2026-08-01', '2026-08-31'],
  ] as const) {
    await s.bankReconciliation.autoMatch({ ...ctx(), bankAccountId: bankAccount.id, from, to });
  }

  // Auto-match refuses to guess between the two −11,800 lines three days
  // apart (a direct expense and an expense claim), so they are matched by
  // hand, each to its own book entry.
  const fullWorkspace = await s.bankReconciliation.getWorkspace({
    organizationId,
    bankAccountId: bankAccount.id,
    from: '2026-06-01',
    to: '2026-09-30',
  });
  const statementLine = (date: string, amount: string) =>
    fullWorkspace.statementLines.find((line) => line.transactionDate === date && line.amount === amount);
  const bookLine = (date: string, amount: string) =>
    fullWorkspace.bookLines.find((line) => line.accountingDate === date && line.amount === amount);
  for (const date of ['2026-07-12', '2026-07-15']) {
    const statement = statementLine(date, '-11800.00');
    const book = bookLine(date, '-11800.00');
    if (statement && book) {
      await s.bankReconciliation.matchSelected({
        ...ctx(),
        bankAccountId: bankAccount.id,
        statementLineIds: [statement.id],
        journalLineIds: [book.journalLineId],
      });
    }
  }

  // The −590 bank charge the books never recorded: raised by the maker,
  // approved by the checker, exactly as the workflow requires.
  const charge = statementLine('2026-08-31', '-590.00');
  if (charge) {
    await s.bankReconciliation.markException({
      ...ctx(),
      statementLineId: charge.id,
      reason: 'SMS and account charges — not yet booked',
    });
    await s.bankReconciliation.approveException({ ...ctx(checkerId), statementLineId: charge.id });
  }

  // June and July reconcile cleanly; August carries the approved bank-only
  // charge; September is left open, as the live month would be.
  for (const [month, closing] of [
    ['2026-06', '-113250.00'],
    ['2026-07', '1072850.00'],
    ['2026-08', '1415537.77'],
  ] as const) {
    await s.bankReconciliation.markReconciled({
      ...ctx(),
      bankAccountId: bankAccount.id,
      month,
      statementOpeningBalance: month === '2026-06' ? '0' : undefined,
      statementClosingBalance: closing,
    });
  }
  // June is closed for good — locked by the checker, never the preparer.
  const june = await s.bankReconciliation.getStatement({
    organizationId,
    bankAccountId: bankAccount.id,
    month: '2026-06',
    statementOpeningBalance: undefined,
    statementClosingBalance: undefined,
  });
  await s.bankReconciliation.lockPeriod({
    ...ctx(checkerId),
    bankAccountId: bankAccount.id,
    month: '2026-06',
    expectedVersion: june.version!,
  });
}
