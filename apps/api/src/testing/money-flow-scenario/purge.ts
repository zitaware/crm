import { PrismaService } from '../../prisma/prisma.service';

/** True when a table cannot be emptied YET because rows elsewhere still depend on it. */
function isBlockedByDependents(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${JSON.stringify((error as { meta?: unknown }).meta ?? {})}` : String(error);
  // 23503 foreign_key_violation (NO ACTION), 23001 restrict_violation (ON DELETE
  // RESTRICT), and 23514 check_violation — an ON DELETE SET NULL that would leave
  // a dependent row invalid (deleting milestone events nulls a payment alert's
  // source, which chk_payment_alerts_source_matches_type rejects). All three
  // clear once the dependent rows are deleted in a later pass.
  return ['23503', '23001', '23514'].some((code) => text.includes(code)) || /foreign key/i.test(text);
}

/**
 * Orders tables so every table comes after all the tables that reference it
 * (children first). Self-references are ignored — Postgres checks them at
 * the end of the statement. A genuine cycle between tables leaves the rest
 * in any order; the retry loop below then resolves it.
 */
function deletionOrder(tables: string[], edges: Array<{ child: string; parent: string }>): string[] {
  const remaining = new Set(tables);
  const order: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((table) => !edges.some((e) => e.parent === table && e.child !== table && remaining.has(e.child)));
    if (ready.length === 0) {
      order.push(...remaining);
      break;
    }
    for (const table of ready) {
      order.push(table);
      remaining.delete(table);
    }
  }
  return order;
}

/**
 * Deletes every row an organization owns, then the organization itself.
 *
 * The table list and the foreign keys between them are read from the
 * database rather than hand-maintained: the scenario touches most of the
 * schema, and a list that silently missed one new table would leave residue
 * behind — the flakiness class ADR-077 records. Tables are emptied children
 * first, so a normal purge raises no constraint errors at all; any a cycle
 * still causes are retried in a later pass, and a pass that makes no
 * progress throws rather than looping.
 */
export async function purgeOrganization(prisma: PrismaService, organizationId: string): Promise<void> {
  const tables = await prisma.client.$queryRaw<Array<{ table_name: string }>>`
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'organization_id'
      AND t.table_type = 'BASE TABLE' AND c.table_name <> 'organizations'`;
  const edges = await prisma.client.$queryRaw<Array<{ child: string; parent: string }>>`
    SELECT DISTINCT child.relname AS child, parent.relname AS parent
    FROM pg_constraint fk
    JOIN pg_class child ON child.oid = fk.conrelid
    JOIN pg_class parent ON parent.oid = fk.confrelid
    JOIN pg_namespace ns ON ns.oid = child.relnamespace
    WHERE fk.contype = 'f' AND ns.nspname = 'public'`;

  // The only owned table without its own organization_id: reached through its role.
  await prisma.client.$executeRaw`
    DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE organization_id = ${organizationId}::uuid)`;

  let remaining = deletionOrder(tables.map((t) => t.table_name), edges);
  while (remaining.length > 0) {
    const blocked: string[] = [];
    for (const table of remaining) {
      try {
        await prisma.client.$executeRawUnsafe(`DELETE FROM "${table}" WHERE organization_id = $1::uuid`, organizationId);
      } catch (error) {
        if (!isBlockedByDependents(error)) throw error;
        blocked.push(table);
      }
    }
    if (blocked.length === remaining.length) {
      throw new Error(`Could not purge organization ${organizationId}: still referenced — ${blocked.join(', ')}`);
    }
    remaining = blocked;
  }

  await prisma.client.organization.delete({ where: { id: organizationId } });
}
