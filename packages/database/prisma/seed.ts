/**
 * Phase 2 seed script — organization, permission catalog, system roles,
 * and one bootstrap Admin user. Idempotent (safe to re-run): every step
 * upserts rather than blindly inserting.
 *
 * The bootstrap Admin user exists only because "no public self-
 * registration, admin-invited users" (docs/09) needs a first admin to
 * invite everyone else — this is a seed-time exception, documented as
 * such, not a general auth bypass. Its password comes from
 * SEED_ADMIN_PASSWORD in the environment and is never written in code
 * (ADR-192); without it a random one is used and the admin resets it
 * through Forgot password.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { uuidv7 as generateId } from 'uuidv7';

const prisma = new PrismaClient();

const PERMISSION_KEYS = [
  'organization.read',
  'legal_entity.read',
  'legal_entity.manage',
  // ADR-172: sees every legal entity's data. Without it a user sees only the
  // legal entity on their own employee record. Admin only.
  'legal_entity.access_all',
  'financial_year.read',
  'financial_year.manage',
  'accounting_period.lock',
  'user.read',
  'user.manage',
  // ADR-174: log in as another user to see what they see. Admin only.
  'user.impersonate',
  'role.read',
  'employee.read',
  'employee.manage',
  // ADR-175: an employee's salary, salary history and the salary cost an
  // allocation carries. Confidential: Admin, Accountant and CEO only.
  'employee.read_salary',
  'master.read',
  'master.manage',
  'document.read',
  'document.upload',
  'document.manage',
  'document.download',
  'audit.read',
  'party.read',
  'client.read',
  'client.create',
  'client.update',
  'client.export',
  'lead.read',
  'lead.create',
  'lead.update',
  'lead.export',
  'introducer.read',
  'introducer.create',
  'introducer.update',
  'project.read',
  'project.read_all',
  'project.read_financials',
  'project.create',
  'project.update',
  'project.manage_team',
  'project.export',
  'project.change_stage',
  'project.change_status',
  'project_progress.create',
  'chart_of_account.read',
  'chart_of_account.manage',
  'milestone.read',
  'milestone.create',
  'milestone.update',
  'milestone.mark_achieved',
  'milestone.cancel',
  'milestone.skip_installment',
  'payment_alert.read',
  'payment_alert.snooze',
  'journal.read',
  'journal.reverse',
  'ledger_opening_balance.set',
  'invoice.read',
  'invoice.create',
  'invoice.update',
  'invoice.finalize',
  'invoice.void',
  'invoice.export',
  'receipt.read',
  'receipt.post',
  'receipt.reverse',
  'deduction.release',
  'credit_debit_note.read',
  'credit_debit_note.create',
  'credit_debit_note.update',
  'credit_debit_note.finalize',
  'credit_debit_note.void',
  'vendor.read',
  'vendor.manage',
  'vendor_bill.read',
  'vendor_bill.create',
  'vendor_bill.approve',
  'vendor_bill.self_approve',
  'vendor_bill.void',
  'payment_request.read',
  'payment_request.create',
  'payment_request.approve',
  'payment_request.revoke',
  'payment_request.self_approve',
  'vendor_payment.read',
  'vendor_payment.post',
  'vendor_payment.reverse',
  'employee_advance.read',
  'employee_advance.create',
  'employee_advance.reverse',
  'employee_claim.read',
  'employee_claim.create',
  'employee_claim.approve',
  'employee_claim.self_approve',
  'employee_claim.reimburse',
  'employee_claim.reverse',
  'direct_expense.read',
  'direct_expense.create',
  'direct_expense.post',
  'direct_expense.reverse',
  // Phase 6.8 (Subscription & Server, ADR-088). CardAccount CRUD reuses
  // legal_entity.read/manage (same boundary as BankAccount, bundled into
  // the same organization-setup module) since it is the same class of
  // financial-infrastructure master, not a workflow entity of its own.
  // Settling a Credit Card bill is a real money-movement posting action,
  // so it gets its own narrow permission, same reasoning as direct_expense.post
  // being separate from direct_expense.read/create.
  'card_account.settle',
  // The subscription.* and server.* keys went with the Server and
  // Subscription modules (ADR-169): server and subscription bills are direct
  // expenses now, under the direct_expense.* keys.
  // Phase 7.1 (ADR-091) -- product/item master. `manage` follows the
  // Admin-only posture of master.manage; `read` goes everywhere master.read
  // already does, since every later inventory screen needs to name an item.
  'inventory_item.read',
  'inventory_item.manage',
  // Phase 7.2 (ADR-092) -- reading the stock ledger is separate from
  // receiving stock into it, following this codebase's own rule that a
  // money-moving action always gets its own narrow key.
  'inventory.read',
  'inventory.receive',
  // Phase 7.3 (ADR-093) -- issuing stock to a project posts Dr Project
  // Material Cost / Cr Inventory, so it is a separate narrow key from
  // `inventory.receive` for the same reason receive is separate from read.
  'inventory.consume',
  // Phase 7.4 (ADR-094) -- salary import. docs/04 section 13 names
  // `salary_import.create/commit` as two keys: previewing an uploaded sheet
  // is a data-entry step, committing it posts a month of salary cost to the
  // ledger. `read` is added alongside for the list/history screen, as every
  // other module in this codebase has.
  'salary_import.read',
  'salary_import.create',
  'salary_import.commit',
  // Phase 7 integration (ADR-100) -- paying the salary payable the import
  // recognised. Its own narrow key because it moves money out of a bank
  // account, the same rule that separates `introducer_fee.pay` from
  // `introducer_fee.create`.
  'salary_import.pay',
  // Phase 7.5 (ADR-095) -- monthly allocation, and the project manpower cost
  // derived from it. docs/04 section 13 names `employee_allocation.manage`
  // for entry and `employee_allocation.read` / `project_cost.read` for the
  // two read screens.
  'employee_allocation.read',
  'employee_allocation.manage',
  'project_cost.read',
  // Phase 7.6 (ADR-096) -- introducer commission. docs/04 section 15 names
  // `introducer_fee.read/export/create/pay`; export is not built this slice
  // (no export action exists), so it is deliberately not in the catalogue.
  // `create` covers the agreement and the accrual; `pay` is the separate,
  // money-moving key, following this codebase's rule throughout.
  'introducer_fee.read',
  'introducer_fee.create',
  'introducer_fee.pay',
  // Phase 8 (ADR-108) -- reports. One read key per report category (the
  // user's choice), each slice adding its own; plus `report.export` for the
  // Excel/PDF downloads, which are audited (docs/09). Exporting also needs
  // the report's own read key, so the export key alone opens nothing.
  'report.receivables.read',
  // Phase 8.2 (ADR-109) -- Accrual Project P&L and Cost to Company.
  'report.profitability.read',
  // Phase 8.4 (ADR-111) -- GST Output, Input, Net and the document register.
  // Company tax, so not granted to the Project Manager.
  'report.gst.read',
  // Phase 8.5a (ADR-112) -- TDS certificates, their matching to client
  // deductions, and the TDS Inward / reconciliation reports. Company tax
  // compliance: Accountant, not Project Manager.
  'tds_certificate.read',
  'tds_certificate.manage',
  'report.tds.read',
  // Phase 8.5b (ADR-113) -- TDS/GST-TDS deposits (challans). Posting moves
  // money out of the bank: Accountant only.
  'tds_deposit.read',
  'tds_deposit.post',
  // Phase 8.6a (ADR-114) -- bank statement import and reconciliation. Approving
  // an exception is its own key: the approver must also differ from the
  // person who marked it (docs/09 maker-checker).
  'bank_reconciliation.read',
  'bank_reconciliation.manage',
  'bank_reconciliation.approve',
  // Phase 8.6b (ADR-115) -- the Cash Flow report.
  'report.cash.read',
  // Phase 8.7 (ADR-116) -- Payables Aging, Vendor Payments, Expenses, Reimbursements, Employee Advances.
  'report.payables.read',
  // Phase 8.8 (ADR-117) -- operations reports (introducer, penalties, holds, ...).
  'report.operations.read',
  'report.export',
  // Phase 8.9a (ADR-119) -- the main Dashboard; each card also needs its report's read key.
  'dashboard.read',
  // Phase 8.9b (ADR-120) -- Audit Activity and Exceptions.
  'report.controls.read',
] as const;

// Project Manager and Hardware Manager are both employees. They share the
// store and the project team: stock, purchase bills, team members,
// and employee allocation. They do not see the books, leads, invoices, or reports.
const STAFF_OPERATIONS_PERMISSIONS = [
  'organization.read',
  'document.read',
  'document.upload',
  'document.manage',
  'document.download',
  'master.read',
  'employee.read',
  'project.read',
  'project.read_all',
  'project.manage_team',
  // ADR-173: the project's progress, milestones and dues, which the project
  // page shows; still no invoices, receipts or books.
  'project_progress.create',
  'milestone.read',
  'payment_alert.read',
  'employee_allocation.read',
  'employee_allocation.manage',
  'vendor.read',
  'vendor.manage',
  'vendor_bill.read',
  'vendor_bill.create',
  'payment_request.read',
  'payment_request.create',
  'inventory_item.read',
  'inventory_item.manage',
  'inventory.read',
  'inventory.receive',
  'inventory.consume',
  'employee_claim.create',
] as const;

const PROJECT_MANAGER_PERMISSIONS = new Set(STAFF_OPERATIONS_PERMISSIONS);
const HARDWARE_MANAGER_PERMISSIONS = new Set(STAFF_OPERATIONS_PERMISSIONS);

// Starter custom roles (isSystem=false) covering common personas — editable
// and deletable via the Users/Roles UI (ADR-045). Admin/Accountant/Project
// Manager stay isSystem=true baselines.
const ADMIN_STAFF_PERMISSIONS = new Set([
  'organization.read',
  'inventory.read',
  'inventory_item.read',
  'master.read',
  'master.manage',
  'document.read',
  'document.upload',
  'document.manage',
  'document.download',
  'employee.read',
  'user.read',
  'client.read',
  'client.create',
  'client.update',
  'lead.read',
  'lead.create',
  'lead.update',
  'introducer.read',
  'project.read',
  'project.read_all',
  'milestone.read',
  'payment_alert.read',
  'invoice.read',
  'receipt.read',
  'credit_debit_note.read',
  'vendor.read',
  'vendor.manage',
  'vendor_bill.read',
  'payment_request.read',
  'vendor_payment.read',
  'employee_advance.read',
  'employee_claim.read',
  'employee_claim.create',
  'direct_expense.read',
]);
// project.read is granted here so a plain Employee can select a project to
// raise a vendor bill against — scoped to their assigned projects only
// (they lack project.read_all), and confirmed (Phase 6.1 plan) not to leak
// any Milestone/Invoice/Receipt/PaymentAlert/CreditDebitNote data, since
// each of those is gated by its own separate .read key this role still
// lacks; it only unlocks projects.list/getDetail/listTeamMembers/
// listProgress. vendor_bill.{read,create} (no approve/self_approve/void) is
// a necessary parity grant from when Purchase Request was merged into
// Vendor Bill (Phase 6.4, docs/12 ADR-079) — Employee previously held
// purchase_request.{read,create} and would otherwise silently lose the
// ability to raise a purchase at all.
// ADR-173: an employee adds and opens documents but does not delete or
// re-file them (document.manage).
const EMPLOYEE_PERMISSIONS = new Set([
  'organization.read',
  'document.read',
  'document.upload',
  'document.download',
  'project.read',
  'vendor.read',
  'vendor_bill.read',
  'vendor_bill.create',
  'employee_claim.create',
]);

// Official GST state/UT codes (CBIC). Seeded in full since gst_registrations
// (Phase 2.6) FKs to states.id and validates gstin against this code. Code 25
// (former Daman & Diu) is intentionally omitted — merged into 26 (Dadra &
// Nagar Haveli and Daman & Diu) since 2020 and never re-issued.
const STATES: Array<{ name: string; code: string; gstStateCode: string }> = [
  { name: 'Jammu and Kashmir', code: 'JK', gstStateCode: '01' },
  { name: 'Himachal Pradesh', code: 'HP', gstStateCode: '02' },
  { name: 'Punjab', code: 'PB', gstStateCode: '03' },
  { name: 'Chandigarh', code: 'CH', gstStateCode: '04' },
  { name: 'Uttarakhand', code: 'UK', gstStateCode: '05' },
  { name: 'Haryana', code: 'HR', gstStateCode: '06' },
  { name: 'Delhi', code: 'DL', gstStateCode: '07' },
  { name: 'Rajasthan', code: 'RJ', gstStateCode: '08' },
  { name: 'Uttar Pradesh', code: 'UP', gstStateCode: '09' },
  { name: 'Bihar', code: 'BR', gstStateCode: '10' },
  { name: 'Sikkim', code: 'SK', gstStateCode: '11' },
  { name: 'Arunachal Pradesh', code: 'AR', gstStateCode: '12' },
  { name: 'Nagaland', code: 'NL', gstStateCode: '13' },
  { name: 'Manipur', code: 'MN', gstStateCode: '14' },
  { name: 'Mizoram', code: 'MZ', gstStateCode: '15' },
  { name: 'Tripura', code: 'TR', gstStateCode: '16' },
  { name: 'Meghalaya', code: 'ML', gstStateCode: '17' },
  { name: 'Assam', code: 'AS', gstStateCode: '18' },
  { name: 'West Bengal', code: 'WB', gstStateCode: '19' },
  { name: 'Jharkhand', code: 'JH', gstStateCode: '20' },
  { name: 'Odisha', code: 'OD', gstStateCode: '21' },
  { name: 'Chhattisgarh', code: 'CG', gstStateCode: '22' },
  { name: 'Madhya Pradesh', code: 'MP', gstStateCode: '23' },
  { name: 'Gujarat', code: 'GJ', gstStateCode: '24' },
  { name: 'Dadra and Nagar Haveli and Daman and Diu', code: 'DNHDD', gstStateCode: '26' },
  { name: 'Maharashtra', code: 'MH', gstStateCode: '27' },
  { name: 'Karnataka', code: 'KA', gstStateCode: '29' },
  { name: 'Goa', code: 'GA', gstStateCode: '30' },
  { name: 'Lakshadweep', code: 'LD', gstStateCode: '31' },
  { name: 'Kerala', code: 'KL', gstStateCode: '32' },
  { name: 'Tamil Nadu', code: 'TN', gstStateCode: '33' },
  { name: 'Puducherry', code: 'PY', gstStateCode: '34' },
  { name: 'Andaman and Nicobar Islands', code: 'AN', gstStateCode: '35' },
  { name: 'Telangana', code: 'TG', gstStateCode: '36' },
  { name: 'Andhra Pradesh', code: 'AP', gstStateCode: '37' },
  { name: 'Ladakh', code: 'LA', gstStateCode: '38' },
];

// Every district and every urban local body (as a city) in India, from the
// Local Government Directory — ADR-149. Regenerate the file with
// scripts/build-india-geography.mjs; do not edit it by hand.
const INDIA_GEOGRAPHY = JSON.parse(readFileSync(join(__dirname, 'data', 'india-geography.json'), 'utf8')) as {
  snapshot: string;
  states: Record<string, Record<string, string[]>>;
};

// LGD writes "Jammu And Kashmir" and "The Dadra And Nagar Haveli And ...".
const stateKey = (name: string) => name.trim().toLowerCase().replace(/^the /, '');
// Matches the lower(trim(name)) unique indexes on districts and cities.
const geographyKey = (name: string) => name.trim().toLowerCase();

const CLIENT_TYPES: Array<{ code: string; name: string }> = [
  { code: 'enterprise', name: 'Enterprise / Corporate' },
  { code: 'smb_startup', name: 'SMB / Startup' },
  { code: 'individual', name: 'Individual' },
  { code: 'non_profit', name: 'Non-profit / Institution' },
];

// The five system-defined Chart of Accounts roots (ADR-062) — the only
// AccountGroup rows ever created with a null parentGroupId. Every other
// group is created via the API and always requires an active parent.
const ACCOUNT_GROUP_ROOTS: Array<{
  code: string;
  name: string;
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  normalBalance: 'DEBIT' | 'CREDIT';
}> = [
  { code: 'ASSETS', name: 'Assets', accountType: 'ASSET', normalBalance: 'DEBIT' },
  { code: 'LIABILITIES', name: 'Liabilities', accountType: 'LIABILITY', normalBalance: 'CREDIT' },
  { code: 'EQUITY', name: 'Equity', accountType: 'EQUITY', normalBalance: 'CREDIT' },
  { code: 'INCOME', name: 'Income', accountType: 'INCOME', normalBalance: 'CREDIT' },
  { code: 'EXPENSES', name: 'Expenses', accountType: 'EXPENSE', normalBalance: 'DEBIT' },
];

// Custom AccountGroups actually created through the Chart of Accounts screen
// (captured from the running dev database on 2026-08-08) — each one inherits
// its accountType/normalBalance from parentCode, exactly like ChartOfAccountsService
// enforces for any group created via the API. Re-added here so a fresh
// database/reseed reproduces the same working set instead of starting empty.
const ACCOUNT_GROUP_CUSTOM: Array<{ code: string; name: string; parentCode: string }> = [
  { code: 'BANK_ACCOUNTS', name: 'Bank Accounts', parentCode: 'ASSETS' },
  { code: 'CLIENT_RECEIVABLES', name: 'Client Receivables', parentCode: 'ASSETS' },
  { code: 'SECURITY_DEPOSITS', name: 'Security Deposits', parentCode: 'ASSETS' },
  { code: 'TAX_RECOVERABLE', name: 'Tax Recoverable', parentCode: 'ASSETS' },
  { code: 'TAX_PAYABLE', name: 'Tax Payable', parentCode: 'LIABILITIES' },
  { code: 'PROJECT_REVENUE', name: 'Project Revenue', parentCode: 'INCOME' },
  { code: 'ADMINISTRATIVE_EXPENSES', name: 'Administrative Expenses', parentCode: 'EXPENSES' },
  { code: 'OTHER_RECEIVABLES', name: 'Other Receivables', parentCode: 'ASSETS' },
  // Phase 6.2 (Vendor Bill, ADR-075).
  { code: 'ACCOUNTS_PAYABLE', name: 'Accounts Payable', parentCode: 'LIABILITIES' },
  { code: 'VENDOR_EXPENSES', name: 'Vendor & Operating Expenses', parentCode: 'EXPENSES' },
  // Phase 6.8 (ADR-088) -- a Credit Card purchase is a liability owed to the
  // card issuer, distinct from Accounts Payable owed to a vendor. Admins
  // create one LedgerAccount here per CardAccount of type CREDIT_CARD, the
  // same way they already create one per BankAccount under BANK_ACCOUNTS.
  { code: 'CREDIT_CARD_PAYABLE', name: 'Credit Card Payable', parentCode: 'LIABILITIES' },
  // Phase 7.2 (ADR-092) -- stock on hand is a current asset. One account
  // for the whole of inventory, deliberately not one per product category:
  // docs/06's "Finalize vendor bill for inventory" names a single Inventory
  // debit, and per-category accounts would make stock value reconcile to a
  // set of balances rather than to one.
  { code: 'INVENTORY_ASSETS', name: 'Inventory', parentCode: 'ASSETS' },
  // Phase 7.3 (ADR-093) -- costs charged directly to a project, as opposed
  // to the vendor-expense categories above which may or may not carry a
  // project. Consumption's "Project Material Cost" is the first member.
  { code: 'PROJECT_COSTS', name: 'Project Costs', parentCode: 'EXPENSES' },
  // Phase 7.4 (ADR-094) -- docs/06 "Salary project costing": the import
  // posts gross salary cost against a payable owed to employees, which is
  // a different counterparty from a vendor (ACCOUNTS_PAYABLE) and from a
  // card issuer (CREDIT_CARD_PAYABLE).
  { code: 'EMPLOYEE_COSTS', name: 'Employee Costs', parentCode: 'EXPENSES' },
  { code: 'EMPLOYEE_PAYABLES', name: 'Employee Payables', parentCode: 'LIABILITIES' },
];

// Ledger accounts actually created through the Chart of Accounts screen
// (captured alongside ACCOUNT_GROUP_CUSTOM above) — only the currently
// active ones; the one stray deactivated duplicate found in the live
// database ("BANK-ACCOUNTS" under ASSETS) is deliberately not reproduced.
const LEDGER_ACCOUNT_CUSTOM: Array<{ code: string; name: string; groupCode: string }> = [
  { code: 'HDFC_CURRENT_ACCOUNT', name: 'HDFC Current Account', groupCode: 'BANK_ACCOUNTS' },
  { code: 'ACCOUNTS_RECEIVABLE', name: 'Accounts Receivable', groupCode: 'CLIENT_RECEIVABLES' },
  { code: 'SECURITY_DEPOSIT_RECOVERABLE', name: 'Security Deposit Recoverable', groupCode: 'SECURITY_DEPOSITS' },
  { code: 'TDS_RECEIVABLE', name: 'TDS Receivable', groupCode: 'TAX_RECOVERABLE' },
  { code: 'GST_TDS_RECEIVABLE_CGST', name: 'GST-TDS Receivable — CGST', groupCode: 'TAX_RECOVERABLE' },
  { code: 'GST_TDS_RECEIVABLE_SGST', name: 'GST-TDS Receivable — SGST', groupCode: 'TAX_RECOVERABLE' },
  { code: 'GST_TDS_RECEIVABLE_IGST', name: 'GST-TDS Receivable — IGST', groupCode: 'TAX_RECOVERABLE' },
  { code: 'GST_PAYABLE', name: 'GST Payable', groupCode: 'TAX_PAYABLE' },
  { code: 'OUTPUT_CGST_PAYABLE', name: 'Output CGST Payable', groupCode: 'TAX_PAYABLE' },
  { code: 'OUTPUT_SGST_PAYABLE', name: 'Output SGST Payable', groupCode: 'TAX_PAYABLE' },
  { code: 'OUTPUT_IGST_PAYABLE', name: 'Output IGST Payable', groupCode: 'TAX_PAYABLE' },
  // Phase 6.5 (Vendor Payment, ADR-080) -- docs/12 ADR-080: TDS/GST-TDS
  // withheld from a vendor payment is a NEW liability owed to the
  // government later (Cr), the flip of TDS_RECEIVABLE/GST_TDS_RECEIVABLE_*
  // above (which are Dr, money owed back to this org by a client).
  { code: 'TDS_PAYABLE', name: 'TDS Payable', groupCode: 'TAX_PAYABLE' },
  { code: 'GST_TDS_PAYABLE_CGST', name: 'GST-TDS Payable — CGST', groupCode: 'TAX_PAYABLE' },
  { code: 'GST_TDS_PAYABLE_SGST', name: 'GST-TDS Payable — SGST', groupCode: 'TAX_PAYABLE' },
  { code: 'GST_TDS_PAYABLE_IGST', name: 'GST-TDS Payable — IGST', groupCode: 'TAX_PAYABLE' },
  { code: 'SOFTWARE_PROJECT_REVENUE', name: 'Software Project Revenue', groupCode: 'PROJECT_REVENUE' },
  { code: 'PENALTY_REVENUE_DEDUCTION', name: 'Penalty Revenue Deduction', groupCode: 'PROJECT_REVENUE' },
  { code: 'OFFICE_RENT', name: 'Office Rent', groupCode: 'ADMINISTRATIVE_EXPENSES' },
  { code: 'HOLD_RECEIVABLE', name: 'Hold Receivable', groupCode: 'OTHER_RECEIVABLES' },
  { code: 'RETENTION_RECEIVABLE', name: 'Retention Receivable', groupCode: 'OTHER_RECEIVABLES' },
  { code: 'DISPUTED_DEDUCTION_RECEIVABLE', name: 'Disputed Deduction Receivable', groupCode: 'OTHER_RECEIVABLES' },
  // Phase 6.6 (Employee Advance & Expense Claim, ADR-081) -- a single
  // bidirectional control account per employee (see schema.prisma's own
  // EmployeeExpenseClaim doc comment for why one account, not two).
  { code: 'EMPLOYEE_ADVANCE_RECEIVABLE', name: 'Employee Advance Receivable', groupCode: 'OTHER_RECEIVABLES' },
  // Offsetting account for every ledger opening balance posted (Phase 5,
  // "Ledger Account Opening Balances") -- lives directly under the EQUITY
  // root, no custom group needed.
  { code: 'OPENING_BALANCE_EQUITY', name: 'Opening Balance Equity', groupCode: 'EQUITY' },
  // Phase 6.2 (Vendor Bill, ADR-075) -- docs/06 "Finalize vendor bill for
  // expense": Dr Expense/Input CGST/SGST/IGST Receivable; Cr Accounts
  // Payable -- Vendor.
  { code: 'ACCOUNTS_PAYABLE_VENDOR', name: 'Accounts Payable — Vendor', groupCode: 'ACCOUNTS_PAYABLE' },
  { code: 'INPUT_CGST_RECEIVABLE', name: 'Input CGST Receivable', groupCode: 'TAX_RECOVERABLE' },
  { code: 'INPUT_SGST_RECEIVABLE', name: 'Input SGST Receivable', groupCode: 'TAX_RECOVERABLE' },
  { code: 'INPUT_IGST_RECEIVABLE', name: 'Input IGST Receivable', groupCode: 'TAX_RECOVERABLE' },
  // Phase 6.6 (Employee Advance & Expense Claim, ADR-081) -- a deliberately
  // generic, undifferentiated account distinct from the precise CGST/SGST/
  // IGST split above, since this slice's own GST credit is a flat,
  // user-entered amount (confirmed via AskUserQuestion), not a computed split.
  { code: 'INPUT_GST_RECEIVABLE_EXPENSE', name: 'Input GST Receivable — Expense Claims', groupCode: 'TAX_RECOVERABLE' },
  // One leaf per vendor-relevant ExpenseCategory (mapped below via
  // EXPENSE_CATEGORIES' own ledgerAccountCode), plus one fallback default
  // for any category left unmapped.
  { code: 'HARDWARE_EQUIPMENT_EXPENSE', name: 'Hardware / Equipment Expense', groupCode: 'VENDOR_EXPENSES' },
  { code: 'SOFTWARE_LICENSES_EXPENSE', name: 'Software Licenses Expense', groupCode: 'VENDOR_EXPENSES' },
  { code: 'HOSTING_CLOUD_INFRA_EXPENSE', name: 'Hosting / Cloud / Infra Expense', groupCode: 'VENDOR_EXPENSES' },
  { code: 'SUB_CONTRACTOR_EXPENSE', name: 'Sub-contractor / Vendor Expense', groupCode: 'VENDOR_EXPENSES' },
  { code: 'TRAVEL_CONVEYANCE_EXPENSE', name: 'Travel & Conveyance Expense', groupCode: 'VENDOR_EXPENSES' },
  { code: 'PROFESSIONAL_CONSULTANCY_EXPENSE', name: 'Professional / Consultancy Expense', groupCode: 'VENDOR_EXPENSES' },
  { code: 'OFFICE_ADMINISTRATIVE_EXPENSE', name: 'Office / Administrative Expense', groupCode: 'VENDOR_EXPENSES' },
  { code: 'MARKETING_BD_EXPENSE', name: 'Marketing / BD Expense', groupCode: 'VENDOR_EXPENSES' },
  { code: 'STATUTORY_COMPLIANCE_EXPENSE', name: 'Statutory & Compliance Expense', groupCode: 'VENDOR_EXPENSES' },
  { code: 'BANK_CHARGES_EXPENSE', name: 'Bank Charges Expense', groupCode: 'VENDOR_EXPENSES' },
  { code: 'OTHER_EXPENSES', name: 'Other Expenses', groupCode: 'VENDOR_EXPENSES' },
  // Phase 7.2 (ADR-092) -- docs/06 "Finalize vendor bill for inventory":
  // Dr Inventory (taxable value plus ineligible tax); Cr Accounts Payable.
  // The sum of every item's latest movement balance_value_amount must equal
  // this account's balance -- Phase 7's own exit criterion.
  { code: 'INVENTORY', name: 'Inventory', groupCode: 'INVENTORY_ASSETS' },
  // Phase 7.3 (ADR-093) -- docs/06 "Inventory / Project consumption":
  // Dr Project Material Cost; Cr Inventory, valued at weighted average.
  // Every posting to this account carries a project dimension on its
  // journal line, which is what lets Project Cost report material spend
  // without a second source of truth.
  { code: 'PROJECT_MATERIAL_COST', name: 'Project Material Cost', groupCode: 'PROJECT_COSTS' },
  // Phase 7.6 (ADR-096) -- docs/06 "Introducer": accrual is Dr Introducer
  // Commission Expense / Cr Introducer Payable, and an over-payment lands in
  // Introducer Advance Receivable rather than driving the payable negative.
  // The expense sits under PROJECT_COSTS because a commission is always
  // earned on a specific project; the payable sits under the existing
  // ACCOUNTS_PAYABLE group because it is exactly that, owed to a different
  // kind of counterparty; and the advance joins EMPLOYEE_ADVANCE_RECEIVABLE
  // under OTHER_RECEIVABLES, the same shape for the same reason.
  { code: 'INTRODUCER_COMMISSION_EXPENSE', name: 'Introducer Commission Expense', groupCode: 'PROJECT_COSTS' },
  { code: 'INTRODUCER_PAYABLE', name: 'Introducer Payable', groupCode: 'ACCOUNTS_PAYABLE' },
  { code: 'INTRODUCER_ADVANCE_RECEIVABLE', name: 'Introducer Advance Receivable', groupCode: 'OTHER_RECEIVABLES' },
  // Phase 7.4 (ADR-094) -- docs/06 "Salary project costing": the import
  // creates the gross salary cost/payable posting. Allocation (Slice 7.5)
  // deliberately posts NOTHING against these accounts: it moves cost
  // analytically "without changing total salary expense", so this account's
  // balance is always the full imported gross for the period.
  { code: 'SALARIES_WAGES_EXPENSE', name: 'Salaries & Wages Expense', groupCode: 'EMPLOYEE_COSTS' },
  { code: 'SALARY_PAYABLE', name: 'Salary Payable', groupCode: 'EMPLOYEE_PAYABLES' },
];

const LEAD_TYPES: Array<{ code: string; name: string }> = [
  { code: 'new_business', name: 'New Business' },
  { code: 'upsell_cross_sell', name: 'Upsell / Cross-sell' },
  { code: 'amc_renewal', name: 'AMC / Renewal' },
  { code: 'change_request_extension', name: 'Change Request / Extension' },
  { code: 'rfp_rfq_response', name: 'RFP / RFQ Response' },
  { code: 'partner_sub_contract', name: 'Partner / Sub-contract' },
];

const LEAD_SOURCES: Array<{ code: string; name: string }> = [
  { code: 'referral', name: 'Referral' },
  { code: 'existing_client', name: 'Existing Client' },
  { code: 'cold_outreach', name: 'Cold Outreach' },
  { code: 'industry_event_expo', name: 'Industry Event / Expo' },
  { code: 'website_inbound', name: 'Website / Inbound' },
  { code: 'social_media', name: 'Social Media / LinkedIn' },
  { code: 'partner', name: 'Partner' },
];

const PROJECT_TYPES: Array<{ code: string; name: string }> = [
  { code: 'software_dev_fixed_price', name: 'Software Dev (Fixed Price)' },
  { code: 'software_dev_tandm', name: 'Software Dev (T&M)' },
  { code: 'supply_and_installation', name: 'Supply & Installation' },
  { code: 'annual_maintenance_contract', name: 'Annual Maintenance Contract' },
  { code: 'system_integration', name: 'System Integration' },
  { code: 'consultancy_advisory', name: 'Consultancy / Advisory' },
  { code: 'saas_subscription', name: 'SaaS / Subscription' },
  { code: 'facilities_manpower', name: 'Facilities / Manpower' },
];

const DOCUMENT_CATEGORIES: Array<{ code: string; name: string }> = [
  { code: 'proposal_quotation', name: 'Proposal / Quotation' },
  { code: 'purchase_work_order', name: 'Purchase Order / Work Order' },
  { code: 'agreement_contract', name: 'Agreement / Contract' },
  { code: 'invoice', name: 'Invoice' },
  { code: 'completion_signoff', name: 'Completion / Sign-off' },
  { code: 'statutory_compliance', name: 'Statutory / Compliance' },
  { code: 'company_credentials', name: 'Company Credentials' },
  { code: 'correspondence', name: 'Correspondence' },
];

// units_of_measure (Phase 6.2 polish, ADR-076) — a 13th generic MasterTypeKey,
// used by VendorBillLine.unitOfMeasureId. 'qty' is given the lowest
// sortOrder so it lists first — the frontend also resolves its default
// line-editor selection by code==='qty' directly, not by list position.
const UNITS_OF_MEASURE: Array<{ code: string; name: string; sortOrder: number }> = [
  { code: 'qty', name: 'Qty', sortOrder: 0 },
  { code: 'ltr', name: 'Litre', sortOrder: 1 },
  { code: 'mtr', name: 'Meter', sortOrder: 2 },
  { code: 'cm', name: 'Centimeter', sortOrder: 3 },
  { code: 'inch', name: 'Inch', sortOrder: 4 },
  { code: 'feet', name: 'Feet', sortOrder: 5 },
];

// ledgerAccountCode (Phase 6.2, ADR-075) resolves ExpenseCategory.ledgerAccountId
// after ledger accounts exist. Left unset for categories this slice
// deliberately doesn't map: salaries_and_wages (Phase 7 payroll concern) --
// VendorBillsService falls back to OTHER_EXPENSES for any unmapped category.
// product_categories (Phase 7.1, ADR-091) -- a 15th generic MasterTypeKey
// classifying InventoryItem rows. Deliberately carries no ledger-account
// linkage (unlike EXPENSE_CATEGORIES below): inventory always debits the
// single INVENTORY account regardless of category, per docs/06's
// "Finalize vendor bill for inventory" rule.
const PRODUCT_CATEGORIES: Array<{ code: string; name: string; sortOrder: number }> = [
  { code: 'hardware', name: 'Hardware', sortOrder: 0 },
  { code: 'networking', name: 'Networking', sortOrder: 1 },
  { code: 'peripherals', name: 'Peripherals', sortOrder: 2 },
  { code: 'consumables', name: 'Consumables', sortOrder: 3 },
  { code: 'cables_accessories', name: 'Cables & Accessories', sortOrder: 4 },
  { code: 'spares', name: 'Spares', sortOrder: 5 },
  { code: 'other', name: 'Other', sortOrder: 6 },
];

// Phase 7.5 (ADR-095) -- the approved non-project destinations for an
// employee's month (docs/16 section 7.6: "internal/bench targets").
// Deliberately carries no ledger account: allocation posts NO journal, so
// there would be nothing for one to be used for.
const ALLOCATION_TARGETS: Array<{ code: string; name: string; sortOrder: number }> = [
  { code: 'bench', name: 'Bench / Unallocated', sortOrder: 0 },
  { code: 'internal_project', name: 'Internal Project', sortOrder: 1 },
  { code: 'presales_bidding', name: 'Pre-sales & Bidding', sortOrder: 2 },
  { code: 'training', name: 'Training', sortOrder: 3 },
  { code: 'leave', name: 'Leave', sortOrder: 4 },
  { code: 'administration', name: 'Administration & Overhead', sortOrder: 5 },
];

const EXPENSE_CATEGORIES: Array<{ code: string; name: string; ledgerAccountCode?: string }> = [
  { code: 'bank_charges', name: 'Bank Charges', ledgerAccountCode: 'BANK_CHARGES_EXPENSE' },
  { code: 'salaries_and_wages', name: 'Salaries & Wages' },
  { code: 'sub_contractor_vendor', name: 'Sub-contractor / Vendor', ledgerAccountCode: 'SUB_CONTRACTOR_EXPENSE' },
  { code: 'hardware_equipment', name: 'Hardware / Equipment', ledgerAccountCode: 'HARDWARE_EQUIPMENT_EXPENSE' },
  { code: 'software_licenses', name: 'Software Licenses', ledgerAccountCode: 'SOFTWARE_LICENSES_EXPENSE' },
  { code: 'hosting_cloud_infra', name: 'Hosting / Cloud / Infra', ledgerAccountCode: 'HOSTING_CLOUD_INFRA_EXPENSE' },
  { code: 'travel_and_conveyance', name: 'Travel & Conveyance', ledgerAccountCode: 'TRAVEL_CONVEYANCE_EXPENSE' },
  { code: 'statutory_and_compliance', name: 'Statutory & Compliance', ledgerAccountCode: 'STATUTORY_COMPLIANCE_EXPENSE' },
  { code: 'professional_consultancy', name: 'Professional / Consultancy', ledgerAccountCode: 'PROFESSIONAL_CONSULTANCY_EXPENSE' },
  { code: 'office_administrative', name: 'Office / Administrative', ledgerAccountCode: 'OFFICE_ADMINISTRATIVE_EXPENSE' },
  { code: 'marketing_bd', name: 'Marketing / BD', ledgerAccountCode: 'MARKETING_BD_EXPENSE' },
];

const PENALTY_CATEGORIES: Array<{ code: string; name: string }> = [
  { code: 'liquidated_damages', name: 'Liquidated Damages' },
  { code: 'delivery_delay', name: 'Delivery Delay' },
  { code: 'sla_breach', name: 'SLA Breach' },
  { code: 'downtime_penalty', name: 'Downtime Penalty' },
  { code: 'non_compliance', name: 'Non-compliance' },
  { code: 'performance_shortfall', name: 'Performance Shortfall' },
];

const INTERNAL_DEPARTMENTS: Array<{ code: string; name: string }> = [
  { code: 'developer', name: 'Developer' },
  { code: 'designer', name: 'Designer' },
];

const DESIGNATIONS: Array<{ code: string; name: string }> = [
  { code: 'sr-developer', name: 'Sr. Developer' },
  { code: 'jr-developer', name: 'Jr. Developer' },
  { code: 'jr-designer', name: 'Jr. Designer' },
  { code: 'sr-designer', name: 'Sr. Designer' },
  { code: 'project-manager', name: 'Project Manager' },
  // ADR-153: these, with Project Manager, are the designations a project's
  // managers must hold.
  { code: 'hardware-manager', name: 'Hardware Manager' },
  { code: 'business-development-manager', name: 'Business Development Manager' },
  { code: 'marketing-manager', name: 'Marketing Manager' },
];

const EMPLOYMENT_TYPES: Array<{ code: string; name: string }> = [
  { code: 'full-time', name: 'Full Time' },
  { code: 'part-time', name: 'Part Time' },
];

// System-seeded, global, fixed reference. INTRODUCER is reserved — added
// now, consumed only once Phase 7 builds that entity.
const ENTITY_TYPES: Array<{ code: string; description: string }> = [
  { code: 'LEAD', description: 'CRM lead' },
  { code: 'PROJECT', description: 'Project' },
  { code: 'EMPLOYEE', description: 'Employee' },
  { code: 'LEGAL_ENTITY', description: 'Legal entity' },
  { code: 'VENDOR', description: 'Vendor' },
  { code: 'INTRODUCER', description: 'Introducer (reserved for Phase 7)' },
  { code: 'INVOICE', description: 'Client invoice' },
  { code: 'RECEIPT', description: 'Client receipt' },
  { code: 'VENDOR_BILL', description: 'Vendor bill' },
  { code: 'PAYMENT_REQUEST', description: 'Payment request' },
  { code: 'VENDOR_PAYMENT', description: 'Vendor payment' },
  { code: 'EMPLOYEE_EXPENSE_CLAIM', description: 'Employee expense claim' },
  { code: 'DIRECT_EXPENSE', description: 'Direct company expense' },
  { code: 'SUBSCRIPTION', description: 'Recurring subscription' },
  { code: 'SERVER', description: 'Recurring server/hosting cost' },
  { code: 'INVENTORY_ITEM', description: 'Inventory product / item' },
  { code: 'INVENTORY_RECEIPT', description: 'Inventory stock receipt' },
  { code: 'INVENTORY_CONSUMPTION', description: 'Inventory project consumption' },
  { code: 'SALARY_IMPORT', description: 'Monthly gross salary import batch' },
  { code: 'EMPLOYEE_ALLOCATION', description: 'Employee monthly allocation' },
  { code: 'INTRODUCER_AGREEMENT', description: 'Introducer commission agreement' },
  { code: 'INTRODUCER_ACCRUAL', description: 'Introducer commission accrual' },
  { code: 'INTRODUCER_PAYMENT', description: 'Introducer commission payment' },
];

// System-seeded, global catalogue. Administrator edits are limited to
// label/sort_order/is_active; code is immutable once referenced.
const PAYMENT_MODES: Array<{
  code: string;
  label: string;
  sortOrder: number;
  requiresReferenceNumber?: boolean;
  requiresBankSource?: boolean;
  isCashLike?: boolean;
  isElectronic?: boolean;
  // Phase 6.8 (ADR-088). Distinct from requiresBankSource -- every other
  // consumer of that flag (ClientReceipt, VendorPayment, EmployeeAdvance)
  // has no card-aware logic and must keep asking for a raw BankAccount,
  // never a CardAccount. Only Direct Expense checks this flag, deriving
  // the correct Bank/Credit-Card-Payable ledger from the selected
  // CardAccount server-side.
  requiresCardSource?: boolean;
  isActive?: boolean;
}> = [
  { code: 'CASH', label: 'Cash', sortOrder: 1, isCashLike: true },
  { code: 'CHEQUE', label: 'Cheque', sortOrder: 2, requiresReferenceNumber: true, requiresBankSource: true },
  {
    code: 'BANK_TRANSFER',
    label: 'Bank Transfer',
    sortOrder: 3,
    requiresReferenceNumber: true,
    requiresBankSource: true,
    isElectronic: true,
  },
  {
    // Same as Bank Transfer (ADR-169): kept only for documents already
    // recorded with it, never offered.
    code: 'NEFT_RTGS',
    label: 'NEFT/RTGS',
    sortOrder: 4,
    requiresReferenceNumber: true,
    requiresBankSource: true,
    isElectronic: true,
    isActive: false,
  },
  {
    code: 'UPI',
    label: 'UPI',
    sortOrder: 5,
    requiresReferenceNumber: true,
    requiresBankSource: true,
    isElectronic: true,
  },
  // Phase 6.8 (ADR-088). Debit Card resolves through its linked
  // BankAccount (Cr Bank, same as any other bank-sourced payment); Credit
  // Card resolves through its own Credit-Card-Payable ledger instead (Cr
  // Credit Card Payable, settled later) -- genuinely different accounting
  // destinations, so requiresBankSource stays false for both and only the
  // new requiresCardSource flag is set.
  { code: 'DEBIT_CARD', label: 'Debit Card', sortOrder: 6, requiresReferenceNumber: true, requiresCardSource: true, isElectronic: true },
  { code: 'CREDIT_CARD', label: 'Credit Card', sortOrder: 7, requiresReferenceNumber: true, requiresCardSource: true, isElectronic: true },
];

async function main() {
  const organization = await prisma.organization.upsert({
    where: { code: 'ZITAWARE' },
    create: { id: generateId(), name: 'Zitaware Solutions', code: 'ZITAWARE' },
    update: {},
  });

  // Same additive-only-by-default reasoning as the permission prune above —
  // PURCHASE_REQUEST is no longer seeded once Purchase Request was merged
  // into Vendor Bill (Phase 6.4, docs/12 ADR-079). Safe to hard-delete: no
  // DocumentLink/DocumentCategoryEntityType row in this codebase's own
  // fixed reference set ever pointed at it outside test fixtures, which
  // clean up their own rows independently.
  await prisma.entityType.deleteMany({ where: { code: { notIn: ENTITY_TYPES.map((e) => e.code) } } });

  for (const entityType of ENTITY_TYPES) {
    await prisma.entityType.upsert({
      where: { code: entityType.code },
      create: entityType,
      update: {},
    });
  }

  for (const paymentMode of PAYMENT_MODES) {
    await prisma.paymentMode.upsert({
      where: { code: paymentMode.code },
      create: { id: generateId(), ...paymentMode },
      update: {},
    });
  }

  for (const department of INTERNAL_DEPARTMENTS) {
    await prisma.internalDepartment.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: department.code } },
      create: { id: generateId(), organizationId: organization.id, ...department },
      update: {},
    });
  }

  for (const designation of DESIGNATIONS) {
    await prisma.designation.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: designation.code } },
      create: { id: generateId(), organizationId: organization.id, ...designation },
      update: {},
    });
  }

  for (const employmentType of EMPLOYMENT_TYPES) {
    await prisma.employmentType.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: employmentType.code } },
      create: { id: generateId(), organizationId: organization.id, ...employmentType },
      update: {},
    });
  }

  for (const clientType of CLIENT_TYPES) {
    await prisma.clientType.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: clientType.code } },
      create: { id: generateId(), organizationId: organization.id, ...clientType },
      update: {},
    });
  }

  for (const root of ACCOUNT_GROUP_ROOTS) {
    await prisma.accountGroup.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: root.code } },
      create: {
        id: generateId(),
        organizationId: organization.id,
        code: root.code,
        name: root.name,
        accountType: root.accountType,
        normalBalance: root.normalBalance,
        parentGroupId: null,
        isSystemDefined: true,
      },
      update: {},
    });
  }

  for (const group of ACCOUNT_GROUP_CUSTOM) {
    const parent = await prisma.accountGroup.findFirstOrThrow({
      where: { organizationId: organization.id, code: group.parentCode },
    });
    await prisma.accountGroup.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: group.code } },
      create: {
        id: generateId(),
        organizationId: organization.id,
        code: group.code,
        name: group.name,
        accountType: parent.accountType,
        normalBalance: parent.normalBalance,
        parentGroupId: parent.id,
        isSystemDefined: false,
      },
      update: {},
    });
  }

  for (const account of LEDGER_ACCOUNT_CUSTOM) {
    const group = await prisma.accountGroup.findFirstOrThrow({
      where: { organizationId: organization.id, code: account.groupCode },
    });
    await prisma.ledgerAccount.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: account.code } },
      create: {
        id: generateId(),
        organizationId: organization.id,
        accountGroupId: group.id,
        code: account.code,
        name: account.name,
        allowManualPosting: true,
      },
      update: {},
    });
  }


  for (const leadType of LEAD_TYPES) {
    await prisma.leadType.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: leadType.code } },
      create: { id: generateId(), organizationId: organization.id, ...leadType },
      update: {},
    });
  }

  for (const leadSource of LEAD_SOURCES) {
    await prisma.leadSource.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: leadSource.code } },
      create: { id: generateId(), organizationId: organization.id, ...leadSource },
      update: {},
    });
  }

  for (const projectType of PROJECT_TYPES) {
    await prisma.projectType.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: projectType.code } },
      create: { id: generateId(), organizationId: organization.id, ...projectType },
      update: {},
    });
  }

  for (const documentCategory of DOCUMENT_CATEGORIES) {
    await prisma.documentCategory.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: documentCategory.code } },
      create: { id: generateId(), organizationId: organization.id, ...documentCategory },
      update: {},
    });
  }

  for (const unitOfMeasure of UNITS_OF_MEASURE) {
    await prisma.unitOfMeasure.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: unitOfMeasure.code } },
      create: { id: generateId(), organizationId: organization.id, ...unitOfMeasure },
      update: {},
    });
  }

  for (const productCategory of PRODUCT_CATEGORIES) {
    await prisma.productCategory.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: productCategory.code } },
      create: { id: generateId(), organizationId: organization.id, ...productCategory },
      update: {},
    });
  }

  for (const allocationTarget of ALLOCATION_TARGETS) {
    await prisma.allocationTarget.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: allocationTarget.code } },
      create: { id: generateId(), organizationId: organization.id, ...allocationTarget },
      update: {},
    });
  }

  // Backfill compensation history from the legacy display figure (ADR-098).
  // Done here rather than in the migration so ids stay application-generated
  // UUID v7 per CLAUDE.md, and so it is idempotent: an employee who already
  // has a revision is left alone.
  const employeesNeedingRevision = await prisma.employee.findMany({
    where: {
      organizationId: organization.id,
      deletedAt: null,
      displayedSalaryAmount: { not: null },
      salaryRevisions: { none: {} },
    },
    select: { id: true, displayedSalaryAmount: true, joiningDate: true },
  });
  for (const employee of employeesNeedingRevision) {
    await prisma.employeeSalaryRevision.create({
      data: {
        id: generateId(),
        organizationId: organization.id,
        employeeId: employee.id,
        grossAmount: employee.displayedSalaryAmount!,
        // Their joining date is the honest start for a figure we only know
        // the current value of.
        effectiveFrom: employee.joiningDate,
        effectiveTo: null,
        reason: 'Backfilled from the pre-ADR-098 displayed salary figure',
      },
    });
  }

  // Backfill the one real vendor_bill_lines row that predates this column
  // (unitOfMeasureId is nullable at the DB layer for exactly this reason —
  // see the migration's own comment) to the default 'qty' unit, now that
  // it exists. A harmless no-op once every row already has one.
  const qtyUnit = await prisma.unitOfMeasure.findFirstOrThrow({ where: { organizationId: organization.id, code: 'qty' } });
  await prisma.vendorBillLine.updateMany({ where: { organizationId: organization.id, unitOfMeasureId: null }, data: { unitOfMeasureId: qtyUnit.id } });

  for (const expenseCategory of EXPENSE_CATEGORIES) {
    const { ledgerAccountCode, ...rest } = expenseCategory;
    const ledgerAccount = ledgerAccountCode
      ? await prisma.ledgerAccount.findFirstOrThrow({
          where: { organizationId: organization.id, code: ledgerAccountCode },
        })
      : null;
    await prisma.expenseCategory.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: expenseCategory.code } },
      create: { id: generateId(), organizationId: organization.id, ...rest, ledgerAccountId: ledgerAccount?.id ?? null },
      update: { ledgerAccountId: ledgerAccount?.id ?? null },
    });
  }

  for (const penaltyCategory of PENALTY_CATEGORIES) {
    await prisma.penaltyCategory.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: penaltyCategory.code } },
      create: { id: generateId(), organizationId: organization.id, ...penaltyCategory },
      update: {},
    });
  }

  // Prune permission keys no longer declared in PERMISSION_KEYS (e.g.
  // purchase_request.* and vendor_bill.{update,finalize}, removed when
  // Purchase Request was merged into Vendor Bill — Phase 6.4, docs/12
  // ADR-079). The upsert loop below is additive-only by design (it never
  // ran into a real permission removal before this), so a stale row would
  // otherwise sit in the catalog forever with its role grants intact even
  // though no code checks for it anymore. Role/user-override grants
  // referencing a stale permission are deleted first — Permission has no
  // ON DELETE CASCADE from either side, matching this schema's own
  // deliberately explicit-FK convention elsewhere.
  const stalePermissions = await prisma.permission.findMany({ where: { key: { notIn: [...PERMISSION_KEYS] } } });
  if (stalePermissions.length > 0) {
    const staleIds = stalePermissions.map((p) => p.id);
    await prisma.rolePermission.deleteMany({ where: { permissionId: { in: staleIds } } });
    await prisma.userPermissionOverride.deleteMany({ where: { permissionId: { in: staleIds } } });
    await prisma.permission.deleteMany({ where: { id: { in: staleIds } } });
  }

  const permissionsByKey = new Map<string, string>();
  for (const key of PERMISSION_KEYS) {
    const [resource, action] = key.split('.') as [string, string];
    const permission = await prisma.permission.upsert({
      where: { key },
      create: { id: generateId(), key, resource, action },
      update: {},
    });
    permissionsByKey.set(key, permission.id);
  }

  // Everything Admin has except seeing every legal entity (ADR-172).
  // ...and logging in as another user (ADR-174).
  const ALL_BUT_EVERY_ENTITY = new Set(PERMISSION_KEYS.filter((key) => key !== 'legal_entity.access_all' && key !== 'user.impersonate'));

  const roleDefinitions = [
    {
      name: 'Admin',
      description: 'Full access. Runs users, roles and masters, and can do any job.',
      permissions: new Set(PERMISSION_KEYS),
      isSystem: true,
    },
    {
      name: 'Accountant',
      description: 'Full access to their own legal entity. Same work as Admin: books, projects, users, roles and masters.',
      permissions: ALL_BUT_EVERY_ENTITY,
      isSystem: true,
    },
    {
      name: 'Project Manager',
      description: 'An employee. Same access as Hardware Manager: projects, the team, stock, and purchase bills. Does not see leads, invoices, reports, or the books.',
      permissions: PROJECT_MANAGER_PERMISSIONS,
      isSystem: true,
    },
    {
      name: 'CEO',
      description: 'Full access to their own legal entity. Same work as Admin: books, projects, users, roles and masters.',
      permissions: ALL_BUT_EVERY_ENTITY,
      isSystem: false,
    },
    {
      name: 'Admin Staff',
      description: 'Office desk. Adds clients, leads, vendors and lookup lists, and files documents. Does not approve payments or change the books.',
      permissions: ADMIN_STAFF_PERMISSIONS,
      isSystem: false,
    },
    {
      name: 'Employee',
      description: 'Own documents, own expense claims, and a purchase bill on an assigned project. Does not approve or see company money.',
      permissions: EMPLOYEE_PERMISSIONS,
      isSystem: false,
    },
    {
      name: 'Hardware Manager',
      description: 'An employee. Same access as Project Manager: projects, the team, stock, and purchase bills. Does not see leads, invoices, reports, or the books.',
      permissions: HARDWARE_MANAGER_PERMISSIONS,
      isSystem: false,
    },
  ];

  const roleIdByName = new Map<string, string>();
  for (const definition of roleDefinitions) {
    const role = await prisma.role.upsert({
      where: { organizationId_name: { organizationId: organization.id, name: definition.name } },
      create: {
        id: generateId(),
        organizationId: organization.id,
        name: definition.name,
        description: definition.description,
        isSystem: definition.isSystem,
      },
      update: { description: definition.description },
    });
    roleIdByName.set(definition.name, role.id);

    const desiredPermissionIds = new Set<string>();
    for (const permissionKey of definition.permissions) {
      const permissionId = permissionsByKey.get(permissionKey);
      if (!permissionId) continue;
      desiredPermissionIds.add(permissionId);
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        create: { id: generateId(), roleId: role.id, permissionId },
        update: {},
      });
    }

    // Reconcile, don't just add. This loop used to be additive only, which
    // meant a permission granted to the wrong role once stayed granted
    // forever — re-running the seed after correcting the definition changed
    // nothing. That is how `introducer_fee.pay` remained on Project Manager
    // after being moved to Accountant (ADR-097 E1), and it would silently
    // leave any future mis-grant in place too.
    //
    // Scoped to SYSTEM roles only: a custom role's permissions are managed
    // by administrators through the Roles screen and are none of the seed's
    // business.
    // Hardware Manager is not a system role, but its grants are defined here.
    // Leaving extras in place is how the wide set stayed on the role after
    // it was narrowed (ADR-140).
    if (definition.isSystem || definition.name === 'Hardware Manager') {
      await prisma.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { notIn: [...desiredPermissionIds] } },
      });
    }
  }

  const adminRoleId = roleIdByName.get('Admin')!;
  const bootstrapEmail = 'zitawaresolutions@gmail.com';
  const existingAdmin = await prisma.user.findFirst({
    where: { organizationId: organization.id, email: bootstrapEmail },
  });

  if (!existingAdmin) {
    // The password is read from the environment, never written in code.
    const configuredPassword = process.env.SEED_ADMIN_PASSWORD;
    const password = configuredPassword && configuredPassword.length > 0 ? configuredPassword : randomBytes(24).toString('base64url');
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const admin = await prisma.user.create({
      data: {
        id: generateId(),
        organizationId: organization.id,
        email: bootstrapEmail,
        passwordHash,
        displayName: 'Admin',
        status: 'ACTIVE',
      },
    });
    await prisma.userRole.create({
      data: { id: generateId(), organizationId: organization.id, userId: admin.id, roleId: adminRoleId },
    });
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: 'seed.bootstrap_admin_created',
        email: bootstrapEmail,
        password: configuredPassword ? 'from SEED_ADMIN_PASSWORD' : 'random (SEED_ADMIN_PASSWORD not set) — use Forgot password',
      }),
    );
  }

  const stateIdByKey = new Map<string, string>();
  for (const state of STATES) {
    const row = await prisma.state.upsert({
      where: { code: state.code },
      create: { id: generateId(), ...state },
      update: {},
    });
    stateIdByKey.set(stateKey(state.name), row.id);
  }

  // skipDuplicates leaves alone any district or city that already exists
  // under the normalized-name unique indexes, including ones an admin added
  // or renamed through Masters, so re-running only adds what is missing.
  for (const [stateName, districts] of Object.entries(INDIA_GEOGRAPHY.states)) {
    const stateId = stateIdByKey.get(stateKey(stateName));
    if (!stateId) throw new Error(`india-geography.json names a state the seed does not know: ${stateName}`);

    await prisma.district.createMany({
      data: Object.keys(districts).map((name) => ({ id: generateId(), stateId, name })),
      skipDuplicates: true,
    });
    const districtIdByKey = new Map(
      (await prisma.district.findMany({ where: { stateId }, select: { id: true, name: true } })).map((d) => [
        geographyKey(d.name),
        d.id,
      ]),
    );

    await prisma.city.createMany({
      data: Object.entries(districts).flatMap(([districtName, cities]) => {
        const districtId = districtIdByKey.get(geographyKey(districtName))!;
        return cities.map((name) => ({ id: generateId(), districtId, stateId, name }));
      }),
      skipDuplicates: true,
    });
  }

  // Placeholder Zitaware Solutions legal entity so a fresh database can post
  // straight away (ADR-191). The PAN, GSTIN and address are FAKE — format-
  // valid only — and must be replaced under Legal Entities before any real
  // invoice is issued. legal_entities/gst_registrations use partial-unique
  // indexes (WHERE deleted_at IS NULL — ADR-049), which Prisma's schema DSL
  // can't express, so these use findFirst + conditional create.
  const PLACEHOLDER_PAN = 'AAACZ0000A';
  const PLACEHOLDER_GSTIN = '24AAACZ0000A1ZF';
  const existingLegalEntity = await prisma.legalEntity.findFirst({
    where: { organizationId: organization.id, panNumber: PLACEHOLDER_PAN, deletedAt: null },
  });
  const legalEntity =
    existingLegalEntity ??
    (await prisma.legalEntity.create({
      data: {
        id: generateId(),
        organizationId: organization.id,
        legalName: 'Zitaware Solutions',
        panNumber: PLACEHOLDER_PAN,
        registeredAddress: 'Placeholder address, Ahmedabad, Gujarat 380001 — replace under Legal Entities',
        invoicePlaceOfSupply: 'Gujarat',
        invoiceStateCode: '24',
        invoiceJurisdiction: 'Ahmedabad',
      },
    }));

  const gujaratId = stateIdByKey.get(stateKey('Gujarat'));
  if (gujaratId) {
    const existingGstRegistration = await prisma.gstRegistration.findFirst({
      where: { gstin: PLACEHOLDER_GSTIN, deletedAt: null },
    });
    if (!existingGstRegistration) {
      await prisma.gstRegistration.create({
        data: {
          id: generateId(),
          organizationId: organization.id,
          legalEntityId: legalEntity.id,
          stateId: gujaratId,
          gstin: PLACEHOLDER_GSTIN,
        },
      });
    }
  }

  const currentFinancialYearLabel = 'FY2026-27';
  const existingFinancialYear = await prisma.financialYear.findFirst({
    where: { legalEntityId: legalEntity.id, label: currentFinancialYearLabel },
  });
  if (!existingFinancialYear) {
    const startDate = new Date('2026-04-01T00:00:00.000Z');
    const endDate = new Date('2027-03-31T00:00:00.000Z');
    const financialYear = await prisma.financialYear.create({
      data: {
        id: generateId(),
        organizationId: organization.id,
        legalEntityId: legalEntity.id,
        label: currentFinancialYearLabel,
        startDate,
        endDate,
        isCurrent: true,
      },
    });

    let periodStart = startDate;
    for (let periodNumber = 1; periodNumber <= 12; periodNumber++) {
      const periodEnd =
        periodNumber === 12
          ? endDate
          : new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0));
      await prisma.accountingPeriod.create({
        data: {
          id: generateId(),
          organizationId: organization.id,
          financialYearId: financialYear.id,
          periodNumber,
          startDate: periodStart,
          endDate: periodEnd,
        },
      });
      periodStart = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1));
    }
  }
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
