import { describe, expect, it } from 'vitest';
import { resolvePermissions } from './resolve-permissions';

describe('resolvePermissions', () => {
  it('grants everything from the user\'s roles when there are no overrides', () => {
    const result = resolvePermissions(['master.read', 'master.manage'], [], []);
    expect(result).toEqual(new Set(['master.read', 'master.manage']));
  });

  it('adds a permission via a user grant that no role provides', () => {
    const result = resolvePermissions(['master.read'], ['audit.read'], []);
    expect(result.has('audit.read')).toBe(true);
    expect(result.has('master.read')).toBe(true);
  });

  it('removes a role-granted permission via a user revocation', () => {
    const result = resolvePermissions(['master.read', 'master.manage'], [], ['master.manage']);
    expect(result.has('master.manage')).toBe(false);
    expect(result.has('master.read')).toBe(true);
  });

  it('revocation wins even when the same key is also present in user grants', () => {
    const result = resolvePermissions([], ['user.manage'], ['user.manage']);
    expect(result.has('user.manage')).toBe(false);
  });

  it('returns an empty set when nothing is granted', () => {
    const result = resolvePermissions([], [], []);
    expect(result.size).toBe(0);
  });
});
