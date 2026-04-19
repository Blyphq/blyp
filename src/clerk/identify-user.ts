import type { ClerkIdentifySource, ClerkLookupDescriptor } from '../types/clerk';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function identifyUser(record: unknown): ClerkLookupDescriptor | null {
  if (!isRecord(record)) {
    return null;
  }

  const auth = isRecord(record.auth) ? record.auth : null;
  const lookup = auth && isRecord(auth.lookup) ? auth.lookup : null;
  if (lookup && lookup.provider === 'clerk') {
    return {
      provider: 'clerk',
      ...(getString(lookup.actorId) ? { actorId: getString(lookup.actorId) } : {}),
      ...(lookup.actorKind === 'user' || lookup.actorKind === 'machine'
        ? { actorKind: lookup.actorKind }
        : {}),
      ...(getString(lookup.userId) ? { userId: getString(lookup.userId) } : {}),
      ...(getString(lookup.sessionId) ? { sessionId: getString(lookup.sessionId) } : {}),
      ...(getString(lookup.organizationId)
        ? { organizationId: getString(lookup.organizationId) }
        : {}),
      ...(getString(lookup.tokenType) ? { tokenType: getString(lookup.tokenType) } : {}),
      ...(getString(lookup.email) ? { email: getString(lookup.email) } : {}),
    };
  }

  const source = record as ClerkIdentifySource;
  if (source.authProvider !== 'clerk') {
    return null;
  }

  return {
    provider: 'clerk',
    ...(getString(source.authActorId) ? { actorId: getString(source.authActorId) } : {}),
    ...(source.authActorKind === 'user' || source.authActorKind === 'machine'
      ? { actorKind: source.authActorKind }
      : {}),
    ...(getString(source.authActorId) && source.authActorKind !== 'machine'
      ? { userId: getString(source.authActorId) }
      : {}),
    ...(getString(source.authSessionId) ? { sessionId: getString(source.authSessionId) } : {}),
    ...(getString(source.authOrganizationId)
      ? { organizationId: getString(source.authOrganizationId) }
      : {}),
    ...(getString(source.authTokenType) ? { tokenType: getString(source.authTokenType) } : {}),
  };
}
