export interface TenderSummary {
  id: string;
  clientId: string;
  clientName: string;
  leadId: string | null;
  tenderPortalId: string | null;
  tenderPortalName: string | null;
  assignedToEmployeeId: string | null;
  assignedToEmployeeName: string | null;
  tenderNumber: string;
  title: string;
  description: string | null;
  submissionStatus: string;
  result: string;
  estimatedValue: string | null;
  tenderDate: string;
  submissionDeadline: string | null;
  submittedDate: string | null;
  resultDate: string | null;
  reminderOffset: string | null;
  internalNote: string | null;
  /** Most recent TenderUpdate.createdAt, falling back to the tender's own
   * createdAt when no update has been added yet. */
  lastActivityAt: string;
  createdAt: string;
  version: number;
}

export interface TenderUpdateEntry {
  id: string;
  title: string;
  note: string;
  createdAt: string;
  createdByEmail: string | null;
}

export interface TenderPort {
  list(input: { organizationId: string }): Promise<TenderSummary[]>;

  getDetail(input: { organizationId: string; id: string }): Promise<TenderSummary>;

  create(input: {
    organizationId: string;
    clientId: string;
    leadId: string | undefined;
    tenderPortalId: string | undefined;
    tenderNumber: string;
    title: string;
    description: string | undefined;
    submissionStatus: string | undefined;
    result: string | undefined;
    estimatedValue: string | undefined;
    tenderDate: string;
    submissionDeadline: string | undefined;
    submittedDate: string | undefined;
    resultDate: string | undefined;
    reminderOffset: string | undefined;
    internalNote: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<TenderSummary>;

  /** `clientId` is immutable after creation — not part of the update input. */
  update(input: {
    organizationId: string;
    id: string;
    leadId: string | undefined;
    tenderPortalId: string | undefined;
    assignedToEmployeeId: string | undefined;
    tenderNumber: string | undefined;
    title: string | undefined;
    description: string | undefined;
    submissionStatus: string | undefined;
    result: string | undefined;
    estimatedValue: string | undefined;
    tenderDate: string | undefined;
    submissionDeadline: string | undefined;
    submittedDate: string | undefined;
    resultDate: string | undefined;
    reminderOffset: string | undefined;
    internalNote: string | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<TenderSummary>;

  listUpdates(input: { organizationId: string; tenderId: string }): Promise<TenderUpdateEntry[]>;

  createUpdate(input: {
    organizationId: string;
    tenderId: string;
    title: string;
    note: string;
    actorId: string;
    correlationId: string;
  }): Promise<TenderUpdateEntry>;
}
