import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ClientsService } from '../clients/clients.service';
import { FinancialYearService } from '../organization/financial-year.service';
import { LegalEntityService } from '../organization/legal-entity.service';
import { PostingService } from '../accounting/posting.service';
import { EmployeeExpensesService } from './employee-expenses.service';

const prisma = new PrismaService();
const projects = new ProjectsService(prisma);
const clients = new ClientsService(prisma);
const financialYears = new FinancialYearService(prisma);
const legalEntities = new LegalEntityService(prisma);
const posting = new PostingService(prisma);
const employeeExpenses = new EmployeeExpensesService(prisma, posting);

let organizationId: string;
let otherOrganizationId: string;
let clientId: string;
let legalEntityId: string;
let projectId: string;
let expenseCategoryId: string;
let bankAccountId: string;
let paymentModeId: string;
let reimbursableEmployeeId: string;
let reimbursableUserId: string;
let nonReimbursableEmployeeId: string;
let nonReimbursableUserId: string;
let noLoginEmployeeId: string;
const accountantActorId = generateId();

/** Gives a user employee_claim.approve, and with seesAll every legal entity (as Admin): only such users approve a legal entity's claims (ADR-182). */
async function grantClaimApproval(userId: string, seesAll: boolean): Promise<string> {
  const keys = seesAll ? ['employee_claim.approve', 'legal_entity.access_all'] : ['employee_claim.approve'];
  const permissions = await prisma.client.permission.findMany({ where: { key: { in: keys } } });
  const role = await prisma.client.role.create({ data: { id: generateId(), organizationId, name: `EE Approver ${generateId().slice(-6)}`, isSystem: false } });
  for (const permission of permissions) await prisma.client.rolePermission.create({ data: { id: generateId(), roleId: role.id, permissionId: permission.id } });
  await prisma.client.userRole.create({ data: { id: generateId(), organizationId, userId, roleId: role.id } });
  return role.id;
}

async function createApprovedClaim(input: { amount: string; gstInvoiceAvailable?: boolean; gstCreditAmount?: string; title?: string; projectId?: string }) {
  const draft = await employeeExpenses.createClaimDraft({
    employeeId: undefined,
    hasApprovePermission: false,
    organizationId,
    expenseCategoryId,
    title: input.title ?? 'Test expense',
    projectId: input.projectId ?? projectId,
    legalEntityId: undefined,
    amount: input.amount,
    expenseDate: '2026-06-01',
    gstInvoiceAvailable: input.gstInvoiceAvailable ?? false,
    gstCreditAmount: input.gstCreditAmount,
    note: undefined,
    idempotencyKey: generateId(),
    actorId: reimbursableUserId,
    correlationId: generateId(),
  });
  const submitted = await employeeExpenses.submitClaim({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId: reimbursableUserId, hasApprovePermission: false, correlationId: generateId() });
  return employeeExpenses.approveClaim({
    organizationId,
    id: submitted.id,
    expectedVersion: submitted.version,
    note: undefined,
    idempotencyKey: generateId(),
    actorId: accountantActorId,
    hasSelfApprovePermission: false,
    correlationId: generateId(),
  });
}

