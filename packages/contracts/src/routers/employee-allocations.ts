import { z } from 'zod';
import { requirePermission, router } from '../trpc';
import { monthWithoutSalary, seesSalary, summaryRowWithoutSalary } from '../salary-visibility';

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format.');
const percentageSchema = z.string().regex(/^\d{1,3}(\.\d{1,4})?$/, 'Must be a percentage with up to 4 decimal places.');

const lineSchema = z.object({
  projectId: z.string().uuid().optional(),
  allocationTargetId: z.string().uuid().optional(),
  percentage: percentageSchema,
  contributionNote: z.string().max(1000).optional(),
});

export const employeeAllocationsRouter = router({
  getMonth: requirePermission('employee_allocation.read')
    .input(z.object({ employeeId: z.string().uuid(), allocationMonth: dateStringSchema }))
    .query(async ({ ctx, input }) => {
      const month = await ctx.services.employeeAllocations.getMonth({
        organizationId: ctx.auth.user!.organizationId,
        employeeId: input.employeeId,
        allocationMonth: input.allocationMonth,
      });
      // Salary is confidential (ADR-175).
      return seesSalary(ctx.auth.permissions) ? month : monthWithoutSalary(month);
    }),

  getSummary: requirePermission('employee_allocation.read')
    .input(
      z.object({
        allocationMonth: dateStringSchema,
        status: z.enum(['DRAFT', 'SUBMITTED', 'NOT_STARTED']).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const summary = await ctx.services.employeeAllocations.getSummary({
        organizationId: ctx.auth.user!.organizationId,
        allocationMonth: input.allocationMonth,
        filters: { status: input.status },
      });
      return seesSalary(ctx.auth.permissions) ? summary : { ...summary, rows: summary.rows.map(summaryRowWithoutSalary) };
    }),

  saveDraft: requirePermission('employee_allocation.manage')
    .input(
      z.object({
        employeeId: z.string().uuid(),
        allocationMonth: dateStringSchema,
        note: z.string().max(1000).optional(),
        lines: z.array(lineSchema).max(50),
        expectedVersion: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const month = await ctx.services.employeeAllocations.saveDraft({
        organizationId: ctx.auth.user!.organizationId,
        employeeId: input.employeeId,
        allocationMonth: input.allocationMonth,
        note: input.note,
        lines: input.lines.map((l) => ({
          projectId: l.projectId,
          allocationTargetId: l.allocationTargetId,
          percentage: l.percentage,
          contributionNote: l.contributionNote,
        })),
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      // Salary is confidential (ADR-175).
      return seesSalary(ctx.auth.permissions) ? month : monthWithoutSalary(month);
    }),

  submit: requirePermission('employee_allocation.manage')
    .input(z.object({ employeeId: z.string().uuid(), allocationMonth: dateStringSchema, expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const month = await ctx.services.employeeAllocations.submit({
        organizationId: ctx.auth.user!.organizationId,
        employeeId: input.employeeId,
        allocationMonth: input.allocationMonth,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      // Salary is confidential (ADR-175).
      return seesSalary(ctx.auth.permissions) ? month : monthWithoutSalary(month);
    }),

  reopen: requirePermission('employee_allocation.manage')
    .input(
      z.object({
        employeeId: z.string().uuid(),
        allocationMonth: dateStringSchema,
        expectedVersion: z.number().int(),
        reason: z.string().min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const month = await ctx.services.employeeAllocations.reopen({
        organizationId: ctx.auth.user!.organizationId,
        employeeId: input.employeeId,
        allocationMonth: input.allocationMonth,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      // Salary is confidential (ADR-175).
      return seesSalary(ctx.auth.permissions) ? month : monthWithoutSalary(month);
    }),

  /** Project manpower cost. Scoped through ProjectsService's own project
   * scope, so a Project Manager sees cost for exactly the projects they can
   * already see (ADR-058) — never a second definition of scope. */
  getProjectManpowerCost: requirePermission('project_cost.read')
    .input(
      z.object({
        fromMonth: dateStringSchema,
        toMonth: dateStringSchema,
        projectId: z.string().uuid().optional(),
        legalEntityId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.employeeAllocations.getProjectManpowerCost({
        organizationId: ctx.auth.user!.organizationId,
        fromMonth: input.fromMonth,
        toMonth: input.toMonth,
        projectId: input.projectId,
        legalEntityId: input.legalEntityId,
        actorId: ctx.auth.user!.id,
        canSeeAllProjects: ctx.auth.permissions.has('project.read_all'),
      });
    }),
});
