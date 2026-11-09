import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { throwAppError } from '@zitaware/contracts';
import type { LegalEntityPort, LegalEntitySummary, LegalEntityBranding, GstRegistrationSummary, BankAccountSummary, CardAccountSummary, CardType, BrandingImageInput } from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isConstraintViolation } from './constraint-error.util';
import { decodeBrandingImage } from './branding-image';
import { brandingImageKey, brandingImagePrefixFolder, brandingImageStore, loadBrandingImage, type BrandingImageKind } from './branding-image-store';

interface BankAccountRow {
  id: string;
  legalEntityId: string;
  ledgerAccountId: string;
  ledgerAccount: { code: string; name: string };
  accountName: string;
  bankName: string | null;
  maskedAccountNumber: string | null;
  invoiceAccountNumber: string | null;
  ifsc: string | null;
  isActive: boolean;
  version: number;
}

function toBankAccountSummary(row: BankAccountRow): BankAccountSummary {
  return {
    id: row.id,
    legalEntityId: row.legalEntityId,
    ledgerAccountId: row.ledgerAccountId,
    ledgerAccountCode: row.ledgerAccount.code,
    ledgerAccountName: row.ledgerAccount.name,
    accountName: row.accountName,
    bankName: row.bankName,
    maskedAccountNumber: row.maskedAccountNumber,
    invoiceAccountNumber: row.invoiceAccountNumber,
    ifsc: row.ifsc,
    isActive: row.isActive,
    version: row.version,
  };
}

interface CardAccountRow {
  id: string;
  legalEntityId: string;
  type: CardType;
  displayName: string;
  issuerName: string | null;
  maskedLastFour: string;
  cardNumber: string | null;
  cardholderEmployeeId: string | null;
  cardholderEmployee: { fullName: string } | null;
  bankAccountId: string | null;
  bankAccount: { accountName: string } | null;
  ledgerAccountId: string | null;
  ledgerAccount: { name: string } | null;
  statementDay: number | null;
  paymentDueDay: number | null;
  isActive: boolean;
  version: number;
}

function toCardAccountSummary(row: CardAccountRow): CardAccountSummary {
  return {
    id: row.id,
    legalEntityId: row.legalEntityId,
    type: row.type,
    displayName: row.displayName,
    issuerName: row.issuerName,
    maskedLastFour: row.maskedLastFour,
    cardNumber: row.cardNumber,
    cardholderEmployeeId: row.cardholderEmployeeId,
    cardholderEmployeeName: row.cardholderEmployee?.fullName ?? null,
    bankAccountId: row.bankAccountId,
    bankAccountName: row.bankAccount?.accountName ?? null,
    ledgerAccountId: row.ledgerAccountId,
    ledgerAccountName: row.ledgerAccount?.name ?? null,
    statementDay: row.statementDay,
    paymentDueDay: row.paymentDueDay,
    isActive: row.isActive,
    version: row.version,
  };
}

const cardAccountInclude = { cardholderEmployee: true, bankAccount: true, ledgerAccount: true } as const;

interface LegalEntityRow {
  id: string;
  legalName: string;
  panNumber: string;
  registeredAddress: string;
  logoContentType: string | null;
  sealContentType: string | null;
  authorizedSignContentType: string | null;
  isActive: boolean;
  version: number;
}

interface GstRegistrationRow {
  id: string;
  legalEntityId: string;
  stateId: string;
  gstin: string;
  tradeName: string | null;
  isActive: boolean;
  version: number;
}

function toLegalEntitySummary(row: LegalEntityRow): LegalEntitySummary {
  return {
    id: row.id,
    legalName: row.legalName,
    panNumber: row.panNumber,
    registeredAddress: row.registeredAddress,
    hasLogo: row.logoContentType !== null,
    hasSeal: row.sealContentType !== null,
    hasAuthorizedSign: row.authorizedSignContentType !== null,
    isActive: row.isActive,
    version: row.version,
  };
}

