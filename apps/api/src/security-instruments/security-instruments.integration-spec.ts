import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialYearService } from '../organization/financial-year.service';
import { PostingService } from '../accounting/posting.service';
import { SecurityInstrumentsService } from './security-instruments.service';

const prisma = new PrismaService();
const financialYears = new FinancialYearService(prisma);
const posting = new PostingService(prisma);
const instruments = new SecurityInstrumentsService(prisma, posting);

let organizationId: string;
let otherOrganizationId: string;
let legalEntityId: string;
let bankAccountId: string;
let recoverableAccountId: string;
let mappedPurposeId: string;
let unmappedPurposeId: string;
let cashTypeId: string;
let guaranteeTypeId: string;
let projectId: string;
let tenderId: string;
const actorId = generateId();

async function lodgeCash(overrides: Partial<Parameters<typeof instruments.lodge>[0]> = {}) {
  return instruments.lodge({
    organizationId,
    legalEntityId,
    projectId,
    tenderId: undefined,
    purposeId: mappedPurposeId,
    typeId: cashTypeId,
    amount: '50000',
    instrumentReferenceNo: undefined,
    issuingBank: undefined,
    lodgedWithAuthority: undefined,
    bankLedgerAccountId: bankAccountId,
    submittedOn: '2026-01-15',
    returnDueOn: '2035-06-30',
    narrative: undefined,
    fundedByLegalEntityId: undefined,
    fundedByPartyId: undefined,
    fundedByBankAccountDetails: undefined,
    fundedByTransferAmount: undefined,
    fundedByTransferMode: undefined,
    fundedByNote: undefined,
    idempotencyKey: generateId(),
    actorId,
    correlationId: generateId(),
    ...overrides,
  });
}

beforeAll(async () => {
  const organization = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Security Instrument Test Org', code: `SITEST-${generateId()}` },
  });
  organizationId = organization.id;

  const otherOrg = await prisma.client.organization.create({
    data: { id: generateId(), name: 'Security Instrument Test Other Org', code: `SITEST-OTHER-${generateId()}` },
  });
  otherOrganizationId = otherOrg.id;

  await prisma.client.user.create({
    data: { id: actorId, organizationId, email: 'si-actor@zitaware.test', passwordHash: 'test-hash', displayName: 'SI Actor', status: 'ACTIVE' },
  });

  const legalEntity = await prisma.client.legalEntity.create({
    data: { id: generateId(), organizationId, legalName: 'SI Legal Entity', panNumber: 'ABCPS1234P', registeredAddress: 'Ahmedabad, Gujarat' },
  });
  legalEntityId = legalEntity.id;

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

  const assetRoot = await prisma.client.accountGroup.create({
    data: { id: generateId(), organizationId, code: 'ASSETS', name: 'Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isSystemDefined: true },
  });

  const bankAccount = await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: assetRoot.id, code: 'BANK', name: 'Bank', allowManualPosting: true, isActive: true },
  });
  bankAccountId = bankAccount.id;

  const recoverableAccount = await prisma.client.ledgerAccount.create({
    data: { id: generateId(), organizationId, accountGroupId: assetRoot.id, code: 'EMD_RECOVERABLE', name: 'EMD Recoverable', allowManualPosting: true, isActive: true },
  });
  recoverableAccountId = recoverableAccount.id;

  const mappedPurpose = await prisma.client.securityInstrumentPurpose.create({
    data: {
      id: generateId(),
      organizationId,
      code: 'test_mapped_purpose',
      name: 'Test Mapped Purpose',
      category: 'EMD',
      defaultRecoverableLedgerAccountId: recoverableAccountId,
    },
  });
  mappedPurposeId = mappedPurpose.id;

  const unmappedPurpose = await prisma.client.securityInstrumentPurpose.create({
    data: { id: generateId(), organizationId, code: 'test_unmapped_purpose', name: 'Test Unmapped Purpose', category: 'SD' },
  });
  unmappedPurposeId = unmappedPurpose.id;

  const cashType = await prisma.client.securityInstrumentType.create({
    data: { id: generateId(), organizationId, code: 'test_cash', name: 'Test Cash', requiresCashPosting: true },
  });
  cashTypeId = cashType.id;

  const guaranteeType = await prisma.client.securityInstrumentType.create({
    data: { id: generateId(), organizationId, code: 'test_guarantee', name: 'Test Guarantee', requiresCashPosting: false },
  });
  guaranteeTypeId = guaranteeType.id;

  const client = await prisma.client.party.create({
    data: { id: generateId(), organizationId, name: 'SI Test Client' },
  });

  const project = await prisma.client.project.create({
    data: { id: generateId(), organizationId, clientId: client.id, legalEntityId, name: 'SI Test Project' },
  });
  projectId = project.id;

  const tender = await prisma.client.tender.create({
    data: { id: generateId(), organizationId, clientId: client.id, tenderNumber: 'SI-TDR-001', title: 'SI Test Tender', tenderDate: new Date('2026-01-01T00:00:00.000Z') },
  });
  tenderId = tender.id;
});

