import { Injectable } from '@nestjs/common';
import { generateId, recordAuditEvent } from '@zitaware/database';
import { REPORT_CATEGORY_PERMISSIONS } from '@zitaware/contracts';
import type {
  BusinessOverviewReport,
  CashProfitabilityReport,
  ContractPerformanceReport,
  CostToCompanyReport,
  GstInputReport,
  GstNetReport,
  GstOutputReport,
  GstRegisterReport,
  TdsInwardReport,
  TdsReconciliationReport,
  TdsOutwardReport,
  CashFlowReport,
  EmployeeAdvanceReport,
  EmdSdRecoveryReport,
  AuditActivityReport,
  ExceptionsReport,
  ClientPaymentReport,
  ManpowerUtilizationReport,
  PendingInvoiceReport,
  IntroducerStatementReport,
  PaymentHoldReport,
  PenaltyReport,
  ExpenseReport,
  PayablesAgingReport,
  ReimbursementReport,
  VendorPaymentReport,
  OutstandingSummaryReport,
  ProjectPlReport,
  ReceivableAgingReport,
  ReportCatalogEntry,
  ReportExportFormat,
  ReportExportResult,
  ReportKey,
  ReportPort,
  ReportReadInput,
} from '@zitaware/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { REPORT_CATALOG } from './report-catalog';

/** Government-only reports Zitaware CRM does not offer (ADR-192: no tenders, no EMD/SD). */
const HIDDEN_REPORTS: ReadonlySet<string> = new Set(['emd-sd-recovery']);
import {
  agingDocument,
  businessOverviewDocument,
  cashProfitabilityDocument,
  contractPerformanceDocument,
  costToCompanyDocument,
  gstInputDocument,
  gstNetDocument,
  gstOutputDocument,
  gstRegisterDocument,
  tdsInwardDocument,
  tdsReconciliationDocument,
  tdsOutwardDocument,
  cashFlowDocument,
  employeeAdvancesDocument,
  emdSdRecoveryDocument,
  auditActivityDocument,
  exceptionsDocument,
  clientPaymentsDocument,
  manpowerUtilizationDocument,
  pendingInvoicesDocument,
  introducerStatementDocument,
  paymentHoldsDocument,
  penaltiesDocument,
  expensesDocument,
  payablesAgingDocument,
  reimbursementsDocument,
  vendorPaymentsDocument,
  outstandingSummaryDocument,
  projectPlDocument,
} from './report-documents';
import { PerformanceReportService } from './performance-report.service';
import { GstReportService } from './gst-report.service';
import { TdsReportService } from './tds-report.service';
import { CashFlowReportService } from './cash-flow-report.service';
import { PayablesReportService } from './payables-report.service';
import { OperationsReportService } from './operations-report.service';
import { ResourceReportService } from './resource-report.service';
import { ControlsReportService } from './controls-report.service';
import { ProfitabilityReportService } from './profitability-report.service';
import { ReportExportService, XLSX_MIME_TYPE, type ReportDocument } from './report-export.service';
import { ReceivablesReportService } from './receivables-report.service';