beforeAll(async () => {
  const organization = await prisma.client.organization.create({ data: { id: generateId(), name: 'Employee Expenses Test Org', code: `EETEST-${generateId()}` } });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({ data: { id: generateId(), name: 'Employee Expenses Test Other Org', code: `EETEST-OTHER-${generateId()}` } });
  otherOrganizationId = otherOrg.id;

  const client = await clients.create({
    organizationId, name: 'EE Test Client', shortCode: undefined, clientTypeId: undefined, department: 'IT', stateId: undefined, districtId: undefined, cityId: undefined,
    pinCode: undefined, officeAddress: undefined, gstin: undefined, internalNote: undefined, contacts: [], actorId: accountantActorId, correlationId: generateId(),
  });
  clientId = client.id;

  const legalEntity = await prisma.client.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'EE Test Legal Entity', panNumber: 'ABCEE1234P', registeredAddress: 'Gandhinagar, Gujarat' },
  });
  legalEntityId = legalEntity.id;

  await financialYears.create({ organizationId, legalEntityId, label: 'FY2026', startDate: '2026-01-01', endDate: '2026-12-31', setCurrent: true, actorId: accountantActorId, correlationId: generateId() });

  const project = await projects.create({
    organizationId, clientId, legalEntityId, leadId: undefined, tenderId: undefined, projectManagerId: undefined, introducerId: undefined, projectTypeId: undefined,
    name: 'EE Test Project', description: undefined, value: undefined, budget: undefined, gstApplicable: undefined, workOrderNumber: undefined, workOrderDate: undefined,
    actorId: accountantActorId, correlationId: generateId(),
  });
  projectId = project.id;

  const assetGroup = await prisma.client.accountGroup.create({ data: { id: generateId(), organizationId, code: 'EE_ASSETS', name: 'Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: true } });
  const expenseGroup = await prisma.client.accountGroup.create({ data: { id: generateId(), organizationId, code: 'EE_EXPENSES', name: 'Expenses', accountType: 'EXPENSE', normalBalance: 'DEBIT', isSystemDefined: true } });

  const ledgerCodes: Array<{ code: string; groupId: string; name: string }> = [
    { code: 'EMPLOYEE_ADVANCE_RECEIVABLE', groupId: assetGroup.id, name: 'Employee Advance Receivable' },
    { code: 'INPUT_GST_RECEIVABLE_EXPENSE', groupId: assetGroup.id, name: 'Input GST Receivable — Expense Claims' },
    { code: 'TRAVEL_EXPENSE', groupId: expenseGroup.id, name: 'Travel Expense' },
    { code: 'OTHER_EXPENSES', groupId: expenseGroup.id, name: 'Other Expenses' },
    { code: 'HDFC_CURRENT_ACCOUNT', groupId: assetGroup.id, name: 'HDFC Current Account' },
  ];
  const createdLedgerAccounts = new Map<string, string>();
  for (const l of ledgerCodes) {
    const row = await prisma.client.ledgerAccount.create({ data: { id: generateId(), organizationId, accountGroupId: l.groupId, code: l.code, name: l.name, allowManualPosting: true, isActive: true } });
    createdLedgerAccounts.set(l.code, row.id);
  }

  const expenseCategory = await prisma.client.expenseCategory.create({
    data: { id: generateId(), organizationId, code: 'EE-TRAVEL', name: 'Travel', ledgerAccountId: createdLedgerAccounts.get('TRAVEL_EXPENSE')! },
  });
  expenseCategoryId = expenseCategory.id;

  const bankAccount = await legalEntities.createBankAccount({
    organizationId, legalEntityId, ledgerAccountId: createdLedgerAccounts.get('HDFC_CURRENT_ACCOUNT')!,
    accountName: 'HDFC Operating Account', bankName: 'HDFC Bank', maskedAccountNumber: '****4471', ifsc: 'HDFC0000123',
    actorId: accountantActorId, correlationId: generateId(),
  });
  bankAccountId = bankAccount.id;

  paymentModeId = (await prisma.client.paymentMode.findFirstOrThrow()).id;

  const reimbursableUser = await prisma.client.user.create({ data: { id: generateId(), organizationId, email: 'ee-reimbursable@zitaware.test', passwordHash: 'test-hash', displayName: 'EE Reimbursable Employee', status: 'ACTIVE' } });
  reimbursableUserId = reimbursableUser.id;
  const reimbursableEmployee = await prisma.client.employee.create({
    data: { id: generateId(), organizationId, userId: reimbursableUserId, employeeCode: 'EMP-EE-1', fullName: 'R. Shah', joiningDate: new Date('2024-01-01'), isReimbursable: true },
  });
  reimbursableEmployeeId = reimbursableEmployee.id;
  // The accountant approves every legal entity's claims, as Admin does.
  await prisma.client.user.create({ data: { id: accountantActorId, organizationId, email: 'ee-accountant@zitaware.test', passwordHash: 'test-hash', displayName: 'EE Accountant', status: 'ACTIVE' } });
  await grantClaimApproval(accountantActorId, true);

  const nonReimbursableUser = await prisma.client.user.create({ data: { id: generateId(), organizationId, email: 'ee-nonreimbursable@zitaware.test', passwordHash: 'test-hash', displayName: 'EE Non-Reimbursable Employee', status: 'ACTIVE' } });
  nonReimbursableUserId = nonReimbursableUser.id;
  const nonReimbursableEmployee = await prisma.client.employee.create({
    data: { id: generateId(), organizationId, userId: nonReimbursableUserId, employeeCode: 'EMP-EE-2', fullName: 'A. Mehta', joiningDate: new Date('2024-01-01'), isReimbursable: false },
  });
  nonReimbursableEmployeeId = nonReimbursableEmployee.id;

  const noLoginEmployee = await prisma.client.employee.create({
    data: { id: generateId(), organizationId, userId: null, employeeCode: 'EMP-EE-3', fullName: 'K. Patel (field staff)', joiningDate: new Date('2024-01-01'), isReimbursable: true },
  });
  noLoginEmployeeId = noLoginEmployee.id;
});

afterAll(async () => {
  const orgIds = [organizationId, otherOrganizationId];
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.idempotencyKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.employeeExpenseClaimDecision.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.employeeExpenseClaim.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.employeeAdvance.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.expenseCategory.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalEntry.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.bankAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.employee.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.userRole.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.rolePermission.deleteMany({ where: { role: { organizationId: { in: orgIds } } } });
  await prisma.client.role.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.user.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.projectTeamMember.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.project.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountingPeriod.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.financialYear.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.contact.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.clientProfile.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.party.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.legalEntity.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.client.$disconnect();
});

describe('EmployeeExpensesService — claim approvers per legal entity (ADR-171)', () => {
  it('works out approvers from each approver\'s own legal entity, shows who is waited for and who decided', async () => {
    const permission = await prisma.client.permission.findUniqueOrThrow({ where: { key: 'employee_claim.approve' } });
    const role = await prisma.client.role.create({ data: { id: generateId(), organizationId, name: `Claim Approver ${generateId().slice(-6)}`, isSystem: false } });
    await prisma.client.rolePermission.create({ data: { id: generateId(), roleId: role.id, permissionId: permission.id } });
    const otherEntity = await prisma.client.legalEntity.create({ data: { id: generateId(), organizationId, legalName: 'EE Other Entity Pvt Ltd', panNumber: 'EEOTH1234Q', registeredAddress: 'Surat' } });
    const approver = async (name: string, employeeLegalEntityId: string) => {
      const user = await prisma.client.user.create({ data: { id: generateId(), organizationId, email: `ee-${generateId()}@zitaware.test`, passwordHash: 'test-hash', displayName: name, status: 'ACTIVE' } });
      await prisma.client.userRole.create({ data: { id: generateId(), organizationId, userId: user.id, roleId: role.id } });
      await prisma.client.employee.create({ data: { id: generateId(), organizationId, userId: user.id, legalEntityId: employeeLegalEntityId, employeeCode: `EE-APR-${generateId().slice(-6)}`, fullName: name, joiningDate: new Date('2026-01-01') } });
      return user.id;
    };
    const asha = await approver('Asha Approver', legalEntityId);
    const ravi = await approver('Ravi Approver', otherEntity.id);

    try {
      const listed = (await employeeExpenses.listClaimApprovers({ organizationId })).entities;
      // Each legal entity's own approver, plus the one who sees every legal entity; never one from another legal entity (ADR-182).
      expect(listed.find((e) => e.legalEntityId === legalEntityId)).toMatchObject({ rule: 'LISTED', approvers: [{ userId: asha, name: 'Asha Approver' }, { userId: accountantActorId, name: 'EE Accountant' }] });
      expect(listed.find((e) => e.legalEntityId === otherEntity.id)).toMatchObject({ rule: 'LISTED', approvers: [{ userId: accountantActorId, name: 'EE Accountant' }, { userId: ravi, name: 'Ravi Approver' }] });

      const draft = await employeeExpenses.createClaimDraft({
        employeeId: undefined, hasApprovePermission: false, organizationId, expenseCategoryId, title: 'Approver test', projectId, legalEntityId: undefined, amount: '500',
        expenseDate: '2026-06-01', gstInvoiceAvailable: false, gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: reimbursableUserId, correlationId: generateId(),
      });
      const submitted = await employeeExpenses.submitClaim({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId: reimbursableUserId, hasApprovePermission: false, correlationId: generateId() });
      const waiting = (await employeeExpenses.listClaims({ organizationId, page: 1, pageSize: 50, filters: { status: 'SUBMITTED' } })).rows.find((r) => r.id === submitted.id)!;
      expect(waiting.approval).toEqual({ rule: 'LISTED', approverNames: ['Asha Approver', 'EE Accountant'], approverUserIds: [asha, accountantActorId] });

      const approve = (actorId: string) =>
        employeeExpenses.approveClaim({ organizationId, id: submitted.id, expectedVersion: submitted.version, note: undefined, idempotencyKey: generateId(), actorId, hasSelfApprovePermission: false, correlationId: generateId() });
      await expect(approve(ravi)).rejects.toThrow('Only Asha Approver, EE Accountant approve expense claims');
      await approve(asha);
      const detail = await employeeExpenses.getClaimDetail({ organizationId, id: submitted.id, actorId: asha, hasReadPermission: true });
      expect([detail.lastDecision?.decision, detail.lastDecision?.byName, detail.decisions[0]?.actorName]).toEqual(['APPROVED', 'Asha Approver', 'Asha Approver']);
    } finally {
      await prisma.client.userRole.deleteMany({ where: { roleId: role.id } });
    }
  });
});

describe('EmployeeExpensesService — issueAdvance', () => {
  it('posts Dr Employee Advance Receivable / Cr Bank, and rejects a non-reimbursable employee', async () => {
    const advance = await employeeExpenses.issueAdvance({
      organizationId, employeeId: reimbursableEmployeeId, projectId: undefined, legalEntityId, amount: '10000', advanceDate: '2026-06-01',
      paymentModeId, bankAccountId, utrReference: undefined, purpose: 'General field expenses', note: undefined,
      idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId(),
    });
    expect(advance.status).toBe('POSTED');
    expect(advance.amount).toBe('10000.00');

    const journalDetail = await posting.getEntryDetail({ organizationId, id: advance.journalEntryId! });
    const debitLines = journalDetail.lines.filter((l) => Number(l.debitAmount) > 0);
    const creditLines = journalDetail.lines.filter((l) => Number(l.creditAmount) > 0);
    expect(debitLines.map((l) => l.ledgerAccountCode)).toEqual(['EMPLOYEE_ADVANCE_RECEIVABLE']);
    expect(creditLines.map((l) => l.ledgerAccountCode)).toEqual(['HDFC_CURRENT_ACCOUNT']);

    await expect(
      employeeExpenses.issueAdvance({
        organizationId, employeeId: nonReimbursableEmployeeId, projectId: undefined, legalEntityId, amount: '5000', advanceDate: '2026-06-01',
        paymentModeId, bankAccountId, utrReference: undefined, purpose: undefined, note: undefined,
        idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId(),
      }),
    ).rejects.toThrow('not marked as reimbursement-eligible');
  });

  it('is idempotent — a repeated call with the same key returns the original record', async () => {
    const key = generateId();
    const input = {
      organizationId, employeeId: reimbursableEmployeeId, projectId: undefined, legalEntityId, amount: '1000', advanceDate: '2026-06-02',
      paymentModeId, bankAccountId, utrReference: undefined, purpose: undefined, note: undefined,
      idempotencyKey: key, actorId: accountantActorId, correlationId: generateId(),
    };
    const first = await employeeExpenses.issueAdvance(input);
    const second = await employeeExpenses.issueAdvance({ ...input, correlationId: generateId() });
    expect(second.id).toBe(first.id);
  });

  it('reverses an advance, restoring the journal to a mirrored state', async () => {
    const advance = await employeeExpenses.issueAdvance({
      organizationId, employeeId: reimbursableEmployeeId, projectId: undefined, legalEntityId, amount: '2000', advanceDate: '2026-06-03',
      paymentModeId, bankAccountId, utrReference: undefined, purpose: undefined, note: undefined,
      idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId(),
    });
    const reversed = await employeeExpenses.reverseAdvance({
      organizationId, id: advance.id, expectedVersion: advance.version, reason: 'Wrong employee selected', accountingDate: '2026-06-04',
      idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId(),
    });
    expect(reversed.status).toBe('REVERSED');

    const reversalDetail = await posting.getEntryDetail({ organizationId, id: reversed.reversalJournalEntryId! });
    expect(reversalDetail.reversalOfJournalEntryId).toBe(advance.journalEntryId);

    // Once already REVERSED, a second reversal attempt hits the terminal-
    // state check before any version comparison.
    await expect(
      employeeExpenses.reverseAdvance({ organizationId, id: advance.id, expectedVersion: reversed.version, reason: 'Again', accountingDate: '2026-06-04', idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId() }),
    ).rejects.toThrow('already been reversed');
  });

  it('rejects a stale expectedVersion on reverseAdvance', async () => {
    const advance = await employeeExpenses.issueAdvance({
      organizationId, employeeId: reimbursableEmployeeId, projectId: undefined, legalEntityId, amount: '1500', advanceDate: '2026-06-03',
      paymentModeId, bankAccountId, utrReference: undefined, purpose: undefined, note: undefined,
      idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId(),
    });
    await expect(
      employeeExpenses.reverseAdvance({ organizationId, id: advance.id, expectedVersion: advance.version + 1, reason: 'Stale', accountingDate: '2026-06-04', idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId() }),
    ).rejects.toThrow('changed by someone else');
  });
});

describe('EmployeeExpensesService — claim state machine (create/submit/reject/cancel)', () => {
  it('creates a draft, submits, and rejects with a mandatory reason', async () => {
    const draft = await employeeExpenses.createClaimDraft({
    employeeId: undefined,
    hasApprovePermission: false,
      organizationId, expenseCategoryId, title: 'Site travel', projectId, legalEntityId: undefined, amount: '2400', expenseDate: '2026-06-05',
      gstInvoiceAvailable: false, gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: reimbursableUserId, correlationId: generateId(),
    });
    expect(draft.status).toBe('DRAFT');
    expect(draft.employeeId).toBe(reimbursableEmployeeId);

    const submitted = await employeeExpenses.submitClaim({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId: reimbursableUserId, hasApprovePermission: false, correlationId: generateId() });
    expect(submitted.status).toBe('SUBMITTED');

    await expect(
      employeeExpenses.rejectClaim({ organizationId, id: submitted.id, expectedVersion: submitted.version, reason: '  ', idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId() }),
    ).rejects.toThrow('reason is required');

    const rejected = await employeeExpenses.rejectClaim({ organizationId, id: submitted.id, expectedVersion: submitted.version, reason: 'Not eligible', idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId() });
    expect(rejected.status).toBe('REJECTED');
  });

  it('rejects a non-reimbursable employee creating a claim, and rejects editing/submitting someone else\'s draft', async () => {
    const otherUser = await prisma.client.user.create({ data: { id: generateId(), organizationId, email: `ee-other-${generateId()}@zitaware.test`, passwordHash: 'test-hash', displayName: 'EE Other User', status: 'ACTIVE' } });

    await expect(
      employeeExpenses.createClaimDraft({
    employeeId: undefined,
    hasApprovePermission: false,
        organizationId, expenseCategoryId, title: 'Not allowed', projectId, legalEntityId: undefined, amount: '100', expenseDate: '2026-06-05',
        gstInvoiceAvailable: false, gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: otherUser.id, correlationId: generateId(),
      }),
    ).rejects.toThrow('No employee record is linked');

    const draft = await employeeExpenses.createClaimDraft({
    employeeId: undefined,
    hasApprovePermission: false,
      organizationId, expenseCategoryId, title: 'Ownership test', projectId, legalEntityId: undefined, amount: '500', expenseDate: '2026-06-05',
      gstInvoiceAvailable: false, gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: reimbursableUserId, correlationId: generateId(),
    });

    await expect(
      employeeExpenses.submitClaim({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId: nonReimbursableUserId, hasApprovePermission: false, correlationId: generateId() }),
    ).rejects.toThrow('your own expense claim');
  });

  it('cancels a draft, creator-only, with a mandatory reason', async () => {
    const draft = await employeeExpenses.createClaimDraft({
    employeeId: undefined,
    hasApprovePermission: false,
      organizationId, expenseCategoryId, title: 'Cancel me', projectId, legalEntityId: undefined, amount: '300', expenseDate: '2026-06-05',
      gstInvoiceAvailable: false, gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: reimbursableUserId, correlationId: generateId(),
    });
    const cancelled = await employeeExpenses.cancelClaim({ organizationId, id: draft.id, expectedVersion: draft.version, reason: 'No longer needed', idempotencyKey: generateId(), actorId: reimbursableUserId, hasApprovePermission: false, correlationId: generateId() });
    expect(cancelled.status).toBe('CANCELLED');
  });
});

describe('EmployeeExpensesService — createClaimDraft on behalf of an employee with no CRM login', () => {
  it('lets an actor with employee_claim.approve raise, edit, submit, and cancel a claim for another employee', async () => {
    const draft = await employeeExpenses.createClaimDraft({
      employeeId: noLoginEmployeeId,
      hasApprovePermission: true,
      organizationId, expenseCategoryId, title: 'Field diesel — on behalf', projectId, legalEntityId: undefined, amount: '800', expenseDate: '2026-06-06',
      gstInvoiceAvailable: false, gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId(),
    });
    expect(draft.status).toBe('DRAFT');
    expect(draft.employeeId).toBe(noLoginEmployeeId);

    const updated = await employeeExpenses.updateClaimDraft({
      organizationId, id: draft.id, expectedVersion: draft.version, expenseCategoryId: undefined, title: 'Field diesel — updated', projectId: undefined, legalEntityId: undefined,
      amount: undefined, expenseDate: undefined, gstInvoiceAvailable: undefined, gstCreditAmount: undefined, note: undefined, actorId: accountantActorId, hasApprovePermission: true, correlationId: generateId(),
    });
    expect(updated.title).toBe('Field diesel — updated');

    const submitted = await employeeExpenses.submitClaim({ organizationId, id: updated.id, expectedVersion: updated.version, idempotencyKey: generateId(), actorId: accountantActorId, hasApprovePermission: true, correlationId: generateId() });
    expect(submitted.status).toBe('SUBMITTED');

    const cancelled = await employeeExpenses.cancelClaim({ organizationId, id: submitted.id, expectedVersion: submitted.version, reason: 'Duplicate entry', idempotencyKey: generateId(), actorId: accountantActorId, hasApprovePermission: true, correlationId: generateId() });
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('rejects a plain employee (no employee_claim.approve) from creating, editing, or submitting a claim for someone else', async () => {
    await expect(
      employeeExpenses.createClaimDraft({
        employeeId: noLoginEmployeeId,
        hasApprovePermission: false,
        organizationId, expenseCategoryId, title: 'Not allowed', projectId, legalEntityId: undefined, amount: '100', expenseDate: '2026-06-06',
        gstInvoiceAvailable: false, gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: reimbursableUserId, correlationId: generateId(),
      }),
    ).rejects.toThrow('You do not have permission to create an expense claim on behalf of another employee.');

    const draft = await employeeExpenses.createClaimDraft({
      employeeId: noLoginEmployeeId,
      hasApprovePermission: true,
      organizationId, expenseCategoryId, title: 'Own by accountant', projectId, legalEntityId: undefined, amount: '150', expenseDate: '2026-06-06',
      gstInvoiceAvailable: false, gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId(),
    });

    await expect(
      employeeExpenses.updateClaimDraft({
        organizationId, id: draft.id, expectedVersion: draft.version, expenseCategoryId: undefined, title: 'Hijacked', projectId: undefined, legalEntityId: undefined,
        amount: undefined, expenseDate: undefined, gstInvoiceAvailable: undefined, gstCreditAmount: undefined, note: undefined, actorId: reimbursableUserId, hasApprovePermission: false, correlationId: generateId(),
      }),
    ).rejects.toThrow('your own expense claim');

    await expect(
      employeeExpenses.submitClaim({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId: reimbursableUserId, hasApprovePermission: false, correlationId: generateId() }),
    ).rejects.toThrow('your own expense claim');
  });
});

describe('EmployeeExpensesService — approveClaim (journal shape, self-approval)', () => {
  it('posts Dr Expense / Cr Employee Advance Receivable for a plain claim with no GST credit', async () => {
    const approved = await createApprovedClaim({ amount: '2400', title: 'Plain claim' });
    expect(approved.status).toBe('APPROVED');

    const journalDetail = await posting.getEntryDetail({ organizationId, id: approved.journalEntryId! });
    const debitLines = journalDetail.lines.filter((l) => Number(l.debitAmount) > 0);
    const creditLines = journalDetail.lines.filter((l) => Number(l.creditAmount) > 0);
    expect(debitLines.map((l) => l.ledgerAccountCode)).toEqual(['TRAVEL_EXPENSE']);
    expect(debitLines[0]!.debitAmount).toBe('2400.00');
    expect(creditLines.map((l) => l.ledgerAccountCode)).toEqual(['EMPLOYEE_ADVANCE_RECEIVABLE']);
    expect(creditLines[0]!.creditAmount).toBe('2400.00');
  });

  it('splits the flat GST credit into its own Input GST Receivable line', async () => {
    const approved = await createApprovedClaim({ amount: '5000', gstInvoiceAvailable: true, gstCreditAmount: '500', title: 'Claim with GST' });
    const journalDetail = await posting.getEntryDetail({ organizationId, id: approved.journalEntryId! });
    const byCode = new Map(journalDetail.lines.map((l) => [l.ledgerAccountCode, l.debitAmount]));
    expect(byCode.get('TRAVEL_EXPENSE')).toBe('4500.00');
    expect(byCode.get('INPUT_GST_RECEIVABLE_EXPENSE')).toBe('500.00');
    const creditLine = journalDetail.lines.find((l) => l.ledgerAccountCode === 'EMPLOYEE_ADVANCE_RECEIVABLE')!;
    expect(creditLine.creditAmount).toBe('5000.00');
  });

  it('rejects claiming GST credit without a GST invoice available', async () => {
    await expect(
      employeeExpenses.createClaimDraft({
    employeeId: undefined,
    hasApprovePermission: false,
        organizationId, expenseCategoryId, title: 'No invoice', projectId, legalEntityId: undefined, amount: '1000', expenseDate: '2026-06-05',
        gstInvoiceAvailable: false, gstCreditAmount: '100', note: undefined, idempotencyKey: generateId(), actorId: reimbursableUserId, correlationId: generateId(),
      }),
    ).rejects.toThrow('GST invoice must be available');
  });

  it('rejects self-approval without the permission, and without a mandatory note even with the permission', async () => {
    const draft = await employeeExpenses.createClaimDraft({
    employeeId: undefined,
    hasApprovePermission: false,
      organizationId, expenseCategoryId, title: 'Self approve test', projectId, legalEntityId: undefined, amount: '900', expenseDate: '2026-06-05',
      gstInvoiceAvailable: false, gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: reimbursableUserId, correlationId: generateId(),
    });
    const submitted = await employeeExpenses.submitClaim({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId: reimbursableUserId, hasApprovePermission: false, correlationId: generateId() });
    // The claimant is an approver too, so only the self-approval rule stands in the way.
    const roleId = await grantClaimApproval(reimbursableUserId, true);
    onTestFinished(() => prisma.client.userRole.deleteMany({ where: { roleId } }).then(() => undefined));

    await expect(
      employeeExpenses.approveClaim({ organizationId, id: submitted.id, expectedVersion: submitted.version, note: 'trying anyway', idempotencyKey: generateId(), actorId: reimbursableUserId, hasSelfApprovePermission: false, correlationId: generateId() }),
    ).rejects.toThrow('cannot approve your own');

    await expect(
      employeeExpenses.approveClaim({ organizationId, id: submitted.id, expectedVersion: submitted.version, note: undefined, idempotencyKey: generateId(), actorId: reimbursableUserId, hasSelfApprovePermission: true, correlationId: generateId() }),
    ).rejects.toThrow('justification note is required');

    const selfApproved = await employeeExpenses.approveClaim({
      organizationId, id: submitted.id, expectedVersion: submitted.version, note: 'I am the only approver available today', idempotencyKey: generateId(), actorId: reimbursableUserId, hasSelfApprovePermission: true, correlationId: generateId(),
    });
    expect(selfApproved.status).toBe('APPROVED');
    const detail = await employeeExpenses.getClaimDetail({ organizationId, id: selfApproved.id, actorId: accountantActorId, hasReadPermission: true });
    expect(detail.decisions[0]!.isSelfApproval).toBe(true);
  });

  it('is idempotent — a repeated approve call with the same key returns the original record', async () => {
    const draft = await employeeExpenses.createClaimDraft({
    employeeId: undefined,
    hasApprovePermission: false,
      organizationId, expenseCategoryId, title: 'Idempotent approve', projectId, legalEntityId: undefined, amount: '700', expenseDate: '2026-06-05',
      gstInvoiceAvailable: false, gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: reimbursableUserId, correlationId: generateId(),
    });
    const submitted = await employeeExpenses.submitClaim({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId: reimbursableUserId, hasApprovePermission: false, correlationId: generateId() });
    const key = generateId();
    const first = await employeeExpenses.approveClaim({ organizationId, id: submitted.id, expectedVersion: submitted.version, note: undefined, idempotencyKey: key, actorId: accountantActorId, hasSelfApprovePermission: false, correlationId: generateId() });
    const second = await employeeExpenses.approveClaim({ organizationId, id: submitted.id, expectedVersion: submitted.version, note: undefined, idempotencyKey: key, actorId: accountantActorId, hasSelfApprovePermission: false, correlationId: generateId() });
    expect(second.version).toBe(first.version);
  });
});

describe('EmployeeExpensesService — reimburseClaim and reverseReimbursement', () => {
  it('posts Dr Employee Advance Receivable / Cr Bank for a claim with no prior advance, then reverses it back to APPROVED', async () => {
    const approved = await createApprovedClaim({ amount: '1770', title: 'No-advance reimbursement test' });

    const reimbursed = await employeeExpenses.reimburseClaim({
      organizationId, id: approved.id, expectedVersion: approved.version, bankAccountId, reimbursementDate: '2026-06-06', idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId(),
    });
    expect(reimbursed.status).toBe('REIMBURSED');

    const journalDetail = await posting.getEntryDetail({ organizationId, id: reimbursed.reimbursementJournalEntryId! });
    const debitLines = journalDetail.lines.filter((l) => Number(l.debitAmount) > 0);
    const creditLines = journalDetail.lines.filter((l) => Number(l.creditAmount) > 0);
    expect(debitLines.map((l) => l.ledgerAccountCode)).toEqual(['EMPLOYEE_ADVANCE_RECEIVABLE']);
    expect(creditLines.map((l) => l.ledgerAccountCode)).toEqual(['HDFC_CURRENT_ACCOUNT']);

    const reversed = await employeeExpenses.reverseReimbursement({
      organizationId, id: reimbursed.id, expectedVersion: reimbursed.version, reason: 'Wrong bank account', accountingDate: '2026-06-07', idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId(),
    });
    expect(reversed.status).toBe('APPROVED');
    expect(reversed.reimbursementReversalJournalEntryId).not.toBeNull();

    // Correctable — the accountant can now re-run reimbursement.
    const reimbursedAgain = await employeeExpenses.reimburseClaim({
      organizationId, id: reversed.id, expectedVersion: reversed.version, bankAccountId, reimbursementDate: '2026-06-08', idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId(),
    });
    expect(reimbursedAgain.status).toBe('REIMBURSED');
  });

  it('rejects a stale expectedVersion on reverseReimbursement', async () => {
    const approved = await createApprovedClaim({ amount: '400', title: 'Version conflict test' });
    const reimbursed = await employeeExpenses.reimburseClaim({
      organizationId, id: approved.id, expectedVersion: approved.version, bankAccountId, reimbursementDate: '2026-06-06', idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId(),
    });
    await expect(
      employeeExpenses.reverseReimbursement({ organizationId, id: reimbursed.id, expectedVersion: reimbursed.version + 1, reason: 'Stale', accountingDate: '2026-06-07', idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId() }),
    ).rejects.toThrow('changed by someone else');
  });
});

describe('EmployeeExpensesService — the R.-Shah-style wallet sequence and statement', () => {
  it('an advance followed by two approved claims produces the exact running control-account balance shown in the prototype', async () => {
    const walletEmployeeUser = await prisma.client.user.create({ data: { id: generateId(), organizationId, email: `ee-wallet-${generateId()}@zitaware.test`, passwordHash: 'test-hash', displayName: 'EE Wallet Employee', status: 'ACTIVE' } });
    const walletEmployee = await prisma.client.employee.create({
      data: { id: generateId(), organizationId, userId: walletEmployeeUser.id, employeeCode: `EMP-EE-WALLET-${generateId().slice(0, 6)}`, fullName: 'Wallet Test Employee', joiningDate: new Date('2024-01-01'), isReimbursable: true },
    });

    const balanceBefore = await employeeExpenses.calculateAdvanceWalletImpact({ organizationId, employeeId: walletEmployee.id, amount: '10000' });
    expect(balanceBefore.currentBalance).toBe('0.00');
    expect(balanceBefore.newBalance).toBe('10000.00');

    await employeeExpenses.issueAdvance({
      organizationId, employeeId: walletEmployee.id, projectId: undefined, legalEntityId, amount: '10000', advanceDate: '2026-07-02',
      paymentModeId, bankAccountId, utrReference: undefined, purpose: 'General field expenses', note: undefined,
      idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId(),
    });

    const draftA = await employeeExpenses.createClaimDraft({
    employeeId: undefined,
    hasApprovePermission: false,
      organizationId, expenseCategoryId, title: 'Site materials — hardware shop', projectId, legalEntityId: undefined, amount: '2400', expenseDate: '2026-07-06',
      gstInvoiceAvailable: false, gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: walletEmployeeUser.id, correlationId: generateId(),
    });
    const submittedA = await employeeExpenses.submitClaim({ organizationId, id: draftA.id, expectedVersion: draftA.version, idempotencyKey: generateId(), actorId: walletEmployeeUser.id, hasApprovePermission: false, correlationId: generateId() });
    await employeeExpenses.approveClaim({ organizationId, id: submittedA.id, expectedVersion: submittedA.version, note: undefined, idempotencyKey: generateId(), actorId: accountantActorId, hasSelfApprovePermission: false, correlationId: generateId() });

    const draftB = await employeeExpenses.createClaimDraft({
    employeeId: undefined,
    hasApprovePermission: false,
      organizationId, expenseCategoryId, title: 'Local travel + courier', projectId, legalEntityId: undefined, amount: '4000', expenseDate: '2026-07-14',
      gstInvoiceAvailable: false, gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: walletEmployeeUser.id, correlationId: generateId(),
    });
    const submittedB = await employeeExpenses.submitClaim({ organizationId, id: draftB.id, expectedVersion: draftB.version, idempotencyKey: generateId(), actorId: walletEmployeeUser.id, hasApprovePermission: false, correlationId: generateId() });
    await employeeExpenses.approveClaim({ organizationId, id: submittedB.id, expectedVersion: submittedB.version, note: undefined, idempotencyKey: generateId(), actorId: accountantActorId, hasSelfApprovePermission: false, correlationId: generateId() });

    const statement = await employeeExpenses.getMyWalletStatement({ organizationId, actorId: walletEmployeeUser.id, month: '2026-07' });
    expect(statement.openingBalance).toBe('0.00');
    expect(statement.entries.map((e) => e.runningBalance)).toEqual(['10000.00', '7600.00', '3600.00']);
    expect(statement.closingBalance).toBe('3600.00');
    expect(statement.totalAdvances).toBe('10000.00');
    expect(statement.totalClaims).toBe('6400.00');
    expect(statement.totalReimbursed).toBe('0.00');

    const myClaims = await employeeExpenses.getMyClaims({ organizationId, actorId: walletEmployeeUser.id });
    expect(myClaims).toHaveLength(2);

    const status = await employeeExpenses.getMyEmployeeStatus({ organizationId, actorId: walletEmployeeUser.id });
    expect(status).toEqual({ hasEmployee: true, isReimbursable: true, employeeName: 'Wallet Test Employee' });
  });
});

describe('EmployeeExpensesService — getClaimDetail scoping and cross-org isolation', () => {
  it('lets the claim\'s own employee view it without employee_claim.read, but not a different employee', async () => {
    const draft = await employeeExpenses.createClaimDraft({
    employeeId: undefined,
    hasApprovePermission: false,
      organizationId, expenseCategoryId, title: 'Scoped view test', projectId, legalEntityId: undefined, amount: '250', expenseDate: '2026-06-05',
      gstInvoiceAvailable: false, gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: reimbursableUserId, correlationId: generateId(),
    });

    const ownView = await employeeExpenses.getClaimDetail({ organizationId, id: draft.id, actorId: reimbursableUserId, hasReadPermission: false });
    expect(ownView.id).toBe(draft.id);

    try {
      await employeeExpenses.getClaimDetail({ organizationId, id: draft.id, actorId: nonReimbursableUserId, hasReadPermission: false });
      expect.unreachable('expected getClaimDetail to throw');
    } catch (error) {
      expect((error as { cause?: { appErrorCode?: string } }).cause?.appErrorCode).toBe('NOT_FOUND');
    }

    const adminView = await employeeExpenses.getClaimDetail({ organizationId, id: draft.id, actorId: accountantActorId, hasReadPermission: true });
    expect(adminView.id).toBe(draft.id);
  });

  it('does not leak advances or claims across organizations', async () => {
    const { rows: advanceRows } = await employeeExpenses.listAdvances({ organizationId: otherOrganizationId, page: 1, pageSize: 25, filters: {} });
    expect(advanceRows).toHaveLength(0);
    const { rows: claimRows } = await employeeExpenses.listClaims({ organizationId: otherOrganizationId, page: 1, pageSize: 25, filters: {} });
    expect(claimRows).toHaveLength(0);
  });
});

describe('EmployeeExpensesService — listClaims filters', () => {
  it('filters by employeeId, expenseCategoryId, projectId, status, expense-date range, and approved-date range', async () => {
    const draft = await employeeExpenses.createClaimDraft({
      employeeId: undefined,
      hasApprovePermission: false,
      organizationId, expenseCategoryId, title: 'Filter matrix test', projectId, legalEntityId: undefined, amount: '600', expenseDate: '2026-07-10',
      gstInvoiceAvailable: false, gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: reimbursableUserId, correlationId: generateId(),
    });
    const submitted = await employeeExpenses.submitClaim({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId: reimbursableUserId, hasApprovePermission: false, correlationId: generateId() });
    const approved = await employeeExpenses.approveClaim({
      organizationId, id: submitted.id, expectedVersion: submitted.version, note: undefined, idempotencyKey: generateId(), actorId: accountantActorId, hasSelfApprovePermission: false, correlationId: generateId(),
    });

    const byEmployee = await employeeExpenses.listClaims({ organizationId, page: 1, pageSize: 25, filters: { employeeId: reimbursableEmployeeId } });
    expect(byEmployee.rows.some((r) => r.id === approved.id)).toBe(true);
    const byOtherEmployee = await employeeExpenses.listClaims({ organizationId, page: 1, pageSize: 25, filters: { employeeId: nonReimbursableEmployeeId } });
    expect(byOtherEmployee.rows.some((r) => r.id === approved.id)).toBe(false);

    const byCategory = await employeeExpenses.listClaims({ organizationId, page: 1, pageSize: 25, filters: { expenseCategoryId } });
    expect(byCategory.rows.some((r) => r.id === approved.id)).toBe(true);

    const byProject = await employeeExpenses.listClaims({ organizationId, page: 1, pageSize: 25, filters: { projectId } });
    expect(byProject.rows.some((r) => r.id === approved.id)).toBe(true);

    const byStatus = await employeeExpenses.listClaims({ organizationId, page: 1, pageSize: 25, filters: { status: 'APPROVED' } });
    expect(byStatus.rows.some((r) => r.id === approved.id)).toBe(true);
    const byWrongStatus = await employeeExpenses.listClaims({ organizationId, page: 1, pageSize: 25, filters: { status: 'DRAFT' } });
    expect(byWrongStatus.rows.some((r) => r.id === approved.id)).toBe(false);

    const inExpenseRange = await employeeExpenses.listClaims({ organizationId, page: 1, pageSize: 25, filters: { expenseDateFrom: '2026-07-01', expenseDateTo: '2026-07-31' } });
    expect(inExpenseRange.rows.some((r) => r.id === approved.id)).toBe(true);
    const outsideExpenseRange = await employeeExpenses.listClaims({ organizationId, page: 1, pageSize: 25, filters: { expenseDateFrom: '2026-08-01', expenseDateTo: '2026-08-31' } });
    expect(outsideExpenseRange.rows.some((r) => r.id === approved.id)).toBe(false);

    const today = new Date().toISOString().slice(0, 10);
    const inApprovedRange = await employeeExpenses.listClaims({ organizationId, page: 1, pageSize: 25, filters: { approvedDateFrom: today, approvedDateTo: today } });
    expect(inApprovedRange.rows.some((r) => r.id === approved.id)).toBe(true);
    const outsideApprovedRange = await employeeExpenses.listClaims({ organizationId, page: 1, pageSize: 25, filters: { approvedDateFrom: '2020-01-01', approvedDateTo: '2020-01-31' } });
    expect(outsideApprovedRange.rows.some((r) => r.id === approved.id)).toBe(false);
  });
});

describe('EmployeeExpensesService — getClaimStats (summary tiles)', () => {
  it('computes Pending Approval / Approved — To Pay / Reimbursed / Advance Outstanding, narrowed by employeeId', async () => {
    const statsUser = await prisma.client.user.create({ data: { id: generateId(), organizationId, email: `ee-stats-${generateId()}@zitaware.test`, passwordHash: 'test-hash', displayName: 'Stats Employee', status: 'ACTIVE' } });
    const statsEmployee = await prisma.client.employee.create({
      data: { id: generateId(), organizationId, userId: statsUser.id, employeeCode: `EMP-STATS-${generateId()}`, fullName: 'S. Stats', joiningDate: new Date('2024-01-01'), isReimbursable: true },
    });

    // Pending Approval: one SUBMITTED (not yet approved) claim, amount 400.
    const pendingDraft = await employeeExpenses.createClaimDraft({
      employeeId: undefined, hasApprovePermission: false, organizationId, expenseCategoryId, title: 'Stats pending', projectId, legalEntityId: undefined,
      amount: '400', expenseDate: '2026-06-10', gstInvoiceAvailable: false, gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: statsUser.id, correlationId: generateId(),
    });
    await employeeExpenses.submitClaim({ organizationId, id: pendingDraft.id, expectedVersion: pendingDraft.version, idempotencyKey: generateId(), actorId: statsUser.id, hasApprovePermission: false, correlationId: generateId() });

    // Approved — To Pay: one APPROVED-but-not-reimbursed claim, amount 900.
    const approvedDraft = await employeeExpenses.createClaimDraft({
      employeeId: undefined, hasApprovePermission: false, organizationId, expenseCategoryId, title: 'Stats approved', projectId, legalEntityId: undefined,
      amount: '900', expenseDate: '2026-06-11', gstInvoiceAvailable: false, gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: statsUser.id, correlationId: generateId(),
    });
    const approvedSubmitted = await employeeExpenses.submitClaim({ organizationId, id: approvedDraft.id, expectedVersion: approvedDraft.version, idempotencyKey: generateId(), actorId: statsUser.id, hasApprovePermission: false, correlationId: generateId() });
    await employeeExpenses.approveClaim({ organizationId, id: approvedSubmitted.id, expectedVersion: approvedSubmitted.version, note: undefined, idempotencyKey: generateId(), actorId: accountantActorId, hasSelfApprovePermission: false, correlationId: generateId() });

    // Reimbursed: one claim approved then reimbursed, amount 700 — approve
    // draws the wallet down 700, reimburse pays it back 700 (same shape as
    // an advance), netting zero further wallet impact from this claim.
    const reimbDraft = await employeeExpenses.createClaimDraft({
      employeeId: undefined, hasApprovePermission: false, organizationId, expenseCategoryId, title: 'Stats reimbursed', projectId, legalEntityId: undefined,
      amount: '700', expenseDate: '2026-06-12', gstInvoiceAvailable: false, gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: statsUser.id, correlationId: generateId(),
    });
    const reimbSubmitted = await employeeExpenses.submitClaim({ organizationId, id: reimbDraft.id, expectedVersion: reimbDraft.version, idempotencyKey: generateId(), actorId: statsUser.id, hasApprovePermission: false, correlationId: generateId() });
    const reimbApproved = await employeeExpenses.approveClaim({ organizationId, id: reimbSubmitted.id, expectedVersion: reimbSubmitted.version, note: undefined, idempotencyKey: generateId(), actorId: accountantActorId, hasSelfApprovePermission: false, correlationId: generateId() });
    await employeeExpenses.reimburseClaim({ organizationId, id: reimbApproved.id, expectedVersion: reimbApproved.version, bankAccountId, reimbursementDate: '2026-06-13', idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId() });

    // Advance Outstanding: 5000 issued; the two approve events (900, 700)
    // draw the wallet down, the reimburse event (+700) pays the second one
    // back — net outstanding = 5000 - 900 - 700 + 700 = 4100.
    await employeeExpenses.issueAdvance({
      organizationId, employeeId: statsEmployee.id, projectId: undefined, legalEntityId, amount: '5000', advanceDate: '2026-06-09',
      paymentModeId, bankAccountId, utrReference: undefined, purpose: undefined, note: undefined, idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId(),
    });

    const stats = await employeeExpenses.getClaimStats({ organizationId, filters: { employeeId: statsEmployee.id } });
    expect(stats.pendingApproval).toEqual({ amount: '400.00', count: 1 });
    expect(stats.approvedToPay).toEqual({ amount: '900.00', count: 1 });
    expect(stats.reimbursed.amount).toBe('700.00');
    expect(stats.reimbursed.count).toBe(1);
    expect(stats.reimbursed.isCurrentFinancialYear).toBe(true);
    expect(stats.advanceOutstanding).toEqual({ amount: '4100.00', employeeCount: 1 });

    // A date filter narrows the Reimbursed tile and flips isCurrentFinancialYear false.
    const narrowedOut = await employeeExpenses.getClaimStats({ organizationId, filters: { employeeId: statsEmployee.id, approvedDateFrom: '2020-01-01', approvedDateTo: '2020-01-31' } });
    expect(narrowedOut.reimbursed).toEqual({ amount: '0.00', count: 0, isCurrentFinancialYear: false });

    // A different employeeId filter excludes this employee's own figures entirely.
    const otherEmployeeStats = await employeeExpenses.getClaimStats({ organizationId, filters: { employeeId: nonReimbursableEmployeeId } });
    expect(otherEmployeeStats.pendingApproval.amount).toBe('0.00');
    expect(otherEmployeeStats.advanceOutstanding).toEqual({ amount: '0.00', employeeCount: 0 });
  });
});

describe('EmployeeExpensesService — on behalf of an employee, within their own company (ADR-183)', () => {
  it('refuses a claim or advance for an employee of another legal entity, and a project of another legal entity', async () => {
    const otherEntity = await prisma.client.legalEntity.create({ data: { id: generateId(), organizationId, legalName: 'EE Third Entity Pvt Ltd', panNumber: 'EETHR1234Q', registeredAddress: 'Vadodara' } });
    const outsider = await prisma.client.employee.create({
      data: { id: generateId(), organizationId, legalEntityId: otherEntity.id, employeeCode: `EE-OUT-${generateId().slice(-6)}`, fullName: 'Other Company Person', joiningDate: new Date('2025-01-01'), isReimbursable: true },
    });
    const claimFor = (input: { employeeId: string; legalEntityId: string | undefined; projectId: string | undefined }) =>
      employeeExpenses.createClaimDraft({
        ...input, hasApprovePermission: true, organizationId, expenseCategoryId, title: 'On behalf', amount: '100', expenseDate: '2026-06-01',
        gstInvoiceAvailable: false, gstCreditAmount: undefined, note: undefined, idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId(),
      });

    await expect(claimFor({ employeeId: outsider.id, legalEntityId, projectId: undefined })).rejects.toThrow('Other Company Person belongs to another legal entity');
    await expect(claimFor({ employeeId: outsider.id, legalEntityId: otherEntity.id, projectId })).rejects.toThrow('belongs to another legal entity');
    await expect(
      employeeExpenses.issueAdvance({
        organizationId, employeeId: outsider.id, projectId: undefined, legalEntityId, amount: '100', advanceDate: '2026-06-01', paymentModeId, bankAccountId,
        utrReference: undefined, purpose: undefined, note: undefined, idempotencyKey: generateId(), actorId: accountantActorId, correlationId: generateId(),
      }),
    ).rejects.toThrow('belongs to another legal entity');
    const own = await claimFor({ employeeId: outsider.id, legalEntityId: otherEntity.id, projectId: undefined });
    expect(own.legalEntityId).toBe(otherEntity.id);
  });
});
