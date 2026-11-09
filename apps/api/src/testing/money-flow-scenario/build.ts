import { generateId } from '@zitaware/database';
import type { VendorBillLineInput } from '@zitaware/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { PostingService } from '../../accounting/posting.service';
import { TdsCertificatesService } from '../../tds/tds-certificates.service';
import { TdsDepositsService } from '../../tds/tds-deposits.service';
import { BankReconciliationService } from '../../bank-reconciliation/bank-reconciliation.service';
import { ClientsService } from '../../clients/clients.service';
import { CreditDebitNotesService } from '../../credit-debit-notes/credit-debit-notes.service';
import { DirectExpensesService } from '../../direct-expenses/direct-expenses.service';
import { EmployeeAllocationsService } from '../../employee-allocations/employee-allocations.service';
import { EmployeeExpensesService } from '../../employee-expenses/employee-expenses.service';
import { EmployeeSalaryRevisionsService } from '../../employees/employee-salary-revisions.service';
import { IntroducerFeesService } from '../../introducer-fees/introducer-fees.service';
import { InventoryLedgerService } from '../../inventory/inventory-ledger.service';
import { InventoryService } from '../../inventory/inventory.service';
import { InvoicesService } from '../../invoices/invoices.service';
import { MilestonesService } from '../../milestones/milestones.service';
import { FinancialYearService } from '../../organization/financial-year.service';
import { LegalEntityService } from '../../organization/legal-entity.service';
import { PaymentAlertsService } from '../../payment-alerts/payment-alerts.service';
import { PaymentRequestsService } from '../../payment-requests/payment-requests.service';
import { ProjectFinancialsService } from '../../projects/project-financials.service';
import { ProjectsService } from '../../projects/projects.service';
import { ReceiptsService } from '../../receipts/receipts.service';
import { SalaryImportsService } from '../../salary-imports/salary-imports.service';
import { VendorBillsService } from '../../vendor-bills/vendor-bills.service';
import { VendorPaymentsService } from '../../vendor-payments/vendor-payments.service';
import { VendorsService } from '../../vendors/vendors.service';
import { hashPassword } from '../../identity/password.util';
import { uniqueGstin } from '../gstin.test-util';
import { CLIENTS, EMPLOYEES, PROJECTS, type ClientKey, type EmployeeKey, type InvoiceKey, type ProjectKey } from './expected';

/** Every service the scenario drives, wired exactly as the integration specs wire them. */
export function createScenarioServices(prisma: PrismaService) {
  const posting = new PostingService(prisma);
  const projects = new ProjectsService(prisma);
  const clients = new ClientsService(prisma);
  const paymentAlerts = new PaymentAlertsService(prisma, projects);
  const inventoryLedger = new InventoryLedgerService(prisma);
  const salaryRevisions = new EmployeeSalaryRevisionsService(prisma);
  const financialYears = new FinancialYearService(prisma);
  const receipts = new ReceiptsService(prisma, posting, projects);
  return {
    posting,
    projects,
    clients,
    paymentAlerts,
    inventoryLedger,
    salaryRevisions,
    milestones: new MilestonesService(prisma, projects, paymentAlerts),
    financialYears,
    legalEntities: new LegalEntityService(prisma),
    invoices: new InvoicesService(prisma, posting, projects, financialYears, receipts),
    receipts,
    creditDebitNotes: new CreditDebitNotesService(prisma, posting, projects),
    vendors: new VendorsService(prisma),
    vendorBills: new VendorBillsService(prisma, posting, projects, inventoryLedger),
    paymentRequests: new PaymentRequestsService(prisma, projects),
    vendorPayments: new VendorPaymentsService(prisma, posting, projects),
    inventory: new InventoryService(prisma, posting, inventoryLedger),
    employeeExpenses: new EmployeeExpensesService(prisma, posting),
    directExpenses: new DirectExpensesService(prisma, posting),
    salaryImports: new SalaryImportsService(prisma, posting, salaryRevisions),
    allocations: new EmployeeAllocationsService(prisma, projects),
    introducerFees: new IntroducerFeesService(prisma, posting),
    financials: new ProjectFinancialsService(prisma, projects, clients),
    tdsCertificates: new TdsCertificatesService(prisma),
    tdsDeposits: new TdsDepositsService(prisma, posting),
    bankReconciliation: new BankReconciliationService(prisma),
  };
}
export type ScenarioServices = ReturnType<typeof createScenarioServices>;

type GroupType = 'ASSET' | 'LIABILITY' | 'INCOME' | 'EXPENSE';