/** The reports module's single entry point (ADR-108): catalogue, reads and audited exports. */
@Injectable()
export class ReportsService implements ReportPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly receivables: ReceivablesReportService,
    private readonly profitability: ProfitabilityReportService,
    private readonly performance: PerformanceReportService,
    private readonly gst: GstReportService,
    private readonly tds: TdsReportService,
    private readonly cashFlowReports: CashFlowReportService,
    private readonly payables: PayablesReportService,
    private readonly operations: OperationsReportService,
    private readonly resources: ResourceReportService,
    private readonly controls: ControlsReportService,
    private readonly exporter: ReportExportService,
  ) {}

  /** Only the reports the caller may open (docs/04 §16: "show only authorized reports"). */
  getCatalog(input: { permissions: string[] }): Promise<ReportCatalogEntry[]> {
    const held = new Set(input.permissions);
    return Promise.resolve(
      Object.values(REPORT_CATALOG).filter((entry) => !HIDDEN_REPORTS.has(entry.key) && held.has(REPORT_CATEGORY_PERMISSIONS[entry.category])),
    );
  }

  getReceivableAging(input: ReportReadInput): Promise<ReceivableAgingReport> {
    return this.receivables.aging(input);
  }

  getOutstandingSummary(input: ReportReadInput): Promise<OutstandingSummaryReport> {
    return this.receivables.outstandingSummary(input);
  }

  getProjectPl(input: ReportReadInput): Promise<ProjectPlReport> {
    return this.profitability.projectPl(input);
  }

  getCostToCompany(input: ReportReadInput): Promise<CostToCompanyReport> {
    return this.profitability.costToCompany(input);
  }

  getCashProfitability(input: ReportReadInput): Promise<CashProfitabilityReport> {
    return this.performance.cashProfitability(input);
  }

  getContractPerformance(input: ReportReadInput): Promise<ContractPerformanceReport> {
    return this.performance.contractPerformance(input);
  }

  getBusinessOverview(input: ReportReadInput): Promise<BusinessOverviewReport> {
    return this.performance.businessOverview(input);
  }

  getGstOutput(input: ReportReadInput): Promise<GstOutputReport> {
    return this.gst.output(input);
  }

  getGstInput(input: ReportReadInput): Promise<GstInputReport> {
    return this.gst.input(input);
  }

  getGstNet(input: ReportReadInput): Promise<GstNetReport> {
    return this.gst.net(input);
  }

  getGstRegister(input: ReportReadInput): Promise<GstRegisterReport> {
    return this.gst.register(input);
  }

  getTdsInward(input: ReportReadInput): Promise<TdsInwardReport> {
    return this.tds.inward(input);
  }

  getTdsReconciliation(input: ReportReadInput): Promise<TdsReconciliationReport> {
    return this.tds.reconciliation(input);
  }

  getTdsOutward(input: ReportReadInput): Promise<TdsOutwardReport> {
    return this.tds.outward(input);
  }

  getCashFlow(input: ReportReadInput): Promise<CashFlowReport> {
    return this.cashFlowReports.cashFlow(input);
  }

  getPayablesAging(input: ReportReadInput): Promise<PayablesAgingReport> {
    return this.payables.payablesAging(input);
  }

  getVendorPayments(input: ReportReadInput): Promise<VendorPaymentReport> {
    return this.payables.vendorPayments(input);
  }

  getExpenses(input: ReportReadInput): Promise<ExpenseReport> {
    return this.payables.expenses(input);
  }

  getReimbursements(input: ReportReadInput): Promise<ReimbursementReport> {
    return this.payables.reimbursements(input);
  }

  getEmployeeAdvances(input: ReportReadInput): Promise<EmployeeAdvanceReport> {
    return this.payables.employeeAdvances(input);
  }

  getEmdSdRecovery(input: ReportReadInput): Promise<EmdSdRecoveryReport> {
    return this.operations.emdSdRecovery(input);
  }

  getIntroducerStatement(input: ReportReadInput): Promise<IntroducerStatementReport> {
    return this.operations.introducerStatement(input);
  }

  getPenalties(input: ReportReadInput): Promise<PenaltyReport> {
    return this.operations.penalties(input);
  }

  getPaymentHolds(input: ReportReadInput): Promise<PaymentHoldReport> {
    return this.operations.paymentHolds(input);
  }

  getPendingInvoices(input: ReportReadInput): Promise<PendingInvoiceReport> {
    return this.receivables.pendingInvoices(input);
  }

  getClientPayments(input: ReportReadInput): Promise<ClientPaymentReport> {
    return this.operations.clientPayments(input);
  }

  getManpowerUtilization(input: ReportReadInput): Promise<ManpowerUtilizationReport> {
    return this.resources.manpowerUtilization(input);
  }

  getAuditActivity(input: ReportReadInput): Promise<AuditActivityReport> {
    return this.controls.auditActivity(input);
  }

  getExceptions(input: ReportReadInput): Promise<ExceptionsReport> {
    return this.controls.exceptions(input);
  }

  /**
   * Renders the same computed report the screen shows — same query, same
   * filters (docs/04 §16) — and records the export in the audit trail
   * (docs/09: "Export actions for sensitive reports").
   */
  async exportReport(
    input: ReportReadInput & { key: ReportKey; format: ReportExportFormat; correlationId: string; ipAddress: string | undefined; userAgent: string | undefined },
  ): Promise<ReportExportResult> {
    const document = await this.documentFor(input.key, input);
    const isXlsx = input.format === 'XLSX';
    const buffer = isXlsx ? await this.exporter.toXlsx(document) : await this.exporter.toPdf(document);
    const period = input.filters.dateFrom ? `${input.filters.dateFrom}-to-${input.filters.asOfDate}` : input.filters.asOfDate;
    const filename = `${input.key}-${period}.${isXlsx ? 'xlsx' : 'pdf'}`;

    await this.prisma.client.$transaction((tx) =>
      recordAuditEvent(tx, {
        organizationId: input.organizationId,
        legalEntityId: input.filters.legalEntityId,
        entityType: 'REPORT',
        entityId: generateId(),
        action: 'REPORT_EXPORTED',
        actorId: input.actorId,
        correlationId: input.correlationId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        newValues: { report: input.key, format: input.format, filename, filters: input.filters },
      }),
    );

    return { filename, mimeType: isXlsx ? XLSX_MIME_TYPE : 'application/pdf', base64: buffer.toString('base64') };
  }

  private async documentFor(key: ReportKey, input: ReportReadInput): Promise<ReportDocument> {
    switch (key) {
      case 'receivable-aging':
        return agingDocument(await this.receivables.aging(input));
      case 'outstanding-summary':
        return outstandingSummaryDocument(await this.receivables.outstandingSummary(input));
      case 'project-pl':
        return projectPlDocument(await this.profitability.projectPl(input));
      case 'cost-to-company':
        return costToCompanyDocument(await this.profitability.costToCompany(input));
      case 'cash-profitability':
        return cashProfitabilityDocument(await this.performance.cashProfitability(input));
      case 'contract-performance':
        return contractPerformanceDocument(await this.performance.contractPerformance(input));
      case 'business-overview':
        return businessOverviewDocument(await this.performance.businessOverview(input));
      case 'gst-output':
        return gstOutputDocument(await this.gst.output(input));
      case 'gst-input':
        return gstInputDocument(await this.gst.input(input));
      case 'gst-net':
        return gstNetDocument(await this.gst.net(input));
      case 'gst-register':
        return gstRegisterDocument(await this.gst.register(input));
      case 'tds-inward':
        return tdsInwardDocument(await this.tds.inward(input));
      case 'tds-reconciliation':
        return tdsReconciliationDocument(await this.tds.reconciliation(input));
      case 'tds-outward':
        return tdsOutwardDocument(await this.tds.outward(input));
      case 'cash-flow':
        return cashFlowDocument(await this.cashFlowReports.cashFlow(input));
      case 'payables-aging':
        return payablesAgingDocument(await this.payables.payablesAging(input));
      case 'vendor-payments':
        return vendorPaymentsDocument(await this.payables.vendorPayments(input));
      case 'expenses':
        return expensesDocument(await this.payables.expenses(input));
      case 'reimbursements':
        return reimbursementsDocument(await this.payables.reimbursements(input));
      case 'employee-advances':
        return employeeAdvancesDocument(await this.payables.employeeAdvances(input));
      case 'emd-sd-recovery':
        return emdSdRecoveryDocument(await this.operations.emdSdRecovery(input));
      case 'introducer-statement':
        return introducerStatementDocument(await this.operations.introducerStatement(input));
      case 'penalties':
        return penaltiesDocument(await this.operations.penalties(input));
      case 'payment-holds':
        return paymentHoldsDocument(await this.operations.paymentHolds(input));
      case 'pending-invoices':
        return pendingInvoicesDocument(await this.receivables.pendingInvoices(input));
      case 'client-payments':
        return clientPaymentsDocument(await this.operations.clientPayments(input));
      case 'manpower-utilization':
        return manpowerUtilizationDocument(await this.resources.manpowerUtilization(input));
      case 'audit-activity':
        return auditActivityDocument(await this.controls.auditActivity(input));
      case 'exceptions':
        return exceptionsDocument(await this.controls.exceptions(input));
    }
  }
}
