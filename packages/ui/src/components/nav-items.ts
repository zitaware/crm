import {
  AuditLogIcon,
  BankAccountIcon,
  BarChartIcon,
  CardAccountIcon,
  ChartOfAccountsIcon,
  ClientsIcon,
  CreditDebitNoteIcon,
  DashboardIcon,
  DirectExpenseIcon,
  EmployeesIcon,
  EmployeeWalletIcon,
  IntroducersIcon,
  InvoiceIcon,
  JournalEntriesIcon,
  LeadsIcon,
  LegalEntityIcon,
  MastersIcon,
  PaymentRequestIcon,
  InventoryIcon,
  SalaryImportIcon,
  IntroducerFeeIcon,
  ProductIcon,
  ProjectsIcon,
  ReceiptIcon,
  RolesIcon,
  ServerIcon,
  TdsCertificateIcon,
  UsersIcon,
  VendorBillIcon,
  VendorIcon,
  VendorPaymentIcon,
} from './icons';
import type { ComponentType } from 'react';

export interface NavItem {
  key: string;
  label: string;
  path: string;
  icon: ComponentType;
  /** Permission required to see this item — any one of them, when a list.
   * `null` means always visible to an authenticated user. */
  permission: string | readonly string[] | null;
  group: string | null;
  /** Kept for its route rule (who may open the address) but left out of the menu. */
  hidden?: boolean;
}

/**
 * Centralized route metadata — docs/15-ui-design-system.md §8.2: "Menu
 * items are generated from centralized route definitions and filtered by
 * permissions. Static prototype links are not copied." Phase 3 sub-phase
 * 3.1 (Party/Client foundation) adds the first CRM item; Projects/Finance/
 * etc. from the shell.html prototype remain later-phase scope and are
 * intentionally absent.
 */