/** The chart of accounts the scenario posts into — every code a service looks up, plus the scenario's own categories. */
export const SCENARIO_CHART: Array<{ code: string; name: string; group: GroupType }> = [
  { code: 'BANK_HDFC_CURRENT', name: 'HDFC Bank — Current Account', group: 'ASSET' },
  { code: 'ACCOUNTS_RECEIVABLE', name: 'Accounts Receivable', group: 'ASSET' },
  { code: 'TDS_RECEIVABLE', name: 'TDS Receivable', group: 'ASSET' },
  { code: 'GST_TDS_RECEIVABLE_CGST', name: 'GST-TDS Receivable — CGST', group: 'ASSET' },
  { code: 'GST_TDS_RECEIVABLE_SGST', name: 'GST-TDS Receivable — SGST', group: 'ASSET' },
  { code: 'GST_TDS_RECEIVABLE_IGST', name: 'GST-TDS Receivable — IGST', group: 'ASSET' },
  { code: 'HOLD_RECEIVABLE', name: 'Hold Receivable', group: 'ASSET' },
  { code: 'RETENTION_RECEIVABLE', name: 'Retention Receivable', group: 'ASSET' },
  { code: 'DISPUTED_DEDUCTION_RECEIVABLE', name: 'Disputed Deduction Receivable', group: 'ASSET' },
  { code: 'INPUT_CGST_RECEIVABLE', name: 'Input CGST Receivable', group: 'ASSET' },
  { code: 'INPUT_SGST_RECEIVABLE', name: 'Input SGST Receivable', group: 'ASSET' },
  { code: 'INPUT_IGST_RECEIVABLE', name: 'Input IGST Receivable', group: 'ASSET' },
  { code: 'INPUT_GST_RECEIVABLE_EXPENSE', name: 'Input GST Receivable — Expense Claims', group: 'ASSET' },
  { code: 'EMPLOYEE_ADVANCE_RECEIVABLE', name: 'Employee Advance Receivable', group: 'ASSET' },
  { code: 'INVENTORY', name: 'Inventory', group: 'ASSET' },
  { code: 'INTRODUCER_ADVANCE_RECEIVABLE', name: 'Introducer Advance Receivable', group: 'ASSET' },
  { code: 'OUTPUT_CGST_PAYABLE', name: 'Output CGST Payable', group: 'LIABILITY' },
  { code: 'OUTPUT_SGST_PAYABLE', name: 'Output SGST Payable', group: 'LIABILITY' },
  { code: 'OUTPUT_IGST_PAYABLE', name: 'Output IGST Payable', group: 'LIABILITY' },
  { code: 'ACCOUNTS_PAYABLE_VENDOR', name: 'Accounts Payable — Vendor', group: 'LIABILITY' },
  { code: 'TDS_PAYABLE', name: 'TDS Payable', group: 'LIABILITY' },
  { code: 'GST_TDS_PAYABLE_CGST', name: 'GST-TDS Payable — CGST', group: 'LIABILITY' },
  { code: 'GST_TDS_PAYABLE_SGST', name: 'GST-TDS Payable — SGST', group: 'LIABILITY' },
  { code: 'GST_TDS_PAYABLE_IGST', name: 'GST-TDS Payable — IGST', group: 'LIABILITY' },
  { code: 'SALARY_PAYABLE', name: 'Salary Payable', group: 'LIABILITY' },
  { code: 'INTRODUCER_PAYABLE', name: 'Introducer Payable', group: 'LIABILITY' },
  { code: 'SOFTWARE_PROJECT_REVENUE', name: 'Project Revenue', group: 'INCOME' },
  { code: 'PENALTY_REVENUE_DEDUCTION', name: 'Penalty — Revenue Deduction', group: 'INCOME' },
  { code: 'OTHER_EXPENSES', name: 'Other Expenses', group: 'EXPENSE' },
  { code: 'HARDWARE_EXPENSE', name: 'Hardware Expense', group: 'EXPENSE' },
  { code: 'TRAVEL_EXPENSE', name: 'Travel Expense', group: 'EXPENSE' },
  { code: 'OFFICE_EXPENSE', name: 'Office Expense', group: 'EXPENSE' },
  { code: 'BANK_CHARGES', name: 'Bank Charges', group: 'EXPENSE' },
  { code: 'SALARIES_WAGES_EXPENSE', name: 'Salaries & Wages Expense', group: 'EXPENSE' },
  { code: 'PROJECT_MATERIAL_COST', name: 'Project Material Cost', group: 'EXPENSE' },
  { code: 'INTRODUCER_COMMISSION_EXPENSE', name: 'Introducer Commission Expense', group: 'EXPENSE' },
];

export interface MoneyFlowScenario {
  organizationId: string;
  legalEntityId: string;
  clientIds: Record<ClientKey, string>;
  projectIds: Record<ProjectKey, string>;
  employeeIds: Record<EmployeeKey, string>;
  invoiceIds: Record<InvoiceKey, string>;
  noteIds: { DN1: string; CN1: string };
  tdsCertificateIds: Record<'GIL_16A_Q2' | 'GIL_26AS_JUL' | 'MAHA_16A_Q2' | 'RSCL_7A_AUG' | 'GIL_CANCELLED', string>;
  inventoryItemId: string;
  salaryImportIds: { july: string; august: string };
  ledgerAccountIdByCode: Map<string, string>;
}

