import type { AuditActionGroup } from '@zitaware/contracts';

/** docs/09 "Alert on ... repeated auth failure, period reopen, and high-risk exports" and its mandatory audit coverage. */
const SIGN_IN = new Set(['USER_LOGIN_FAILED', 'USER_LOCKED_OUT', 'USER_PASSWORD_RESET_REQUESTED', 'USER_PASSWORD_RESET_COMPLETED']);
const ACCESS = new Set(['USER_DISABLED', 'USER_ENABLED', 'USER_INVITED', 'USER_REINVITED', 'USER_SESSIONS_REVOKED', 'SESSION_FAMILY_REVOKED', 'SESSION_REVOKED']);
const PERIOD_CONTROL = new Set(['LOCK', 'REOPEN', 'SOFT_CLOSE', 'BANK_RECONCILIATION_LOCKED', 'BANK_RECONCILIATION_REOPENED', 'EMPLOYEE_ALLOCATION_REOPENED']);
const EXPORT = new Set(['REPORT_EXPORTED', 'DOCUMENT_DOWNLOADED']);

/**
 * The control group an audit action belongs to (ADR-120). Anything not named
 * here is routine activity. Rules are by exact action or by the suffix every
 * module already uses for the same kind of event (…_REVERSED, …_VOIDED).
 */
export function auditActionGroup(action: string): AuditActionGroup {
  if (SIGN_IN.has(action)) return 'SIGN_IN';
  if (ACCESS.has(action) || action.startsWith('ROLE_') || action.startsWith('USER_ROLE_') || action.startsWith('USER_PERMISSION_')) return 'ACCESS';
  if (PERIOD_CONTROL.has(action)) return 'PERIOD_CONTROL';
  if (EXPORT.has(action)) return 'EXPORT';
  if (action.includes('_EXCEPTION_')) return 'EXCEPTION';
  if (action.endsWith('_REVERSED') || action.endsWith('_VOIDED') || action.endsWith('_UNMATCHED')) return 'CORRECTION';
  if (action.endsWith('_DELETED')) return 'DELETION';
  return 'ROUTINE';
}
