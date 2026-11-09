/** Detects Postgres unique-violation (Prisma P2002) and raw CHECK-constraint
 * violations (Prisma has no distinct known-error code for CHECK failures —
 * they surface as PrismaClientUnknownRequestError with Postgres's own
 * "violates check constraint" wording), so both can be mapped to a clean
 * VALIDATION_FAILED instead of leaking a raw 500. */
export function isConstraintViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: string }).code;
  if (code === 'P2002') return true;
  const message = (error as { message?: string }).message ?? '';
  return message.includes('violates check constraint') || message.includes('duplicate key value');
}
