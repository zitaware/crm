export interface IntroducerSummary {
  id: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  version: number;
}

export interface IntroducerPort {
  list(input: { organizationId: string; includeInactive: boolean | undefined }): Promise<IntroducerSummary[]>;

  create(input: {
    organizationId: string;
    name: string;
    phone: string | undefined;
    actorId: string;
    correlationId: string;
  }): Promise<IntroducerSummary>;

  update(input: {
    organizationId: string;
    id: string;
    name: string | undefined;
    phone: string | undefined;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<IntroducerSummary>;

  setActive(input: {
    organizationId: string;
    id: string;
    isActive: boolean;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
  }): Promise<void>;
}