const legalEntityListSelect = {
  id: true,
  legalName: true,
  panNumber: true,
  registeredAddress: true,
  logoContentType: true,
  sealContentType: true,
  authorizedSignContentType: true,
  isActive: true,
  version: true,
} as const;

type ImageField = 'logo' | 'seal' | 'authorizedSign';

const IMAGE_KIND: Record<ImageField, BrandingImageKind> = { logo: 'logo', seal: 'seal', authorizedSign: 'authorized-sign' };

/**
 * Validates and uploads one image to object storage (ADR-193) and returns
 * the row's columns for it. Runs before the database transaction: a failed
 * save can leave an unreferenced object behind, never a row pointing at a
 * missing one. Null clears the image; undefined leaves it unchanged.
 */
async function imageColumns(
  organizationId: string,
  legalEntityId: string,
  field: ImageField,
  image: BrandingImageInput | null | undefined,
): Promise<Record<string, unknown>> {
  if (image === undefined) return {};
  const contentTypeKey = `${field}ContentType`;
  const storageKey = `${field}StorageKey`;
  const bytesKey = `${field}Bytes`;
  if (image === null) return { [contentTypeKey]: null, [storageKey]: null, [bytesKey]: null };
  const decoded = decodeBrandingImage(image);
  const key = brandingImageKey({
    prefixFolder: brandingImagePrefixFolder(),
    organizationId,
    legalEntityId,
    kind: IMAGE_KIND[field],
    contentType: decoded.contentType,
  });
  await brandingImageStore().put(key, decoded.bytes, decoded.contentType);
  return { [contentTypeKey]: decoded.contentType, [storageKey]: key, [bytesKey]: null };
}

async function allImageColumns(
  organizationId: string,
  legalEntityId: string,
  images: { logo?: BrandingImageInput | null | undefined; seal?: BrandingImageInput | null | undefined; authorizedSign?: BrandingImageInput | null | undefined },
): Promise<Record<string, unknown>> {
  const [logo, seal, authorizedSign] = await Promise.all([
    imageColumns(organizationId, legalEntityId, 'logo', images.logo),
    imageColumns(organizationId, legalEntityId, 'seal', images.seal),
    imageColumns(organizationId, legalEntityId, 'authorizedSign', images.authorizedSign),
  ]);
  return { ...logo, ...seal, ...authorizedSign };
}

function imageAudit(image: BrandingImageInput | null | undefined): 'set' | 'cleared' | undefined {
  if (image === undefined) return undefined;
  return image === null ? 'cleared' : 'set';
}

async function toBrandingImage(contentType: string | null, storageKey: string | null, bytes: Uint8Array | null): Promise<BrandingImageInput | null> {
  const image = await loadBrandingImage(contentType, storageKey, bytes);
  return image ? { contentType: image.contentType, dataBase64: image.bytes.toString('base64') } : null;
}

function blankToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function printColumns(input: {
  placeOfSupply?: string | null | undefined;
  jurisdiction?: string | null | undefined;
  stateCode?: string | null | undefined;
}): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const pairs = [
    ['placeOfSupply', 'invoicePlaceOfSupply'],
    ['jurisdiction', 'invoiceJurisdiction'],
    ['stateCode', 'invoiceStateCode'],
  ] as const;
  for (const [from, to] of pairs) {
    const value = input[from];
    if (value === undefined) continue;
    out[to] = value === null ? null : blankToNull(value);
  }
  return out;
}

function toGstRegistrationSummary(row: GstRegistrationRow): GstRegistrationSummary {
  return {
    id: row.id,
    legalEntityId: row.legalEntityId,
    stateId: row.stateId,
    gstin: row.gstin,
    tradeName: row.tradeName,
    isActive: row.isActive,
    version: row.version,
  };
}

