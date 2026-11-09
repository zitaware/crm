import { z } from 'zod';
import { requireAnyPermission, requirePermission, router } from '../trpc';

const decimalStringSchema = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Must be a valid decimal amount.');
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');
const stageSchema = z.enum([
  'WON',
  'WORK_ORDER_RECEIVED',
  'WAITING_FOR_PERMISSIONS',
  'WORK_STARTED',
  'WORK_DONE',
  'SUCCESSFULLY_COMPLETED',
]);
const statusSchema = z.enum(['ACTIVE', 'ON_HOLD', 'CANCELLED', 'CLOSED']);

export const projectsRouter = router({
  list: requirePermission('project.read').query(async ({ ctx }) => {
    return ctx.services.projects.list({
      organizationId: ctx.auth.user!.organizationId,
      actorId: ctx.auth.user!.id,
      canSeeAll: ctx.auth.permissions.has('project.read_all'),
    });
  }),

  listManagerCandidates: requirePermission('project.read')
    .input(z.object({ legalEntityId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.projects.listManagerCandidates({ organizationId: ctx.auth.user!.organizationId, legalEntityId: input.legalEntityId });
    }),

  getDetail: requirePermission('project.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.projects.getDetail({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        actorId: ctx.auth.user!.id,
        canSeeAll: ctx.auth.permissions.has('project.read_all'),
      });
    }),

  create: requirePermission('project.create')
    .input(
      z.object({
        clientId: z.string().uuid(),
        legalEntityId: z.string().uuid(),
        leadId: z.string().uuid().optional(),
        tenderId: z.string().uuid().optional(),
        projectManagerId: z.string().uuid().optional(),
        salesManagerId: z.string().uuid().optional(),
        introducerId: z.string().uuid().optional(),
        projectTypeId: z.string().uuid().optional(),
        name: z.string().min(1).max(300),
        description: z.string().max(2000).optional(),
        value: decimalStringSchema.optional(),
        budget: decimalStringSchema.optional(),
        gstApplicable: z.boolean().optional(),
        workOrderNumber: z.string().max(100).optional(),
        workOrderDate: dateStringSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.projects.create({
        organizationId: ctx.auth.user!.organizationId,
        clientId: input.clientId,
        legalEntityId: input.legalEntityId,
        leadId: input.leadId,
        tenderId: input.tenderId,
        projectManagerId: input.projectManagerId,
        salesManagerId: input.salesManagerId,
        introducerId: input.introducerId,
        projectTypeId: input.projectTypeId,
        name: input.name,
        description: input.description,
        value: input.value,
        budget: input.budget,
        gstApplicable: input.gstApplicable,
        workOrderNumber: input.workOrderNumber,
        workOrderDate: input.workOrderDate,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  update: requirePermission('project.update')
    .input(
      // null clears an optional link or date; omitted leaves it unchanged.
      z.object({
        id: z.string().uuid(),
        leadId: z.string().uuid().nullable().optional(),
        tenderId: z.string().uuid().optional(),
        projectManagerId: z.string().uuid().nullable().optional(),
        salesManagerId: z.string().uuid().nullable().optional(),
        introducerId: z.string().uuid().nullable().optional(),
        projectTypeId: z.string().uuid().nullable().optional(),
        name: z.string().min(1).max(300).optional(),
        description: z.string().max(2000).optional(),
        value: decimalStringSchema.optional(),
        budget: decimalStringSchema.optional(),
        gstApplicable: z.boolean().optional(),
        workOrderNumber: z.string().max(100).optional(),
        workOrderDate: dateStringSchema.nullable().optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.projects.update({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        leadId: input.leadId,
        tenderId: input.tenderId,
        projectManagerId: input.projectManagerId,
        salesManagerId: input.salesManagerId,
        introducerId: input.introducerId,
        projectTypeId: input.projectTypeId,
        name: input.name,
        description: input.description,
        value: input.value,
        budget: input.budget,
        gstApplicable: input.gstApplicable,
        workOrderNumber: input.workOrderNumber,
        workOrderDate: input.workOrderDate,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        canSeeAll: ctx.auth.permissions.has('project.read_all'),
        correlationId: ctx.correlationId,
      });
    }),

  changeStage: requirePermission('project.change_stage')
    .input(
      z.object({
        id: z.string().uuid(),
        targetStage: stageSchema,
        reason: z.string().max(1000).optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.projects.changeStage({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        targetStage: input.targetStage,
        reason: input.reason,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        canSeeAll: ctx.auth.permissions.has('project.read_all'),
        correlationId: ctx.correlationId,
      });
    }),

  changeStatus: requirePermission('project.change_status')
    .input(
      z.object({
        id: z.string().uuid(),
        targetStatus: statusSchema,
        reason: z.string().max(1000).optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.projects.changeStatus({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        targetStatus: input.targetStatus,
        reason: input.reason,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        canSeeAll: ctx.auth.permissions.has('project.read_all'),
        correlationId: ctx.correlationId,
      });
    }),

  listTeamMembers: requirePermission('project.read')
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.projects.listTeamMembers({
        organizationId: ctx.auth.user!.organizationId,
        projectId: input.projectId,
        actorId: ctx.auth.user!.id,
        canSeeAll: ctx.auth.permissions.has('project.read_all'),
      });
    }),

  addTeamMember: requireAnyPermission('project.update', 'project.manage_team')
    .input(z.object({ projectId: z.string().uuid(), employeeId: z.string().uuid(), role: z.string().max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.projects.addTeamMember({
        organizationId: ctx.auth.user!.organizationId,
        projectId: input.projectId,
        employeeId: input.employeeId,
        role: input.role,
        actorId: ctx.auth.user!.id,
        canSeeAll: ctx.auth.permissions.has('project.read_all'),
        correlationId: ctx.correlationId,
      });
    }),

  removeTeamMember: requireAnyPermission('project.update', 'project.manage_team')
    .input(z.object({ projectId: z.string().uuid(), employeeId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.services.projects.removeTeamMember({
        organizationId: ctx.auth.user!.organizationId,
        projectId: input.projectId,
        employeeId: input.employeeId,
        actorId: ctx.auth.user!.id,
        canSeeAll: ctx.auth.permissions.has('project.read_all'),
        correlationId: ctx.correlationId,
      });
      return { success: true };
    }),

  listProgress: requirePermission('project.read')
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.projects.listProgress({
        organizationId: ctx.auth.user!.organizationId,
        projectId: input.projectId,
        actorId: ctx.auth.user!.id,
        canSeeAll: ctx.auth.permissions.has('project.read_all'),
      });
    }),

  addProgress: requirePermission('project_progress.create')
    .input(z.object({ projectId: z.string().uuid(), title: z.string().min(1).max(300), percentage: z.number().int().min(0).max(100), note: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.projects.addProgress({
        organizationId: ctx.auth.user!.organizationId,
        projectId: input.projectId,
        title: input.title,
        percentage: input.percentage,
        note: input.note,
        actorId: ctx.auth.user!.id,
        canSeeAll: ctx.auth.permissions.has('project.read_all'),
        correlationId: ctx.correlationId,
      });
    }),

  getExpenseLedger: requirePermission('project.read')
    .input(
      z.object({
        projectId: z.string().uuid(),
        category: z
          .enum(['PURCHASE', 'REIMBURSEMENT', 'DIRECT_EXPENSE', 'MATERIAL', 'MANPOWER', 'INTRODUCER'])
          .optional(),
        dateFrom: dateStringSchema.optional(),
        dateTo: dateStringSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.projects.getExpenseLedger({
        organizationId: ctx.auth.user!.organizationId,
        projectId: input.projectId,
        actorId: ctx.auth.user!.id,
        canSeeAll: ctx.auth.permissions.has('project.read_all'),
        hasVendorBillReadPermission: ctx.auth.permissions.has('vendor_bill.read'),
        hasEmployeeClaimReadPermission: ctx.auth.permissions.has('employee_claim.read'),
        hasDirectExpenseReadPermission: ctx.auth.permissions.has('direct_expense.read'),
        hasInventoryReadPermission: ctx.auth.permissions.has('inventory.read'),
        hasProjectCostReadPermission: ctx.auth.permissions.has('project_cost.read'),
        hasIntroducerFeeReadPermission: ctx.auth.permissions.has('introducer_fee.read'),
        category: input.category,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
      });
    }),

  getFinancialSummary: requirePermission('project.read_financials')
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.projectFinancials.getFinancialSummary({
        organizationId: ctx.auth.user!.organizationId,
        projectId: input.projectId,
        actorId: ctx.auth.user!.id,
        canSeeAll: ctx.auth.permissions.has('project.read_all'),
      });
    }),

  listFinancialSummaries: requirePermission('project.read_financials')
    .input(z.object({ projectIds: z.array(z.string().uuid()).min(1) }))
    .query(async ({ ctx, input }) => {
      return ctx.services.projectFinancials.listFinancialSummaries({
        organizationId: ctx.auth.user!.organizationId,
        actorId: ctx.auth.user!.id,
        canSeeAll: ctx.auth.permissions.has('project.read_all'),
        projectIds: input.projectIds,
      });
    }),
});
