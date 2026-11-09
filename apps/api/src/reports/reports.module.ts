import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { EmployeeAllocationsModule } from '../employee-allocations/employee-allocations.module';
import { TdsModule } from '../tds/tds.module';
import { ProfitabilityReportService } from './profitability-report.service';
import { GstReportService } from './gst-report.service';
import { TdsReportService } from './tds-report.service';
import { CashFlowReportService } from './cash-flow-report.service';
import { PayablesReportService } from './payables-report.service';
import { OperationsReportService } from './operations-report.service';
import { ResourceReportService } from './resource-report.service';
import { DashboardService } from './dashboard.service';
import { ControlsReportService } from './controls-report.service';
import { LedgerControlService } from './ledger-control.service';
import { PerformanceReportService } from './performance-report.service';
import { ReceivablesReportService } from './receivables-report.service';
import { ReportExportService } from './report-export.service';
import { ReportScopeService } from './report-scope.service';
import { ReportsService } from './reports.service';

@Module({
  imports: [ProjectsModule, EmployeeAllocationsModule, TdsModule],
  providers: [
    ReportsService,
    ReceivablesReportService,
    ProfitabilityReportService,
    PerformanceReportService,
    GstReportService,
    TdsReportService,
    CashFlowReportService,
    PayablesReportService,
    OperationsReportService,
    ResourceReportService,
    DashboardService,
    ControlsReportService,
    ReportScopeService,
    LedgerControlService,
    ReportExportService,
  ],
  exports: [ReportsService, DashboardService],
})
export class ReportsModule {}
