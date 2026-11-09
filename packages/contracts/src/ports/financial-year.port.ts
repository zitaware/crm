export interface FinancialYearSummary {
  id: string;
  legalEntityId: string;
  label: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  version: number;
}

export type AccountingPeriodStatus = 'OPEN' | 'SOFT_CLOSED' | 'LOCKED';

export interface AccountingPeriodSummary {
  id: string;
  financialYearId: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
  status: AccountingPeriodStatus;
  lockedAt: string | null;
  lockedBy: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  version: number;
}

export type AccountingPeriodAction = 'SOFT_CLOSE' | 'LOCK' | 'REOPEN';

export interface AccountingPeriodTransitionSummary {
  id: string;
  accountingPeriodId: string;
  previousStatus: string;
  newStatus: string;
  action: string;
  actorId: string;
  reason: string;
  createdAt: string;
}

export interface FinancialYearPort {
  list(input: { organizationId: string; legalEntityId: string }): Promise<FinancialYearSummary[]>;

  /** Creates the financial year and its 12 accounting periods atomically
   * (accounting_periods are system-generated, never created independently). */
  create(input: {
    organizationId: string;
    legalEntityId: string;
    label: string;
    startDate: string;
    endDate: string;
    setCurrent: boolean;
    actorId: string;
    correlationId: string;
  }): Promise<FinancialYearSummary>;

  /** Marks this financial year current for its legal entity, un-setting
   * whichever one was current before — the same side-effect `create`'s
   * `setCurrent` has, but callable on an already-existing financial year. */
  setCurrentFinancialYear(input: {
    organizationId: string;
    legalEntityId: string;
    id: string;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<FinancialYearSummary>;

  listAccountingPeriods(input: {
    organizationId: string;
    financialYearId: string;
  }): Promise<AccountingPeriodSummary[]>;

  /** Maker-checker: REOPEN throws SELF_APPROVAL_NOT_ALLOWED if the actor
   * matches the period's current lockedBy. `reason` is mandatory for every
   * transition and is always recorded in accounting_period_transitions. */
  transitionAccountingPeriod(input: {
    organizationId: string;
    accountingPeriodId: string;
    action: AccountingPeriodAction;
    reason: string;
    actorId: string;
    correlationId: string;
  }): Promise<AccountingPeriodSummary>;

  listAccountingPeriodTransitions(input: {
    organizationId: string;
    accountingPeriodId: string;
  }): Promise<AccountingPeriodTransitionSummary[]>;
}