function randomPan(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const pick = (alphabet: string, n: number) => Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  return `${pick(letters, 5)}${pick('0123456789', 4)}${pick(letters, 1)}`;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Builds the whole money-flow scenario — three clients, five projects, four
 * employees, April–August 2026 — inside an existing, empty organization.
 *
 * Everything goes through the real application services, so the figures the
 * spec asserts are the figures the screens would show. The only rows written
 * directly are masters with no service of their own, and the OPEN payment
 * alerts an invoice is raised from (the worker creates those in production;
 * every invoice spec inserts them the same way).
 *
 * `makerId` creates every document and `checkerId` approves every one that
 * needs a second person (vendor bills, payment requests, expense claims), so
 * the maker-checker rules are exercised, not bypassed.
 */
export async function buildMoneyFlowScenario(
  prisma: PrismaService,
  options: { organizationId: string; makerId: string; checkerId: string; emailSuffix: string },
): Promise<MoneyFlowScenario> {
  const s = createScenarioServices(prisma);
  const { organizationId, makerId, checkerId } = options;
  const db = prisma.client;
  const ids = () => ({ idempotencyKey: generateId(), correlationId: generateId() });

  const stateByCode = new Map((await db.state.findMany({ where: { code: { in: ['GJ', 'MH', 'RJ'] } } })).map((st) => [st.code, st.id]));
  const stateId = (code: string) => {
    const id = stateByCode.get(code);
    if (!id) throw new Error(`State ${code} is not seeded — run the database seed first.`);
    return id;
  };
  const bankTransferModeId = (await db.paymentMode.findFirstOrThrow({ where: { code: 'BANK_TRANSFER' } })).id;

  // ---------------------------------------------------------------- entity
  const legalEntity = await db.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'Scenario Infotech Pvt Ltd', panNumber: randomPan(), registeredAddress: 'Ahmedabad, Gujarat' },
  });
  const legalEntityId = legalEntity.id;
  const gstRegistration = await s.legalEntities.createGstRegistration({
    organizationId, legalEntityId, stateId: stateId('GJ'), gstin: uniqueGstin('24'), tradeName: undefined,
    actorId: makerId, correlationId: generateId(),
  });
  const gstRegistrationId = gstRegistration.id;

  // Financial years from April 2026 up to the one containing today: the
  // documents are dated Apr–Aug 2026, but a credit/debit note always posts
  // into TODAY's period, so a year must cover the real current date too.
  const today = new Date().toISOString().slice(0, 10);
  for (let year = 2026; `${year}-04-01` <= today || year === 2026; year++) {
    const startDate = `${year}-04-01`;
    const endDate = `${year + 1}-03-31`;
    await s.financialYears.create({
      organizationId, legalEntityId, label: `FY${year}-${String((year + 1) % 100).padStart(2, '0')}`, startDate, endDate,
      setCurrent: startDate <= today && today <= endDate, actorId: makerId, correlationId: generateId(),
    });
  }

  // ------------------------------------------------------ chart of accounts
  const groupIds = new Map<GroupType, string>();
  for (const [group, normalBalance] of [['ASSET', 'DEBIT'], ['LIABILITY', 'CREDIT'], ['INCOME', 'CREDIT'], ['EXPENSE', 'DEBIT']] as const) {
    const row = await db.accountGroup.create({
      data: { id: generateId(), organizationId, code: `MF_${group}`, name: group[0] + group.slice(1).toLowerCase(), accountType: group, normalBalance, isSystemDefined: true },
    });
    groupIds.set(group, row.id);
  }
  const ledgerAccountIdByCode = new Map<string, string>();
  for (const account of SCENARIO_CHART) {
    const row = await db.ledgerAccount.create({
      data: { id: generateId(), organizationId, accountGroupId: groupIds.get(account.group)!, code: account.code, name: account.name, allowManualPosting: true, isActive: true },
    });
    ledgerAccountIdByCode.set(account.code, row.id);
  }
  const ledger = (code: string) => ledgerAccountIdByCode.get(code)!;

  const bankAccount = await s.legalEntities.createBankAccount({
    organizationId, legalEntityId, ledgerAccountId: ledger('BANK_HDFC_CURRENT'), accountName: 'Scenario Operating Account',
    bankName: 'HDFC Bank', maskedAccountNumber: '****4321', ifsc: 'HDFC0001234', actorId: makerId, correlationId: generateId(),
  });
  const bankAccountId = bankAccount.id;

  // ---------------------------------------------------------------- masters
  const category = async (code: string, name: string, ledgerCode: string) =>
    (await db.expenseCategory.create({ data: { id: generateId(), organizationId, code, name, ledgerAccountId: ledger(ledgerCode) } })).id;
  const hardwareCategoryId = await category('MF-HARDWARE', 'Hardware & Equipment', 'HARDWARE_EXPENSE');
  const travelCategoryId = await category('MF-TRAVEL', 'Travel', 'TRAVEL_EXPENSE');
  const officeCategoryId = await category('MF-OFFICE', 'Office & Admin', 'OFFICE_EXPENSE');

  const nosUnitId = (await db.unitOfMeasure.create({ data: { id: generateId(), organizationId, code: 'mf-nos', name: 'Nos' } })).id;
  const boxUnitId = (await db.unitOfMeasure.create({ data: { id: generateId(), organizationId, code: 'mf-box', name: 'Box' } })).id;
  const inventoryItemId = (await db.inventoryItem.create({
    data: { id: generateId(), organizationId, code: 'CAT6-BOX', name: 'Cat6 Cable Box (305 m)', unitOfMeasureId: boxUnitId, isStockTracked: true },
  })).id;
  const penaltyCategoryId = (await db.penaltyCategory.create({
    data: { id: generateId(), organizationId, code: 'MF-LD', name: 'Liquidated Damages', createdBy: makerId },
  })).id;
  const benchTargetId = (await db.allocationTarget.create({ data: { id: generateId(), organizationId, code: 'bench', name: 'Bench / Unallocated' } })).id;
  const introducerId = (await db.introducer.create({ data: { id: generateId(), organizationId, name: 'Mehul Consultancy' } })).id;

  // ------------------------------------------------------ clients, projects
  const clientIds = {} as Record<ClientKey, string>;
  for (const key of ['C1', 'C2', 'C3'] as const) {
    const client = await s.clients.create({
      organizationId, name: CLIENTS[key].name, shortCode: undefined, clientTypeId: undefined, department: 'IT',
      stateId: stateId(CLIENTS[key].stateCode), districtId: undefined, cityId: undefined, pinCode: undefined,
      officeAddress: undefined, gstin: undefined, internalNote: undefined, contacts: [], actorId: makerId, correlationId: generateId(),
    });
    clientIds[key] = client.id;
  }
  const projectIds = {} as Record<ProjectKey, string>;
  for (const key of ['P1', 'P2', 'P3', 'P4', 'P5'] as const) {
    const project = await s.projects.create({
      organizationId, clientId: clientIds[PROJECTS[key].client], legalEntityId, leadId: undefined, tenderId: undefined,
      projectManagerId: undefined, introducerId: key === 'P1' ? introducerId : undefined, projectTypeId: undefined,
      name: PROJECTS[key].name, description: undefined, value: PROJECTS[key].value, budget: PROJECTS[key].budget, gstApplicable: undefined,
      workOrderNumber: undefined, workOrderDate: undefined, actorId: makerId, correlationId: generateId(),
    });
    projectIds[key] = project.id;
  }

  const vendor = async (name: string, stateCode: string) =>
    (await s.vendors.create({
      organizationId, existingPartyId: undefined, name, shortCode: undefined, gstin: undefined, panNumber: undefined,
      paymentTerms: undefined, stateId: stateId(stateCode), districtId: undefined, cityId: undefined, pinCode: undefined,
      officeAddress: undefined, internalNote: undefined, actorId: makerId, correlationId: generateId(),
    })).id;
  const gujaratVendorId = await vendor('Ahmedabad Networks Pvt Ltd', 'GJ');
  const puneVendorId = await vendor('Pune Hardware Traders', 'MH');

  // -------------------------------------------------------------- employees
  // An ACTIVE user must carry a password hash (chk_users_status_password_consistency).
  // A real hash of a random, discarded password keeps the account un-loginable
  // without giving the login path a malformed hash to choke on.
  const claimantUser = await db.user.create({
    data: {
      id: generateId(), organizationId, email: `asha.patel.${options.emailSuffix}@scenario.local`, displayName: EMPLOYEES.E1.name,
      status: 'ACTIVE', passwordHash: await hashPassword(generateId()),
    },
  });
  const employeeIds = {} as Record<EmployeeKey, string>;
  for (const key of ['E1', 'E2', 'E3', 'E4'] as const) {
    const employee = await db.employee.create({
      data: {
        id: generateId(), organizationId, employeeCode: EMPLOYEES[key].code, fullName: EMPLOYEES[key].name,
        joiningDate: new Date('2025-01-01T00:00:00.000Z'),
        ...(key === 'E1' ? { userId: claimantUser.id, isReimbursable: true } : {}),
      },
    });
    employeeIds[key] = employee.id;
  }
  const revise = (key: EmployeeKey, grossAmount: string, effectiveFrom: string) =>
    s.salaryRevisions.revise({ organizationId, employeeId: employeeIds[key], grossAmount, effectiveFrom, reason: undefined, actorId: makerId, correlationId: generateId() });
  await revise('E1', '90000.00', '2026-04-01');
  await revise('E2', '75000.00', '2026-04-01');
  await revise('E3', '60000.00', '2026-04-01');
  await revise('E4', '55555.55', '2026-04-01');
  await revise('E2', '81000.00', '2026-08-01');

  // ------------------------------------------------------------- invoicing
  const capexEventIds = async (projectId: string, milestoneId: string) => {
    const overview = await s.milestones.listForProject({ organizationId, projectId, actorId: makerId, canSeeAll: true });
    return new Map(overview.capexEvents.filter((e) => e.milestoneId === milestoneId).map((e) => [e.name, e.id]));
  };
  const createCapex = async (projectKey: ProjectKey, name: string, approvedAmount: string, events: Array<{ name: string; amount: string; dueDate: string }>) => {
    const milestone = await s.milestones.createCapex({
      organizationId, projectId: projectIds[projectKey], name, approvedAmount, referenceNumber: undefined, approvalDate: undefined,
      description: undefined, alertRecipient: undefined, reminderOffsetDays: undefined, events, actorId: makerId, canSeeAll: true, ...ids(),
    });
    return capexEventIds(projectIds[projectKey], milestone.id);
  };

  const raiseInvoice = async (input: {
    projectKey: ProjectKey;
    source: { sourceEventId: string } | { sourceInstallmentId: string };
    description: string;
    taxable: string;
    invoiceDate: string;
  }) => {
    const existingAlert = await db.paymentAlert.findFirst({
      where: 'sourceEventId' in input.source ? { sourceEventId: input.source.sourceEventId } : { sourceInstallmentId: input.source.sourceInstallmentId },
    });
    const alert =
      existingAlert ??
      (await db.paymentAlert.create({
        data: {
          id: generateId(), organizationId, projectId: projectIds[input.projectKey], status: 'OPEN',
          ...('sourceEventId' in input.source
            ? { sourceType: 'CAPEX_EVENT' as const, sourceEventId: input.source.sourceEventId }
            : { sourceType: 'OPEX_INSTALLMENT' as const, sourceInstallmentId: input.source.sourceInstallmentId }),
        },
      }));
    const draft = await s.invoices.createDraftFromAlert({
      organizationId, paymentAlertId: alert.id, gstRegistrationId, dueDate: addDays(input.invoiceDate, 30), paymentTermsDays: 30,
      narrative: undefined,
      lines: [{ description: input.description, hsnSac: '998314', quantity: '1', unitPrice: input.taxable, gstRatePercent: '9' }],
      actorId: makerId, ...ids(),
    });
    return s.invoices.finalize({ organizationId, id: draft.id, expectedVersion: draft.version, invoiceDate: input.invoiceDate, actorId: makerId, ...ids() });
  };

  const p1Events = await createCapex('P1', 'Portal delivery', '2000000', [
    { name: 'Design sign-off', amount: '500000', dueDate: '2026-05-31' },
    { name: 'UAT', amount: '123456.78', dueDate: '2026-06-30' },
    { name: 'Go-live', amount: '1376543.22', dueDate: '2026-09-30' },
  ]);
  const p3Events = await createCapex('P3', 'App build', '1500000', [
    { name: 'Phase 1', amount: '600000', dueDate: '2026-06-15' },
    { name: 'Phase 2', amount: '400000', dueDate: '2026-07-25' },
    { name: 'Phase 3', amount: '500000', dueDate: '2026-10-31' },
  ]);
  const p4Events = await createCapex('P4', 'Parking rollout', '800000', [
    { name: 'Survey', amount: '200000', dueDate: '2026-07-15' },
    { name: 'Installation', amount: '600000', dueDate: '2026-08-31' },
  ]);
  const amc = await s.milestones.createOpex({
    organizationId, projectId: projectIds.P2, name: 'Data centre AMC', approvedAmount: PROJECTS.P2.value, frequency: 'MONTHLY',
    installmentCount: 12, scheduleStartDate: '2026-06-01', firstInvoiceDate: '2026-06-30', referenceNumber: undefined,
    approvalDate: undefined, description: undefined, alertRecipient: undefined, reminderOffsetDays: undefined,
    actorId: makerId, canSeeAll: true, ...ids(),
  });
  const installments = amc.installments ?? [];
  // P3 carries both kinds: the CAPEX build above plus a 36-month O&M schedule
  // whose pool does not divide evenly (5,00,000 ÷ 36).
  const oAndM = await s.milestones.createOpex({
    organizationId, projectId: projectIds.P3, name: 'O&M support', approvedAmount: '500000', frequency: 'MONTHLY',
    installmentCount: 36, scheduleStartDate: '2026-07-01', firstInvoiceDate: '2026-07-31', referenceNumber: undefined,
    approvalDate: undefined, description: undefined, alertRecipient: undefined, reminderOffsetDays: undefined,
    actorId: makerId, canSeeAll: true, ...ids(),
  });
  const oAndMInstallments = oAndM.installments ?? [];

  const inv1 = await raiseInvoice({ projectKey: 'P1', source: { sourceEventId: p1Events.get('Design sign-off')! }, description: 'Design sign-off', taxable: '500000', invoiceDate: '2026-05-25' });
  const inv2 = await raiseInvoice({ projectKey: 'P1', source: { sourceEventId: p1Events.get('UAT')! }, description: 'UAT completion', taxable: '123456.78', invoiceDate: '2026-06-28' });
  const inv3 = await raiseInvoice({ projectKey: 'P2', source: { sourceInstallmentId: installments[0]!.id }, description: 'AMC — June 2026', taxable: '100000', invoiceDate: '2026-06-30' });
  const inv4 = await raiseInvoice({ projectKey: 'P2', source: { sourceInstallmentId: installments[1]!.id }, description: 'AMC — July 2026', taxable: '100000', invoiceDate: '2026-07-31' });
  const inv5 = await raiseInvoice({ projectKey: 'P3', source: { sourceEventId: p3Events.get('Phase 1')! }, description: 'Phase 1 delivery', taxable: '600000', invoiceDate: '2026-06-15' });
  const inv6 = await raiseInvoice({ projectKey: 'P3', source: { sourceEventId: p3Events.get('Phase 2')! }, description: 'Phase 2 delivery', taxable: '400000', invoiceDate: '2026-07-25' });
  const inv7 = await raiseInvoice({ projectKey: 'P4', source: { sourceEventId: p4Events.get('Survey')! }, description: 'Site survey', taxable: '200000', invoiceDate: '2026-07-15' });
  const inv9 = await raiseInvoice({ projectKey: 'P3', source: { sourceInstallmentId: oAndMInstallments[0]!.id }, description: 'O&M — July 2026', taxable: '13888.88', invoiceDate: '2026-07-31' });
  const inv10 = await raiseInvoice({ projectKey: 'P3', source: { sourceInstallmentId: oAndMInstallments[1]!.id }, description: 'O&M — August 2026', taxable: '13888.88', invoiceDate: '2026-08-31' });
  const inv8 = await raiseInvoice({ projectKey: 'P4', source: { sourceEventId: p4Events.get('Installation')! }, description: 'Installation (raised early)', taxable: '600000', invoiceDate: '2026-08-05' });
  await s.invoices.void({ canReverseReceipts: true,
    organizationId, id: inv8.id, expectedVersion: inv8.version, reason: 'Raised before installation was complete',
    accountingDate: '2026-08-06', actorId: makerId, ...ids(),
  });

  const note = async (invoiceId: string, type: 'DEBIT' | 'CREDIT', reason: string, taxable: string) => {
    const draft = await s.creditDebitNotes.createDraft({
      organizationId, invoiceId, type, reason,
      lines: [{ description: reason, hsnSac: undefined, quantity: '1', unitPrice: taxable, gstRatePercent: '9' }],
      actorId: makerId, ...ids(),
    });
    return s.creditDebitNotes.finalize({ organizationId, id: draft.id, expectedVersion: draft.version, actorId: makerId, ...ids() });
  };
  const dn1 = await note(inv2.id, 'DEBIT', 'Additional UAT cycle', '10000');
  const cn1 = await note(inv5.id, 'CREDIT', 'Reduced scope — offline module dropped', '50000');

  // --------------------------------------------------------------- receipts
  type DeductionType = 'TDS' | 'CGST_TDS' | 'SGST_TDS' | 'IGST_TDS' | 'HOLD' | 'RETENTION' | 'ACCEPTED_PENALTY' | 'DISPUTED_PENALTY' | 'OTHER';
  const deduction = (type: DeductionType, amount: string, extra: { ratePercent?: string; narrative?: string } = {}) => ({
    type, amount, ratePercent: extra.ratePercent, narrative: extra.narrative,
    penaltyCategoryId: type === 'ACCEPTED_PENALTY' || type === 'DISPUTED_PENALTY' ? penaltyCategoryId : undefined,
    otherLedgerAccountId: type === 'OTHER' ? ledger('BANK_CHARGES') : undefined,
  });
  const receive = (receiptDate: string, utrReference: string, actualAmount: string, allocations: Array<{ invoiceId: string; cashAllocated: string; deductions: ReturnType<typeof deduction>[] }>) =>
    s.receipts.postReceipt({ organizationId, bankAccountId, paymentModeId: bankTransferModeId, receiptDate, utrReference, actualAmount, allocations, actorId: makerId, ...ids() });

  const r1 = await receive('2026-07-10', 'GIL-UTR-0710', '631500', [
    {
      invoiceId: inv1.id, cashAllocated: '517500',
      deductions: [
        deduction('TDS', '10000', { ratePercent: '2' }), deduction('CGST_TDS', '5000'), deduction('SGST_TDS', '5000'),
        deduction('RETENTION', '25000'), deduction('HOLD', '20000'), deduction('ACCEPTED_PENALTY', '7500', { narrative: 'Delay in design sign-off' }),
      ],
    },
    { invoiceId: inv3.id, cashAllocated: '114000', deductions: [deduction('TDS', '2000', { ratePercent: '2' }), deduction('CGST_TDS', '1000'), deduction('SGST_TDS', '1000')] },
  ]);
  await receive('2026-07-20', 'GIL-UTR-0720', '100000', [
    { invoiceId: inv2.id, cashAllocated: '100000', deductions: [deduction('TDS', '2469.14', { ratePercent: '2' })] },
  ]);
  await receive('2026-08-18', 'GIL-UTR-0818', '138000', [
    { invoiceId: inv4.id, cashAllocated: '118000', deductions: [] },
    { invoiceId: inv2.id, cashAllocated: '20000', deductions: [deduction('DISPUTED_PENALTY', '3000', { narrative: 'Client claims SLA breach' })] },
  ]);
  await receive('2026-07-05', 'MAHA-UTR-0705', '500000', [
    { invoiceId: inv5.id, cashAllocated: '500000', deductions: [deduction('TDS', '12000', { ratePercent: '2' }), deduction('IGST_TDS', '12000')] },
  ]);
  const r5 = await receive('2026-08-10', 'MAHA-CHQ-0810', '200000', [{ invoiceId: inv6.id, cashAllocated: '200000', deductions: [] }]);
  await s.receipts.reverseReceipt({
    organizationId, id: r5.id, expectedVersion: r5.version, reason: 'Cheque dishonoured', accountingDate: '2026-08-12', actorId: makerId, ...ids(),
  });
  await receive('2026-08-28', 'RSCL-UTR-0828', '150000', [
    {
      invoiceId: inv7.id, cashAllocated: '150000',
      deductions: [deduction('TDS', '4000', { ratePercent: '2' }), deduction('IGST_TDS', '4000'), deduction('OTHER', '1000', { narrative: 'Bank charges' })],
    },
  ]);
  // One receipt settling an OPEX invoice in full and a CAPEX invoice in part.
  await receive('2026-08-31', 'MAHA-UTR-0831', '315833.32', [
    { invoiceId: inv9.id, cashAllocated: '15833.32', deductions: [deduction('TDS', '277.78', { ratePercent: '2' }), deduction('IGST_TDS', '277.78')] },
    { invoiceId: inv6.id, cashAllocated: '300000', deductions: [deduction('TDS', '8000', { ratePercent: '2' }), deduction('IGST_TDS', '8000')] },
  ]);

  const r1Inv1 = await db.receiptAllocation.findFirstOrThrow({ where: { receiptId: r1.id, invoiceId: inv1.id }, include: { deductions: true } });
  const holdId = r1Inv1.deductions.find((d) => d.type === 'HOLD')!.id;
  const retentionId = r1Inv1.deductions.find((d) => d.type === 'RETENTION')!.id;
  const release = (deductionId: string, releasedAmount: string, releasedOn: string, utrReference: string) =>
    s.receipts.releaseDeduction({ organizationId, deductionId, releasedAmount, releasedOn, bankAccountId, utrReference, actorId: makerId, ...ids() });
  await release(holdId, '12000', '2026-08-01', 'GIL-HOLD-REL-1');
  await release(holdId, '8000', '2026-08-20', 'GIL-HOLD-REL-2');
  await release(retentionId, '10000', '2026-08-25', 'GIL-RET-REL-1');

  // ------------------------------------------------ purchases and inventory
  const billLine = (line: Partial<VendorBillLineInput> & Pick<VendorBillLineInput, 'description' | 'quantity' | 'unitPrice' | 'itcEligible'>): VendorBillLineInput => ({
    expenseCategoryId: undefined, inventoryItemId: undefined, unitOfMeasureId: nosUnitId, hsnSac: '8471', gstRatePercent: '9', ...line,
  });
  const draftBill = (projectKey: ProjectKey, vendorId: string, vendorBillNumber: string, vendorBillDate: string, lines: VendorBillLineInput[]) =>
    s.vendorBills.createDraft({
      organizationId, projectId: projectIds[projectKey], vendorId, priority: undefined, gstRegistrationId, vendorBillNumber, vendorBillDate,
      lines, actorId: makerId, canSeeAll: true, ...ids(),
    });
  const submitBill = (bill: { id: string; version: number }) =>
    s.vendorBills.submit({ organizationId, id: bill.id, expectedVersion: bill.version, actorId: makerId, canSeeAll: true, ...ids() });
  const approveBill = (bill: { id: string; version: number }) =>
    s.vendorBills.approve({ organizationId, id: bill.id, expectedVersion: bill.version, note: undefined, actorId: checkerId, canSeeAll: true, hasSelfApprovePermission: false, ...ids() });

  const vb1 = await approveBill(await submitBill(await draftBill('P1', gujaratVendorId, 'AN-1001', '2026-05-05', [
    billLine({ description: 'Managed network switches', expenseCategoryId: hardwareCategoryId, quantity: '2', unitPrice: '20000', itcEligible: true }),
    billLine({ description: 'Cat6 cable boxes (stock)', inventoryItemId, unitOfMeasureId: boxUnitId, quantity: '20', unitPrice: '2500', itcEligible: true }),
  ])));
  await approveBill(await submitBill(await draftBill('P3', puneVendorId, 'PHT-77', '2026-06-20', [
    billLine({ description: 'Field tablets', expenseCategoryId: hardwareCategoryId, quantity: '4', unitPrice: '15000', itcEligible: false }),
  ])));
  await submitBill(await draftBill('P4', gujaratVendorId, 'AN-1002', '2026-08-01', [
    billLine({ description: 'Parking sensors (awaiting approval)', expenseCategoryId: hardwareCategoryId, quantity: '1', unitPrice: '25000', itcEligible: true }),
  ]));

  const requestDraft = await s.paymentRequests.createDraft({
    organizationId, vendorId: gujaratVendorId, legalEntityId, requestedPaymentDate: '2026-06-05', priority: undefined, remarks: undefined,
    lines: [{ vendorBillId: vb1.id, requestedAmount: vb1.totalAmount! }], actorId: makerId, canSeeAll: true, ...ids(),
  });
  const requestSubmitted = await s.paymentRequests.submit({ organizationId, id: requestDraft.id, expectedVersion: requestDraft.version, actorId: makerId, canSeeAll: true, ...ids() });
  const requestApproved = await s.paymentRequests.approve({
    organizationId, id: requestSubmitted.id, expectedVersion: requestSubmitted.version, note: undefined, actorId: checkerId, canSeeAll: true, hasSelfApprovePermission: false, ...ids(),
  });
  const request = await s.paymentRequests.getDetail({ organizationId, id: requestApproved.id, actorId: makerId, canSeeAll: true });
  await s.vendorPayments.postVendorPayment({
    organizationId, bankAccountId, paymentModeId: bankTransferModeId, paymentDate: '2026-06-05', utrReference: 'AN-PAY-0605', actualAmount: '104400',
    allocations: [{ paymentRequestLineId: request.lines[0]!.id, cashPaid: '104400', deductions: [{ type: 'TDS', amount: '1800', ratePercent: '2', narrative: undefined }] }],
    actorId: makerId, ...ids(),
  });

  await s.inventory.recordReceipt({
    organizationId, legalEntityId, receiptType: 'DIRECT', partyId: gujaratVendorId, receivedDate: '2026-05-20', invoiceChallanNumber: 'AN-CH-520',
    note: undefined, lines: [{ inventoryItemId, quantity: '10', unitCostAmount: '2800' }], actorId: makerId, ...ids(),
  });
  const consume = (projectKey: ProjectKey, consumedDate: string, quantity: string) =>
    s.inventory.recordConsumption({ organizationId, legalEntityId, projectId: projectIds[projectKey], consumedDate, note: undefined, lines: [{ inventoryItemId, quantity }], actorId: makerId, ...ids() });
  await consume('P1', '2026-06-15', '12');
  await consume('P4', '2026-07-10', '5');
  // An all-stock bill on P2, dated after the issues above (the stock ledger
  // refuses back-dated movements). It adds inventory but must add no purchase
  // cost and no PURCHASE row (ADR-103).
  await approveBill(await submitBill(await draftBill('P2', gujaratVendorId, 'AN-1003', '2026-08-10', [
    billLine({ description: 'Cat6 cable boxes (stock only)', inventoryItemId, unitOfMeasureId: boxUnitId, quantity: '4', unitPrice: '2500', itcEligible: true }),
  ])));

  // ------------------------------------------------------- direct expenses
  const directExpense = async (input: {
    projectKey: ProjectKey | undefined; categoryId: string; title: string; taxable: string; date: string;
    gst: { rate: string; supplyType: 'INTRASTATE' | 'INTERSTATE'; itcEligible: boolean } | undefined; post: boolean;
  }) => {
    const draft = await s.directExpenses.createDraft({
      organizationId, expenseCategoryId: input.categoryId, vendorId: undefined, title: input.title,
      projectId: input.projectKey ? projectIds[input.projectKey] : undefined, legalEntityId: input.projectKey ? undefined : legalEntityId,
      taxableAmount: input.taxable, expenseDate: input.date, gstInvoiceAvailable: Boolean(input.gst), gstRatePercent: input.gst?.rate,
      supplyType: input.gst?.supplyType, itcEligible: input.gst?.itcEligible, tdsAmount: undefined, tdsRatePercent: undefined,
      paymentModeId: bankTransferModeId, bankAccountId, cardAccountId: undefined, transactionReference: undefined,
      purchasedByEmployeeId: undefined, note: undefined, actorId: makerId, ...ids(),
    });
    if (input.post) await s.directExpenses.post({ organizationId, id: draft.id, expectedVersion: draft.version, actorId: makerId, ...ids() });
  };
  await directExpense({ projectKey: 'P4', categoryId: hardwareCategoryId, title: 'Survey equipment hire', taxable: '10000', date: '2026-07-12', gst: { rate: '9', supplyType: 'INTERSTATE', itcEligible: true }, post: true });
  await directExpense({ projectKey: 'P1', categoryId: officeCategoryId, title: 'Printing and stationery', taxable: '7500', date: '2026-06-22', gst: { rate: '9', supplyType: 'INTRASTATE', itcEligible: false }, post: true });
  await directExpense({ projectKey: undefined, categoryId: officeCategoryId, title: 'Office rent — July', taxable: '20000', date: '2026-07-01', gst: undefined, post: true });
  await directExpense({ projectKey: 'P1', categoryId: officeCategoryId, title: 'Courier (still a draft)', taxable: '999', date: '2026-07-02', gst: undefined, post: false });

  // --------------------------------------------------------- expense claims
  const claim = async (input: { projectKey: ProjectKey; title: string; amount: string; date: string; gstCredit: string | undefined; to: 'DRAFT' | 'APPROVED' | 'REIMBURSED' }) => {
    const draft = await s.employeeExpenses.createClaimDraft({
      employeeId: undefined, hasApprovePermission: false, organizationId, expenseCategoryId: travelCategoryId, title: input.title,
      projectId: projectIds[input.projectKey], legalEntityId: undefined, amount: input.amount, expenseDate: input.date,
      gstInvoiceAvailable: input.gstCredit !== undefined, gstCreditAmount: input.gstCredit, note: undefined, actorId: claimantUser.id, ...ids(),
    });
    if (input.to === 'DRAFT') return;
    const submitted = await s.employeeExpenses.submitClaim({ organizationId, id: draft.id, expectedVersion: draft.version, actorId: claimantUser.id, hasApprovePermission: false, ...ids() });
    const approved = await s.employeeExpenses.approveClaim({ organizationId, id: submitted.id, expectedVersion: submitted.version, note: undefined, actorId: makerId, hasSelfApprovePermission: false, ...ids() });
    if (input.to === 'REIMBURSED') {
      await s.employeeExpenses.reimburseClaim({ organizationId, id: approved.id, expectedVersion: approved.version, bankAccountId, reimbursementDate: '2026-07-15', actorId: makerId, ...ids() });
    }
  };
  await claim({ projectKey: 'P3', title: 'Travel to Mumbai client site', amount: '11800', date: '2026-07-08', gstCredit: '1800', to: 'REIMBURSED' });
  await claim({ projectKey: 'P1', title: 'Local conveyance', amount: '2450', date: '2026-07-18', gstCredit: undefined, to: 'APPROVED' });
  await claim({ projectKey: 'P1', title: 'Parking receipts (not submitted)', amount: '500', date: '2026-07-20', gstCredit: undefined, to: 'DRAFT' });

  // ----------------------------------------------------------------- salary
  const postMonth = async (salaryMonth: string, accountingDate: string) => {
    const draft = await s.salaryImports.generateDraft({ organizationId, legalEntityId, salaryMonth, actorId: makerId, correlationId: generateId() });
    return s.salaryImports.commit({ organizationId, id: draft.id, accountingDate, actorId: makerId, ...ids() });
  };
  const july = await postMonth('2026-07-01', '2026-07-31');
  const august = await postMonth('2026-08-01', '2026-08-31');
  const payLine = (key: EmployeeKey, paidAmount: string, tdsAmount: string) => ({ employeeId: employeeIds[key], paidAmount, tdsAmount, referenceNumber: `SAL-JUL-${EMPLOYEES[key].code}` });
  await s.salaryImports.pay({
    organizationId, salaryImportId: july.id, bankAccountId, paymentDate: '2026-08-05', paymentModeId: bankTransferModeId, referenceNumber: 'SAL-BULK-JUL',
    lines: [payLine('E1', '90000.00', '9000.00'), payLine('E2', '75000.00', '5000.00'), payLine('E3', '60000.00', '3000.00'), payLine('E4', '55555.55', '0')],
    narrative: undefined, actorId: makerId, ...ids(),
  });

  const allocate = async (key: EmployeeKey, allocationMonth: string, lines: Array<[ProjectKey | 'bench', string]>, submit: boolean) => {
    const saved = await s.allocations.saveDraft({
      organizationId, employeeId: employeeIds[key], allocationMonth, note: undefined, expectedVersion: undefined,
      lines: lines.map(([target, percentage]) => ({
        projectId: target === 'bench' ? undefined : projectIds[target], allocationTargetId: target === 'bench' ? benchTargetId : undefined,
        percentage, contributionNote: undefined,
      })),
      actorId: makerId, correlationId: generateId(),
    });
    if (submit) await s.allocations.submit({ organizationId, employeeId: employeeIds[key], allocationMonth, expectedVersion: saved.version, actorId: makerId, correlationId: generateId() });
  };
  await allocate('E1', '2026-07-01', [['P1', '60'], ['P3', '40']], true);
  await allocate('E2', '2026-07-01', [['P1', '50'], ['P2', '30'], ['bench', '20']], true);
  await allocate('E3', '2026-07-01', [['P3', '100']], true);
  await allocate('E4', '2026-07-01', [['P1', '33.33'], ['P4', '33.33'], ['P3', '33.34']], true);
  await allocate('E1', '2026-08-01', [['P1', '100']], true);
  await allocate('E2', '2026-08-01', [['P2', '50'], ['P4', '50']], true);
  await allocate('E3', '2026-08-01', [['P3', '70'], ['bench', '30']], true);
  await allocate('E4', '2026-08-01', [['P1', '100']], false);

  // ------------------------------------------------------------- introducer
  const agreement = await s.introducerFees.createAgreement({
    organizationId, introducerId, projectId: projectIds.P1, basisType: 'PERCENT_OF_PROJECT_VALUE', ratePercent: '2.5', fixedAmount: undefined,
    agreementDate: '2026-05-01', remarks: undefined, actorId: makerId, ...ids(),
  });
  const accrue = (accrualDate: string, amount: string, narrative: string) =>
    s.introducerFees.postAccrual({ organizationId, introducerAgreementId: agreement.id, accrualDate, amount, narrative, actorId: makerId, ...ids() });
  const accrual1 = await accrue('2026-06-20', '20000', 'On design sign-off');
  const accrual2 = await accrue('2026-08-05', '15000', 'On UAT');
  await s.introducerFees.postPayment({
    organizationId, introducerId, legalEntityId, bankAccountId, paymentDate: '2026-08-25', paymentModeId: bankTransferModeId, referenceNumber: 'INTRO-NEFT-0825',
    grossAmount: '30000', tdsAmount: '3000', narrative: undefined,
    allocations: [{ introducerAccrualId: accrual1.id, allocatedAmount: '20000' }, { introducerAccrualId: accrual2.id, allocatedAmount: '10000' }],
    actorId: makerId, ...ids(),
  });

  // ----------------------------------------------------- TDS deposits (8.5b)
  // Challans paying tax withheld above; see TDS_OUTWARD_ALL_TIME.
  const vendorTds = await prisma.client.vendorPaymentDeduction.findFirstOrThrow({ where: { organizationId, type: 'TDS' }, select: { id: true } });
  const salaryTds = async (key: EmployeeKey) => (await prisma.client.salaryPaymentLine.findFirstOrThrow({ where: { organizationId, employeeId: employeeIds[key] }, select: { id: true } })).id;
  const introducerPayment = await prisma.client.introducerPayment.findFirstOrThrow({ where: { organizationId }, select: { id: true } });
  const deposit = (challanNumber: string, depositDate: string, allocations: Array<{ sourceKind: 'VENDOR_PAYMENT_DEDUCTION' | 'SALARY_PAYMENT_LINE' | 'INTRODUCER_PAYMENT'; sourceId: string; amount: string }>) =>
    s.tdsDeposits.post({ organizationId, legalEntityId, bankAccountId, deductionType: 'TDS', challanNumber, depositDate, remarks: undefined, allocations, actorId: checkerId, ...ids() });
  await deposit('CIN-0001', '2026-07-07', [{ sourceKind: 'VENDOR_PAYMENT_DEDUCTION', sourceId: vendorTds.id, amount: '1800' }]);
  await deposit('CIN-0002', '2026-09-05', [
    { sourceKind: 'INTRODUCER_PAYMENT', sourceId: introducerPayment.id, amount: '3000' },
    { sourceKind: 'SALARY_PAYMENT_LINE', sourceId: await salaryTds('E1'), amount: '9000' },
  ]);
  const wrongChallan = await deposit('CIN-0099', '2026-09-05', [{ sourceKind: 'SALARY_PAYMENT_LINE', sourceId: await salaryTds('E2'), amount: '5000' }]);
  await s.tdsDeposits.reverse({ organizationId, id: wrongChallan.id, reason: 'Challan paid under the wrong TAN', accountingDate: '2026-09-06', expectedVersion: wrongChallan.version, actorId: checkerId, ...ids() });

  // ------------------------------------------------- TDS certificates (8.5a)
  // Matched to the client deductions above; see TDS_INWARD_ALL_TIME.
  const deductionId = async (invoiceId: string, type: 'TDS' | 'CGST_TDS' | 'SGST_TDS' | 'IGST_TDS') =>
    (await prisma.client.allocationDeduction.findFirstOrThrow({ where: { organizationId, type, allocation: { invoiceId, receipt: { status: 'POSTED' } } }, select: { id: true } })).id;
  const certificate = (partyId: string, source: 'CERTIFICATE' | 'STATEMENT', deductionType: 'TDS' | 'CGST_TDS' | 'SGST_TDS' | 'IGST_TDS', referenceNumber: string, periodStart: string, periodEnd: string, creditDate: string, amount: string) =>
    s.tdsCertificates.record({
      organizationId, legalEntityId, partyId, source, deductionType, referenceNumber, deductorTan: undefined, deductorGstin: undefined,
      periodStart, periodEnd, creditDate, amount, remarks: undefined, actorId: checkerId, ...ids(),
    });
  const matchTo = (certificateId: string, matches: Array<{ deductionId: string; amount: string }>) =>
    s.tdsCertificates.match({ organizationId, certificateId, matches, actorId: checkerId, ...ids() });

  const gil16A = await certificate(clientIds.C1, 'CERTIFICATE', 'TDS', 'GIL/16A/Q2/0001', '2026-07-01', '2026-09-30', '2026-10-15', '14469.14');
  await matchTo(gil16A.id, [
    { deductionId: await deductionId(inv1.id, 'TDS'), amount: '10000' },
    { deductionId: await deductionId(inv3.id, 'TDS'), amount: '2000' },
    { deductionId: await deductionId(inv2.id, 'TDS'), amount: '2469.14' },
  ]);
  const gil26As = await certificate(clientIds.C1, 'STATEMENT', 'TDS', '26AS-GIL-202607', '2026-07-01', '2026-07-31', '2026-07-10', '12000');
  await matchTo(gil26As.id, [
    { deductionId: await deductionId(inv1.id, 'TDS'), amount: '10000' },
    { deductionId: await deductionId(inv3.id, 'TDS'), amount: '2000' },
  ]);
  const maha16A = await certificate(clientIds.C2, 'CERTIFICATE', 'TDS', 'MAHA/16A/Q2/0007', '2026-07-01', '2026-09-30', '2026-10-10', '15000');
  await matchTo(maha16A.id, [{ deductionId: await deductionId(inv5.id, 'TDS'), amount: '12000' }]); // 3,000 of it matches nothing
  const rscl7A = await certificate(clientIds.C3, 'CERTIFICATE', 'IGST_TDS', 'RSCL/GSTR7A/2026-08', '2026-08-01', '2026-08-31', '2026-09-10', '4000');
  await matchTo(rscl7A.id, [{ deductionId: await deductionId(inv7.id, 'IGST_TDS'), amount: '2500' }]); // partial
  const wrong = await certificate(clientIds.C1, 'STATEMENT', 'CGST_TDS', 'GST-CR-GIL-2607-X', '2026-07-01', '2026-07-31', '2026-07-10', '6000');
  await s.tdsCertificates.cancel({ organizationId, id: wrong.id, reason: 'Recorded against the wrong month', expectedVersion: wrong.version, actorId: checkerId, ...ids() });

  return {
    organizationId,
    legalEntityId,
    clientIds,
    projectIds,
    employeeIds,
    invoiceIds: { INV1: inv1.id, INV2: inv2.id, INV3: inv3.id, INV4: inv4.id, INV5: inv5.id, INV6: inv6.id, INV7: inv7.id, INV8: inv8.id, INV9: inv9.id, INV10: inv10.id },
    noteIds: { DN1: dn1.id, CN1: cn1.id },
    tdsCertificateIds: { GIL_16A_Q2: gil16A.id, GIL_26AS_JUL: gil26As.id, MAHA_16A_Q2: maha16A.id, RSCL_7A_AUG: rscl7A.id, GIL_CANCELLED: wrong.id },
    inventoryItemId,
    salaryImportIds: { july: july.id, august: august.id },
    ledgerAccountIdByCode,
  };
}