/** "****4471" from a full account number: the last four digits, the rest hidden. Null without a number. */
export function maskAccountNumber(accountNumber: string | null | undefined): string | null {
  const digits = (accountNumber ?? '').replace(/[^0-9A-Za-z]/g, '');
  return digits ? `****${digits.slice(-4)}` : null;
}

@Injectable()
export class LegalEntityService implements LegalEntityPort {
  constructor(private readonly prisma: PrismaService) {}

  async list(input: { organizationId: string; includeInactive: boolean | undefined }): Promise<LegalEntitySummary[]> {
    const rows = await this.prisma.client.legalEntity.findMany({
      where: {
        organizationId: input.organizationId,
        deletedAt: null,
        ...(input.includeInactive ? {} : { isActive: true }),
      },
      select: legalEntityListSelect,
      orderBy: { legalName: 'asc' },
    });
    return rows.map(toLegalEntitySummary);
  }

  async getBranding(input: { organizationId: string; id: string }): Promise<LegalEntityBranding> {
    const row = await this.prisma.client.legalEntity.findFirst({
      where: { id: input.id, organizationId: input.organizationId, deletedAt: null },
      select: {
        logoContentType: true,
        logoStorageKey: true,
        logoBytes: true,
        sealContentType: true,
        sealStorageKey: true,
        sealBytes: true,
        authorizedSignContentType: true,
        authorizedSignStorageKey: true,
        authorizedSignBytes: true,
        invoicePlaceOfSupply: true,
        invoiceJurisdiction: true,
        invoiceStateCode: true,
      },
    });
    if (!row) throwAppError('NOT_FOUND', 'Legal entity not found.');
    const [logo, seal, authorizedSign] = await Promise.all([
      toBrandingImage(row.logoContentType, row.logoStorageKey, row.logoBytes),
      toBrandingImage(row.sealContentType, row.sealStorageKey, row.sealBytes),
      toBrandingImage(row.authorizedSignContentType, row.authorizedSignStorageKey, row.authorizedSignBytes),
    ]);
    return {
      logo,
      seal,
      authorizedSign,
      placeOfSupply: row.invoicePlaceOfSupply,
      jurisdiction: row.invoiceJurisdiction,
      stateCode: row.invoiceStateCode,
    };
  }

