import { describe, expect, it } from 'vitest';
import { auditActionGroup } from './audit-group.util';

describe('auditActionGroup', () => {
  it('puts reversals, voids and unmatches under corrections', () => {
    for (const action of ['RECEIPT_REVERSED', 'INVOICE_VOIDED', 'EMPLOYEE_EXPENSE_CLAIM_REIMBURSEMENT_REVERSED', 'BANK_STATEMENT_UNMATCHED', 'TDS_CERTIFICATE_UNMATCHED', 'LEDGER_OPENING_BALANCE_VOIDED']) {
      expect(auditActionGroup(action), action).toBe('CORRECTION');
    }
  });

  it('separates period controls, access changes, sign-in problems, exports, exceptions and deletions', () => {
    expect(['LOCK', 'REOPEN', 'SOFT_CLOSE', 'BANK_RECONCILIATION_LOCKED', 'BANK_RECONCILIATION_REOPENED'].map(auditActionGroup)).toEqual(Array(5).fill('PERIOD_CONTROL'));
    expect(['ROLE_PERMISSIONS_CHANGED', 'USER_ROLE_ASSIGNED', 'USER_PERMISSION_OVERRIDE_CLEARED', 'USER_DISABLED', 'SESSION_FAMILY_REVOKED'].map(auditActionGroup)).toEqual(Array(5).fill('ACCESS'));
    expect(['USER_LOGIN_FAILED', 'USER_LOCKED_OUT'].map(auditActionGroup)).toEqual(['SIGN_IN', 'SIGN_IN']);
    expect(['REPORT_EXPORTED', 'DOCUMENT_DOWNLOADED'].map(auditActionGroup)).toEqual(['EXPORT', 'EXPORT']);
    expect(['BANK_STATEMENT_EXCEPTION_MARKED', 'BANK_STATEMENT_EXCEPTION_APPROVED'].map(auditActionGroup)).toEqual(['EXCEPTION', 'EXCEPTION']);
    expect(['DOCUMENT_DELETED', 'LEGAL_ENTITY_DELETED'].map(auditActionGroup)).toEqual(['DELETION', 'DELETION']);
  });

  it('treats ordinary postings, approvals and successful sign-ins as routine', () => {
    for (const action of ['RECEIPT_POSTED', 'VENDOR_BILL_APPROVED', 'USER_LOGIN_SUCCEEDED', 'SESSION_REFRESHED', 'BANK_RECONCILIATION_RECONCILED', 'PAYMENT_REQUEST_CANCELLED']) {
      expect(auditActionGroup(action), action).toBe('ROUTINE');
    }
  });
});
