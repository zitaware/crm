import { generateId, recordAuditEvent, enqueueOutboxEvent, type PrismaClient } from '@zitaware/database';
import { createLogger } from '@zitaware/config';

const logger = createLogger({ service: 'worker' });

const SALARY_COMMIT_PERMISSION = 'salary_import.commit';

/**
 * Everyone who could actually commit the draft this job creates.
 *
 * Resolved from effective permissions rather than a hardcoded role name, so
 * a custom role granted the key later is notified too — the same rule
 * `payment-alert-opener.ts` follows for ACCOUNT_TEAM (ADR-064). Reimplemented
 * here rather than imported because the worker is a separate app with no
 * NestJS DI and deliberately no dependency on apps/api's module graph.
 */
async function resolveSalaryApproverEmails(prisma: PrismaClient, organizationId: string): Promise<string[]> {
  const candidates = await prisma.user.findMany({
    where: {
      organizationId,
      status: 'ACTIVE',
      OR: [
        { userRoles: { some: { role: { rolePermissions: { some: { permission: { key: SALARY_COMMIT_PERMISSION } } } } } } },
        { userPermissionOverrides: { some: { permission: { key: SALARY_COMMIT_PERMISSION }, effect: 'GRANT', scopeType: null } } },
      ],
    },
    select: {
      email: true,
      userRoles: { select: { role: { select: { rolePermissions: { select: { permission: { select: { key: true } } } } } } } },
      userPermissionOverrides: { select: { effect: true, scopeType: true, permission: { select: { key: true } } } },
    },
  });

  const emails: string[] = [];
  for (const user of candidates) {
    const hasRoleGrant = user.userRoles.some((ur) =>
      ur.role.rolePermissions.some((rp) => rp.permission.key === SALARY_COMMIT_PERMISSION),
    );
    const overrides = user.userPermissionOverrides.filter(
      (o) => o.scopeType === null && o.permission.key === SALARY_COMMIT_PERMISSION,
    );
    const hasUserGrant = overrides.some((o) => o.effect === 'GRANT');
    const hasUserRevoke = overrides.some((o) => o.effect === 'REVOKE');
    if ((hasRoleGrant || hasUserGrant) && !hasUserRevoke) emails.push(user.email);
  }
  return emails;
}

/** First day of the month before the one `today` falls in. */
export function previousMonthStart(today: Date): Date {
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
}

function monthEnd(month: Date): Date {
  return new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
}

export interface SalaryDraftResult {
  generated: number;
  skipped: number;
}

/**
 * Creates the previous month's DRAFT salary batch for every legal entity
 * that does not already have one (ADR-098).
 *
 * Only the month that has actually *ended* is generated — a salary month is
 * not knowable until it is over, and drafting the current month would
 * invite committing a month that is still changing.
 *
 * Nothing is posted: the draft carries no journal, and an accountant must
 * review and commit it. Skips entirely when a batch (draft or posted)
 * already exists for the month, so repeated ticks are harmless — the
 * partial unique indexes make that a guarantee rather than a hope.
 */
