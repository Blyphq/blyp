import type { BetterAuthIdentifySource, BetterAuthLookupDescriptor } from '../types/better-auth';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function identifyUser(record: unknown): BetterAuthLookupDescriptor | null {
  if (!isRecord(record)) {
    return null;
  }

  const auth = isRecord(record.auth) ? record.auth : null;
  const lookup = auth && isRecord(auth.lookup) ? auth.lookup : null;
  if (lookup && lookup.provider === 'better-auth') {
    return {
      provider: 'better-auth',
      ...(getString(lookup.userId) ? { userId: getString(lookup.userId) } : {}),
      ...(getString(lookup.sessionId) ? { sessionId: getString(lookup.sessionId) } : {}),
      ...(getString(lookup.organizationId)
        ? { organizationId: getString(lookup.organizationId) }
        : {}),
      ...(getString(lookup.email) ? { email: getString(lookup.email) } : {}),
    };
  }

  const source = record as BetterAuthIdentifySource;
  if (source.authProvider !== 'better-auth') {
    return null;
  }

  return {
    provider: 'better-auth',
    ...(getString(source.authActorId) ? { userId: getString(source.authActorId) } : {}),
    ...(getString(source.authSessionId) ? { sessionId: getString(source.authSessionId) } : {}),
    ...(getString(source.authOrganizationId)
      ? { organizationId: getString(source.authOrganizationId) }
      : {}),
  };
}
