import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { INVOICE_INWARD_COPY_LINK_TYPE } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ClientsService } from '../clients/clients.service';
import { MilestonesService } from '../milestones/milestones.service';
import { PaymentAlertsService } from '../payment-alerts/payment-alerts.service';
import { FinancialYearService } from '../organization/financial-year.service';
import { LegalEntityService } from '../organization/legal-entity.service';
import { PostingService } from '../accounting/posting.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { InvoicesService } from './invoices.service';

const prisma = new PrismaService();
const projects = new ProjectsService(prisma);
const clients = new ClientsService(prisma);
const paymentAlerts = new PaymentAlertsService(prisma, projects);
const milestones = new MilestonesService(prisma, projects, paymentAlerts);
const financialYears = new FinancialYearService(prisma);
const legalEntities = new LegalEntityService(prisma);
const posting = new PostingService(prisma);
const invoices = new InvoicesService(prisma, posting, projects, financialYears, new ReceiptsService(prisma, posting, projects));

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

async function createOpenAlert(overrides: { sourceEventId?: string; sourceInstallmentId?: string; sourceType: 'CAPEX_EVENT' | 'OPEX_INSTALLMENT' }) {
  const existing = await prisma.client.paymentAlert.findFirst({
    where: {
      organizationId,
      ...(overrides.sourceEventId ? { sourceEventId: overrides.sourceEventId } : {}),
      ...(overrides.sourceInstallmentId ? { sourceInstallmentId: overrides.sourceInstallmentId } : {}),
    },
  });
  if (existing) return existing;
  return prisma.client.paymentAlert.create({
    data: {
      id: generateId(),
      organizationId,
      projectId,
      sourceType: overrides.sourceType,
      sourceEventId: overrides.sourceEventId ?? null,
      sourceInstallmentId: overrides.sourceInstallmentId ?? null,
      status: 'OPEN',
    },
  });
}

