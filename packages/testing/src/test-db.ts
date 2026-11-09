import { PrismaClient } from '@zitaware/database';

/**
 * Runs `fn` inside a Prisma transaction that is always rolled back, so
 * integration tests never leave residue in the shared test database.
 * No business models exist yet (Phase 1) — this helper is wired now so
 * later phases can adopt it without re-deriving the isolation pattern.
 */
export async function withRolledBackTransaction<T>(
  fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  const prisma = new PrismaClient();
  const ROLLBACK = Symbol('rollback');

  try {
    let result: T;
    await prisma
      .$transaction(async (tx) => {
        result = await fn(tx);
        throw ROLLBACK;
      })
      .catch((error: unknown) => {
        if (error !== ROLLBACK) {
          throw error;
        }
      });
    return result!;
  } finally {
    await prisma.$disconnect();
  }
}
