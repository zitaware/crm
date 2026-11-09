/**
 * Loads the money-flow scenario into its own demo organization, so the
 * figures the integration spec asserts can be checked by hand on the real
 * screens.
 *
 *   npm --workspace api run demo:money-flow               load (refuses if already loaded)
 *   npm --workspace api run demo:money-flow -- --reset    delete the demo organization and load it again
 *   npm --workspace api run demo:money-flow -- --remove   delete the demo organization only
 *   ... -- --out <path>                                   where to write the expected-numbers sheet
 *
 * The data lives in a separate organization with its own two users, so its
 * totals are not mixed with anything else in the database and removing it
 * touches nothing else. Refuses to run with NODE_ENV=production.
 */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateId } from '@zitaware/database';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/identity/password.util';
import { buildMoneyFlowScenario } from '../src/testing/money-flow-scenario/build';
import { buildDemoExtras } from '../src/testing/money-flow-scenario/demo-extras';
import { purgeOrganization } from '../src/testing/money-flow-scenario/purge';
import { renderExpectedSheet } from '../src/testing/money-flow-scenario/sheet';

const ORG_CODE = 'DEMO-MONEY-FLOW';
const PASSWORD = 'MoneyFlow@2026';
const MAKER_EMAIL = 'maker@zitaware.test';
const CHECKER_EMAIL = 'checker@zitaware.test';

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to load demo data with NODE_ENV=production.');

  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const remove = args.includes('--remove');
  const outFlag = args.indexOf('--out');
  const outPath = resolve(outFlag >= 0 && args[outFlag + 1] ? args[outFlag + 1]! : 'money-flow-demo-sheet.md');

  const prisma = new PrismaService();
  try {
    const existing = await prisma.client.organization.findUnique({ where: { code: ORG_CODE } });
    if (existing) {
      if (!reset && !remove) {
        throw new Error(`The demo organization ${ORG_CODE} is already loaded. Re-run with --reset to rebuild it, or --remove to delete it.`);
      }
      await purgeOrganization(prisma, existing.id);
      write(`Removed the existing demo organization ${ORG_CODE}.`);
    }
    if (remove) return;

    // Login looks a user up by email alone, across organizations.
    const clash = await prisma.client.user.findFirst({
      where: { OR: [MAKER_EMAIL, CHECKER_EMAIL].map((email) => ({ email: { equals: email, mode: 'insensitive' as const } })) },
    });
    if (clash) throw new Error(`${clash.email} already belongs to another organization, so the demo login would be ambiguous.`);

    const permissions = await prisma.client.permission.findMany({ select: { id: true } });
    if (permissions.length === 0) throw new Error('The permission catalogue is empty — run the database seed first.');

    const organization = await prisma.client.organization.create({ data: { id: generateId(), name: 'Demo — Money Flow Scenario', code: ORG_CODE } });
    try {
      const role = await prisma.client.role.create({ data: { id: generateId(), organizationId: organization.id, name: 'Admin', isSystem: true } });
      await prisma.client.rolePermission.createMany({ data: permissions.map((p) => ({ id: generateId(), roleId: role.id, permissionId: p.id })) });

      const passwordHash = await hashPassword(PASSWORD);
      const createUser = async (email: string, displayName: string): Promise<string> => {
        const user = await prisma.client.user.create({
          data: { id: generateId(), organizationId: organization.id, email, displayName, passwordHash, status: 'ACTIVE' },
        });
        await prisma.client.userRole.create({ data: { id: generateId(), organizationId: organization.id, userId: user.id, roleId: role.id } });
        return user.id;
      };
      const makerId = await createUser(MAKER_EMAIL, 'Demo Maker');
      const checkerId = await createUser(CHECKER_EMAIL, 'Demo Checker');

      write('Building the scenario — this takes a minute or two…');
      const scenario = await buildMoneyFlowScenario(prisma, { organizationId: organization.id, makerId, checkerId, emailSuffix: 'demo' });
      // The modules the scenario does not build — Leads, Tenders, EMD/SD,
      // Subscriptions, Servers, Card Accounts, Employee Advances, masters,
      // contacts, project team/progress and the bank statement flow. Demo
      // only: the integration spec's organization never gets these.
      write('Loading the demo extras…');
      await buildDemoExtras(prisma, scenario, { makerId, checkerId });
    } catch (error) {
      // Never leave a half-built organization behind.
      await purgeOrganization(prisma, organization.id);
      throw error;
    }

    const webUrl = process.env.WEB_PUBLIC_URL ?? `http://localhost:${process.env.WEB_PORT ?? '3000'}`;
    writeFileSync(outPath, renderExpectedSheet({ url: webUrl, makerEmail: MAKER_EMAIL, checkerEmail: CHECKER_EMAIL, password: PASSWORD }));

    write(`Loaded the demo organization ${ORG_CODE}.`);
    write(`Log in as ${MAKER_EMAIL} or ${CHECKER_EMAIL} with password ${PASSWORD}.`);
    write(`Expected numbers: ${outPath}`);
  } finally {
    await prisma.client.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
