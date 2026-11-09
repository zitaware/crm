import type { SVGProps } from 'react';

/**
 * Small inline SVG icons matching references/ui/html/01-platform/shell.html's
 * own approach (raw inline `<svg>`, no icon-font/library dependency).
 * `@ant-design/icons` was tried first and dropped — its CJS/ESM export
 * shape broke Turbopack's page-data-collection step
 * ("(0, b.createContext) is not a function") across unrelated (auth)
 * routes that share a root-level bundle with this package.
 */
function Icon({ className, width, height, ...props }: SVGProps<SVGSVGElement>) {
  // AntD's Menu clones each `icon:` element and REPLACES its className
  // entirely with "ant-menu-item-icon" — a Tailwind size className here
  // gets silently discarded there. `width`/`height` attributes survive
  // that clone, so size via attributes (16px matches docs/15
  // §8.2's "16px icons" for nav rows), not className. Non-Menu callers
  // (e.g. Topbar) can still override via width/height or className.
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      width={width ?? 16}
      height={height ?? 16}
      className={className}
      {...props}
    />
  );
}

export function DashboardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </Icon>
  );
}

export function MastersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Icon>
  );
}

export function UsersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    </Icon>
  );
}

export function RolesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </Icon>
  );
}

export function EmployeesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M15 8h4M15 12h4M6 16h12" />
    </Icon>
  );
}

export function ClientsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="4" y="3" width="10" height="18" rx="1" />
      <path d="M14 8h6v13h-6M7 7h.01M7 11h.01M7 15h.01" />
    </Icon>
  );
}

export function LeadsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />
    </Icon>
  );
}

export function IntroducersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 21v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M16 8h5M18.5 5.5v5" />
    </Icon>
  );
}

export function TendersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
      <path d="M14 2v6h6" />
      <circle cx="12" cy="15" r="3" />
      <path d="M10.5 16.5 12 18l3-3" />
    </Icon>
  );
}

export function ProjectsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M3 12h18" />
    </Icon>
  );
}

export function LegalEntityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 21h18M4 21V10l8-6 8 6v11M9 21v-6h6v6" />
    </Icon>
  );
}

export function BankAccountIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 21h18M3 10h18M5 6l7-4 7 4M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3" />
    </Icon>
  );
}

export function CardAccountIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20M6 15h4" />
    </Icon>
  );
}

export function FinancialYearIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </Icon>
  );
}

export function ChartOfAccountsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M9 3v18" />
      <path d="M13 8h4M13 13h4M13 18h4" />
    </Icon>
  );
}

export function JournalEntriesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 4h16v16H4z" />
      <path d="M8 9h4M8 13h8M8 17h6" />
    </Icon>
  );
}

export function SecurityInstrumentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </Icon>
  );
}

export function InvoiceIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 13h6M9 17h6" />
    </Icon>
  );
}

export function ReceiptIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </Icon>
  );
}

export function AuditLogIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 3v18h18" />
      <path d="M18 17V9M13 17V5M8 17v-3" />
    </Icon>
  );
}

export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </Icon>
  );
}

export function BellIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
    </Icon>
  );
}

export function MenuIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 12h18M3 6h18M3 18h18" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M15 18l-6-6 6-6" />
    </Icon>
  );
}

/** Rest position points down (section expanded); rotate -90deg to point
 * right (section collapsed) — a clean 90-degree sweep either direction,
 * matching the disclosure-triangle convention. */
export function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M6 9l6 6 6-6" />
    </Icon>
  );
}

export function BarChartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 3v18h18M18 17V9M13 17V5M8 17v-3" />
    </Icon>
  );
}

export function CreditDebitNoteIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h3M9.5 11.5v3M13 17h5" />
    </Icon>
  );
}

export function TdsCertificateIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13l2.5 2.5L16 10" />
    </Icon>
  );
}

export function VendorIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 21V8l9-5 9 5v13" />
      <path d="M3 21h18M9 21v-6h6v6" />
    </Icon>
  );
}

/** A vendor's own bill received into the company — a document dropping
 * into an inbound tray. Doubles as the Purchase Request/vendor-selection
 * entry point since Purchase Request was merged into Vendor Bill (Phase
 * 6.4, docs/12 ADR-079) — the former PurchaseRequestIcon (cart glyph) was
 * removed along with that module. */
export function VendorBillIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 4h16v10H4z" />
      <path d="M8 8h8M8 11h5" />
      <path d="M4 15l4 5h8l4-5" />
    </Icon>
  );
}

/** The authorization/reservation gate before a vendor bill is actually
 * paid — a clipboard with a checkmark, distinct from VendorBillIcon's own
 * inbound-tray glyph. */
export function PaymentRequestIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1z" />
      <path d="M6 5h12a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
      <path d="M9 13l2 2 4-4" />
    </Icon>
  );
}

/** Money actually leaving the bank — a banknote with an outbound arrow,
 * distinct from PaymentRequestIcon's own clipboard-checkmark glyph (that
 * only authorizes; this is the step that posts a real Dr/Cr journal). */
export function VendorPaymentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <circle cx="9" cy="12" r="2.5" />
      <path d="M16 10l6-6M22 4h-5M22 4v5" />
    </Icon>
  );
}

/** An employee's own wallet — a billfold with a flap/press-stud, distinct
 * from every other money glyph in this set (ReceiptIcon's plain rect,
 * VendorPaymentIcon's outbound banknote). Shared by both "My Expenses"
 * (self-service) and "Employee Reimbursements" (Accountant/Admin) nav
 * entries — one wallet, two audiences. */
export function EmployeeWalletIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3" />
      <path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-4" />
      <rect x="14" y="12" width="8" height="6" rx="1.5" />
      <circle cx="17.5" cy="15" r="0.75" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** A torn-edge receipt — a company-paid bill posted immediately, distinct
 * from every other money glyph in this set (EmployeeWalletIcon's billfold,
 * VendorBillIcon's inbound tray, PaymentRequestIcon's clipboard). */
export function DirectExpenseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M6 3h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </Icon>
  );
}

export function SubscriptionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M21 12a9 9 0 1 1-3.5-7.1" />
      <path d="M21 3v5h-5" />
    </Icon>
  );
}

export function ServerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <path d="M7 7h.01M7 17h.01" />
    </Icon>
  );
}

export function ProductIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 3 20.5 7.5v9L12 21l-8.5-4.5v-9L12 3Z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
    </Icon>
  );
}

export function IntroducerFeeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M8 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 19v-1.5A4.5 4.5 0 0 1 6.5 13h3" />
      <path d="M17.5 21a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM17.5 14.2v4.6M16 15.5h3M16 17.5h3" />
    </Icon>
  );
}

export function AllocationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 3a9 9 0 1 0 9 9h-9V3Z" />
      <path d="M15 3.5A9 9 0 0 1 20.5 9H15V3.5Z" />
    </Icon>
  );
}

export function ManpowerCostIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M9 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20v-1.5A4.5 4.5 0 0 1 7.5 14h3" />
      <path d="M17 21a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 15v4M15.5 16.2h3" />
    </Icon>
  );
}

export function SalaryImportIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 3v10m0 0 3.5-3.5M12 13 8.5 9.5" />
      <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </Icon>
  );
}

export function InventoryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 8h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8Z" />
      <path d="M2 4h20v4H2zM10 12h4" />
    </Icon>
  );
}
