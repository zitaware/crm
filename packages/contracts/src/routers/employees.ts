import { z } from 'zod';
import { requirePermission, router } from '../trpc';
import { SALARY_PERMISSION, seesSalary, withoutSalary } from '../salary-visibility';

const decimalStringSchema = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Must be a valid decimal amount.');

export const employeesRouter = router({
  list: requirePermission('employee.read')
    .input(z.object({ includeInactive: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.services.employees.list({
        organizationId: ctx.auth.user!.organizationId,
        includeInactive: input.includeInactive,
      });
      // Salary is confidential (ADR-175).
      return seesSalary(ctx.auth.permissions) ? rows : rows.map(withoutSalary);
    }),

  listLinkable: requirePermission('user.manage').query(async ({ ctx }) => {
    return ctx.services.employees.listLinkable({ organizationId: ctx.auth.user!.organizationId });
  }),

  getDetail: requirePermission('employee.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const detail = await ctx.services.employees.getDetail({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
      });
      return detail && !seesSalary(ctx.auth.permissions) ? withoutSalary(detail) : detail;
    }),

  create: requirePermission('employee.manage')
    .input(
      z.object({
        userId: z.string().uuid().optional(),
        legalEntityId: z.string().uuid().optional(),
        internalDepartmentId: z.string().uuid().optional(),
        designationId: z.string().uuid().optional(),
        employmentTypeId: z.string().uuid().optional(),
        employeeCode: z.string().min(1).max(50),
        fullName: z.string().min(1).max(200),
        isReimbursable: z.boolean().optional(),
        displayedSalaryAmount: decimalStringSchema.optional(),
        joiningDate: z.string().date(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.employees.create({
        organizationId: ctx.auth.user!.organizationId,
        userId: input.userId,
        legalEntityId: input.legalEntityId,
        internalDepartmentId: input.internalDepartmentId,
        designationId: input.designationId,
        employmentTypeId: input.employmentTypeId,
        employeeCode: input.employeeCode,
        fullName: input.fullName,
        isReimbursable: input.isReimbursable,
        displayedSalaryAmount: input.displayedSalaryAmount,
        joiningDate: input.joiningDate,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  update: requirePermission('employee.manage')
    .input(
      z.object({
        id: z.string().uuid(),
        userId: z.string().uuid().optional(),
        legalEntityId: z.string().uuid().optional(),
        internalDepartmentId: z.string().uuid().optional(),
        designationId: z.string().uuid().optional(),
        employmentTypeId: z.string().uuid().optional(),
        fullName: z.string().min(1).max(200).optional(),
        isReimbursable: z.boolean().optional(),
        displayedSalaryAmount: decimalStringSchema.optional(),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.employees.update({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        userId: input.userId,
        legalEntityId: input.legalEntityId,
        internalDepartmentId: input.internalDepartmentId,
        designationId: input.designationId,
        employmentTypeId: input.employmentTypeId,
        fullName: input.fullName,
        isReimbursable: input.isReimbursable,
        displayedSalaryAmount: input.displayedSalaryAmount,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  downloadImportSample: requirePermission('employee.manage').query(async ({ ctx }) => {
    return ctx.services.employees.downloadImportSample();
  }),

  previewImport: requirePermission('employee.manage')
    .input(z.object({ contentBase64: z.string().min(1).max(4_000_000) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.employees.previewImport({
        organizationId: ctx.auth.user!.organizationId,
        contentBase64: input.contentBase64,
      });
    }),

  importRows: requirePermission('employee.manage')
    .input(z.object({ contentBase64: z.string().min(1).max(4_000_000) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.services.employees.importRows({
        organizationId: ctx.auth.user!.organizationId,
        contentBase64: input.contentBase64,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),

  setStatus: requirePermission('employee.manage')
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(['ACTIVE', 'INACTIVE']),
        expectedVersion: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.services.employees.setStatus({
        organizationId: ctx.auth.user!.organizationId,
        id: input.id,
        status: input.status,
        expectedVersion: input.expectedVersion,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
      return { status: 'ok' as const };
    }),

  /** An employee's compensation history (ADR-098). Confidential: only
   * holders of employee.read_salary (ADR-175). */
  listSalaryRevisions: requirePermission(SALARY_PERMISSION)
    .input(z.object({ employeeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.services.employeeSalaryRevisions.list({
        organizationId: ctx.auth.user!.organizationId,
        employeeId: input.employeeId,
      });
    }),

  /** Records a new salary effective from a date, superseding the current
   * one. Never edits a past period. */
  reviseSalary: requirePermission('employee.manage')
    .input(
      z.object({
        employeeId: z.string().uuid(),
        grossAmount: decimalStringSchema,
        effectiveFrom: z.string().date(),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.services.employeeSalaryRevisions.revise({
        organizationId: ctx.auth.user!.organizationId,
        employeeId: input.employeeId,
        grossAmount: input.grossAmount,
        effectiveFrom: input.effectiveFrom,
        reason: input.reason,
        actorId: ctx.auth.user!.id,
        correlationId: ctx.correlationId,
      });
    }),
});
