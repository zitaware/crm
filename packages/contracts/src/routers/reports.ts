import { z } from 'zod';
import { protectedProcedure, requirePermission, router } from '../trpc';
import { throwAppError } from '../errors';
import type { Context } from '../context';
import {
  REPORT_CATEGORY_PERMISSIONS,
  REPORT_EXPORT_PERMISSION,
  REPORT_KEY_CATEGORIES,
  REPORT_KEYS,
  type ReportReadInput,
} from '../ports/report.port';

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');

const filtersSchema = z.object({
  legalEntityId: z.string().uuid().optional(),
  dateFrom: dateStringSchema.optional(),
  asOfDate: dateStringSchema,
  clientId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
});

function readInput(ctx: Context, filters: z.infer<typeof filtersSchema>): ReportReadInput {
  return {
    organizationId: ctx.auth.user!.organizationId,
    actorId: ctx.auth.user!.id,
    // Project scoping reuses the rest of the app's rule: without
    // project.read_all an actor sees only their own projects' figures.
    canSeeAllProjects: ctx.auth.permissions.has('project.read_all'),
    filters: {
      legalEntityId: filters.legalEntityId,
      dateFrom: filters.dateFrom,
      asOfDate: filters.asOfDate,
      clientId: filters.clientId,
      projectId: filters.projectId,
    },
  };
}

// Read-only except `export`, a mutation only because it is audited
// (docs/09: "Export actions for sensitive reports").
export const reportsRouter = router({
  getCatalog: protectedProcedure.query(async ({ ctx }) => {
    return ctx.services.reports.getCatalog({ permissions: [...ctx.auth.permissions] });
  }),

  receivableAging: requirePermission(REPORT_CATEGORY_PERMISSIONS.RECEIVABLES)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getReceivableAging(readInput(ctx, input))),

  outstandingSummary: requirePermission(REPORT_CATEGORY_PERMISSIONS.RECEIVABLES)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getOutstandingSummary(readInput(ctx, input))),

  projectPl: requirePermission(REPORT_CATEGORY_PERMISSIONS.PROFITABILITY)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getProjectPl(readInput(ctx, input))),

  costToCompany: requirePermission(REPORT_CATEGORY_PERMISSIONS.PROFITABILITY)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getCostToCompany(readInput(ctx, input))),

  cashProfitability: requirePermission(REPORT_CATEGORY_PERMISSIONS.PROFITABILITY)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getCashProfitability(readInput(ctx, input))),

  contractPerformance: requirePermission(REPORT_CATEGORY_PERMISSIONS.PROFITABILITY)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getContractPerformance(readInput(ctx, input))),

  businessOverview: requirePermission(REPORT_CATEGORY_PERMISSIONS.PROFITABILITY)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getBusinessOverview(readInput(ctx, input))),

  gstOutput: requirePermission(REPORT_CATEGORY_PERMISSIONS.GST)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getGstOutput(readInput(ctx, input))),

  gstInput: requirePermission(REPORT_CATEGORY_PERMISSIONS.GST)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getGstInput(readInput(ctx, input))),

  gstNet: requirePermission(REPORT_CATEGORY_PERMISSIONS.GST)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getGstNet(readInput(ctx, input))),

  gstRegister: requirePermission(REPORT_CATEGORY_PERMISSIONS.GST)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getGstRegister(readInput(ctx, input))),

  tdsInward: requirePermission(REPORT_CATEGORY_PERMISSIONS.TDS)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getTdsInward(readInput(ctx, input))),

  tdsReconciliation: requirePermission(REPORT_CATEGORY_PERMISSIONS.TDS)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getTdsReconciliation(readInput(ctx, input))),

  tdsOutward: requirePermission(REPORT_CATEGORY_PERMISSIONS.TDS)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getTdsOutward(readInput(ctx, input))),

  cashFlow: requirePermission(REPORT_CATEGORY_PERMISSIONS.CASH)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getCashFlow(readInput(ctx, input))),

  payablesAging: requirePermission(REPORT_CATEGORY_PERMISSIONS.PAYABLES)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getPayablesAging(readInput(ctx, input))),

  vendorPayments: requirePermission(REPORT_CATEGORY_PERMISSIONS.PAYABLES)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getVendorPayments(readInput(ctx, input))),

  expenses: requirePermission(REPORT_CATEGORY_PERMISSIONS.PAYABLES)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getExpenses(readInput(ctx, input))),

  reimbursements: requirePermission(REPORT_CATEGORY_PERMISSIONS.PAYABLES)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getReimbursements(readInput(ctx, input))),

  employeeAdvances: requirePermission(REPORT_CATEGORY_PERMISSIONS.PAYABLES)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getEmployeeAdvances(readInput(ctx, input))),

  emdSdRecovery: requirePermission(REPORT_CATEGORY_PERMISSIONS.OPERATIONS)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getEmdSdRecovery(readInput(ctx, input))),

  introducerStatement: requirePermission(REPORT_CATEGORY_PERMISSIONS.OPERATIONS)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getIntroducerStatement(readInput(ctx, input))),

  penalties: requirePermission(REPORT_CATEGORY_PERMISSIONS.OPERATIONS)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getPenalties(readInput(ctx, input))),

  paymentHolds: requirePermission(REPORT_CATEGORY_PERMISSIONS.OPERATIONS)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getPaymentHolds(readInput(ctx, input))),

  pendingInvoices: requirePermission(REPORT_CATEGORY_PERMISSIONS.OPERATIONS)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getPendingInvoices(readInput(ctx, input))),

  clientPayments: requirePermission(REPORT_CATEGORY_PERMISSIONS.OPERATIONS)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getClientPayments(readInput(ctx, input))),

  manpowerUtilization: requirePermission(REPORT_CATEGORY_PERMISSIONS.OPERATIONS)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getManpowerUtilization(readInput(ctx, input))),

  auditActivity: requirePermission(REPORT_CATEGORY_PERMISSIONS.CONTROLS)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getAuditActivity(readInput(ctx, input))),

  exceptions: requirePermission(REPORT_CATEGORY_PERMISSIONS.CONTROLS)
    .input(filtersSchema)
    .query(async ({ ctx, input }) => ctx.services.reports.getExceptions(readInput(ctx, input))),

  export: requirePermission(REPORT_EXPORT_PERMISSION)
    .input(z.object({ key: z.enum(REPORT_KEYS), format: z.enum(['XLSX', 'PDF']), filters: filtersSchema }))
    .mutation(async ({ ctx, input }) => {
      // Exporting needs the report's own read key too — the export key alone
      // must never open a report its holder cannot view.
      const needed = REPORT_CATEGORY_PERMISSIONS[REPORT_KEY_CATEGORIES[input.key]];
      if (!ctx.auth.permissions.has(needed)) throwAppError('FORBIDDEN', `Missing permission: ${needed}`);
      return ctx.services.reports.exportReport({
        ...readInput(ctx, input.filters),
        key: input.key,
        format: input.format,
        correlationId: ctx.correlationId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    }),
});
