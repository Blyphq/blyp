import type { BetterAuthClientPlugin, BetterAuthPlugin } from 'better-auth';
import type { ClientLogEvent } from './shared/client-log';
import type { ClientConnectorRequest } from './frameworks/client';
import type { BlypLogger } from './core/logger';
import type { StandaloneLoggerConfig } from './frameworks/standalone';

export interface BetterAuthLookupDescriptor {
  provider: 'better-auth';
  userId?: string;
  sessionId?: string;
  organizationId?: string;
  email?: string;
}

export interface BetterAuthLogContext {
  provider: 'better-auth';
  authenticated: boolean;
  actor: {
    kind: 'user' | 'anonymous';
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
  };
  lookup: BetterAuthLookupDescriptor;
  claims?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export interface BetterAuthSessionEnvelope {
  session?: Record<string, unknown> | null;
  user?: Record<string, unknown> | null;
}

export interface BetterAuthLike {
  api?: {
    getSession?: (input: {
      headers: Headers | Record<string, unknown>;
    }) => Promise<unknown>;
  };
}

export interface BetterAuthResolutionOptions {
  includeClaims?: boolean;
  includeRawSession?: boolean;
}

export interface BetterAuthResolveArgs<Ctx> {
  ctx: Ctx;
  request: Request | { headers?: Headers | Record<string, unknown> };
  session: BetterAuthSessionEnvelope | null;
  auth: BetterAuthLike;
  source: 'request' | 'client_ingestion';
}

export interface BetterAuthPluginEnrichArgs {
  request: Request;
  response?: Response;
  auth: BetterAuthLogContext | null;
  action: string;
  session: BetterAuthSessionEnvelope | null;
}

export interface BetterAuthIntegrationConfig<Ctx> extends BetterAuthResolutionOptions {
  betterAuth: BetterAuthLike;
  enrich?: (
    args: BetterAuthResolveArgs<Ctx>
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

export interface BlypBetterAuthPluginOptions extends BetterAuthResolutionOptions {
  logger?: BlypLogger;
  loggerConfig?: StandaloneLoggerConfig;
  clientLogging?: boolean | {
    path?: string;
  };
  authEndpointLogging?: boolean;
  enrich?: (
    args: BetterAuthPluginEnrichArgs
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

export interface BlypBetterAuthClientPluginOptions {
  endpoint?: string;
}

export interface BetterAuthIdentifySource {
  auth?: BetterAuthLogContext;
  authProvider?: string | null;
  authActorId?: string | null;
  authSessionId?: string | null;
  authOrganizationId?: string | null;
}

export type BlypBetterAuthPlugin = BetterAuthPlugin;
export type BlypBetterAuthClientPlugin = BetterAuthClientPlugin;

export interface BetterAuthClientLoggerFactoryConfig {
  traceId?: string;
  localConsole?: boolean;
  remoteSync?: boolean;
  connector?: ClientConnectorRequest;
  metadata?: Record<string, unknown> | (() => Record<string, unknown>);
  delivery?: import('./shared/client-log').RemoteDeliveryConfig;
}

export type { ClientLogEvent };
