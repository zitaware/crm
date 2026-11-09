export interface FormDraftPort {
  get(input: { organizationId: string; userId: string; formKey: string }): Promise<{ payload: Record<string, unknown> | null }>;

  save(input: { organizationId: string; userId: string; formKey: string; payload: Record<string, unknown> }): Promise<void>;

  clear(input: { organizationId: string; userId: string; formKey: string }): Promise<void>;
}