export async function runSalaryDraftGeneratorJob(prisma: PrismaClient, now: Date = new Date()): Promise<SalaryDraftResult> {
  const month = previousMonthStart(now);
  const result: SalaryDraftResult = { generated: 0, skipped: 0 };

  const legalEntities = await prisma.legalEntity.findMany({
    where: { deletedAt: null },
    select: { id: true, organizationId: true, legalName: true },
  });
  const entitiesPerOrganization = new Map<string, number>();
  for (const entity of legalEntities) {
    entitiesPerOrganization.set(entity.organizationId, (entitiesPerOrganization.get(entity.organizationId) ?? 0) + 1);
  }

  for (const legalEntity of legalEntities) {
    const existing = await prisma.salaryImport.findFirst({
      where: {
        organizationId: legalEntity.organizationId,
        legalEntityId: legalEntity.id,
        salaryMonth: month,
        status: { in: ['DRAFT', 'POSTED'] },
      },
      select: { id: true },
    });
    if (existing) {
      result.skipped += 1;
      continue;
    }

    // This legal entity's own employees only (ADR-154), the same rule as
    // SalaryImportsService.payrollScope: an employee whose legal entity is
    // not set counts only when the organization has a single legal entity.
    const includesUnassigned = (entitiesPerOrganization.get(legalEntity.organizationId) ?? 0) <= 1;
    const employeeScope = includesUnassigned
      ? { OR: [{ legalEntityId: legalEntity.id }, { legalEntityId: null }] }
      : { legalEntityId: legalEntity.id };

    // Whoever has a salary on record covering this month. A revision covers
    // it when it began on or before the month ended and had not already
    // ended before the month began.
    const revisions = await prisma.employeeSalaryRevision.findMany({
      where: {
        organizationId: legalEntity.organizationId,
        effectiveFrom: { lte: monthEnd(month) },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: month } }],
        employee: { deletedAt: null, status: 'ACTIVE', ...employeeScope },
      },
      orderBy: { effectiveFrom: 'asc' },
      select: {
        grossAmount: true,
        employeeId: true,
        employee: { select: { employeeCode: true, fullName: true } },
      },
    });

    const byEmployee = new Map<string, (typeof revisions)[number]>();
    for (const revision of revisions) byEmployee.set(revision.employeeId, revision);
    const rows = [...byEmployee.values()];

    // No salaries on record is a setup problem to leave alone, not an empty
    // document to create — and an empty batch would fail the head-count CHECK.
    if (rows.length === 0) {
      result.skipped += 1;
      continue;
    }

    const importId = generateId();
    const totalGrossAmount = rows.reduce((sum, r) => sum.add(r.grossAmount), rows[0]!.grossAmount.minus(rows[0]!.grossAmount));

    await prisma.$transaction(async (tx) => {
      await tx.salaryImport.create({
        data: {
          id: importId,
          organizationId: legalEntity.organizationId,
          legalEntityId: legalEntity.id,
          salaryMonth: month,
          accountingDate: monthEnd(month),
          sourceFileName: null,
          sourceChecksum: null,
          employeeCount: rows.length,
          totalGrossAmount,
          status: 'DRAFT',
          journalEntryId: null,
        },
      });
      await tx.salaryImportLine.createMany({
        data: rows.map((r) => ({
          id: generateId(),
          organizationId: legalEntity.organizationId,
          salaryImportId: importId,
          employeeId: r.employeeId,
          employeeCodeRaw: r.employee.employeeCode,
          employeeNameRaw: r.employee.fullName,
          grossSalaryAmount: r.grossAmount,
        })),
      });
      await recordAuditEvent(tx, {
        organizationId: legalEntity.organizationId,
        legalEntityId: legalEntity.id,
        entityType: 'SALARY_IMPORT',
        entityId: importId,
        action: 'SALARY_IMPORT_DRAFT_GENERATED',
        actorId: undefined,
        correlationId: generateId(),
        newValues: {
          salaryMonth: month.toISOString().slice(0, 10),
          employeeCount: rows.length,
          totalGrossAmount: totalGrossAmount.toFixed(2),
          generatedBy: 'worker',
        },
      });
    });

    const emails = await resolveSalaryApproverEmails(prisma, legalEntity.organizationId);
    await prisma.$transaction(async (tx) => {
      for (const email of emails) {
        await enqueueOutboxEvent(tx, {
          organizationId: legalEntity.organizationId,
          aggregateType: 'SALARY_IMPORT',
          aggregateId: importId,
          eventType: 'SALARY_IMPORT_DRAFT_GENERATED',
          payload: {
            email,
            legalEntityName: legalEntity.legalName,
            salaryMonth: month.toISOString().slice(0, 10),
            employeeCount: rows.length,
            totalGrossAmount: totalGrossAmount.toFixed(2),
          },
        });
      }
    });

    result.generated += 1;
  }

  if (result.generated > 0 || result.skipped > 0) {
    logger.info('salary_draft_generator.tick', { month: month.toISOString().slice(0, 10), ...result });
  }
  return result;
}
