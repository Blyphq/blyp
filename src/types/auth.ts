import type {
  BetterAuthIntegrationConfig,
  BetterAuthLogContext,
  BetterAuthLookupDescriptor,
} from './better-auth';
import type {
  ClerkIntegrationConfig,
  ClerkLogContext,
  ClerkLookupDescriptor,
} from './clerk';
import type {
  WorkOsIntegrationConfig,
  WorkOsLogContext,
  WorkOsLookupDescriptor,
} from './workos';

export type AuthLogContext =
  | BetterAuthLogContext
  | ClerkLogContext
  | WorkOsLogContext;

export type AuthLookupDescriptor =
  | BetterAuthLookupDescriptor
  | ClerkLookupDescriptor
  | WorkOsLookupDescriptor;

export type AuthProvidersConfig<Ctx = unknown> =
  | {
      betterAuth: BetterAuthIntegrationConfig<Ctx>;
      clerk?: never;
      workos?: never;
    }
  | {
      betterAuth?: never;
      clerk: ClerkIntegrationConfig<Ctx>;
      workos?: never;
    }
  | {
      betterAuth?: never;
      clerk?: never;
      workos: WorkOsIntegrationConfig<Ctx>;
    };

export type AuthIntegrationConfig<Ctx = unknown> = AuthProvidersConfig<Ctx>;

export type AuthConfig<Ctx = unknown> =
  | BetterAuthIntegrationConfig<Ctx>
  | AuthProvidersConfig<Ctx>;

export type ResolvedAuthProvider<Ctx = unknown> =
  | { provider: 'better-auth'; config: BetterAuthIntegrationConfig<Ctx> }
  | { provider: 'clerk'; config: ClerkIntegrationConfig<Ctx> }
  | { provider: 'workos'; config: WorkOsIntegrationConfig<Ctx> };

export type LegacyServerAuthConfig<Ctx = unknown> =
  | BetterAuthIntegrationConfig<Ctx>
  | AuthIntegrationConfig<Ctx>;
