import type {
  BetterAuthLogContext,
  BetterAuthResolutionOptions,
  BetterAuthSessionEnvelope,
} from '../types/better-auth';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function maybeClaims(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  const claims = value.claims;
  return isRecord(claims) ? claims : undefined;
}

export function extractBetterAuthSessionEnvelope(value: unknown): BetterAuthSessionEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }

  const session = isRecord(value.session) ? value.session : null;
  const user = isRecord(value.user) ? value.user : null;

  if (!session && !user) {
    return null;
  }

  return {
    ...(session ? { session } : {}),
    ...(user ? { user } : {}),
  };
}

export function normalizeBetterAuthContext(
  value: unknown,
  options: BetterAuthResolutionOptions = {}
): BetterAuthLogContext | null {
  const envelope = extractBetterAuthSessionEnvelope(value);
  if (!envelope) {
    return null;
  }

  const session = envelope.session ?? undefined;
  const user = envelope.user ?? undefined;
  const userId = getString(user?.id);
  const sessionId = getString(session?.id);
  const email = getString(user?.email);
  const activeOrganizationId = getString(session?.activeOrganizationId);
  const authenticated = Boolean(userId || sessionId);

  const auth: BetterAuthLogContext = {
    provider: 'better-auth',
    authenticated,
    actor: {
      kind: authenticated ? 'user' : 'anonymous',
      ...(userId ? { id: userId } : {}),
      ...(email ? { email } : {}),
      ...(getString(user?.name) ? { name: getString(user?.name) } : {}),
    },
    ...(sessionId || activeOrganizationId
      ? {
          session: {
            ...(sessionId ? { id: sessionId } : {}),
            ...(activeOrganizationId ? { activeOrganizationId } : {}),
          },
        }
      : {}),
    ...(activeOrganizationId
      ? {
          organization: {
            id: activeOrganizationId,
          },
        }
      : {}),
    lookup: {
      provider: 'better-auth',
      ...(userId ? { userId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(activeOrganizationId ? { organizationId: activeOrganizationId } : {}),
      ...(email ? { email } : {}),
    },
  };

  if (options.includeClaims) {
    const claims = maybeClaims(session) ?? maybeClaims(user);
    if (claims) {
      auth.claims = claims;
    }
  }

  if (options.includeRawSession) {
    auth.raw = {
      ...(session ? { session } : {}),
      ...(user ? { user } : {}),
    };
  }

  return auth;
}

export function withBetterAuthContextOverride(
  auth: BetterAuthLogContext | null,
  extra: Record<string, unknown> | undefined
): BetterAuthLogContext | null {
  if (!auth || !extra) {
    return auth;
  }

  const next: BetterAuthLogContext = {
    ...auth,
    provider: 'better-auth',
    actor: { ...auth.actor },
    lookup: {
      ...auth.lookup,
      provider: 'better-auth',
    },
    ...(auth.session ? { session: { ...auth.session } } : {}),
    ...(auth.organization ? { organization: { ...auth.organization } } : {}),
    ...(auth.claims ? { claims: auth.claims } : {}),
    ...(auth.raw ? { raw: auth.raw } : {}),
  };

  if (typeof extra.authenticated === 'boolean') {
    next.authenticated = extra.authenticated;
  }

  if (isRecord(extra.actor)) {
    next.actor = {
      ...next.actor,
      ...extra.actor,
    };
  }

  if (isRecord(extra.session)) {
    next.session = {
      ...(next.session ?? {}),
      ...extra.session,
    };
  }

  if (isRecord(extra.organization)) {
    next.organization = {
      ...(next.organization ?? {}),
      ...extra.organization,
    };
  }

  if (isRecord(extra.lookup)) {
    next.lookup = {
      ...next.lookup,
      ...extra.lookup,
      provider: 'better-auth',
    };
  }

  if (isRecord(extra.claims)) {
    next.claims = extra.claims;
  }

  if (isRecord(extra.raw)) {
    next.raw = extra.raw;
  }

  return next;
}
