import { createHash, randomBytes } from 'node:crypto';

/**
 * High-entropy random tokens (invitations, password resets, refresh
 * tokens) are hashed with plain SHA-256 before storage — unlike user
 * passwords, these are never user-chosen/low-entropy, so a fast
 * cryptographic hash is appropriate; argon2 (password.util.ts) is
 * reserved for actual passwords where brute-force resistance matters.
 */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