afterAll(async () => {
  const orgIds = [organizationId, otherOrganizationId];
  await prisma.client.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.idempotencyKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.securityInstrument.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalLine.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.journalEntry.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.tender.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.project.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.party.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.securityInstrumentType.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.securityInstrumentPurpose.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.accountingPeriod.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.financialYear.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.legalEntity.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.user.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.client.$disconnect();
});

describe('SecurityInstrumentsService', () => {
  it('lodges a cash-equivalent instrument, posts the correct journal, and is retrievable', async () => {
    const sourceId = generateId();
    const result = await lodgeCash({ idempotencyKey: sourceId });
    expect(result.status).toBe('LODGED');
    expect(result.lodgeJournalEntryId).not.toBeNull();

    const journalDetail = await posting.getEntryDetail({ organizationId, id: result.lodgeJournalEntryId! });
    expect(journalDetail.lines).toHaveLength(2);
    const debitLine = journalDetail.lines.find((l) => Number(l.debitAmount) > 0)!;
    expect(debitLine.ledgerAccountCode).toBe('EMD_RECOVERABLE');
    const creditLine = journalDetail.lines.find((l) => Number(l.creditAmount) > 0)!;
    expect(creditLine.ledgerAccountCode).toBe('BANK');

    const detail = await instruments.getDetail({ organizationId, id: result.id });
    expect(detail.amount).toBe('50000.00');
    expect(detail.derivedLabel).toBe('LODGED');

    const auditEvent = await prisma.client.auditEvent.findFirst({
      where: { entityType: 'SECURITY_INSTRUMENT', entityId: result.id, action: 'SECURITY_INSTRUMENT_LODGED' },
    });
    expect(auditEvent).not.toBeNull();
  });

  it('lodges a guarantee-type instrument with no journal posting', async () => {
    const result = await lodgeCash({
      typeId: guaranteeTypeId,
      bankLedgerAccountId: undefined,
      idempotencyKey: generateId(),
    });
    expect(result.status).toBe('LODGED');
    expect(result.lodgeJournalEntryId).toBeNull();
    expect(result.requiresCashPosting).toBe(false);
  });

  it('rejects lodging without a project', async () => {
    await expect(lodgeCash({ projectId: undefined, tenderId: undefined, idempotencyKey: generateId() })).rejects.toThrow(
      'must reference a project',
    );
  });

  it('accepts lodging with only a tenderId (no projectId)', async () => {
    const result = await lodgeCash({ projectId: undefined, tenderId, idempotencyKey: generateId() });
    expect(result.tenderId).toBe(tenderId);
    expect(result.projectId).toBeNull();
  });

  it('rejects a cash-equivalent instrument lodged under an unmapped purpose', async () => {
    await expect(lodgeCash({ purposeId: unmappedPurposeId, idempotencyKey: generateId() })).rejects.toThrow(
      'No recoverable ledger account is configured',
    );
  });

  it('rejects a cash-equivalent instrument with no bank/source ledger account', async () => {
    await expect(lodgeCash({ bankLedgerAccountId: undefined, idempotencyKey: generateId() })).rejects.toThrow(
      'bank/source ledger account is required',
    );
  });

  it('rejects funding fields set on both a Legal Entity and a Party', async () => {
    await expect(
      lodgeCash({ fundedByLegalEntityId: legalEntityId, fundedByPartyId: generateId(), idempotencyKey: generateId() }),
    ).rejects.toThrow('not both');
  });

  it('a duplicate idempotency-key lodge call returns the original record, not a second one', async () => {
    const key = generateId();
    const first = await lodgeCash({ idempotencyKey: key });
    const second = await lodgeCash({ idempotencyKey: key });
    expect(second.id).toBe(first.id);
  });

  it('the same idempotency key with a different request throws IDEMPOTENCY_CONFLICT', async () => {
    const key = generateId();
    await lodgeCash({ idempotencyKey: key, amount: '10000' });
    await expect(lodgeCash({ idempotencyKey: key, amount: '99999' })).rejects.toThrow('different request');
  });

  it('records a full return, posts the mirror journal, and transitions to RETURNED', async () => {
    const lodged = await lodgeCash({ idempotencyKey: generateId() });
    const returned = await instruments.recordReturn({
      organizationId,
      id: lodged.id,
      returnedAmount: lodged.amount,
      returnedOn: '2026-04-01',
      returnedToLegalEntityId: undefined,
      returnedToPartyId: undefined,
      returnedToBankAccountDetails: undefined,
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(returned.status).toBe('RETURNED');
    expect(returned.returnJournalEntryId).not.toBeNull();

    const journalDetail = await posting.getEntryDetail({ organizationId, id: returned.returnJournalEntryId! });
    const debitLine = journalDetail.lines.find((l) => Number(l.debitAmount) > 0)!;
    expect(debitLine.ledgerAccountCode).toBe('BANK');

    const auditEvent = await prisma.client.auditEvent.findFirst({
      where: { entityType: 'SECURITY_INSTRUMENT', entityId: lodged.id, action: 'SECURITY_INSTRUMENT_RETURNED' },
    });
    expect(auditEvent).not.toBeNull();
  });

  it('rejects a return where returnedAmount does not equal the lodged amount', async () => {
    const lodged = await lodgeCash({ idempotencyKey: generateId() });
    await expect(
      instruments.recordReturn({
        organizationId,
        id: lodged.id,
        returnedAmount: '1',
        returnedOn: '2026-04-01',
        returnedToLegalEntityId: undefined,
        returnedToPartyId: undefined,
        returnedToBankAccountDetails: undefined,
        idempotencyKey: generateId(),
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('must equal the lodged amount');
  });

  it('rejects returning an already-returned instrument', async () => {
    const lodged = await lodgeCash({ idempotencyKey: generateId() });
    await instruments.recordReturn({
      organizationId,
      id: lodged.id,
      returnedAmount: lodged.amount,
      returnedOn: '2026-04-01',
      returnedToLegalEntityId: undefined,
      returnedToPartyId: undefined,
      returnedToBankAccountDetails: undefined,
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    await expect(
      instruments.recordReturn({
        organizationId,
        id: lodged.id,
        returnedAmount: lodged.amount,
        returnedOn: '2026-04-02',
        returnedToLegalEntityId: undefined,
        returnedToPartyId: undefined,
        returnedToBankAccountDetails: undefined,
        idempotencyKey: generateId(),
        actorId,
        correlationId: generateId(),
      }),
    ).rejects.toThrow('already been returned');
  });

  it('returns a guarantee-type instrument with no journal posting', async () => {
    const lodged = await lodgeCash({ typeId: guaranteeTypeId, bankLedgerAccountId: undefined, idempotencyKey: generateId() });
    const returned = await instruments.recordReturn({
      organizationId,
      id: lodged.id,
      returnedAmount: lodged.amount,
      returnedOn: '2026-04-01',
      returnedToLegalEntityId: undefined,
      returnedToPartyId: undefined,
      returnedToBankAccountDetails: undefined,
      idempotencyKey: generateId(),
      actorId,
      correlationId: generateId(),
    });
    expect(returned.status).toBe('RETURNED');
    expect(returned.returnJournalEntryId).toBeNull();
  });

  it('does not leak records across organizations', async () => {
    const { rows } = await instruments.list({ organizationId: otherOrganizationId, page: 1, pageSize: 25, filters: {} });
    expect(rows).toHaveLength(0);
  });

  it('computes tile totals correctly', async () => {
    const tiles = await instruments.getTiles({ organizationId, projectId: undefined });
    expect(Number(tiles.emdLodgedAmount)).toBeGreaterThanOrEqual(0);
    expect(Number(tiles.toRecoverAmount)).toBeGreaterThanOrEqual(0);
    expect(tiles.returnedCount).toBeGreaterThanOrEqual(1);
  });
});
