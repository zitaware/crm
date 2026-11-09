/**
 * Port (interface) for the Identity/Auth module. packages/contracts
 * depends only on this interface, never on apps/api's concrete NestJS
 * service — apps/api wires the real implementation into tRPC Context at
 * request time (see mount-trpc.ts's createContext). This keeps the
 * dependency direction correct: shared contracts never import concrete
 * app-layer implementations.
 */
/** Tokens issued by login, invite acceptance, and refresh. */
export interface IssuedSessionTokens {
  accessToken: string;
  /** When the access-token cookie and JWT both stop being valid. */
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface AuthPort {
  /**
   * No `organizationId` parameter — Phase 2 is single-organization
   * (ADR-004) and the server resolves it internally by looking up the
   * user by email. A client-supplied organization id is never accepted
   * for authorization (docs/09: "never accept organization_id from the
   * browser").
   */
  login(input: {
    email: string;
    password: string;
    ipAddress: string | undefined;
    userAgent: string | undefined;
    correlationId: string;
  }): Promise<IssuedSessionTokens>;

  refresh(input: {
    refreshToken: string;
    ipAddress: string | undefined;
    userAgent: string | undefined;
    correlationId: string;
  }): Promise<IssuedSessionTokens>;

  logout(input: { refreshToken: string; correlationId: string }): Promise<void>;

  requestPasswordReset(input: { email: string; correlationId: string }): Promise<void>;

  completePasswordReset(input: {
    token: string;
    newPassword: string;
    correlationId: string;
  }): Promise<void>;

  acceptInvite(input: {
    token: string;
    password: string;
    correlationId: string;
  }): Promise<IssuedSessionTokens>;

  verifyAccessToken(
    accessToken: string,
  ): Promise<{ userId: string; organizationId: string; sessionId: string; impersonatorUserId: string | null } | null>;

  /**
   * ADR-174: an Admin logs in as another user. A new session for that user
   * records the Admin and the Admin's own session, which stays open to
   * return to.
   */
  startImpersonation(input: {
    organizationId: string;
    adminUserId: string;
    adminSessionId: string;
    targetUserId: string;
    ipAddress: string | undefined;
    userAgent: string | undefined;
    correlationId: string;
  }): Promise<IssuedSessionTokens>;

  /** Ends viewing as another user and signs the Admin back in; null when the Admin's own session has ended meanwhile. */
  stopImpersonation(input: { sessionId: string; ipAddress: string | undefined; userAgent: string | undefined; correlationId: string }): Promise<IssuedSessionTokens | null>;

  /** The Admin viewing as this session's user, if any. */
  getImpersonator(sessionId: string): Promise<{ userId: string; displayName: string } | null>;

  /**
   * Display data for the shell's brand area and user menu — not part of the
   * auth decision itself. The brand is the legal entity of the user's own
   * employee record (white labelling); null when they have none, and the
   * shell then shows the organization.
   */
  getProfile(
    userId: string,
    organizationId: string,
  ): Promise<{ displayName: string; organizationName: string; brandName: string | null; brandHasLogo: boolean } | null>;

  /** The logo of that legal entity, for the shell's brand area; null when there is none. */
  getBrandLogo(userId: string, organizationId: string): Promise<{ contentType: 'image/png' | 'image/jpeg'; dataBase64: string } | null>;
}
