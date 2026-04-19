import type { WorkOsIdentifySource, WorkOsLookupDescriptor } from '../types/workos';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function identifyUser(record: unknown): WorkOsLookupDescriptor | null {
  if (!isRecord(record)) {
    return null;
  }

  const auth = isRecord(record.auth) ? record.auth : null;
  const lookup = auth && isRecord(auth.lookup) ? auth.lookup : null;
  if (lookup && lookup.provider === 'workos') {
    return {
      provider: 'workos',
      ...(getString(lookup.userId) ? { userId: getString(lookup.userId) } : {}),
      ...(getString(lookup.sessionId) ? { sessionId: getString(lookup.sessionId) } : {}),
      ...(getString(lookup.organizationId)
        ? { organizationId: getString(lookup.organizationId) }
        : {}),
      ...(getString(lookup.email) ? { email: getString(lookup.email) } : {}),
    };
  }

  const source = record as WorkOsIdentifySource;
  if (source.authProvider !== 'workos') {
    return null;
  }

  return {
    provider: 'workos',
    ...(getString(source.authActorId) ? { userId: getString(source.authActorId) } : {}),
    ...(getString(source.authSessionId) ? { sessionId: getString(source.authSessionId) } : {}),
    ...(getString(source.authOrganizationId)
      ? { organizationId: getString(source.authOrganizationId) }
      : {}),
  };
}
