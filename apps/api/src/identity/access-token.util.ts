import jwt from 'jsonwebtoken';

export interface AccessTokenClaims {
  sub: string; // userId
  organizationId: string;
  sessionId: string;
}

/**
 * Access tokens are stateless signed JWTs (short-lived, verified by
 * signature + expiry only, no DB round trip) — distinct from refresh
 * tokens, which are stateful rows in `sessions` supporting revocation and
 * rotation/reuse detection.
 */
export function signAccessToken(
  claims: AccessTokenClaims,
  secret: string,
  ttlMinutes: number,
): string {
  return jwt.sign(claims, secret, { expiresIn: `${ttlMinutes}m` });
}

export function verifyAccessToken(token: string, secret: string): AccessTokenClaims | null {
  try {
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === 'string') {
      return null;
    }
    const { sub, organizationId, sessionId } = decoded as Record<string, unknown>;
    if (
      typeof sub !== 'string' ||
      typeof organizationId !== 'string' ||
      typeof sessionId !== 'string'
    ) {
      return null;
    }
    return { sub, organizationId, sessionId };
  } catch {
    return null;
  }
}