  async create(input: {
    organizationId: string;
    legalName: string;
    panNumber: string;
    registeredAddress: string;
    logo?: BrandingImageInput | undefined;
    seal?: BrandingImageInput | undefined;
    authorizedSign?: BrandingImageInput | undefined;
    placeOfSupply?: string | null | undefined;
    jurisdiction?: string | null | undefined;
    stateCode?: string | null | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<LegalEntitySummary> {
    const legalEntityId = generateId();
    const images = await allImageColumns(input.organizationId, legalEntityId, input);
    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.legalEntity.create({
          data: {
            id: legalEntityId,
            organizationId: input.organizationId,
            legalName: input.legalName,
            panNumber: input.panNumber,
            registeredAddress: input.registeredAddress,
            ...images,
            ...printColumns(input),
            createdBy: input.actorId,
          },
          select: legalEntityListSelect,
        });
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'LEGAL_ENTITY',
          entityId: row.id,
          action: 'LEGAL_ENTITY_CREATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: {
            legalName: input.legalName,
            panNumber: input.panNumber,
            ...(imageAudit(input.logo) ? { logo: imageAudit(input.logo) } : {}),
            ...(imageAudit(input.seal) ? { seal: imageAudit(input.seal) } : {}),
            ...(imageAudit(input.authorizedSign) ? { authorizedSign: imageAudit(input.authorizedSign) } : {}),
          },
        });
        return row;
      });
      return toLegalEntitySummary(created);
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'A legal entity with this PAN already exists.');
      }
      throw error;
    }
  }

  async update(input: {
    organizationId: string;
    id: string;
    legalName: string | undefined;
    registeredAddress: string | undefined;
    logo?: BrandingImageInput | null | undefined;
    seal?: BrandingImageInput | null | undefined;
    authorizedSign?: BrandingImageInput | null | undefined;
    placeOfSupply?: string | null | undefined;
    jurisdiction?: string | null | undefined;
    stateCode?: string | null | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<LegalEntitySummary> {
    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.legalName !== undefined) data.legalName = input.legalName;
    if (input.registeredAddress !== undefined) data.registeredAddress = input.registeredAddress;
    Object.assign(data, await allImageColumns(input.organizationId, input.id, input));
    Object.assign(data, printColumns(input));

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.legalEntity.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data,
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      const row = await tx.legalEntity.findFirstOrThrow({
        where: { id: input.id, organizationId: input.organizationId },
        select: legalEntityListSelect,
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'LEGAL_ENTITY',
        entityId: row.id,
        action: 'LEGAL_ENTITY_UPDATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: {
          legalName: input.legalName,
          registeredAddress: input.registeredAddress,
          ...(imageAudit(input.logo) ? { logo: imageAudit(input.logo) } : {}),
          ...(imageAudit(input.seal) ? { seal: imageAudit(input.seal) } : {}),
          ...(imageAudit(input.authorizedSign) ? { authorizedSign: imageAudit(input.authorizedSign) } : {}),
        },
      });
      return row;
    });
    return toLegalEntitySummary(updated);
  }

  async setActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.legalEntity.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: { isActive: input.isActive, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'LEGAL_ENTITY',
        entityId: input.id,
        action: input.isActive ? 'LEGAL_ENTITY_ACTIVATED' : 'LEGAL_ENTITY_DEACTIVATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }

  async delete(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    const [gstCount, financialYearCount] = await Promise.all([
      this.prisma.client.gstRegistration.count({
        where: { legalEntityId: input.id, organizationId: input.organizationId, deletedAt: null },
      }),
      this.prisma.client.financialYear.count({
        where: { legalEntityId: input.id, organizationId: input.organizationId },
      }),
    ]);
    if (gstCount > 0 && financialYearCount > 0) {
      throwAppError(
        'VALIDATION_FAILED',
        'This legal entity still has GST registrations and financial years. Remove the GST registrations first — financial years cannot be removed, so this entity can only be deactivated, not deleted.',
      );
    }
    if (gstCount > 0) {
      throwAppError('VALIDATION_FAILED', 'This legal entity still has GST registrations. Remove those first.');
    }
    if (financialYearCount > 0) {
      throwAppError(
        'VALIDATION_FAILED',
        'This legal entity has a financial year, which cannot be removed. This entity can only be deactivated, not deleted.',
      );
    }

    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.legalEntity.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: { deletedAt: new Date(), deletedBy: input.actorId, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'LEGAL_ENTITY',
        entityId: input.id,
        action: 'LEGAL_ENTITY_DELETED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }

  async listGstRegistrations(input: {
    organizationId: string;
    legalEntityId: string;
  }): Promise<GstRegistrationSummary[]> {
    const rows = await this.prisma.client.gstRegistration.findMany({
      where: { organizationId: input.organizationId, legalEntityId: input.legalEntityId, deletedAt: null },
      orderBy: { gstin: 'asc' },
    });
    return rows.map(toGstRegistrationSummary);
  }

  async createGstRegistration(input: {
    organizationId: string;
    legalEntityId: string;
    stateId: string;
    gstin: string;
    tradeName: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<GstRegistrationSummary> {
    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.gstRegistration.create({
          data: {
            id: generateId(),
            organizationId: input.organizationId,
            legalEntityId: input.legalEntityId,
            stateId: input.stateId,
            gstin: input.gstin,
            tradeName: input.tradeName ?? null,
            createdBy: input.actorId,
          },
        });
        await recordAuditEvent(tx, {
          organizationId: input.organizationId,
          entityType: 'GST_REGISTRATION',
          entityId: row.id,
          action: 'GST_REGISTRATION_CREATED',
          actorId: input.actorId,
          correlationId: input.correlationId,
          newValues: { gstin: input.gstin, legalEntityId: input.legalEntityId },
        });
        return row;
      });
      return toGstRegistrationSummary(created);
    } catch (error) {
      if (isConstraintViolation(error)) {
        throwAppError('VALIDATION_FAILED', 'Invalid GSTIN format, or this GSTIN is already registered.');
      }
      throw error;
    }
  }

  async updateGstRegistration(input: {
    organizationId: string;
    id: string;
    tradeName: string | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<GstRegistrationSummary> {
    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.tradeName !== undefined) data.tradeName = input.tradeName;

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.gstRegistration.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data,
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      const row = await tx.gstRegistration.findFirstOrThrow({
        where: { id: input.id, organizationId: input.organizationId },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'GST_REGISTRATION',
        entityId: row.id,
        action: 'GST_REGISTRATION_UPDATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { tradeName: input.tradeName },
      });
      return row;
    });
    return toGstRegistrationSummary(updated);
  }

  async setGstRegistrationActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.gstRegistration.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: { isActive: input.isActive, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'GST_REGISTRATION',
        entityId: input.id,
        action: input.isActive ? 'GST_REGISTRATION_ACTIVATED' : 'GST_REGISTRATION_DEACTIVATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }

  async deleteGstRegistration(input: {
    organizationId: string;
    id: string;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.gstRegistration.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: { deletedAt: new Date(), deletedBy: input.actorId, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'GST_REGISTRATION',
        entityId: input.id,
        action: 'GST_REGISTRATION_DELETED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }

  async listBankAccounts(input: {
    organizationId: string;
    legalEntityId: string | undefined;
    includeInactive: boolean | undefined;
  }): Promise<BankAccountSummary[]> {
    const rows = await this.prisma.client.bankAccount.findMany({
      where: {
        organizationId: input.organizationId,
        ...(input.legalEntityId ? { legalEntityId: input.legalEntityId } : {}),
        ...(input.includeInactive ? {} : { isActive: true }),
      },
      include: { ledgerAccount: true },
      orderBy: { accountName: 'asc' },
    });
    return rows.map(toBankAccountSummary);
  }

  /**
   * A ledger of its own for a new bank account or credit card (ADR-160),
   * so the person adding it never has to pick or create one. It sits in the
   * group the posting rules expect — Bank Accounts, or Credit Card Payable —
   * is named after the account, and gets a code derived from that name.
   */
  private async createOwnLedger(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      groupCode: string;
      groupLabel: string;
      codePrefix: string;
      name: string;
      /** Told apart by this when another ledger in the group already has the name (e.g. the masked account number). */
      distinguisher?: string | undefined;
      actorId: string;
      correlationId: string;
    },
  ): Promise<string> {
    const group = await tx.accountGroup.findFirst({ where: { organizationId: input.organizationId, code: input.groupCode, isActive: true } });
    if (!group) throwAppError('VALIDATION_FAILED', `The chart of accounts has no active "${input.groupLabel}" group to hold this account's ledger.`);
    const slug = input.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'ACCOUNT';
    const base = `${input.codePrefix}_${slug}`;
    const taken = new Set((await tx.ledgerAccount.findMany({ where: { organizationId: input.organizationId, code: { startsWith: base } }, select: { code: true } })).map((r) => r.code));
    let code = base;
    for (let n = 2; taken.has(code); n++) code = `${base}_${n}`;
    const sameName = await tx.ledgerAccount.count({ where: { organizationId: input.organizationId, accountGroupId: group.id, name: input.name } });
    // Readable names only: the account number tells two of the same name apart, or else a plain number.
    const name = sameName > 0 ? `${input.name} ${input.distinguisher?.trim() || sameName + 1}` : input.name;
    const ledger = await tx.ledgerAccount.create({
      data: { id: generateId(), organizationId: input.organizationId, accountGroupId: group.id, code, name, createdBy: input.actorId },
    });
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      entityType: 'LEDGER_ACCOUNT',
      entityId: ledger.id,
      action: 'LEDGER_ACCOUNT_CREATED',
      actorId: input.actorId,
      correlationId: input.correlationId,
      reason: `Created for a new ${input.groupLabel === 'Bank Accounts' ? 'bank account' : 'credit card'}`,
      newValues: { code, name, accountGroupId: group.id },
    });
    return ledger.id;
  }

  async createBankAccount(input: {
    organizationId: string;
    legalEntityId: string;
    ledgerAccountId: string | undefined;
    accountName: string;
    bankName: string | undefined;
    maskedAccountNumber: string | undefined;
    invoiceAccountNumber?: string | undefined;
    ifsc: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<BankAccountSummary> {
    if (input.ledgerAccountId) {
      const ledgerAccount = await this.prisma.client.ledgerAccount.findFirst({
        where: { id: input.ledgerAccountId, organizationId: input.organizationId },
      });
      if (!ledgerAccount) throwAppError('NOT_FOUND', 'Ledger account not found.');
    }

    // The list shows the masked number; it is taken from the full account number when one is given.
    const maskedAccountNumber = maskAccountNumber(input.invoiceAccountNumber) ?? (input.maskedAccountNumber?.trim() || null);
    const created = await this.prisma.client.$transaction(async (tx) => {
      const ledgerAccountId =
        input.ledgerAccountId ??
        (await this.createOwnLedger(tx, {
          organizationId: input.organizationId,
          groupCode: 'BANK_ACCOUNTS',
          groupLabel: 'Bank Accounts',
          codePrefix: 'BANK',
          name: input.accountName.trim(),
          distinguisher: maskedAccountNumber ?? undefined,
          actorId: input.actorId,
          correlationId: input.correlationId,
        }));
      const row = await tx.bankAccount.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          legalEntityId: input.legalEntityId,
          ledgerAccountId,
          accountName: input.accountName,
          bankName: input.bankName ?? null,
          maskedAccountNumber,
          invoiceAccountNumber: input.invoiceAccountNumber?.trim() || null,
          ifsc: input.ifsc ?? null,
          createdBy: input.actorId,
        },
        include: { ledgerAccount: true },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'BANK_ACCOUNT',
        entityId: row.id,
        action: 'BANK_ACCOUNT_CREATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { accountName: input.accountName, legalEntityId: input.legalEntityId, ledgerAccountId, ledgerCreated: !input.ledgerAccountId },
      });
      return row;
    });
    return toBankAccountSummary(created);
  }

  async updateBankAccount(input: {
    organizationId: string;
    id: string;
    accountName?: string | undefined;
    bankName?: string | null | undefined;
    maskedAccountNumber?: string | null | undefined;
    invoiceAccountNumber?: string | null | undefined;
    ifsc?: string | null | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<BankAccountSummary> {
    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.accountName !== undefined) data.accountName = input.accountName;
    if (input.bankName !== undefined) data.bankName = input.bankName;
    if (input.maskedAccountNumber !== undefined) data.maskedAccountNumber = input.maskedAccountNumber;
    if (input.invoiceAccountNumber !== undefined) {
      data.invoiceAccountNumber = input.invoiceAccountNumber ? input.invoiceAccountNumber.trim() || null : null;
      // A changed full number re-derives the masked one shown in lists.
      const masked = input.invoiceAccountNumber ? maskAccountNumber(input.invoiceAccountNumber) : null;
      if (masked) data.maskedAccountNumber = masked;
    }
    if (input.ifsc !== undefined) data.ifsc = input.ifsc;

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.bankAccount.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data,
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      const row = await tx.bankAccount.findFirstOrThrow({
        where: { id: input.id, organizationId: input.organizationId },
        include: { ledgerAccount: true },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'BANK_ACCOUNT',
        entityId: row.id,
        action: 'BANK_ACCOUNT_UPDATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { accountName: input.accountName, bankName: input.bankName },
      });
      return row;
    });
    return toBankAccountSummary(updated);
  }

  async setBankAccountActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.bankAccount.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: { isActive: input.isActive, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'BANK_ACCOUNT',
        entityId: input.id,
        action: input.isActive ? 'BANK_ACCOUNT_ACTIVATED' : 'BANK_ACCOUNT_DEACTIVATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }

  async listCardAccounts(input: {
    organizationId: string;
    legalEntityId: string | undefined;
    includeInactive: boolean | undefined;
  }): Promise<CardAccountSummary[]> {
    const rows = await this.prisma.client.cardAccount.findMany({
      where: {
        organizationId: input.organizationId,
        ...(input.legalEntityId ? { legalEntityId: input.legalEntityId } : {}),
        ...(input.includeInactive ? {} : { isActive: true }),
      },
      include: cardAccountInclude,
      orderBy: { displayName: 'asc' },
    });
    return rows.map(toCardAccountSummary);
  }

  async createCardAccount(input: {
    organizationId: string;
    legalEntityId: string;
    type: CardType;
    displayName: string;
    issuerName: string | undefined;
    maskedLastFour: string;
    cardNumber?: string | undefined;
    cardholderEmployeeId: string | undefined;
    bankAccountId: string | undefined;
    ledgerAccountId: string | undefined;
    statementDay: number | undefined;
    paymentDueDay: number | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<CardAccountSummary> {
    if (!/^\d{4}$/.test(input.maskedLastFour)) throwAppError('VALIDATION_FAILED', 'Masked last four must be exactly 4 digits.');

    if (input.type === 'DEBIT_CARD') {
      if (!input.bankAccountId) throwAppError('VALIDATION_FAILED', 'A Debit Card requires a linked bank account.');
      if (input.ledgerAccountId) throwAppError('VALIDATION_FAILED', 'A Debit Card must not carry its own payable ledger account.');
      const bankAccount = await this.prisma.client.bankAccount.findFirst({ where: { id: input.bankAccountId, organizationId: input.organizationId } });
      if (!bankAccount) throwAppError('NOT_FOUND', 'Bank account not found.');
      if (bankAccount.legalEntityId !== input.legalEntityId) throwAppError('VALIDATION_FAILED', 'The bank account must belong to the same legal entity.');
    } else {
      // Without a ledger given, the card gets a payable ledger of its own (ADR-160).
      if (input.bankAccountId) throwAppError('VALIDATION_FAILED', 'A Credit Card must not carry a directly-linked bank account.');
      if (input.ledgerAccountId) {
        const ledgerAccount = await this.prisma.client.ledgerAccount.findFirst({ where: { id: input.ledgerAccountId, organizationId: input.organizationId } });
        if (!ledgerAccount) throwAppError('NOT_FOUND', 'Ledger account not found.');
      }
    }

    if (input.cardholderEmployeeId) {
      const employee = await this.prisma.client.employee.findFirst({ where: { id: input.cardholderEmployeeId, organizationId: input.organizationId, deletedAt: null } });
      if (!employee) throwAppError('NOT_FOUND', 'Cardholder employee not found.');
    }

    const created = await this.prisma.client.$transaction(async (tx) => {
      const ledgerAccountId =
        input.type === 'CREDIT_CARD'
          ? (input.ledgerAccountId ??
            (await this.createOwnLedger(tx, {
              organizationId: input.organizationId,
              groupCode: 'CREDIT_CARD_PAYABLE',
              groupLabel: 'Credit Card Payable',
              codePrefix: 'CARD',
              name: `${input.displayName.trim()} ****${input.maskedLastFour}`,
              actorId: input.actorId,
              correlationId: input.correlationId,
            })))
          : null;
      const row = await tx.cardAccount.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          legalEntityId: input.legalEntityId,
          type: input.type,
          displayName: input.displayName,
          issuerName: input.issuerName ?? null,
          maskedLastFour: input.maskedLastFour,
          cardNumber: input.cardNumber ?? null,
          cardholderEmployeeId: input.cardholderEmployeeId ?? null,
          bankAccountId: input.bankAccountId ?? null,
          ledgerAccountId,
          statementDay: input.statementDay ?? null,
          paymentDueDay: input.paymentDueDay ?? null,
          createdBy: input.actorId,
        },
        include: cardAccountInclude,
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'CARD_ACCOUNT',
        entityId: row.id,
        action: 'CARD_ACCOUNT_CREATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { displayName: input.displayName, type: input.type, legalEntityId: input.legalEntityId },
      });
      return row;
    });
    return toCardAccountSummary(created);
  }

  /** displayName/issuerName/maskedLastFour/cardholderEmployeeId/statementDay/
   * paymentDueDay only -- type/bankAccountId/ledgerAccountId are permanent
   * once created (see CardAccountSummary's own doc comment). */
  async updateCardAccount(input: {
    organizationId: string;
    id: string;
    displayName?: string | undefined;
    issuerName?: string | null | undefined;
    maskedLastFour?: string | undefined;
    cardNumber?: string | null | undefined;
    cardholderEmployeeId?: string | null | undefined;
    statementDay?: number | null | undefined;
    paymentDueDay?: number | null | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<CardAccountSummary> {
    if (input.maskedLastFour !== undefined && !/^\d{4}$/.test(input.maskedLastFour)) {
      throwAppError('VALIDATION_FAILED', 'Masked last four must be exactly 4 digits.');
    }
    if (input.cardholderEmployeeId) {
      const employee = await this.prisma.client.employee.findFirst({ where: { id: input.cardholderEmployeeId, organizationId: input.organizationId, deletedAt: null } });
      if (!employee) throwAppError('NOT_FOUND', 'Cardholder employee not found.');
    }

    const data: Record<string, unknown> = { updatedBy: input.actorId, version: { increment: 1 } };
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.issuerName !== undefined) data.issuerName = input.issuerName;
    if (input.maskedLastFour !== undefined) data.maskedLastFour = input.maskedLastFour;
    if (input.cardNumber !== undefined) {
      data.cardNumber = input.cardNumber;
      if (input.cardNumber && input.cardNumber.length >= 4) {
        data.maskedLastFour = input.cardNumber.slice(-4);
      }
    }
    if (input.cardholderEmployeeId !== undefined) data.cardholderEmployeeId = input.cardholderEmployeeId;
    if (input.statementDay !== undefined) data.statementDay = input.statementDay;
    if (input.paymentDueDay !== undefined) data.paymentDueDay = input.paymentDueDay;

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.cardAccount.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data,
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      const row = await tx.cardAccount.findFirstOrThrow({
        where: { id: input.id, organizationId: input.organizationId },
        include: cardAccountInclude,
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'CARD_ACCOUNT',
        entityId: row.id,
        action: 'CARD_ACCOUNT_UPDATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        newValues: { displayName: input.displayName },
      });
      return row;
    });
    return toCardAccountSummary(updated);
  }

  async setCardAccountActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.cardAccount.updateMany({
        where: { id: input.id, organizationId: input.organizationId, version: input.expectedVersion },
        data: { isActive: input.isActive, updatedBy: input.actorId, version: { increment: 1 } },
      });
      if (count === 0) {
        throwAppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
      }
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        entityType: 'CARD_ACCOUNT',
        entityId: input.id,
        action: input.isActive ? 'CARD_ACCOUNT_ACTIVATED' : 'CARD_ACCOUNT_DEACTIVATED',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    });
  }
}
