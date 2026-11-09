import { describe, expect, it } from 'vitest';
import { isPublicAuthPath, sanitizeNextPath } from './next-path';

describe('isPublicAuthPath', () => {
  it('matches an exact public auth path', () => {
    expect(isPublicAuthPath('/login')).toBe(true);
    expect(isPublicAuthPath('/reset-password')).toBe(true);
  });

  it('matches a nested public auth path', () => {
    expect(isPublicAuthPath('/accept-invite/sub')).toBe(true);
  });

  it('does not match a protected path', () => {
    expect(isPublicAuthPath('/projects')).toBe(false);
    expect(isPublicAuthPath('/login-audit')).toBe(false);
  });
});

describe('sanitizeNextPath', () => {
  it('passes through a same-origin relative path', () => {
    expect(sanitizeNextPath('/projects/123?tab=milestones')).toBe('/projects/123?tab=milestones');
  });

  it('defaults to / when missing', () => {
    expect(sanitizeNextPath(null)).toBe('/');
    expect(sanitizeNextPath(undefined)).toBe('/');
    expect(sanitizeNextPath('')).toBe('/');
  });

  it('rejects an absolute URL', () => {
    expect(sanitizeNextPath('https://evil.example/phish')).toBe('/');
  });

  it('rejects a protocol-relative URL', () => {
    expect(sanitizeNextPath('//evil.example/phish')).toBe('/');
  });

  it('rejects a backslash-based bypass', () => {
    expect(sanitizeNextPath('/\\evil.example')).toBe('/');
  });

  it('collapses a public auth path back to /', () => {
    expect(sanitizeNextPath('/login')).toBe('/');
    expect(sanitizeNextPath('/login?next=%2Fprojects')).toBe('/');
  });
});
