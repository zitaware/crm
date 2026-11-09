import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ClientsService } from '../clients/clients.service';
import { MilestonesService } from '../milestones/milestones.service';
import { PaymentAlertsService } from '../payment-alerts/payment-alerts.service';
import { FinancialYearService } from '../organization/financial-year.service';
import { LegalEntityService } from '../organization/legal-entity.service';
import { PostingService } from '../accounting/posting.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { InvoicesService } from '../invoices/invoices.service';
import { CreditDebitNotesService } from './credit-debit-notes.service';
import { uniqueGstin } from '../testing/gstin.test-util';
import { extendFinancialYearsThroughToday } from '../testing/financial-years.test-util';

const prisma = new PrismaService();
const projects = new ProjectsService(prisma);
const clients = new ClientsService(prisma);
const paymentAlerts = new PaymentAlertsService(prisma, projects);
const milestones = new MilestonesService(prisma, projects, paymentAlerts);
const financialYears = new FinancialYearService(prisma);
const legalEntities = new LegalEntityService(prisma);
const posting = new PostingService(prisma);
const invoices = new InvoicesService(prisma, posting, projects, financialYears, new ReceiptsService(prisma, posting, projects));
const notes = new CreditDebitNotesService(prisma, posting, projects);

let organizationId: string;
let otherOrganizationId: string;
let clientId: string;
let legalEntityId: string;
let projectId: string;
let gujaratStateId: string;
let maharashtraStateId: string;
let gujaratGstRegistrationId: string;
let maharashtraGstRegistrationId: string;
const actorId = generateId();

let milestoneCounter = 0;

/** Mirrors receipts.integration-spec.ts's own finalizeInvoice helper,
 * parameterized by which GST registration to use so tests can exercise
 * both the same-state (CGST+SGST) and different-state (IGST) paths — a
 * credit/debit note always inherits its invoice's own registration, it
 * never picks one independently. */
