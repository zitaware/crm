export interface LeadSummary {
  id: string;
  clientId: string;
  clientName: string;
  leadTypeId: string;
  leadTypeName: string;
  leadSourceId: string;
  leadSourceName: string;
  introducerId: string | null;
  introducerName: string | null;
  assignedToEmployeeId: string | null;
  assignedToEmployeeName: string | null;
  title: string;
  description: string | null;
  stage: string;
  estimatedValue: string | null;
  leadDate: string;
  expectedCloseDate: string | null;
  expectedTenderDate: string | null;
  tenderNumber: string | null;
  tenderDate: string | null;
  submissionDeadline: string | null;
  reminderOffset: string | null;
  internalNote: string | null;
  /** Most recent LeadUpdate.createdAt, falling back to the lead's own
   * createdAt when no update has been added yet. Drives the list's "Last
   * Update" column without a separate per-row query. */
  lastActivityAt: string;
  createdAt: string;
  version: number;
}

export interface LeadUpdateEntry {
  id: string;
  title: string;
  note: string;
  createdAt: string;
  createdByEmail: string | null;
}

export interface LeadPort {
  list(input: { organizationId: string }): Promise<LeadSummary[]>;

  getDetail(input: { organizationId: string; id: string }): Promise<LeadSummary>;

  create(input: {
    organizationId: string;
    clientId: string;
    leadTypeId: string;
    leadSourceId: string;
    introducerId: string | undefined;
    title: string;
    description: string | undefined;
    stage: string | undefined;
    estimatedValue: string | undefined;
    leadDate: string;
    expectedCloseDate: string | undefined;
    expectedTenderDate: string | undefined;
    tenderNumber: string | undefined;
    tenderDate: string | undefined;
    submissionDeadline: string | undefined;
    reminderOffset: string | undefined;
    internalNote: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<LeadSummary>;

  /** `clientId` is immutable after creation — not part of the update input. */
  update(input: {
    organizationId: string;
    id: string;
    leadTypeId: string | undefined;
    leadSourceId: string | undefined;
    introducerId: string | undefined;
    assignedToEmployeeId: string | undefined;
    title: string | undefined;
    description: string | undefined;
    stage: string | undefined;
    estimatedValue: string | undefined;
    leadDate: string | undefined;
    expectedCloseDate: string | undefined;
    expectedTenderDate: string | undefined;
    tenderNumber: string | undefined;
    tenderDate: string | undefined;
    submissionDeadline: string | undefined;
    reminderOffset: string | undefined;
    internalNote: string | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<LeadSummary>;

  listUpdates(input: { organizationId: string; leadId: string }): Promise<LeadUpdateEntry[]>;

  createUpdate(input: {
    organizationId: string;
    leadId: string;
    title: string;
    note: string;
    actorId: string;
    correlationId: string;
  }): Promise<LeadUpdateEntry>;
}
