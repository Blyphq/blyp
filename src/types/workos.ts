export interface WorkOsLookupDescriptor {
  provider: 'workos';
  userId?: string;
  sessionId?: string;
  organizationId?: string;
  email?: string;
}

export interface WorkOsLogContext {
  provider: 'workos';
  authenticated: boolean;
  actor: {
    kind: 'user' | 'anonymous';
    id?: string;
    email?: string;
    name?: string;
  };
  session?: {
    id?: string;
  };
  organization?: {
    id?: string;
  };
  lookup: WorkOsLookupDescriptor;
  role?: string;
  roles?: string[];
  permissions?: string[];
  entitlements?: unknown[];
  featureFlags?: unknown[];
  impersonator?: Record<string, unknown>;
  claims?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export interface WorkOsAuthenticateSuccessResponse {
  authenticated: true;
  sessionId: string;
  organizationId?: string;
  role?: string;
  permissions?: string[];
  entitlements?: unknown[];
  featureFlags?: unknown[];
  user: {
    id: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    [key: string]: unknown;
  };
  impersonator?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WorkOsAuthenticateFailureResponse {
  authenticated: false;
  reason: string;
}

export type WorkOsAuthenticateResponse =
  | WorkOsAuthenticateSuccessResponse
  | WorkOsAuthenticateFailureResponse;

export interface WorkOsSealedSessionLike {
  authenticate: () => Promise<WorkOsAuthenticateResponse>;
}

export interface WorkOSLike {
  userManagement?: {
    loadSealedSession?: (options: {
      sessionData: string;
      cookiePassword: string;
    }) => WorkOsSealedSessionLike;
  };
}

export interface WorkOsResolutionOptions {
  includeClaims?: boolean;
  includeRawSession?: boolean;
}

export interface WorkOsResolveArgs<Ctx> {
  ctx: Ctx;
  request: Request | { headers?: Headers | Record<string, unknown> };
  sessionCookie: string | null;
  authResponse: WorkOsAuthenticateResponse | null;
  workos: WorkOSLike;
  source: 'request' | 'client_ingestion';
}

export interface WorkOsIntegrationConfig<Ctx> extends WorkOsResolutionOptions {
  workos: WorkOSLike;
  cookiePassword: string;
  cookieName?: string;
  enrich?: (
    args: WorkOsResolveArgs<Ctx>
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

export interface WorkOsIdentifySource {
  auth?: WorkOsLogContext;
  authProvider?: string | null;
  authActorId?: string | null;
  authSessionId?: string | null;
  authOrganizationId?: string | null;
}
