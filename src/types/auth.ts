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

export type AuthLogContext = BetterAuthLogContext | ClerkLogContext;

export type AuthLookupDescriptor = BetterAuthLookupDescriptor | ClerkLookupDescriptor;

export interface AuthIntegrationConfig<Ctx = unknown> {
  betterAuth?: BetterAuthIntegrationConfig<Ctx>;
  clerk?: ClerkIntegrationConfig<Ctx>;
}

export type LegacyServerAuthConfig<Ctx = unknown> =
  | BetterAuthIntegrationConfig<Ctx>
  | AuthIntegrationConfig<Ctx>;
