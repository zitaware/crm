import { describe, expect, it, vi } from 'vitest';
import { appRouter, createCallerFactory } from '@zitaware/contracts';

const createCaller = createCallerFactory(appRouter);
type CallerContext = Parameters<typeof createCaller>[0];

const filters = { asOfDate: '2026-08-31' };

/** A caller holding exactly `permissions`, with the reports service stubbed. */
function callerWith(permissions: string[]) {
  const reports = {
    getCatalog: vi.fn(),
    getReceivableAging: vi.fn().mockResolvedValue({}),
    getOutstandingSummary: vi.fn().mockResolvedValue({}),
    getCashProfitability: vi.fn().mockResolvedValue({}),
    getContractPerformance: vi.fn().mockResolvedValue({}),
    getBusinessOverview: vi.fn().mockResolvedValue({}),
    getGstOutput: vi.fn().mockResolvedValue({}),
    getGstInput: vi.fn().mockResolvedValue({}),
    getGstNet: vi.fn().mockResolvedValue({}),
    getGstRegister: vi.fn().mockResolvedValue({}),
    exportReport: vi.fn().mockResolvedValue({ filename: 'x.xlsx', mimeType: 'application/octet-stream', base64: '' }),
  };
  const ctx = {
    correlationId: 'corr-1',
    requestTimestamp: new Date().toISOString(),
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
    auth: { user: { id: 'user-1', organizationId: 'org-1' }, permissions: new Set(permissions), sessionId: 'session-1' },
    services: { reports },
    res: { cookie: () => undefined, clearCookie: () => undefined },
    cookies: {},
  } as unknown as CallerContext;
  return { caller: createCaller(ctx), reports };
}

describe('reports router permissions (ADR-108)', () => {
  it('refuses a report to a caller without its category read key', async () => {
    const { caller, reports } = callerWith(['report.export']);
    await expect(caller.reports.receivableAging(filters)).rejects.toThrow('Missing permission: report.receivables.read');
    expect(reports.getReceivableAging).not.toHaveBeenCalled();
  });

  it('refuses an export to a caller holding only the export key — it must never open a report its holder cannot view', async () => {
    const { caller, reports } = callerWith(['report.export']);
    await expect(caller.reports.export({ key: 'receivable-aging', format: 'XLSX', filters })).rejects.toThrow('Missing permission: report.receivables.read');
    expect(reports.exportReport).not.toHaveBeenCalled();
  });

  it('refuses an export to a caller who may only read', async () => {
    const { caller, reports } = callerWith(['report.receivables.read']);
    await expect(caller.reports.export({ key: 'outstanding-summary', format: 'PDF', filters })).rejects.toThrow('Missing permission: report.export');
    expect(reports.exportReport).not.toHaveBeenCalled();
  });

  it('exports with both keys, passing the request details the audit event needs', async () => {
    const { caller, reports } = callerWith(['report.receivables.read', 'report.export']);
    await caller.reports.export({ key: 'receivable-aging', format: 'XLSX', filters });
    expect(reports.exportReport).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        actorId: 'user-1',
        canSeeAllProjects: false,
        key: 'receivable-aging',
        format: 'XLSX',
        correlationId: 'corr-1',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        filters: { legalEntityId: undefined, dateFrom: undefined, asOfDate: '2026-08-31', clientId: undefined, projectId: undefined },
      }),
    );
  });

  it('scopes to the caller\'s own projects unless they hold project.read_all', async () => {
    const scoped = callerWith(['report.receivables.read']);
    await scoped.caller.reports.outstandingSummary(filters);
    expect(scoped.reports.getOutstandingSummary).toHaveBeenCalledWith(expect.objectContaining({ canSeeAllProjects: false }));

    const all = callerWith(['report.receivables.read', 'project.read_all']);
    await all.caller.reports.outstandingSummary(filters);
    expect(all.reports.getOutstandingSummary).toHaveBeenCalledWith(expect.objectContaining({ canSeeAllProjects: true }));
  });

  it('guards the Phase 8.3 reports and their exports with the profitability key', async () => {
    const receivablesOnly = callerWith(['report.receivables.read', 'report.export']);
    await expect(receivablesOnly.caller.reports.cashProfitability(filters)).rejects.toThrow('Missing permission: report.profitability.read');
    await expect(receivablesOnly.caller.reports.contractPerformance(filters)).rejects.toThrow('Missing permission: report.profitability.read');
    await expect(receivablesOnly.caller.reports.businessOverview(filters)).rejects.toThrow('Missing permission: report.profitability.read');
    await expect(receivablesOnly.caller.reports.export({ key: 'business-overview', format: 'PDF', filters })).rejects.toThrow('Missing permission: report.profitability.read');

    const { caller, reports } = callerWith(['report.profitability.read']);
    await caller.reports.cashProfitability(filters);
    await caller.reports.contractPerformance(filters);
    await caller.reports.businessOverview(filters);
    expect(reports.getCashProfitability).toHaveBeenCalledTimes(1);
    expect(reports.getContractPerformance).toHaveBeenCalledTimes(1);
    expect(reports.getBusinessOverview).toHaveBeenCalledTimes(1);
  });

  it('guards the GST reports with their own key — the profitability key does not open them (ADR-111)', async () => {
    const profitability = callerWith(['report.profitability.read', 'report.export']);
    for (const proc of ['gstOutput', 'gstInput', 'gstNet', 'gstRegister'] as const) {
      await expect(profitability.caller.reports[proc](filters)).rejects.toThrow('Missing permission: report.gst.read');
    }
    await expect(profitability.caller.reports.export({ key: 'gst-net', format: 'XLSX', filters })).rejects.toThrow('Missing permission: report.gst.read');

    const { caller, reports } = callerWith(['report.gst.read']);
    await caller.reports.gstOutput(filters);
    await caller.reports.gstInput(filters);
    await caller.reports.gstNet(filters);
    await caller.reports.gstRegister(filters);
    for (const fn of [reports.getGstOutput, reports.getGstInput, reports.getGstNet, reports.getGstRegister]) expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rejects an as-of date that is not YYYY-MM-DD', async () => {
    const { caller } = callerWith(['report.receivables.read']);
    await expect(caller.reports.receivableAging({ asOfDate: '31/08/2026' })).rejects.toThrow();
  });
});