async function finalizeInvoice(gstRegistrationId: string, taxableAmount: string): Promise<{ id: string; invoiceNumber: string | null; totalAmount: string | null; taxableAmount: string | null }> {
  milestoneCounter += 1;
  const milestoneName = `CN/DN Test Milestone ${milestoneCounter}`;
  const capex = await milestones.createCapex({
    organizationId,
    projectId,
    name: milestoneName,
    approvedAmount: '50000000',
    referenceNumber: undefined,
    approvalDate: undefined,
    description: undefined,
    alertRecipient: undefined,
    reminderOffsetDays: undefined,
    events: [{ name: 'On Completion', amount: '50000000', dueDate: '2026-05-31' }],
    idempotencyKey: generateId(),
    actorId,
    canSeeAll: true,
    correlationId: generateId(),
  });
  const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
  const eventId = overview.capexEvents.find((e) => e.milestoneId === capex.id)!.id;
  const alert =
    (await prisma.client.paymentAlert.findFirst({ where: { sourceEventId: eventId } })) ??
    (await prisma.client.paymentAlert.create({
      data: { id: generateId(), organizationId, projectId, sourceType: 'CAPEX_EVENT', sourceEventId: eventId, status: 'OPEN' },
    }));

  const draft = await invoices.createDraftFromAlert({
    organizationId,
    paymentAlertId: alert.id,
    gstRegistrationId,
    dueDate: '2026-05-15',
    paymentTermsDays: undefined,
    narrative: undefined,
    lines: [{ description: milestoneName, hsnSac: '998314', quantity: '1', unitPrice: taxableAmount, gstRatePercent: '9' }],
    idempotencyKey: generateId(),
    actorId,
    correlationId: generateId(),
  });

  return invoices.finalize({
    organizationId,
    id: draft.id,
    expectedVersion: draft.version,
    invoiceDate: '2026-04-20',
    idempotencyKey: generateId(),
    actorId,
    correlationId: generateId(),
  });
}

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Credit/Debit Note Test Org', code: `CDNTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Credit/Debit Note Test Other Org', code: `CDNTEST-OTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  const gujarat = await prisma.client.state.findFirstOrThrow({ where: { code: 'GJ' } });
  gujaratStateId = gujarat.id;
  const maharashtra = await prisma.client.state.findFirstOrThrow({ where: { code: 'MH' } });
  maharashtraStateId = maharashtra.id;

  const client = await clients.create({
    organizationId,
    name: 'Credit/Debit Note Test Client',
    shortCode: undefined,
    clientTypeId: undefined,
    department: 'IT Department',
    stateId: gujaratStateId,
    districtId: undefined,
    cityId: undefined,
    pinCode: undefined,
    officeAddress: 'Gandhinagar, Gujarat',
    gstin: uniqueGstin('24'),
    internalNote: undefined,
    contacts: [],
    actorId,
    correlationId: generateId(),
  });
  clientId = client.id;

  const legalEntity = await prisma.client.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'Credit/Debit Note Test Legal Entity', panNumber: 'ABCPC7890P', registeredAddress: 'Ahmedabad, Gujarat' },
  });
  legalEntityId = legalEntity.id;

  const gujaratGst = await legalEntities.createGstRegistration({
    organizationId,
    legalEntityId,
    stateId: gujaratStateId,
    gstin: uniqueGstin('24'),
    tradeName: undefined,
    actorId,
    correlationId: generateId(),
  });
  gujaratGstRegistrationId = gujaratGst.id;

  const maharashtraGst = await legalEntities.createGstRegistration({
    organizationId,
    legalEntityId,
    stateId: maharashtraStateId,
    gstin: uniqueGstin('27'),
    tradeName: undefined,
    actorId,
    correlationId: generateId(),
  });
  maharashtraGstRegistrationId = maharashtraGst.id;

  // Covers the invoice's own finalize date (2026-04-20, used to prove the
  // "note posts even when the invoice's own period is LOCKED" rule). This
  // test's finalize() calls always post at whatever "today" is, per the
  // confirmed always-today's-open-period rule (ADR-070), so the years after
  // it are added up to the one containing today.
  await financialYears.create({
    organizationId,
    legalEntityId,
    label: 'FY2026',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    setCurrent: true,
    actorId,
    correlationId: generateId(),
  });
  await extendFinancialYearsThroughToday(financialYears, { organizationId, legalEntityId, lastEndDate: '2026-12-31', actorId });

  const project = await projects.create({
    organizationId,
    clientId,
    legalEntityId,
    leadId: undefined,
    tenderId: undefined,
    projectManagerId: undefined,
    introducerId: undefined,
    projectTypeId: undefined,
    name: 'Credit/Debit Note Test Project',
    description: undefined,
    value: undefined,
    budget: undefined,
    gstApplicable: undefined,
    workOrderNumber: undefined,
    workOrderDate: undefined,
    actorId,
    correlationId: generateId(),
  });
  projectId = project.id;

  const assetGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'ASSETS', name: 'Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: true },
  });
  const incomeGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'INCOME', name: 'Income', accountType: 'INCOME', normalBalance: 'CREDIT', isSystemDefined: true },
  });
  const liabilityGroup = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'LIABILITIES', name: 'Liabilities', accountType: 'LIABILITY', normalBalance: 'CREDIT', isSystemDefined: true },
  });

  await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: assetGroup.id, code: 'ACCOUNTS_RECEIVABLE', name: 'Accounts Receivable', allowManualPosting: true, isActive: true },
  });
  await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: incomeGroup.id, code: 'SOFTWARE_PROJECT_REVENUE', name: 'Software Project Revenue', allowManualPosting: true, isActive: true },
  });
  await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: liabilityGroup.id, code: 'OUTPUT_CGST_PAYABLE', name: 'Output CGST Payable', allowManualPosting: true, isActive: true },
  });
  await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: liabilityGroup.id, code: 'OUTPUT_SGST_PAYABLE', name: 'Output SGST Payable', allowManualPosting: true, isActive: true },
  });
  await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: liabilityGroup.id, code: 'OUTPUT_IGST_PAYABLE', name: 'Output IGST Payable', allowManualPosting: true, isActive: true },
  });
});

afterAll(async () => {
  const orgIds = [organizationId, otherOrganizationId];
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.idempotencyKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.creditDebitNoteLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.creditDebitNote.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.invoiceLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.invoice.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.paymentAlert.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.milestoneCreationRequest.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.milestoneInstallment.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.milestoneEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.projectMilestone.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalEntry.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.projectTeamMember.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.project.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountingPeriodTransition.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountingPeriod.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.financialYear.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.gstRegistration.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.contact.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.clientProfile.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.party.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.legalEntity.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.client.$disconnect();
});

describe('CreditDebitNotesService', () => {
  it('rejects createDraft against a DRAFT invoice, and against a VOIDed invoice', async () => {
    // A draft invoice, never finalized.
    const capex = await milestones.createCapex({
      organizationId,
      projectId,
      name: 'Draft Rejection Milestone',
      approvedAmount: '50000000',
      referenceNumber: undefined,
      approvalDate: undefined,
      description: undefined,
      alertRecipient: undefined,
      reminderOffsetDays: undefined,
      events: [{ name: 'On Completion', amount: '50000000', dueDate: '2026-05-31' }],
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const eventId = overview.capexEvents.find((e) => e.milestoneId === capex.id)!.id;
    const alert =
      (await prisma.client.paymentAlert.findFirst({ where: { sourceEventId: eventId } })) ??
      (await prisma.client.paymentAlert.create({
        data: { id: generateId(), organizationId, projectId, sourceType: 'CAPEX_EVENT', sourceEventId: eventId, status: 'OPEN' },
      }));
    const draftInvoice = await invoices.createDraftFromAlert({
      organizationId,
      paymentAlertId: alert.id,
      gstRegistrationId: gujaratGstRegistrationId,
      dueDate: '2026-05-15',
      paymentTermsDays: undefined,
      narrative: undefined,
      lines: [{ description: 'Draft only', hsnSac: '998314', quantity: '1', unitPrice: '100000', gstRatePercent: '9' }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    await expect(
      notes.createDraft({
        organizationId,
        invoiceId: draftInvoice.id,
        type: 'CREDIT',
        reason: 'Rate correction',
        lines: [{ description: 'Correction', hsnSac: undefined, quantity: '1', unitPrice: '10000', gstRatePercent: '9' }],
        idempotencyKey: generateId(),
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('finalized');

    // A voided invoice.
    const invoiceToVoid = await finalizeInvoice(gujaratGstRegistrationId, '200000');
    const voided = await invoices.void({ canReverseReceipts: true,
      organizationId,
      id: invoiceToVoid.id,
      expectedVersion: 2,
      reason: 'Voiding for test',
      accountingDate: '2026-04-21',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(voided.status).toBe('VOID');

    await expect(
      notes.createDraft({
        organizationId,
        invoiceId: invoiceToVoid.id,
        type: 'CREDIT',
        reason: 'Rate correction',
        lines: [{ description: 'Correction', hsnSac: undefined, quantity: '1', unitPrice: '10000', gstRatePercent: '9' }],
        idempotencyKey: generateId(),
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('finalized');
  });

  it('computes CGST+SGST for a same-state invoice and IGST for a different-state invoice, matching Invoice.finalize', async () => {
    const sameStateInvoice = await finalizeInvoice(gujaratGstRegistrationId, '100000');
    const sameStateDraft = await notes.createDraft({
      organizationId,
      invoiceId: sameStateInvoice.id,
      type: 'CREDIT',
      reason: 'Rate correction',
      lines: [{ description: 'Correction', hsnSac: undefined, quantity: '1', unitPrice: '10000', gstRatePercent: '9' }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    const sameStateDetail = await notes.getDetail({ organizationId, id: sameStateDraft.id, actorId, canSeeAll: true });
    expect(sameStateDetail.lines[0]!.cgstAmount).toBe('900.00');
    expect(sameStateDetail.lines[0]!.sgstAmount).toBe('900.00');
    expect(sameStateDetail.lines[0]!.igstAmount).toBe('0.00');

    const differentStateInvoice = await finalizeInvoice(maharashtraGstRegistrationId, '100000');
    const differentStateDraft = await notes.createDraft({
      organizationId,
      invoiceId: differentStateInvoice.id,
      type: 'CREDIT',
      reason: 'Rate correction',
      lines: [{ description: 'Correction', hsnSac: undefined, quantity: '1', unitPrice: '10000', gstRatePercent: '9' }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    const differentStateDetail = await notes.getDetail({ organizationId, id: differentStateDraft.id, actorId, canSeeAll: true });
    expect(differentStateDetail.lines[0]!.cgstAmount).toBe('0.00');
    expect(differentStateDetail.lines[0]!.sgstAmount).toBe('0.00');
    expect(differentStateDetail.lines[0]!.igstAmount).toBe('1800.00');
  });

  it('finalizes a CREDIT note posting the mirrored journal (Dr Revenue+GST, Cr Accounts Receivable)', async () => {
    const invoice = await finalizeInvoice(gujaratGstRegistrationId, '200000');
    // 200000 taxable, credit 20000 of it (+18% GST = 23600 total).
    const draft = await notes.createDraft({
      organizationId,
      invoiceId: invoice.id,
      type: 'CREDIT',
      reason: 'Quantity correction',
      lines: [{ description: 'Quantity correction', hsnSac: undefined, quantity: '1', unitPrice: '20000', gstRatePercent: '9' }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    const finalized = await notes.finalize({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId, correlationId: generateId() });

    expect(finalized.status).toBe('FINALIZED');
    expect(finalized.noteNumber).toMatch(/^CN-\d{4}$/);
    expect(finalized.totalAmount).toBe('23600.00');

    const journalDetail = await posting.getEntryDetail({ organizationId, id: finalized.journalEntryId! });
    const debitLines = journalDetail.lines.filter((l) => Number(l.debitAmount) > 0);
    const creditLines = journalDetail.lines.filter((l) => Number(l.creditAmount) > 0);
    expect(debitLines.map((l) => l.ledgerAccountCode).sort()).toEqual(['OUTPUT_CGST_PAYABLE', 'OUTPUT_SGST_PAYABLE', 'SOFTWARE_PROJECT_REVENUE'].sort());
    expect(creditLines.map((l) => l.ledgerAccountCode)).toEqual(['ACCOUNTS_RECEIVABLE']);
    expect(creditLines[0]!.creditAmount).toBe('23600.00');

    // The source invoice itself is untouched -- still FINALIZED, no status
    // change, no PaymentAlert reopened.
    const invoiceAfter = await invoices.getDetail({ organizationId, id: invoice.id, actorId, canSeeAll: true });
    expect(invoiceAfter.status).toBe('FINALIZED');

    const auditEvent = await prisma.client.auditEvent.findFirst({ where: { entityType: 'CREDIT_DEBIT_NOTE', entityId: finalized.id, action: 'CREDIT_DEBIT_NOTE_FINALIZED' } });
    expect(auditEvent).not.toBeNull();
  });

  it('finalizes a DEBIT note posting the same-direction journal as Invoice.finalize (Dr Accounts Receivable, Cr Revenue+GST)', async () => {
    const invoice = await finalizeInvoice(gujaratGstRegistrationId, '200000');
    const draft = await notes.createDraft({
      organizationId,
      invoiceId: invoice.id,
      type: 'DEBIT',
      reason: 'Additional work performed',
      lines: [{ description: 'Additional work', hsnSac: undefined, quantity: '1', unitPrice: '15000', gstRatePercent: '9' }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    const finalized = await notes.finalize({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId, correlationId: generateId() });

    expect(finalized.status).toBe('FINALIZED');
    expect(finalized.noteNumber).toMatch(/^DN-\d{4}$/);
    expect(finalized.totalAmount).toBe('17700.00');

    const journalDetail = await posting.getEntryDetail({ organizationId, id: finalized.journalEntryId! });
    const debitLines = journalDetail.lines.filter((l) => Number(l.debitAmount) > 0);
    const creditLines = journalDetail.lines.filter((l) => Number(l.creditAmount) > 0);
    expect(debitLines.map((l) => l.ledgerAccountCode)).toEqual(['ACCOUNTS_RECEIVABLE']);
    expect(debitLines[0]!.debitAmount).toBe('17700.00');
    expect(creditLines.map((l) => l.ledgerAccountCode).sort()).toEqual(['OUTPUT_CGST_PAYABLE', 'OUTPUT_SGST_PAYABLE', 'SOFTWARE_PROJECT_REVENUE'].sort());
  });

  it('CN/DN sequences are independent of each other and of invoice numbering', async () => {
    const countBefore = (type: 'CREDIT' | 'DEBIT') =>
      prisma.client.creditDebitNote.count({ where: { organizationId, gstRegistrationId: gujaratGstRegistrationId, type, noteNumber: { not: null } } });
    const creditCountBefore = await countBefore('CREDIT');
    const debitCountBefore = await countBefore('DEBIT');

    const invoiceA = await finalizeInvoice(gujaratGstRegistrationId, '50000');
    const creditDraft = await notes.createDraft({
      organizationId,
      invoiceId: invoiceA.id,
      type: 'CREDIT',
      reason: 'Test',
      lines: [{ description: 'x', hsnSac: undefined, quantity: '1', unitPrice: '1000', gstRatePercent: '9' }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    const creditFinalized = await notes.finalize({ organizationId, id: creditDraft.id, expectedVersion: creditDraft.version, idempotencyKey: generateId(), actorId, correlationId: generateId() });

    const invoiceB = await finalizeInvoice(gujaratGstRegistrationId, '50000');
    const debitDraft = await notes.createDraft({
      organizationId,
      invoiceId: invoiceB.id,
      type: 'DEBIT',
      reason: 'Test',
      lines: [{ description: 'x', hsnSac: undefined, quantity: '1', unitPrice: '1000', gstRatePercent: '9' }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    const debitFinalized = await notes.finalize({ organizationId, id: debitDraft.id, expectedVersion: debitDraft.version, idempotencyKey: generateId(), actorId, correlationId: generateId() });

    // Each series increments purely from its own prior count -- unaffected
    // by how many notes of the other type (or invoices) exist.
    expect(creditFinalized.noteNumber).toBe(`CN-${String(creditCountBefore + 1).padStart(4, '0')}`);
    expect(debitFinalized.noteNumber).toBe(`DN-${String(debitCountBefore + 1).padStart(4, '0')}`);
    expect(creditFinalized.noteNumber).not.toBe(debitFinalized.noteNumber);
  });

  it('rejects a CREDIT note that would push cumulative credited value past the invoice taxable amount', async () => {
    const invoice = await finalizeInvoice(gujaratGstRegistrationId, '100000');

    const firstDraft = await notes.createDraft({
      organizationId,
      invoiceId: invoice.id,
      type: 'CREDIT',
      reason: 'First correction',
      lines: [{ description: 'x', hsnSac: undefined, quantity: '1', unitPrice: '70000', gstRatePercent: '9' }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    await notes.finalize({ organizationId, id: firstDraft.id, expectedVersion: firstDraft.version, idempotencyKey: generateId(), actorId, correlationId: generateId() });

    const secondDraft = await notes.createDraft({
      organizationId,
      invoiceId: invoice.id,
      type: 'CREDIT',
      reason: 'Second correction, exceeds remaining',
      lines: [{ description: 'x', hsnSac: undefined, quantity: '1', unitPrice: '40000', gstRatePercent: '9' }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    await expect(
      notes.finalize({ organizationId, id: secondDraft.id, expectedVersion: secondDraft.version, idempotencyKey: generateId(), actorId, correlationId: generateId() }),
    ).rejects.toThrow('exceed');
  });

  it('does not cap a DEBIT note the same way', async () => {
    const invoice = await finalizeInvoice(gujaratGstRegistrationId, '50000');
    const draft = await notes.createDraft({
      organizationId,
      invoiceId: invoice.id,
      type: 'DEBIT',
      reason: 'Large additional charge',
      lines: [{ description: 'x', hsnSac: undefined, quantity: '1', unitPrice: '9000000', gstRatePercent: '9' }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    const finalized = await notes.finalize({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId, correlationId: generateId() });
    expect(finalized.status).toBe('FINALIZED');
  });

  it('voids a finalized note by reversing its journal', async () => {
    const invoice = await finalizeInvoice(gujaratGstRegistrationId, '60000');
    const draft = await notes.createDraft({
      organizationId,
      invoiceId: invoice.id,
      type: 'CREDIT',
      reason: 'Issued in error',
      lines: [{ description: 'x', hsnSac: undefined, quantity: '1', unitPrice: '10000', gstRatePercent: '9' }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    const finalized = await notes.finalize({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId, correlationId: generateId() });

    const voided = await notes.void({
      organizationId,
      id: finalized.id,
      expectedVersion: finalized.version,
      reason: 'Issued in error, reversing',
      accountingDate: new Date().toISOString().slice(0, 10),
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(voided.status).toBe('VOID');
    expect(voided.voidJournalEntryId).not.toBeNull();

    const reversalDetail = await posting.getEntryDetail({ organizationId, id: voided.voidJournalEntryId! });
    expect(reversalDetail.reversalOfJournalEntryId).toBe(finalized.journalEntryId);
  });

  it('a duplicate idempotency-key finalize call returns the original record, not a second one', async () => {
    const invoice = await finalizeInvoice(gujaratGstRegistrationId, '30000');
    const draft = await notes.createDraft({
      organizationId,
      invoiceId: invoice.id,
      type: 'CREDIT',
      reason: 'Idempotency test',
      lines: [{ description: 'x', hsnSac: undefined, quantity: '1', unitPrice: '5000', gstRatePercent: '9' }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    const key = generateId();
    const first = await notes.finalize({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: key, actorId, correlationId: generateId() });
    const second = await notes.finalize({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: key, actorId, correlationId: generateId() });
    expect(second.id).toBe(first.id);
    expect(second.noteNumber).toBe(first.noteNumber);
  });

  // Must run last among the finalizeInvoice()-dependent tests above: it
  // permanently LOCKs the shared April accounting period that
  // finalizeInvoice()'s hardcoded invoiceDate always posts into, which
  // would break every subsequent finalizeInvoice() call in this file.
  it('finalizes successfully even after the source invoice\'s own accounting period has been LOCKED', async () => {
    const invoice = await finalizeInvoice(gujaratGstRegistrationId, '80000');
    // invoice.finalize used accountingDate '2026-04-20' -- lock that period.
    const invoicePeriod = await prisma.client.accountingPeriod.findFirstOrThrow({
      where: { organizationId, financialYear: { legalEntityId }, startDate: { lte: new Date('2026-04-20T00:00:00.000Z') }, endDate: { gte: new Date('2026-04-20T00:00:00.000Z') } },
    });
    await financialYears.transitionAccountingPeriod({ organizationId, accountingPeriodId: invoicePeriod.id, action: 'SOFT_CLOSE', reason: 'Test lock', actorId, correlationId: generateId() });
    await financialYears.transitionAccountingPeriod({ organizationId, accountingPeriodId: invoicePeriod.id, action: 'LOCK', reason: 'Test lock', actorId, correlationId: generateId() });

    const draft = await notes.createDraft({
      organizationId,
      invoiceId: invoice.id,
      type: 'CREDIT',
      reason: 'Correction after period lock',
      lines: [{ description: 'x', hsnSac: undefined, quantity: '1', unitPrice: '5000', gstRatePercent: '9' }],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    // Must not throw -- the note posts into today's own open period, never
    // the invoice's now-LOCKED one.
    const finalized = await notes.finalize({ organizationId, id: draft.id, expectedVersion: draft.version, idempotencyKey: generateId(), actorId, correlationId: generateId() });
    expect(finalized.status).toBe('FINALIZED');

    const journalDetail = await posting.getEntryDetail({ organizationId, id: finalized.journalEntryId! });
    const todayStr = new Date().toISOString().slice(0, 10);
    expect(journalDetail.accountingDate).toBe(todayStr);
  });

  it('does not leak credit/debit notes across organizations', async () => {
    const { rows } = await notes.list({ organizationId: otherOrganizationId, page: 1, pageSize: 25, filters: {}, actorId, canSeeAll: true });
    expect(rows).toHaveLength(0);
  });

  it('scopes list() to the actor\'s assigned projects when canSeeAll is false', async () => {
    const unassignedActorId = generateId();
    const { rows } = await notes.list({ organizationId, page: 1, pageSize: 25, filters: {}, actorId: unassignedActorId, canSeeAll: false });
    expect(rows).toHaveLength(0);
  });
});
