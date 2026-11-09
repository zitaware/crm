import * as argon2 from 'argon2';

/** argon2id — proposed default (docs/12 ADR-035+); no algorithm is named
 * anywhere in the project's docs prior to Phase 2. */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}
