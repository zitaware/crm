import type {
  AuthPort,
  UserPort,
  RolePort,
  GeographyPort,
  MasterPort,
  LegalEntityPort,
  FinancialYearPort,
  EmployeePort,
  EmployeeSalaryRevisionPort,
  DocumentSupportPort,
  DocumentPort,
  PenaltyCategoryPort,
  InventoryItemPort,
  InventoryPort,
  SalaryImportPort,
  EmployeeAllocationPort,
  IntroducerFeePort,
  AuditPort,
  ClientPort,
  IntroducerPort,
  FormDraftPort,
  LeadPort,
  TenderPort,
  ProjectPort,
  ProjectFinancialsPort,
  ChartOfAccountsPort,
  MilestonePort,
  PaymentAlertPort,
  JournalPort,
  SecurityInstrumentPort,
  TdsCertificatePort,
  TdsDepositPort,
  BankReconciliationPort,
  InvoicePort,
  CreditDebitNotePort,
  LedgerOpeningBalancePort,
  ReceiptPort,
  VendorPort,
  VendorBillPort,
  PaymentRequestPort,
  VendorPaymentPort,
  EmployeeExpensePort,
  DirectExpensePort,
  ServerSubscriptionImportPort,
  PurchasePort,
  CardSettlementPort,
  ReportPort,
  DashboardPort,
  SearchPort,
} from './ports';

/** Resolved from the incoming session — never trust a client-supplied value. */
export interface AuthContext {
  user: { id: string; organizationId: string } | null;
  permissions: Set<string>;
  sessionId: string | null;
}

/**
 * Concrete NestJS services are wired into this bag by apps/api's
 * createContext factory — packages/contracts only ever sees the port
 * (interface) types, never the concrete implementations.
 */
export interface Services {
  auth: AuthPort;
  users: UserPort;
  roles: RolePort;
  geography: GeographyPort;
  masters: MasterPort;
  legalEntities: LegalEntityPort;
  financialYears: FinancialYearPort;
  employees: EmployeePort;
  employeeSalaryRevisions: EmployeeSalaryRevisionPort;
  documentSupport: DocumentSupportPort;
  documents: DocumentPort;
  penaltyCategories: PenaltyCategoryPort;
  inventoryItems: InventoryItemPort;
  inventory: InventoryPort;
  salaryImports: SalaryImportPort;
  employeeAllocations: EmployeeAllocationPort;
  introducerFees: IntroducerFeePort;
  audit: AuditPort;
  clients: ClientPort;
  introducers: IntroducerPort;
  formDrafts: FormDraftPort;
  leads: LeadPort;
  tenders: TenderPort;
  projects: ProjectPort;
  projectFinancials: ProjectFinancialsPort;
  chartOfAccounts: ChartOfAccountsPort;
  milestones: MilestonePort;
  paymentAlerts: PaymentAlertPort;
  journal: JournalPort;
  securityInstruments: SecurityInstrumentPort;
  tdsCertificates: TdsCertificatePort;
  tdsDeposits: TdsDepositPort;
  bankReconciliation: BankReconciliationPort;
  invoices: InvoicePort;
  creditDebitNotes: CreditDebitNotePort;
  ledgerOpeningBalances: LedgerOpeningBalancePort;
  receipts: ReceiptPort;
  vendors: VendorPort;
  vendorBills: VendorBillPort;
  paymentRequests: PaymentRequestPort;
  vendorPayments: VendorPaymentPort;
  employeeExpenses: EmployeeExpensePort;
  directExpenses: DirectExpensePort;
  serverSubscriptionImports: ServerSubscriptionImportPort;
  purchases: PurchasePort;
  cardSettlements: CardSettlementPort;
  reports: ReportPort;
  dashboard: DashboardPort;
  search: SearchPort;
}

/** Minimal structural interface for setting/clearing the session cookie —
 * intentionally not importing express's Response type, to keep this
 * package framework-agnostic. Any object with these two methods
 * (including a real Express Response) satisfies it. */
export interface CookieSetter {
  cookie(name: string, value: string, options?: Record<string, unknown>): void;
  clearCookie(name: string, options?: Record<string, unknown>): void;
}

/**
 * tRPC request context shape. Phase 1 carried only a correlation ID; Phase 2
 * extends it with the auth-resolved user/permissions, request metadata, the
 * service ports, and cookie access for auth.login/refresh/logout.
 */
export interface Context {
  correlationId: string;
  requestTimestamp: string;
  ipAddress: string | undefined;
  userAgent: string | undefined;
  auth: AuthContext;
  services: Services;
  res: CookieSetter;
  cookies: Record<string, string>;
  /**
   * Entity-wise data (ADR-172): which legal entities this user sees. ALL
   * with legal_entity.access_all; OWN with the legal entity on their
   * employee record; NONE when that is not set.
   */
  entityAccess?: { kind: 'ALL' } | { kind: 'OWN'; legalEntityId: string } | { kind: 'NONE' } | undefined;
  /** ADR-174: the Admin viewing as this user, when this is an impersonated session. */
  impersonatorUserId?: string | null | undefined;
  /** Runs a procedure inside the user's entity scope. Absent in tests that build a context by hand. */
  runScoped?: (<T>(fn: () => Promise<T>) => Promise<T>) | undefined;
}
