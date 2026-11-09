export interface AuditEventSummary {
  id: string;
  organizationId: string;
  legalEntityId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string | null;
  actorEmail: string | null;
  oldValues: unknown;
  newValues: unknown;
  commandPayload: unknown;
  reason: string | null;
  correlationId: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditEventFilters {
  /** Substring match against the actor_email snapshot — not a live Users
   * join, so a since-renamed or disabled actor's historical actions still
   * surface correctly (see ADR-051). */
  actorEmail?: string | undefined;
  entityType?: string | undefined;
  action?: string | undefined;
  /** Inclusive UTC date-only bounds (YYYY-MM-DD). */
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

export interface AuditPort {
  list(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    filters: AuditEventFilters;
  }): Promise<{ rows: AuditEventSummary[]; total: number }>;

  getById(input: { organizationId: string; id: string }): Promise<AuditEventSummary>;

  /** Distinct entity_type values actually present for this organization —
   * drives the filter dropdown without a hardcoded, ever-stale enum. */
  listEntityTypes(input: { organizationId: string }): Promise<string[]>;

  /** Distinct action values actually present for this organization. */
  listActions(input: { organizationId: string }): Promise<string[]>;
}
