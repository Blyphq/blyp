import type { ClientConnectorRequest } from './frameworks/client';
import type { ClientLogger } from './frameworks/client';
import type { RemoteDeliveryConfig } from './shared/client-log';

export type ClerkAcceptsToken =
  | 'api_key'
  | 'oauth_token'
  | 'session_token'
  | 'm2m_token'
  | 'any'
  | Array<'api_key' | 'oauth_token' | 'session_token' | 'm2m_token'>;

export interface ClerkAuthenticateRequestOptions {
  acceptsToken?: ClerkAcceptsToken;
  audience?: string | string[];
  authorizedParties?: string[];
  jwtKey?: string;
  secretKey?: string;
  publishableKey?: string;
  apiUrl?: string;
  apiVersion?: string;
  domain?: string;
  isSatellite?: boolean;
  proxyUrl?: string;
  [key: string]: unknown;
}

export interface ClerkRequestStateLike {
  isAuthenticated?: boolean;
  headers?: Headers;
  toAuth: () => unknown;
}

export interface ClerkUserLike {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  primaryEmailAddress?: {
    emailAddress?: string | null;
  } | null;
  emailAddresses?: Array<{
    emailAddress?: string | null;
  }>;
  [key: string]: unknown;
}

export interface ClerkBackendClientLike {
  authenticateRequest: (
    request: Request,
    options?: ClerkAuthenticateRequestOptions
  ) => Promise<ClerkRequestStateLike>;
  users?: {
    getUser?: (userId: string) => Promise<ClerkUserLike>;
  };
}

export interface ClerkLookupDescriptor {
  provider: 'clerk';
  actorId?: string;
  actorKind?: 'user' | 'machine';
  userId?: string;
  sessionId?: string;
  organizationId?: string;
  tokenType?: string;
  email?: string;
}

export interface ClerkLogContext {
  provider: 'clerk';
  authenticated: boolean;
  actor: {
    kind: 'user' | 'machine' | 'anonymous';
    id?: string;
    email?: string;
    name?: string;
  };
  session?: {
    id?: string;
    activeOrganizationId?: string;
  };
  organization?: {
    id?: string;
    slug?: string;
    role?: string;
  };
  impersonator?: {
    id?: string;
  };
  lookup: ClerkLookupDescriptor;
  claims?: Record<string, unknown>;
  raw?: Record<string, unknown>;
  clerk?: {
    tokenType?: string;
    orgPermissions?: string[] | null;
    factorVerificationAge?: [number, number] | null;
    scopes?: string[] | null;
    clientId?: string;
  };
}

export interface ClerkHydrateUserOptions {
  cacheTtlMs?: number;
}

export interface ClerkResolveArgs<Ctx = unknown> {
  ctx: Ctx;
  request: Request;
  auth: unknown;
  clerkClient: ClerkBackendClientLike;
  requestState: ClerkRequestStateLike;
  source: 'request' | 'client_ingestion';
}

export interface ClerkIntegrationOptions<Ctx = unknown> {
  client?: ClerkBackendClientLike;
  clerkClient?: ClerkBackendClientLike;
  secretKey?: string;
  publishableKey?: string;
  jwtKey?: string;
  apiUrl?: string;
  apiVersion?: string;
  domain?: string;
  proxyUrl?: string;
  isSatellite?: boolean;
  audience?: string | string[];
  authorizedParties?: string[];
  includeClaims?: boolean;
  includeRawAuth?: boolean;
  hydrateUser?: false | ClerkHydrateUserOptions;
  authenticateRequest?:
    | ClerkAuthenticateRequestOptions
    | ((args: ClerkResolveArgs<Ctx>) =>
        | ClerkAuthenticateRequestOptions
        | Promise<ClerkAuthenticateRequestOptions>);
  authenticateRequestOptions?:
    | ClerkAuthenticateRequestOptions
    | ((args: ClerkResolveArgs<Ctx>) =>
        | ClerkAuthenticateRequestOptions
        | Promise<ClerkAuthenticateRequestOptions>);
  enrich?: (
    args: ClerkResolveArgs<Ctx>
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

export interface ClerkIntegrationConfig<Ctx = unknown>
  extends ClerkIntegrationOptions<Ctx> {
  provider: 'clerk';
}

export interface ClerkIdentifySource {
  auth?: ClerkLogContext;
  authProvider?: string | null;
  authActorId?: string | null;
  authSessionId?: string | null;
  authOrganizationId?: string | null;
  authActorKind?: string | null;
  authTokenType?: string | null;
}

export interface ClerkClientLoggerOptions {
  endpoint?: string;
  traceId?: string;
  localConsole?: boolean;
  remoteSync?: boolean;
  connector?: ClientConnectorRequest;
  metadata?: Record<string, unknown> | (() => Record<string, unknown>);
  delivery?: RemoteDeliveryConfig;
}

export type ClerkClientLogger = ClientLogger;