function createBasicLine(overrides: Partial<{ description: string; unitPrice: string; gstRatePercent: string }> = {}) {
  return [
    {
      description: overrides.description ?? 'Test line item',
      hsnSac: '998314',
      quantity: '1',
      unitPrice: overrides.unitPrice ?? '100000',
      gstRatePercent: overrides.gstRatePercent ?? '9',
    },
  ];
}

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Invoices Test Org', code: `INVTEST-${generateId()}` },
  });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Invoices Test Other Org', code: `INVTEST-OTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  const gujarat = await prisma.client.state.findFirstOrThrow({ where: { code: 'GJ' } });
  gujaratStateId = gujarat.id;
  const maharashtra = await prisma.client.state.findFirstOrThrow({ where: { code: 'MH' } });
  maharashtraStateId = maharashtra.id;

  const client = await clients.create({
    organizationId,
    name: 'Invoice Test Client',
    shortCode: undefined,
    clientTypeId: undefined,
    department: 'IT Department',
    stateId: gujaratStateId,
    districtId: undefined,
    cityId: undefined,
    pinCode: undefined,
    officeAddress: 'Gandhinagar, Gujarat',
    gstin: '24BBBBB1111B1Z5',
    internalNote: undefined,
    contacts: [],
    actorId,
    correlationId: generateId(),
  });
  clientId = client.id;

  const legalEntity = await prisma.client.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'Invoice Test Legal Entity', panNumber: 'ABCPI9012P', registeredAddress: 'Ahmedabad, Gujarat' },
  });
  legalEntityId = legalEntity.id;

  const gujaratGst = await legalEntities.createGstRegistration({
    organizationId,
    legalEntityId,
    stateId: gujaratStateId,
    gstin: '24AAAAA0000A1Z5',
    tradeName: undefined,
    actorId,
    correlationId: generateId(),
  });
  gujaratGstRegistrationId = gujaratGst.id;

  const maharashtraGst = await legalEntities.createGstRegistration({
    organizationId,
    legalEntityId,
    stateId: maharashtraStateId,
    gstin: '27AAAAA0000A1Z5',
    tradeName: undefined,
    actorId,
    correlationId: generateId(),
  });
  maharashtraGstRegistrationId = maharashtraGst.id;

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

  const project = await projects.create({
    organizationId,
    clientId,
    legalEntityId,
    leadId: undefined,
    tenderId: undefined,
    projectManagerId: undefined,
    introducerId: undefined,
    projectTypeId: undefined,
    name: 'Invoice Test Project',
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
  await prisma.client.documentLink.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.document.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.idempotencyKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.invoiceLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.invoice.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.bankAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
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

describe('InvoicesService', () => {
  it('creates a draft from a CAPEX-event alert and computes intra-state CGST+SGST on finalize', async () => {
    const capex = await milestones.createCapex({
      organizationId,
      projectId,
      name: 'CGST Test Capex',
      approvedAmount: '5000000',
      referenceNumber: undefined,
      approvalDate: undefined,
      description: undefined,
      alertRecipient: undefined,
      reminderOffsetDays: undefined,
      events: [{ name: 'On Completion', amount: '5000000', dueDate: '2026-05-31' }],
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const eventId = overview.capexEvents.find((e) => e.milestoneId === capex.id)!.id;
    const alert = await createOpenAlert({ sourceType: 'CAPEX_EVENT', sourceEventId: eventId });

    const draft = await invoices.createDraftFromAlert({
      organizationId,
      paymentAlertId: alert.id,
      gstRegistrationId: gujaratGstRegistrationId,
      dueDate: '2026-05-15',
      paymentTermsDays: 30,
      narrative: undefined,
      lines: createBasicLine({ unitPrice: '1000000' }),
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(draft.status).toBe('DRAFT');
    expect(draft.milestoneType).toBe('CAPEX');

    const finalized = await invoices.finalize({
      organizationId,
      id: draft.id,
      expectedVersion: draft.version,
      invoiceDate: '2026-04-20',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(finalized.status).toBe('FINALIZED');
    expect(finalized.invoiceNumber).not.toBeNull();
    expect(finalized.taxableAmount).toBe('1000000.00');
    expect(finalized.cgstAmount).toBe('90000.00');
    expect(finalized.sgstAmount).toBe('90000.00');
    expect(finalized.igstAmount).toBe('0.00');
    expect(finalized.totalAmount).toBe('1180000.00');

    const journalDetail = await posting.getEntryDetail({ organizationId, id: finalized.journalEntryId! });
    const debitLine = journalDetail.lines.find((l) => Number(l.debitAmount) > 0)!;
    expect(debitLine.ledgerAccountCode).toBe('ACCOUNTS_RECEIVABLE');
    expect(debitLine.debitAmount).toBe('1180000.00');
    const creditCodes = journalDetail.lines.filter((l) => Number(l.creditAmount) > 0).map((l) => l.ledgerAccountCode).sort();
    expect(creditCodes).toEqual(['OUTPUT_CGST_PAYABLE', 'OUTPUT_SGST_PAYABLE', 'SOFTWARE_PROJECT_REVENUE'].sort());

    const alertAfter = await prisma.client.paymentAlert.findUniqueOrThrow({ where: { id: alert.id } });
    // 10,00,000 of a 50,00,000 event: billed in part, so the alert stays open for the rest (ADR-156).
    expect(alertAfter.status).toBe('OPEN');
    expect(alertAfter.invoiceId).toBeNull();

    const auditEvent = await prisma.client.auditEvent.findFirst({
      where: { entityType: 'INVOICE', entityId: finalized.id, action: 'INVOICE_FINALIZED' },
    });
    expect(auditEvent).not.toBeNull();
  });

  it('computes inter-state IGST when the seller GST registration state differs from the buyer state', async () => {
    const capex = await milestones.createCapex({
      organizationId,
      projectId,
      name: 'IGST Test Capex',
      approvedAmount: '5000000',
      referenceNumber: undefined,
      approvalDate: undefined,
      description: undefined,
      alertRecipient: undefined,
      reminderOffsetDays: undefined,
      events: [{ name: 'On Completion', amount: '5000000', dueDate: '2026-05-31' }],
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const eventId = overview.capexEvents.find((e) => e.milestoneId === capex.id)!.id;
    const alert = await createOpenAlert({ sourceType: 'CAPEX_EVENT', sourceEventId: eventId });

    const draft = await invoices.createDraftFromAlert({
      organizationId,
      paymentAlertId: alert.id,
      gstRegistrationId: maharashtraGstRegistrationId,
      dueDate: '2026-05-15',
      paymentTermsDays: undefined,
      narrative: undefined,
      lines: createBasicLine({ unitPrice: '200000' }),
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    const finalized = await invoices.finalize({
      organizationId,
      id: draft.id,
      expectedVersion: draft.version,
      invoiceDate: '2026-04-20',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(finalized.cgstAmount).toBe('0.00');
    expect(finalized.sgstAmount).toBe('0.00');
    expect(finalized.igstAmount).toBe('36000.00');
  });

  it('creates a draft from an OPEX-installment alert, snapshots seller/buyer, and flips installment status', async () => {
    const opex = await milestones.createOpex({
      organizationId,
      projectId,
      name: 'AMC Services Test',
      approvedAmount: '1200000',
      frequency: 'MONTHLY',
      installmentCount: 12,
      scheduleStartDate: '2026-01-01',
      firstInvoiceDate: '2026-01-01',
      referenceNumber: undefined,
      approvalDate: undefined,
      description: undefined,
      alertRecipient: undefined,
      reminderOffsetDays: undefined,
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const installmentId = opex.installments![0]!.id;
    const alert = await createOpenAlert({ sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: installmentId });

    const draft = await invoices.createDraftFromAlert({
      organizationId,
      paymentAlertId: alert.id,
      gstRegistrationId: gujaratGstRegistrationId,
      dueDate: '2026-01-31',
      paymentTermsDays: undefined,
      narrative: undefined,
      lines: createBasicLine({ unitPrice: '100000' }),
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(draft.milestoneType).toBe('OPEX');

    const draftInstallment = await prisma.client.milestoneInstallment.findUniqueOrThrow({ where: { id: installmentId } });
    expect(draftInstallment.status).toBe('INVOICE_DRAFT');

    const finalized = await invoices.finalize({
      organizationId,
      id: draft.id,
      expectedVersion: draft.version,
      invoiceDate: '2026-01-15',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(finalized.status).toBe('FINALIZED');

    const detail = await invoices.getDetail({ organizationId, id: finalized.id, actorId, canSeeAll: true });
    expect(detail.sellerLegalName).toBe('Invoice Test Legal Entity');
    expect(detail.sellerGstin).toBe('24AAAAA0000A1Z5');
    expect(detail.buyerName).toBe('Invoice Test Client');
    expect(detail.buyerGstin).toBe('24BBBBB1111B1Z5');

    const invoicedInstallment = await prisma.client.milestoneInstallment.findUniqueOrThrow({ where: { id: installmentId } });
    expect(invoicedInstallment.status).toBe('INVOICED');
  });

  it('offers the previous OPEX invoice lines when the next installment is billed', async () => {
    const opex = await milestones.createOpex({
      organizationId,
      projectId,
      name: 'Copy Lines AMC',
      approvedAmount: '200000',
      frequency: 'MONTHLY',
      installmentCount: 2,
      scheduleStartDate: '2026-03-01',
      firstInvoiceDate: '2026-03-01',
      referenceNumber: undefined,
      approvalDate: undefined,
      description: undefined,
      alertRecipient: undefined,
      reminderOffsetDays: undefined,
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const first = opex.installments![0]!;
    const second = opex.installments![1]!;
    const firstAlert = await createOpenAlert({ sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: first.id });
    await invoices.createDraftFromAlert({
      organizationId,
      paymentAlertId: firstAlert.id,
      gstRegistrationId: gujaratGstRegistrationId,
      dueDate: '2026-03-31',
      paymentTermsDays: undefined,
      narrative: undefined,
      lines: [
        { description: 'Site engineer', hsnSac: '998314', quantity: '1', unitPrice: '80000', gstRatePercent: '9' },
        { description: 'Helper', hsnSac: '998314', quantity: '1', unitPrice: '20000', gstRatePercent: '9' },
      ],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    const secondAlert = await createOpenAlert({ sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: second.id });
    const defaults = await invoices.getDraftDefaults({ organizationId, paymentAlertId: secondAlert.id, actorId, canSeeAll: true });
    expect(defaults.previousOpexLines).toEqual([
      { description: 'Site engineer', hsnSac: '998314', unitPrice: '80000.00', gstRatePercent: '9.00' },
      { description: 'Helper', hsnSac: '998314', unitPrice: '20000.00', gstRatePercent: '9.00' },
    ]);
    expect(defaults.previousOpexLabel).toContain('Installment 1');
  });

  it('hasInwardCopy is false until a document is linked with the inward-copy linkType, in both list() and getDetail()', async () => {
    const opex = await milestones.createOpex({
      organizationId,
      projectId,
      name: 'Inward Copy Test',
      approvedAmount: '1200000',
      frequency: 'MONTHLY',
      installmentCount: 3,
      scheduleStartDate: '2026-07-01',
      firstInvoiceDate: '2026-07-01',
      referenceNumber: undefined,
      approvalDate: undefined,
      description: undefined,
      alertRecipient: undefined,
      reminderOffsetDays: undefined,
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const installmentId = opex.installments![0]!.id;
    const alert = await createOpenAlert({ sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: installmentId });

    const draft = await invoices.createDraftFromAlert({
      organizationId,
      paymentAlertId: alert.id,
      gstRegistrationId: gujaratGstRegistrationId,
      dueDate: '2026-07-31',
      paymentTermsDays: undefined,
      narrative: undefined,
      lines: createBasicLine(),
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    const finalized = await invoices.finalize({
      organizationId,
      id: draft.id,
      expectedVersion: draft.version,
      invoiceDate: '2026-07-15',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    const beforeDetail = await invoices.getDetail({ organizationId, id: finalized.id, actorId, canSeeAll: true });
    expect(beforeDetail.hasInwardCopy).toBe(false);
    const beforeList = await invoices.list({ organizationId, page: 1, pageSize: 25, filters: { projectId }, actorId, canSeeAll: true });
    expect(beforeList.rows.find((r) => r.id === finalized.id)?.hasInwardCopy).toBe(false);

    // A supporting document with a different linkType must not flip the flag.
    const supportingDoc = await prisma.client.document.create({
      data: {
        id: generateId(),
        organizationId,
        documentGroupId: generateId(),
        storageKey: `test/${generateId()}`,
        originalFilename: 'supporting.pdf',
        contentType: 'application/pdf',
        sizeBytes: 100n,
        checksum: 'x',
        uploadedBy: actorId,
        status: 'UPLOADED',
      },
    });
    await prisma.client.documentLink.create({
      data: { id: generateId(), organizationId, documentId: supportingDoc.id, entityType: 'INVOICE', entityId: finalized.id, linkType: 'SUPPORTING' },
    });
    const stillFalse = await invoices.getDetail({ organizationId, id: finalized.id, actorId, canSeeAll: true });
    expect(stillFalse.hasInwardCopy).toBe(false);

    const inwardCopyDoc = await prisma.client.document.create({
      data: {
        id: generateId(),
        organizationId,
        documentGroupId: generateId(),
        storageKey: `test/${generateId()}`,
        originalFilename: 'inward-copy.pdf',
        contentType: 'application/pdf',
        sizeBytes: 100n,
        checksum: 'y',
        uploadedBy: actorId,
        status: 'UPLOADED',
      },
    });
    await prisma.client.documentLink.create({
      data: { id: generateId(), organizationId, documentId: inwardCopyDoc.id, entityType: 'INVOICE', entityId: finalized.id, linkType: INVOICE_INWARD_COPY_LINK_TYPE },
    });

    const afterDetail = await invoices.getDetail({ organizationId, id: finalized.id, actorId, canSeeAll: true });
    expect(afterDetail.hasInwardCopy).toBe(true);
    const afterList = await invoices.list({ organizationId, page: 1, pageSize: 25, filters: { projectId }, actorId, canSeeAll: true });
    expect(afterList.rows.find((r) => r.id === finalized.id)?.hasInwardCopy).toBe(true);
  });

  it('rejects a second draft while the source already has an open one', async () => {
    const opex = await milestones.createOpex({
      organizationId,
      projectId,
      name: 'Duplicate Source Test',
      approvedAmount: '1200000',
      frequency: 'MONTHLY',
      installmentCount: 3,
      scheduleStartDate: '2026-06-01',
      firstInvoiceDate: '2026-06-01',
      referenceNumber: undefined,
      approvalDate: undefined,
      description: undefined,
      alertRecipient: undefined,
      reminderOffsetDays: undefined,
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const installmentId = opex.installments![0]!.id;
    const alert = await createOpenAlert({ sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: installmentId });

    await invoices.createDraftFromAlert({
      organizationId,
      paymentAlertId: alert.id,
      gstRegistrationId: gujaratGstRegistrationId,
      dueDate: '2026-06-30',
      paymentTermsDays: undefined,
      narrative: undefined,
      lines: createBasicLine(),
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    await expect(
      invoices.createDraftFromAlert({
        organizationId,
        paymentAlertId: alert.id,
        gstRegistrationId: gujaratGstRegistrationId,
        dueDate: '2026-06-30',
        paymentTermsDays: undefined,
        narrative: undefined,
        lines: createBasicLine(),
        idempotencyKey: generateId(),
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('already open');
  });

  it('void of a draft frees the source for a new draft', async () => {
    const opex = await milestones.createOpex({
      organizationId,
      projectId,
      name: 'Void Draft Test',
      approvedAmount: '1200000',
      frequency: 'MONTHLY',
      installmentCount: 3,
      scheduleStartDate: '2026-07-01',
      firstInvoiceDate: '2026-07-01',
      referenceNumber: undefined,
      approvalDate: undefined,
      description: undefined,
      alertRecipient: undefined,
      reminderOffsetDays: undefined,
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const installmentId = opex.installments![0]!.id;
    const alert = await createOpenAlert({ sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: installmentId });

    const draft = await invoices.createDraftFromAlert({
      organizationId,
      paymentAlertId: alert.id,
      gstRegistrationId: gujaratGstRegistrationId,
      dueDate: '2026-07-31',
      paymentTermsDays: undefined,
      narrative: undefined,
      lines: createBasicLine(),
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    const voided = await invoices.void({ canReverseReceipts: true,
      organizationId,
      id: draft.id,
      expectedVersion: draft.version,
      reason: 'Wrong amount entered',
      accountingDate: undefined,
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(voided.status).toBe('VOID');

    const revertedInstallment = await prisma.client.milestoneInstallment.findUniqueOrThrow({ where: { id: installmentId } });
    expect(revertedInstallment.status).toBe('PLANNED');

    const secondDraft = await invoices.createDraftFromAlert({
      organizationId,
      paymentAlertId: alert.id,
      gstRegistrationId: gujaratGstRegistrationId,
      dueDate: '2026-07-31',
      paymentTermsDays: undefined,
      narrative: undefined,
      lines: createBasicLine(),
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(secondDraft.status).toBe('DRAFT');
  });

  it('void of a finalized invoice reverses the journal, reopens the alert, and reverts the installment', async () => {
    const opex = await milestones.createOpex({
      organizationId,
      projectId,
      name: 'Void Finalized Test',
      approvedAmount: '1200000',
      frequency: 'MONTHLY',
      installmentCount: 3,
      scheduleStartDate: '2026-08-01',
      firstInvoiceDate: '2026-08-01',
      referenceNumber: undefined,
      approvalDate: undefined,
      description: undefined,
      alertRecipient: undefined,
      reminderOffsetDays: undefined,
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const installmentId = opex.installments![0]!.id;
    const alert = await createOpenAlert({ sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: installmentId });

    const draft = await invoices.createDraftFromAlert({
      organizationId,
      paymentAlertId: alert.id,
      gstRegistrationId: gujaratGstRegistrationId,
      dueDate: '2026-08-31',
      paymentTermsDays: undefined,
      narrative: undefined,
      lines: createBasicLine(),
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    const finalized = await invoices.finalize({
      organizationId,
      id: draft.id,
      expectedVersion: draft.version,
      invoiceDate: '2026-08-05',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    const voided = await invoices.void({ canReverseReceipts: true,
      organizationId,
      id: finalized.id,
      expectedVersion: finalized.version,
      reason: 'Client cancelled the work order',
      accountingDate: '2026-08-10',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(voided.status).toBe('VOID');
    expect(voided.voidJournalEntryId).not.toBeNull();

    const reversalDetail = await posting.getEntryDetail({ organizationId, id: voided.voidJournalEntryId! });
    expect(reversalDetail.reversalOfJournalEntryId).toBe(finalized.journalEntryId);

    const reopenedAlert = await prisma.client.paymentAlert.findUniqueOrThrow({ where: { id: alert.id } });
    expect(reopenedAlert.status).toBe('OPEN');
    expect(reopenedAlert.invoiceId).toBeNull();

    const revertedInstallment = await prisma.client.milestoneInstallment.findUniqueOrThrow({ where: { id: installmentId } });
    expect(revertedInstallment.status).toBe('PLANNED');
  });

  it('finalizes a CAPEX invoice beyond the milestone approved amount, says how much more on the draft, and keeps remaining at zero (ADR-165)', async () => {
    const capex = await milestones.createCapex({
      organizationId,
      projectId,
      name: 'Cap Exceeded Test',
      approvedAmount: '1000000',
      referenceNumber: undefined,
      approvalDate: undefined,
      description: undefined,
      alertRecipient: undefined,
      reminderOffsetDays: undefined,
      events: [
        { name: 'Event A', amount: '500000', dueDate: '2026-05-31' },
        { name: 'Event B', amount: '500000', dueDate: '2026-06-30' },
      ],
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const events = overview.capexEvents.filter((e) => e.milestoneId === capex.id);
    const eventAId = events[0]!.id;
    const eventBId = events[1]!.id;

    const alertA = await createOpenAlert({ sourceType: 'CAPEX_EVENT', sourceEventId: eventAId });
    const draftA = await invoices.createDraftFromAlert({
      organizationId,
      paymentAlertId: alertA.id,
      gstRegistrationId: gujaratGstRegistrationId,
      dueDate: '2026-05-15',
      paymentTermsDays: undefined,
      narrative: undefined,
      lines: createBasicLine({ unitPrice: '600000' }),
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    await invoices.finalize({
      organizationId,
      id: draftA.id,
      expectedVersion: draftA.version,
      invoiceDate: '2026-04-20',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });

    const alertB = await createOpenAlert({ sourceType: 'CAPEX_EVENT', sourceEventId: eventBId });
    const draftB = await invoices.createDraftFromAlert({
      organizationId,
      paymentAlertId: alertB.id,
      gstRegistrationId: gujaratGstRegistrationId,
      dueDate: '2026-06-15',
      paymentTermsDays: undefined,
      narrative: undefined,
      lines: createBasicLine({ unitPrice: '500000' }),
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    // Event B is 500,000 and nothing is billed on it yet: this draft is within it.
    expect((await invoices.getDetail({ organizationId, id: draftB.id, actorId, canSeeAll: true })).overBilledBy).toBeNull();
    const finalizedB = await invoices.finalize({
      organizationId,
      id: draftB.id,
      expectedVersion: draftB.version,
      invoiceDate: '2026-06-01',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(finalizedB.status).toBe('FINALIZED');

    // Event A was billed 600,000 against 500,000; nothing is left, and nothing shows negative.
    const after = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const eventA = after.capexEvents.find((e) => e.id === eventAId)!;
    expect([eventA.invoicedAmount, eventA.remainingAmount]).toEqual(['600000.00', '0.00']);
  });

  it('a duplicate idempotency-key createDraftFromAlert call returns the original record, not a second one', async () => {
    const opex = await milestones.createOpex({
      organizationId,
      projectId,
      name: 'Idempotency Test',
      approvedAmount: '1200000',
      frequency: 'MONTHLY',
      installmentCount: 3,
      scheduleStartDate: '2026-09-01',
      firstInvoiceDate: '2026-09-01',
      referenceNumber: undefined,
      approvalDate: undefined,
      description: undefined,
      alertRecipient: undefined,
      reminderOffsetDays: undefined,
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const installmentId = opex.installments![0]!.id;
    const alert = await createOpenAlert({ sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: installmentId });

    const key = generateId();
    const input = {
      organizationId,
      paymentAlertId: alert.id,
      gstRegistrationId: gujaratGstRegistrationId,
      dueDate: '2026-09-30',
      paymentTermsDays: undefined,
      narrative: undefined,
      lines: createBasicLine(),
      idempotencyKey: key,
      actorId,
      correlationId: generateId(),
    };
    const first = await invoices.createDraftFromAlert(input);
    const second = await invoices.createDraftFromAlert({ ...input, correlationId: generateId() });
    expect(second.id).toBe(first.id);
  });

  it('does not leak invoices across organizations', async () => {
    const { rows } = await invoices.list({ organizationId: otherOrganizationId, page: 1, pageSize: 25, filters: {}, actorId, canSeeAll: true });
    expect(rows).toHaveLength(0);
  });

  it('updateDraft can change the GST registration on a draft (regression: gstRegistrationId sits behind a composite FK, unreachable via a plain updateMany() scalar/connect)', async () => {
    const opex = await milestones.createOpex({
      organizationId,
      projectId,
      name: 'Update Draft GST Registration Test',
      approvedAmount: '1200000',
      frequency: 'MONTHLY',
      installmentCount: 3,
      scheduleStartDate: '2026-10-01',
      firstInvoiceDate: '2026-10-01',
      referenceNumber: undefined,
      approvalDate: undefined,
      description: undefined,
      alertRecipient: undefined,
      reminderOffsetDays: undefined,
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const installmentId = opex.installments![0]!.id;
    const alert = await createOpenAlert({ sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: installmentId });

    const draft = await invoices.createDraftFromAlert({
      organizationId,
      paymentAlertId: alert.id,
      gstRegistrationId: gujaratGstRegistrationId,
      dueDate: '2026-10-31',
      paymentTermsDays: undefined,
      narrative: undefined,
      lines: createBasicLine(),
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(draft.gstRegistrationId).toBe(gujaratGstRegistrationId);

    const updated = await invoices.updateDraft({
      organizationId,
      id: draft.id,
      expectedVersion: draft.version,
      gstRegistrationId: maharashtraGstRegistrationId,
      dueDate: undefined,
      paymentTermsDays: undefined,
      narrative: undefined,
      lines: undefined,
      actorId,
      correlationId: generateId(),
    });
    expect(updated.gstRegistrationId).toBe(maharashtraGstRegistrationId);
    expect(updated.gstRegistrationGstin).toBe('27AAAAA0000A1Z5');

    const detail = await invoices.getDetail({ organizationId, id: draft.id, actorId, canSeeAll: true });
    expect(detail.gstRegistrationId).toBe(maharashtraGstRegistrationId);
  });

  it('puts several CAPEX events on one invoice and keeps an OPEX installment alone', async () => {
    const capex = await milestones.createCapex({
      organizationId,
      projectId,
      name: 'Combined Capex Invoice',
      approvedAmount: '800000',
      referenceNumber: undefined,
      approvalDate: undefined,
      description: undefined,
      alertRecipient: undefined,
      reminderOffsetDays: undefined,
      events: [
        { name: 'Design', amount: '300000', dueDate: '2026-05-31' },
        { name: 'Build', amount: '500000', dueDate: '2026-06-30' },
      ],
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const events = overview.capexEvents.filter((event) => event.milestoneId === capex.id);
    const design = events.find((event) => event.name === 'Design')!;
    const build = events.find((event) => event.name === 'Build')!;
    const designAlert = await createOpenAlert({ sourceType: 'CAPEX_EVENT', sourceEventId: design.id });
    const buildAlert = await createOpenAlert({ sourceType: 'CAPEX_EVENT', sourceEventId: build.id });

    const defaults = await invoices.getDraftDefaults({
      organizationId,
      paymentAlertId: designAlert.id,
      actorId,
      canSeeAll: true,
    });
    expect(defaults.capexChoices.map((choice) => choice.paymentAlertId)).toContain(buildAlert.id);

    const draft = await invoices.createDraftFromAlert({
      organizationId,
      paymentAlertId: designAlert.id,
      additionalPaymentAlertIds: [buildAlert.id],
      gstRegistrationId: gujaratGstRegistrationId,
      dueDate: '2026-06-15',
      paymentTermsDays: undefined,
      narrative: undefined,
      lines: [
        { description: 'Design', hsnSac: '998314', quantity: '1', unitPrice: '300000', gstRatePercent: '9', sourceEventId: design.id },
        { description: 'Build', hsnSac: '998314', quantity: '1', unitPrice: '500000', gstRatePercent: '9', sourceEventId: build.id },
      ],
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    const detail = await invoices.getDetail({ organizationId, id: draft.id, actorId, canSeeAll: true });
    expect(detail.lines.map((line) => line.sourceEventId).sort()).toEqual([build.id, design.id].sort());
    expect(detail.sourceTitle).toContain('Design');
    expect(detail.sourceTitle).toContain('Build');

    const finalized = await invoices.finalize({
      organizationId,
      id: draft.id,
      expectedVersion: draft.version,
      invoiceDate: '2026-06-01',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(finalized.taxableAmount).toBe('800000.00');
    const closedDesign = await prisma.client.paymentAlert.findUniqueOrThrow({ where: { id: designAlert.id } });
    const closedBuild = await prisma.client.paymentAlert.findUniqueOrThrow({ where: { id: buildAlert.id } });
    expect(closedDesign.status).toBe('CLOSED');
    expect(closedBuild.status).toBe('CLOSED');
    expect(closedDesign.invoiceId).toBe(draft.id);
    expect(closedBuild.invoiceId).toBe(draft.id);

    const opex = await milestones.createOpex({
      organizationId,
      projectId,
      name: 'OPEX stays single',
      approvedAmount: '100000',
      frequency: 'MONTHLY',
      installmentCount: 1,
      scheduleStartDate: '2026-11-01',
      firstInvoiceDate: '2026-11-01',
      referenceNumber: undefined,
      approvalDate: undefined,
      description: undefined,
      alertRecipient: undefined,
      reminderOffsetDays: undefined,
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const spare = await milestones.createCapex({
      organizationId,
      projectId,
      name: 'Spare Capex',
      approvedAmount: '100000',
      referenceNumber: undefined,
      approvalDate: undefined,
      description: undefined,
      alertRecipient: undefined,
      reminderOffsetDays: undefined,
      events: [{ name: 'Spare', amount: '100000', dueDate: '2026-07-31' }],
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const spareOverview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const spareEvent = spareOverview.capexEvents.find((event) => event.milestoneId === spare.id)!;
    const spareAlert = await createOpenAlert({ sourceType: 'CAPEX_EVENT', sourceEventId: spareEvent.id });
    const opexAlert = await createOpenAlert({ sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: opex.installments![0]!.id });
    await expect(
      invoices.createDraftFromAlert({
        organizationId,
        paymentAlertId: opexAlert.id,
        additionalPaymentAlertIds: [spareAlert.id],
        gstRegistrationId: gujaratGstRegistrationId,
        dueDate: '2026-11-15',
        paymentTermsDays: undefined,
        narrative: undefined,
        lines: createBasicLine({ unitPrice: '100000' }),
        idempotencyKey: generateId(),
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow(/OPEX/);
  });

  it('issues a proforma without posting, then posts when it becomes a tax invoice', async () => {
    const opex = await milestones.createOpex({
      organizationId,
      projectId,
      name: 'Proforma then tax invoice',
      approvedAmount: '100000',
      frequency: 'MONTHLY',
      installmentCount: 1,
      scheduleStartDate: '2026-12-01',
      firstInvoiceDate: '2026-12-01',
      referenceNumber: undefined,
      approvalDate: undefined,
      description: undefined,
      alertRecipient: undefined,
      reminderOffsetDays: undefined,
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const alert = await createOpenAlert({ sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: opex.installments![0]!.id });
    const draft = await invoices.createDraftFromAlert({
      organizationId,
      paymentAlertId: alert.id,
      kind: 'PROFORMA',
      gstRegistrationId: gujaratGstRegistrationId,
      dueDate: '2026-12-15',
      paymentTermsDays: undefined,
      narrative: undefined,
      lines: createBasicLine({ unitPrice: '100000' }),
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(draft.kind).toBe('PROFORMA');
    expect(draft.journalEntryId).toBeNull();

    const issued = await invoices.finalize({
      organizationId,
      id: draft.id,
      expectedVersion: draft.version,
      invoiceDate: '2026-12-01',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(issued.status).toBe('ISSUED');
    expect(issued.kind).toBe('PROFORMA');
    expect(issued.journalEntryId).toBeNull();
    expect(issued.proformaNumber).toMatch(/^PF/);
    expect(issued.outstandingAmount).toBeNull();
    expect(issued.totalAmount).toBe('118000.00');
    const stillOpen = await prisma.client.paymentAlert.findUniqueOrThrow({ where: { id: alert.id } });
    expect(stillOpen.status).toBe('OPEN');
    const installment = await prisma.client.milestoneInstallment.findUniqueOrThrow({ where: { id: opex.installments![0]!.id } });
    expect(installment.status).toBe('INVOICE_DRAFT');

    const tax = await invoices.startConversion({
      organizationId,
      id: draft.id,
      expectedVersion: issued.version,
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(tax.id).not.toBe(draft.id);
    expect(tax.status).toBe('DRAFT');
    expect(tax.kind).toBe('REGULAR');
    expect(tax.journalEntryId).toBeNull();
    expect(tax.proformaNumber).toBeNull();
    const again = await invoices.startConversion({
      organizationId,
      id: draft.id,
      expectedVersion: issued.version + 1,
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(again.id).toBe(tax.id);

    const kept = await invoices.getDetail({ organizationId, id: draft.id, actorId, canSeeAll: true });
    expect(kept.status).toBe('CONVERTED');
    expect(kept.proformaNumber).toBe(issued.proformaNumber);
    expect(kept.totalAmount).toBe('118000.00');
    expect(kept.journalEntryId).toBeNull();
    expect(kept.convertedToInvoiceId).toBe(tax.id);
    const stillOpenAfterConvert = await prisma.client.paymentAlert.findUniqueOrThrow({ where: { id: alert.id } });
    expect(stillOpenAfterConvert.status).toBe('OPEN');

    const posted = await invoices.finalize({
      organizationId,
      id: tax.id,
      expectedVersion: tax.version,
      invoiceDate: '2026-12-05',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(posted.status).toBe('FINALIZED');
    expect(posted.kind).toBe('REGULAR');
    expect(posted.invoiceNumber).toBeTruthy();
    expect(posted.proformaNumber).toBeNull();
    expect(posted.journalEntryId).toBeTruthy();
    expect(posted.outstandingAmount).toBe('118000.00');
    const closed = await prisma.client.paymentAlert.findUniqueOrThrow({ where: { id: alert.id } });
    expect(closed.status).toBe('CLOSED');
    expect(closed.invoiceId).toBe(tax.id);
    const invoiced = await prisma.client.milestoneInstallment.findUniqueOrThrow({ where: { id: opex.installments![0]!.id } });
    expect(invoiced.status).toBe('INVOICED');
    const proformaAfter = await invoices.getDetail({ organizationId, id: draft.id, actorId, canSeeAll: true });
    expect(proformaAfter.status).toBe('CONVERTED');
    expect(proformaAfter.totalAmount).toBe('118000.00');
    expect(proformaAfter.proformaNumber).toBe(issued.proformaNumber);
  });

  it('posts the edited tax invoice and leaves the proforma amounts in place', async () => {
    const opex = await milestones.createOpex({
      organizationId,
      projectId,
      name: 'Edited tax invoice from proforma',
      approvedAmount: '100000',
      frequency: 'MONTHLY',
      installmentCount: 1,
      scheduleStartDate: '2026-10-01',
      firstInvoiceDate: '2026-10-01',
      referenceNumber: undefined,
      approvalDate: undefined,
      description: undefined,
      alertRecipient: undefined,
      reminderOffsetDays: undefined,
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const alert = await createOpenAlert({ sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: opex.installments![0]!.id });
    const draft = await invoices.createDraftFromAlert({
      organizationId,
      paymentAlertId: alert.id,
      kind: 'PROFORMA',
      gstRegistrationId: gujaratGstRegistrationId,
      dueDate: '2026-10-15',
      paymentTermsDays: undefined,
      narrative: 'Original heading',
      lines: createBasicLine({ unitPrice: '100000' }),
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    const issued = await invoices.finalize({
      organizationId,
      id: draft.id,
      expectedVersion: draft.version,
      invoiceDate: '2026-10-01',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    const tax = await invoices.startConversion({
      organizationId,
      id: issued.id,
      expectedVersion: issued.version,
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    const edited = await invoices.updateDraft({
      organizationId,
      id: tax.id,
      expectedVersion: tax.version,
      gstRegistrationId: undefined,
      dueDate: undefined,
      paymentTermsDays: undefined,
      narrative: 'Revised heading',
      lines: createBasicLine({ unitPrice: '50000' }),
      actorId,
      correlationId: generateId(),
    });
    const posted = await invoices.finalize({
      organizationId,
      id: tax.id,
      expectedVersion: edited.version,
      invoiceDate: '2026-10-05',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(posted.totalAmount).toBe('59000.00');
    expect(posted.narrative).toBe('Revised heading');
    expect(posted.outstandingAmount).toBe('59000.00');
    const proforma = await invoices.getDetail({ organizationId, id: issued.id, actorId, canSeeAll: true });
    expect(proforma.status).toBe('CONVERTED');
    expect(proforma.totalAmount).toBe('118000.00');
    expect(proforma.narrative).toBe('Original heading');
    expect(proforma.journalEntryId).toBeNull();
  });

  it('puts the proforma back when the tax invoice draft is voided', async () => {
    const opex = await milestones.createOpex({
      organizationId,
      projectId,
      name: 'Restore proforma',
      approvedAmount: '100000',
      frequency: 'MONTHLY',
      installmentCount: 1,
      scheduleStartDate: '2026-11-01',
      firstInvoiceDate: '2026-11-01',
      referenceNumber: undefined,
      approvalDate: undefined,
      description: undefined,
      alertRecipient: undefined,
      reminderOffsetDays: undefined,
      idempotencyKey: generateId(),
      actorId,
      canSeeAll: true,
      correlationId: generateId(),
    });
    const alert = await createOpenAlert({ sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: opex.installments![0]!.id });
    const draft = await invoices.createDraftFromAlert({
      organizationId,
      paymentAlertId: alert.id,
      kind: 'PROFORMA',
      gstRegistrationId: gujaratGstRegistrationId,
      dueDate: '2026-11-15',
      paymentTermsDays: undefined,
      narrative: undefined,
      lines: createBasicLine({ unitPrice: '100000' }),
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    const issued = await invoices.finalize({
      organizationId,
      id: draft.id,
      expectedVersion: draft.version,
      invoiceDate: '2026-11-01',
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    const tax = await invoices.startConversion({
      organizationId,
      id: issued.id,
      expectedVersion: issued.version,
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    await invoices.void({ canReverseReceipts: true,
      organizationId,
      id: tax.id,
      expectedVersion: tax.version,
      reason: 'Wrong amount',
      accountingDate: undefined,
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    const restored = await invoices.getDetail({ organizationId, id: issued.id, actorId, canSeeAll: true });
    expect(restored.status).toBe('ISSUED');
    expect(restored.proformaNumber).toBe(issued.proformaNumber);
    expect(restored.convertedToInvoiceId).toBeNull();
    const replacement = await invoices.startConversion({
      organizationId,
      id: issued.id,
      expectedVersion: restored.version,
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(replacement.id).not.toBe(tax.id);
    expect(replacement.status).toBe('DRAFT');
  });

  async function createCapexDraft(name: string) {
    const capex = await milestones.createCapex({
      organizationId, projectId, name, approvedAmount: '100000', referenceNumber: undefined,
      approvalDate: undefined, description: undefined, alertRecipient: undefined, reminderOffsetDays: undefined,
      events: [{ name, amount: '100000', dueDate: '2026-08-31' }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const eventId = overview.capexEvents.find((event) => event.milestoneId === capex.id)!.id;
    const alert = await createOpenAlert({ sourceType: 'CAPEX_EVENT', sourceEventId: eventId });
    return invoices.createDraftFromAlert({
      organizationId, paymentAlertId: alert.id, gstRegistrationId: gujaratGstRegistrationId, dueDate: '2026-09-15',
      paymentTermsDays: undefined, narrative: undefined, lines: createBasicLine({ unitPrice: '50000' }),
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
  }

  it('creates the April–March financial year when no year covers the invoice date', async () => {
    const draft = await createCapexDraft('Year Missing Capex');
    const finalized = await invoices.finalize({
      organizationId, id: draft.id, expectedVersion: draft.version, invoiceDate: '2030-05-10',
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });

    const year = await prisma.client.financialYear.findFirstOrThrow({ where: { legalEntityId, label: 'FY2030-31' }, include: { accountingPeriods: true } });
    expect(year.startDate.toISOString().slice(0, 10)).toBe('2030-04-01');
    expect(year.endDate.toISOString().slice(0, 10)).toBe('2031-03-31');
    expect(year.isCurrent).toBe(false);
    expect(year.accountingPeriods).toHaveLength(12);
    expect(finalized.status).toBe('FINALIZED');
    expect(finalized.invoiceNumber).toBe('0001');
    expect(finalized.invoiceDate).toBe('2030-05-10');
  });

  it('fills only the gap after an existing year that is not April–March', async () => {
    const draft = await createCapexDraft('Year Gap Capex');
    await invoices.finalize({
      organizationId, id: draft.id, expectedVersion: draft.version, invoiceDate: '2027-02-10',
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });

    // The fixture year is the 2026 calendar year, so 1 Apr 2026 – 31 Dec 2026 is already taken.
    const year = await prisma.client.financialYear.findFirstOrThrow({
      where: { legalEntityId, startDate: new Date('2027-01-01T00:00:00.000Z') },
      include: { accountingPeriods: { orderBy: { periodNumber: 'asc' } } },
    });
    expect(year.endDate.toISOString().slice(0, 10)).toBe('2027-03-31');
    expect(year.label).toBe('FY2026-27 (2027-01-01 to 2027-03-31)');
    expect(year.accountingPeriods.map((period) => period.endDate.toISOString().slice(0, 10))).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('uses a typed invoice number and rejects one already used in that GST registration and year', async () => {
    const first = await createCapexDraft('Manual Number Capex');
    const finalized = await invoices.finalize({
      organizationId, id: first.id, expectedVersion: first.version, invoiceDate: '2026-09-01', invoiceNumber: 'MT/26-27/101',
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect(finalized.invoiceNumber).toBe('MT/26-27/101');

    const second = await createCapexDraft('Manual Number Clash Capex');
    await expect(
      invoices.finalize({
        organizationId, id: second.id, expectedVersion: second.version, invoiceDate: '2026-09-02', invoiceNumber: 'mt/26-27/101',
        idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow('already used');
    await expect(
      invoices.finalize({
        organizationId, id: second.id, expectedVersion: second.version, invoiceDate: '2026-09-02', invoiceNumber: 'MT 101!',
        idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow('up to 16 letters');

    // Rejected before posting: still a draft, and no journal for it.
    const stored = await prisma.client.invoice.findUniqueOrThrow({ where: { id: second.id }, select: { status: true, invoiceNumber: true } });
    expect(stored).toEqual({ status: 'DRAFT', invoiceNumber: null });
    expect(await prisma.client.journalEntry.count({ where: { organizationId, sourceType: 'invoice_finalize', sourceId: second.id } })).toBe(0);

    const generated = await invoices.finalize({
      organizationId, id: second.id, expectedVersion: second.version, invoiceDate: '2026-09-02',
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect(generated.invoiceNumber).toMatch(/^\d{4}$/);
  });

  it('lets a later invoice take a voided invoice number, and counts that number once (ADR-163)', async () => {
    const first = await createCapexDraft('Reuse Number Capex');
    const issued = await invoices.finalize({
      organizationId, id: first.id, expectedVersion: first.version, invoiceDate: '2026-10-01', invoiceNumber: 'MT/26-27/201',
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    const second = await createCapexDraft('Reuse Number Second Capex');
    expect(await invoices.reusableNumbers({ organizationId, id: second.id, invoiceDate: '2026-10-02' })).not.toContain('MT/26-27/201');

    await invoices.void({ canReverseReceipts: true,
      organizationId, id: issued.id, expectedVersion: issued.version, reason: 'Wrong client', accountingDate: '2026-10-01',
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect(await invoices.reusableNumbers({ organizationId, id: second.id, invoiceDate: '2026-10-02' })).toContain('MT/26-27/201');

    const scope = await prisma.client.invoice.findUniqueOrThrow({ where: { id: issued.id }, select: { gstRegistrationId: true, financialYearId: true } });
    const numbered = () => prisma.client.invoice.findMany({ where: { organizationId, ...scope, invoiceNumber: { not: null } }, distinct: ['invoiceNumber'], select: { id: true } });
    const before = (await numbered()).length;

    const reused = await invoices.finalize({
      organizationId, id: second.id, expectedVersion: second.version, invoiceDate: '2026-10-02', invoiceNumber: 'MT/26-27/201',
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect(reused.invoiceNumber).toBe('MT/26-27/201');
    // The voided invoice keeps its number on record.
    expect((await prisma.client.invoice.findUniqueOrThrow({ where: { id: issued.id }, select: { status: true, invoiceNumber: true } }))).toEqual({ status: 'VOID', invoiceNumber: 'MT/26-27/201' });
    expect(await invoices.reusableNumbers({ organizationId, id: second.id, invoiceDate: '2026-10-02' })).not.toContain('MT/26-27/201');
    expect((await numbered()).length).toBe(before);

    // Now held again, so a third invoice cannot take it.
    const third = await createCapexDraft('Reuse Number Third Capex');
    await expect(
      invoices.finalize({
        organizationId, id: third.id, expectedVersion: third.version, invoiceDate: '2026-10-03', invoiceNumber: 'MT/26-27/201',
        idempotencyKey: generateId(), actorId, correlationId: generateId(),
      }),
    ).rejects.toThrow('already used');
  });

  it('asks for a bank account when the legal entity has more than one', async () => {
    const assetGroup = await prisma.client.accountGroup.create({
      data: { id: generateId(), organizationId, code: 'BANK_ASSETS', name: 'Bank Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: true },
    });
    const ledger = await prisma.client.ledgerAccount.create({
      data: { id: generateId(), organizationId, accountGroupId: assetGroup.id, code: 'HDFC_INVOICE', name: 'HDFC Invoice', allowManualPosting: true, isActive: true },
    });
    const hdfc = await legalEntities.createBankAccount({
      organizationId, legalEntityId, ledgerAccountId: ledger.id, accountName: 'HDFC Operating', bankName: 'HDFC BANK',
      maskedAccountNumber: '****0595', ifsc: 'HDFC0000306', actorId, correlationId: generateId(),
    });
    const sbi = await legalEntities.createBankAccount({
      organizationId, legalEntityId, ledgerAccountId: ledger.id, accountName: 'SBI Collection', bankName: 'SBI',
      maskedAccountNumber: '****1122', ifsc: 'SBIN0000123', actorId, correlationId: generateId(),
    });

    const capex = await milestones.createCapex({
      organizationId, projectId, name: 'Bank Choice Capex', approvedAmount: '100000', referenceNumber: undefined,
      approvalDate: undefined, description: undefined, alertRecipient: undefined, reminderOffsetDays: undefined,
      events: [{ name: 'Bank choice', amount: '100000', dueDate: '2026-08-31' }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const overview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const eventId = overview.capexEvents.find((event) => event.milestoneId === capex.id)!.id;
    const alert = await createOpenAlert({ sourceType: 'CAPEX_EVENT', sourceEventId: eventId });

    const defaults = await invoices.getDraftDefaults({ organizationId, paymentAlertId: alert.id, actorId, canSeeAll: true });
    expect(defaults.bankAccountOptions.map((account) => account.id).sort()).toEqual([hdfc.id, sbi.id].sort());

    const draftInput = {
      organizationId, paymentAlertId: alert.id, gstRegistrationId: gujaratGstRegistrationId, dueDate: '2026-08-15',
      paymentTermsDays: undefined, narrative: undefined, lines: createBasicLine({ unitPrice: '100000' }),
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    };
    await expect(invoices.createDraftFromAlert(draftInput)).rejects.toThrow('Choose the bank account');

    const draft = await invoices.createDraftFromAlert({ ...draftInput, bankAccountId: hdfc.id, idempotencyKey: generateId(), correlationId: generateId() });
    const stored = await prisma.client.invoice.findUniqueOrThrow({ where: { id: draft.id }, select: { bankAccountId: true } });
    expect(stored.bankAccountId).toBe(hdfc.id);

    await legalEntities.setBankAccountActive({ organizationId, id: sbi.id, isActive: false, expectedVersion: sbi.version, actorId, correlationId: generateId() });
    const second = await milestones.createCapex({
      organizationId, projectId, name: 'Single Bank Capex', approvedAmount: '50000', referenceNumber: undefined,
      approvalDate: undefined, description: undefined, alertRecipient: undefined, reminderOffsetDays: undefined,
      events: [{ name: 'Single bank', amount: '50000', dueDate: '2026-09-30' }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const secondOverview = await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true });
    const secondEventId = secondOverview.capexEvents.find((event) => event.milestoneId === second.id)!.id;
    const secondAlert = await createOpenAlert({ sourceType: 'CAPEX_EVENT', sourceEventId: secondEventId });
    const only = await invoices.createDraftFromAlert({
      ...draftInput, paymentAlertId: secondAlert.id, idempotencyKey: generateId(), correlationId: generateId(),
    });
    const onlyStored = await prisma.client.invoice.findUniqueOrThrow({ where: { id: only.id }, select: { bankAccountId: true } });
    expect(onlyStored.bankAccountId).toBe(hdfc.id);
  });
  it('bills a CAPEX event in parts until its amount is reached, keeping the alert open for the rest (ADR-156)', async () => {
    const capex = await milestones.createCapex({
      organizationId, projectId, name: 'Partial Billing Capex', approvedAmount: '150', referenceNumber: undefined,
      approvalDate: undefined, description: undefined, alertRecipient: undefined, reminderOffsetDays: undefined,
      events: [{ name: 'Installation', amount: '100', dueDate: '2026-05-31' }, { name: 'Handover', amount: '50', dueDate: '2026-06-30' }],
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const event = (await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true })).capexEvents.find((e) => e.milestoneId === capex.id && e.name === 'Installation')!;
    const alert = await createOpenAlert({ sourceType: 'CAPEX_EVENT', sourceEventId: event.id });
    const raise = (unitPrice: string) =>
      invoices.createDraftFromAlert({
        organizationId, paymentAlertId: alert.id, gstRegistrationId: gujaratGstRegistrationId, dueDate: '2026-06-30',
        paymentTermsDays: undefined, narrative: undefined, lines: createBasicLine({ unitPrice }),
        idempotencyKey: generateId(), actorId, correlationId: generateId(),
      });
    const finalize = (draft: { id: string; version: number }) =>
      invoices.finalize({ organizationId, id: draft.id, expectedVersion: draft.version, invoiceDate: '2026-05-20', idempotencyKey: generateId(), actorId, correlationId: generateId() });
    const state = async () => {
      const row = (await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true })).capexEvents.find((e) => e.id === event.id)!;
      const alertRow = await prisma.client.paymentAlert.findUniqueOrThrow({ where: { id: alert.id } });
      return [row.billingStatus, row.invoicedAmount, row.remainingAmount, alertRow.status];
    };

    // 70 of 100 now.
    const first = await raise('70');
    await expect(raise('30')).rejects.toThrow('already open');
    const firstFinal = await finalize(first);
    expect(await state()).toEqual(['PARTIALLY_INVOICED', '70.00', '30.00', 'OPEN']);

    // The next invoice is offered the 30 left; the alert list shows it too.
    const defaults = await invoices.getDraftDefaults({ organizationId, paymentAlertId: alert.id, actorId, canSeeAll: true });
    expect([defaults.sourceAmount, defaults.invoicedAmount, defaults.suggestedTaxableAmount]).toEqual(['100.00', '70.00', '30.00']);
    const listed = (await paymentAlerts.listForProject({ organizationId, projectId, actorId, canSeeAll: true })).openAlerts.find((a) => a.id === alert.id)!;
    expect([listed.amount, listed.invoicedAmount, listed.remainingAmount]).toEqual(['100.00', '70.00', '30.00']);

    // Then the 30: fully invoiced, the alert closes on the invoice that finished it.
    const secondFinal = await finalize(await raise('30'));
    expect(await state()).toEqual(['FULLY_INVOICED', '100.00', '0.00', 'CLOSED']);
    expect((await prisma.client.paymentAlert.findUniqueOrThrow({ where: { id: alert.id } })).invoiceId).toBe(secondFinal.id);
    const summary = (await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true })).capexEvents.find((e) => e.id === event.id)!;
    expect(summary.invoiceNumber).toBe(`${firstFinal.invoiceNumber}, ${secondFinal.invoiceNumber}`);
    await expect(raise('1')).rejects.toThrow('already fully invoiced');

    // Voiding the second gives its 30 back and reopens the alert.
    await invoices.void({ canReverseReceipts: true, organizationId, id: secondFinal.id, expectedVersion: secondFinal.version, reason: 'Wrong amount', accountingDate: '2026-05-21', idempotencyKey: generateId(), actorId, correlationId: generateId() });
    expect(await state()).toEqual(['PARTIALLY_INVOICED', '70.00', '30.00', 'OPEN']);

    const bySource = (await invoices.listBySource({ organizationId, projectId, actorId, canSeeAll: true })).find((s) => s.sourceId === event.id)!;
    expect(bySource.invoices.map((i) => [i.invoiceNumber, i.billedTaxable])).toEqual([[firstFinal.invoiceNumber, '70.00']]);
  });

  it('bills an OPEX installment in parts; it is INVOICED only when its scheduled amount is reached (ADR-156)', async () => {
    const opex = await milestones.createOpex({
      organizationId, projectId, name: 'Partial Billing Opex', approvedAmount: '300', frequency: 'MONTHLY', installmentCount: 3,
      scheduleStartDate: '2026-07-01', firstInvoiceDate: '2026-07-01', referenceNumber: undefined, approvalDate: undefined,
      description: undefined, alertRecipient: undefined, reminderOffsetDays: undefined,
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const installment = opex.installments![0]!;
    const alert = await createOpenAlert({ sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: installment.id });
    const raiseAndFinalize = async (unitPrice: string) => {
      const draft = await invoices.createDraftFromAlert({
        organizationId, paymentAlertId: alert.id, gstRegistrationId: gujaratGstRegistrationId, dueDate: '2026-07-31',
        paymentTermsDays: undefined, narrative: undefined, lines: createBasicLine({ unitPrice }),
        idempotencyKey: generateId(), actorId, correlationId: generateId(),
      });
      expect((await prisma.client.milestoneInstallment.findUniqueOrThrow({ where: { id: installment.id } })).status).toBe('INVOICE_DRAFT');
      return invoices.finalize({ organizationId, id: draft.id, expectedVersion: draft.version, invoiceDate: '2026-07-31', idempotencyKey: generateId(), actorId, correlationId: generateId() });
    };
    const state = async () => {
      const row = (await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true })).opexMilestones.find((m) => m.id === opex.id)!;
      const inst = row.installments!.find((i) => i.id === installment.id)!;
      const alertRow = await prisma.client.paymentAlert.findUniqueOrThrow({ where: { id: alert.id } });
      return [inst.status, inst.billingStatus, inst.remainingAmount, row.billingStatus, alertRow.status];
    };

    await raiseAndFinalize('60');
    expect(await state()).toEqual(['PLANNED', 'PARTIALLY_INVOICED', '40.00', 'PARTIALLY_INVOICED', 'OPEN']);
    const current = (await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true })).opexMilestones.find((m) => m.id === opex.id)!.installments!.find((i) => i.id === installment.id)!;
    await expect(
      milestones.skipInstallment({ organizationId, id: installment.id, reason: 'Not needed', expectedVersion: current.version, actorId, canSeeAll: true, correlationId: generateId() }),
    ).rejects.toThrow('partly invoiced');

    await raiseAndFinalize('40');
    expect(await state()).toEqual(['INVOICED', 'FULLY_INVOICED', '0.00', 'PARTIALLY_INVOICED', 'CLOSED']);

    // Each invoice states the period it bills.
    const billing = (await invoices.listBySource({ organizationId, projectId, actorId, canSeeAll: true })).find((b) => b.sourceId === installment.id)!;
    expect(billing.invoices.map((i) => [i.servicePeriodStart, i.servicePeriodEnd])).toEqual([
      [installment.servicePeriodStart, installment.servicePeriodEnd],
      [installment.servicePeriodStart, installment.servicePeriodEnd],
    ]);
  });

  it('closes an installment billed for less when Finalize marks it as the full bill, and reopens it on void (ADR-167)', async () => {
    const opex = await milestones.createOpex({
      organizationId, projectId, name: 'Full Bill Opex', approvedAmount: '300', frequency: 'MONTHLY', installmentCount: 3,
      scheduleStartDate: '2026-07-01', firstInvoiceDate: '2026-07-01', referenceNumber: undefined, approvalDate: undefined,
      description: undefined, alertRecipient: undefined, reminderOffsetDays: undefined,
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const installment = opex.installments![0]!;
    const alert = await createOpenAlert({ sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: installment.id });
    const draft = await invoices.createDraftFromAlert({
      organizationId, paymentAlertId: alert.id, gstRegistrationId: gujaratGstRegistrationId, dueDate: '2026-07-31',
      paymentTermsDays: undefined, narrative: undefined, lines: createBasicLine({ unitPrice: '98.80' }),
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    const detail = await invoices.getDetail({ organizationId, id: draft.id, actorId, canSeeAll: true });
    expect([detail.underBilledBy, detail.overBilledBy]).toEqual(['1.20', null]);

    const finalized = await invoices.finalize({
      organizationId, id: draft.id, expectedVersion: draft.version, invoiceDate: '2026-07-31', completesSource: true,
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    const state = async () => {
      const row = (await milestones.listForProject({ organizationId, projectId, actorId, canSeeAll: true })).opexMilestones.find((m) => m.id === opex.id)!;
      const inst = row.installments!.find((i) => i.id === installment.id)!;
      const alertRow = await prisma.client.paymentAlert.findUniqueOrThrow({ where: { id: alert.id } });
      return [inst.status, inst.billingStatus, inst.invoicedAmount, inst.remainingAmount, row.remainingAmount, alertRow.status];
    };
    expect(await state()).toEqual(['INVOICED', 'FULLY_INVOICED', '98.80', '0.00', '200.00', 'CLOSED']);
    expect((await invoices.getDetail({ organizationId, id: finalized.id, actorId, canSeeAll: true })).completesSource).toBe(true);

    await invoices.void({
      canReverseReceipts: true, organizationId, id: finalized.id, expectedVersion: finalized.version, reason: 'Wrong month',
      accountingDate: '2026-07-31', idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    expect(await state()).toEqual(['PLANNED', 'NOT_INVOICED', '0.00', '100.00', '300.00', 'OPEN']);
  });

  it('marks an invoice already finalized for less as the full bill from its alert, and undoes it (ADR-167)', async () => {
    const opex = await milestones.createOpex({
      organizationId, projectId, name: 'Mark Full Bill Opex', approvedAmount: '300', frequency: 'MONTHLY', installmentCount: 3,
      scheduleStartDate: '2026-07-01', firstInvoiceDate: '2026-07-01', referenceNumber: undefined, approvalDate: undefined,
      description: undefined, alertRecipient: undefined, reminderOffsetDays: undefined,
      idempotencyKey: generateId(), actorId, canSeeAll: true, correlationId: generateId(),
    });
    const installment = opex.installments![0]!;
    const alert = await createOpenAlert({ sourceType: 'OPEX_INSTALLMENT', sourceInstallmentId: installment.id });
    const draft = await invoices.createDraftFromAlert({
      organizationId, paymentAlertId: alert.id, gstRegistrationId: gujaratGstRegistrationId, dueDate: '2026-07-31',
      paymentTermsDays: undefined, narrative: undefined, lines: createBasicLine({ unitPrice: '97.50' }),
      idempotencyKey: generateId(), actorId, correlationId: generateId(),
    });
    // Finalized the old way: no answer, so the alert stays open for the 2.50 left.
    const finalized = await invoices.finalize({ organizationId, id: draft.id, expectedVersion: draft.version, invoiceDate: '2026-07-31', idempotencyKey: generateId(), actorId, correlationId: generateId() });
    const alertView = async () => (await paymentAlerts.listForProject({ organizationId, projectId, actorId, canSeeAll: true })).openAlerts.find((a) => a.id === alert.id);
    expect([(await alertView())?.remainingAmount, (await alertView())?.latestInvoice?.id]).toEqual(['2.50', finalized.id]);

    const marked = await invoices.setCompletesSource({ organizationId, id: finalized.id, completesSource: true, expectedVersion: finalized.version, actorId, correlationId: generateId() });
    expect(await alertView()).toBeUndefined();
    expect((await prisma.client.paymentAlert.findUniqueOrThrow({ where: { id: alert.id } })).status).toBe('CLOSED');
    expect((await prisma.client.milestoneInstallment.findUniqueOrThrow({ where: { id: installment.id } })).status).toBe('INVOICED');
    await expect(
      invoices.setCompletesSource({ organizationId, id: finalized.id, completesSource: false, expectedVersion: finalized.version, actorId, correlationId: generateId() }),
    ).rejects.toThrow('changed by someone else');

    await invoices.setCompletesSource({ organizationId, id: finalized.id, completesSource: false, expectedVersion: marked.version, actorId, correlationId: generateId() });
    expect((await alertView())?.remainingAmount).toBe('2.50');
    expect((await prisma.client.milestoneInstallment.findUniqueOrThrow({ where: { id: installment.id } })).status).toBe('PLANNED');
  });
});