export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', path: '/', icon: DashboardIcon, permission: 'dashboard.read', group: null },
  {
    key: 'clients',
    label: 'Clients',
    path: '/clients',
    icon: ClientsIcon,
    permission: 'client.read',
    group: 'CRM',
  },
  {
    key: 'leads',
    label: 'Leads',
    path: '/leads',
    icon: LeadsIcon,
    permission: 'lead.read',
    group: 'CRM',
  },
  {
    key: 'introducers',
    label: 'Introducers',
    path: '/introducers',
    icon: IntroducersIcon,
    permission: 'introducer.read',
    group: 'CRM',
  },
  // Sits beside the Introducers master it is about (ADR-097). It was briefly
  // its own one-item group three rows below that — which is how a screen ends
  // up with no inbound links from anywhere.
  {
    key: 'introducer-fees',
    label: 'Introducer Fees',
    path: '/introducer-fees',
    icon: IntroducerFeeIcon,
    permission: 'introducer_fee.read',
    group: 'CRM',
  },
  {
    key: 'projects',
    label: 'Projects',
    path: '/projects',
    icon: ProjectsIcon,
    permission: 'project.read',
    group: 'Projects',
  },
  {
    key: 'chart-of-accounts',
    label: 'Chart of Accounts',
    path: '/chart-of-accounts',
    icon: ChartOfAccountsIcon,
    permission: 'chart_of_account.read',
    group: 'Finance',
  },
  {
    key: 'journal-entries',
    label: 'Journal Entries',
    path: '/journal-entries',
    icon: JournalEntriesIcon,
    permission: 'journal.read',
    group: 'Finance',
  },
  {
    key: 'invoices',
    label: 'Invoices',
    path: '/invoices',
    icon: InvoiceIcon,
    permission: 'invoice.read',
    group: 'Finance',
  },
  {
    key: 'payment-integration',
    label: 'Payment Integration',
    path: '/payment-integration',
    icon: ReceiptIcon,
    permission: 'receipt.read',
    group: 'Finance',
  },
  {
    key: 'credit-debit-notes',
    label: 'Credit / Debit Notes',
    path: '/credit-debit-notes',
    icon: CreditDebitNoteIcon,
    permission: 'credit_debit_note.read',
    group: 'Finance',
  },
  {
    key: 'tds-certificates',
    label: 'TDS Certificates',
    path: '/tds-certificates',
    icon: TdsCertificateIcon,
    permission: 'tds_certificate.read',
    group: 'Finance',
  },
  {
    key: 'tds-deposits',
    label: 'TDS Deposits',
    path: '/tds-deposits',
    icon: TdsCertificateIcon,
    permission: 'tds_deposit.read',
    group: 'Finance',
  },
  {
    key: 'vendors',
    label: 'Vendors',
    path: '/vendors',
    icon: VendorIcon,
    permission: 'vendor.read',
    group: 'Purchases & Expenses',
  },
  {
    key: 'products',
    label: 'Products & Items',
    path: '/products',
    icon: ProductIcon,
    permission: 'inventory_item.read',
    group: 'Purchases & Expenses',
  },
  {
    key: 'inventory',
    label: 'Inventory',
    path: '/inventory',
    icon: InventoryIcon,
    permission: 'inventory.read',
    group: 'Purchases & Expenses',
  },
  // ADR-176: a vendor bill from entry to payment on one screen. The three
  // screens it replaces keep their pages (a bill, a payment) but leave the menu.
  {
    key: 'purchases',
    label: 'Purchases',
    path: '/purchases',
    icon: VendorBillIcon,
    permission: 'vendor_bill.read',
    group: 'Purchases & Expenses',
  },
  {
    key: 'vendor-bills',
    label: 'Vendor Bills',
    path: '/vendor-bills',
    icon: VendorBillIcon,
    permission: 'vendor_bill.read',
    group: 'Purchases & Expenses',
    hidden: true,
  },
  {
    key: 'payment-requests',
    label: 'Payment Requests',
    path: '/payment-requests',
    icon: PaymentRequestIcon,
    permission: 'payment_request.read',
    group: 'Purchases & Expenses',
    hidden: true,
  },
  {
    key: 'vendor-payments',
    label: 'Vendor Payments',
    path: '/vendor-payments',
    icon: VendorPaymentIcon,
    permission: 'vendor_payment.read',
    group: 'Purchases & Expenses',
    hidden: true,
  },
  {
    key: 'my-expenses',
    label: 'My Expenses',
    path: '/employee-expenses/my',
    icon: EmployeeWalletIcon,
    permission: 'employee_claim.create',
    group: 'Expenses',
  },
  {
    key: 'employee-reimbursements',
    label: 'Employee Reimbursements',
    path: '/employee-expenses',
    icon: EmployeeWalletIcon,
    permission: 'employee_claim.read',
    group: 'Expenses',
  },
  {
    key: 'direct-expenses',
    label: 'Direct Expenses',
    path: '/direct-expenses',
    icon: DirectExpenseIcon,
    permission: 'direct_expense.read',
    group: 'Expenses',
  },
  // ADR-169: server and subscription bills, imported from Excel as direct expenses.
  {
    key: 'servers-subscriptions',
    label: 'Servers & Subscriptions',
    path: '/servers-subscriptions',
    icon: ServerIcon,
    permission: 'direct_expense.read',
    group: 'Expenses',
  },
  // Phase 8 (ADR-108). Reads are granted per report category, so the
  // catalogue shows for anyone holding at least one; each slice adds its
  // category's key here.
  {
    key: 'reports',
    label: 'Reports',
    path: '/reports',
    icon: BarChartIcon,
    permission: ['report.receivables.read', 'report.profitability.read', 'report.gst.read', 'report.tds.read', 'report.cash.read', 'report.payables.read', 'report.operations.read', 'report.controls.read'],
    group: 'Reports',
  },
  {
    key: 'legal-entities',
    label: 'Legal Entities',
    path: '/legal-entities',
    icon: LegalEntityIcon,
    permission: 'legal_entity.read',
    group: 'Organization',
  },
  {
    key: 'bank-accounts',
    label: 'Bank Accounts',
    path: '/bank-accounts',
    icon: BankAccountIcon,
    permission: 'legal_entity.read',
    group: 'Organization',
  },
  {
    key: 'card-accounts',
    label: 'Card Accounts',
    path: '/card-accounts',
    icon: CardAccountIcon,
    permission: 'legal_entity.read',
    group: 'Organization',
  },
  {
    key: 'audit-log',
    label: 'Audit Log',
    path: '/audit-log',
    icon: AuditLogIcon,
    permission: 'audit.read',
    group: 'Organization',
  },
  {
    key: 'masters',
    label: 'Masters',
    path: '/masters',
    icon: MastersIcon,
    permission: 'master.read',
    group: 'Administration',
  },
  {
    key: 'users',
    label: 'Users',
    path: '/users',
    icon: UsersIcon,
    permission: 'user.manage',
    group: 'Administration',
  },
  {
    key: 'roles',
    label: 'Roles',
    path: '/roles',
    icon: RolesIcon,
    permission: 'user.manage',
    group: 'Administration',
  },
  {
    key: 'employees',
    label: 'Employees',
    path: '/employees',
    icon: EmployeesIcon,
    permission: 'employee.read',
    group: 'Administration',
  },
  // Salary, allocation and manpower cost are one month's work (ADR-125).
  // A group of one item renders as a single row, so the menu is not a
  // heading plus two destinations.
  {
    key: 'employee-costing',
    label: 'Employee Costing',
    path: '/employee-costing',
    icon: SalaryImportIcon,
    permission: ['salary_import.read', 'employee_allocation.read'],
    group: 'Employee Costing',
  },
];
