/**
 * Permission resolution, per docs/09-security-audit.md's exact algorithm:
 * 1. Combine role grants.
 * 2. Apply user grants.
 * 3. Apply user revocations.
 * 4. Revocation wins.
 *
 * Pure and unit-testable — no DB access. Callers assemble the three input
 * lists from role_permissions (via the user's roles) and
 * user_permission_overrides (split by effect).
 */
export function resolvePermissions(
  roleGrants: readonly string[],
  userGrants: readonly string[],
  userRevocations: readonly string[],
): Set<string> {
  const combined = new Set<string>([...roleGrants, ...userGrants]);
  for (const revoked of userRevocations) {
    combined.delete(revoked);
  }
  return combined;
}
