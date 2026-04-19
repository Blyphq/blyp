import type {
  ClerkAuthenticateRequestOptions,
  ClerkLogContext,
} from '../types/clerk';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getStringArray(value: unknown): string[] | null | undefined {
  if (value === null) {
    return null;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter((entry): entry is string => {
    return typeof entry === 'string' && entry.length > 0;
  });

  return strings.length > 0 ? strings : [];
}

function getFactorVerificationAge(value: unknown): [number, number] | null | undefined {
  if (value === null) {
    return null;
  }

  if (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  ) {
    return [value[0], value[1]];
  }

  return undefined;
}

function getClaims(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  return isRecord(value.claims) ? value.claims : undefined;
}

function getName(value: Record<string, unknown> | undefined): string | undefined {
  return getString(value?.name) ??
    getString(value?.fullName) ??
    ([getString(value?.firstName), getString(value?.lastName)].filter(Boolean).join(' ') ||
    undefined);
}

function getEmail(
  value: Record<string, unknown> | undefined,
  claims: Record<string, unknown> | undefined
): string | undefined {
  return getString(value?.email) ??
    getString(claims?.email) ??
    getString(claims?.email_address);
}

export function createSignedOutClerkContext(): ClerkLogContext {
  return {
    provider: 'clerk',
    authenticated: false,
    actor: {
      kind: 'anonymous',
    },
    lookup: {
      provider: 'clerk',
    },
  };
}

export interface NormalizeClerkAuthOptions {
  includeClaims?: boolean;
  includeRawAuth?: boolean;
  hydratedUser?: Record<string, unknown> | undefined;
}

export function normalizeClerkAuthContext(
  value: unknown,
  options: NormalizeClerkAuthOptions = {}
): ClerkLogContext {
  const raw = isRecord(value) ? value : {};
  const hydratedUser = options.hydratedUser;
  const claims = getClaims(raw);
  const tokenType = getString(raw.tokenType);
  const isMachine = tokenType !== undefined && tokenType !== 'session_token';
  const userId = getString(raw.userId);
  const sessionId = getString(raw.sessionId);
  const organizationId = getString(raw.orgId);
  const organizationSlug = getString(raw.orgSlug);
  const organizationRole = getString(raw.orgRole);
  const impersonationActor = isRecord(raw.actor) ? raw.actor : undefined;
  const impersonatorId = getString(impersonationActor?.sub);
  const orgPermissions = getStringArray(raw.orgPermissions);
  const factorVerificationAge = getFactorVerificationAge(raw.factorVerificationAge);
  const scopes = getStringArray(raw.scopes);
  const clientId = getString(raw.clientId);
  const hydratedName = getName(hydratedUser);
  const hydratedEmail = getEmail(hydratedUser, claims);
  const machineActorId = getString(raw.id) ?? getString(claims?.sub);
  const authenticated = isMachine
    ? Boolean(machineActorId || tokenType)
    : Boolean(userId || sessionId);

  if (!authenticated) {
    const signedOut = createSignedOutClerkContext();
    if (options.includeClaims && claims) {
      signedOut.claims = claims;
    }
    if (options.includeRawAuth && isRecord(value)) {
      signedOut.raw = raw;
    }
    return signedOut;
  }

  if (isMachine) {
    const actorId = machineActorId;
    const lookupTokenType = tokenType;
    const auth: ClerkLogContext = {
      provider: 'clerk',
      authenticated: true,
      actor: {
        kind: 'machine',
        ...(actorId ? { id: actorId } : {}),
        ...(hydratedEmail ? { email: hydratedEmail } : {}),
        ...(hydratedName ? { name: hydratedName } : {}),
      },
      lookup: {
        provider: 'clerk',
        ...(actorId ? { actorId } : {}),
        actorKind: 'machine',
        ...(userId ? { userId } : {}),
        ...(organizationId ? { organizationId } : {}),
        ...(lookupTokenType ? { tokenType: lookupTokenType } : {}),
        ...(hydratedEmail ? { email: hydratedEmail } : {}),
      },
      clerk: {
        ...(lookupTokenType ? { tokenType: lookupTokenType } : {}),
        ...(scopes !== undefined ? { scopes } : {}),
        ...(clientId ? { clientId } : {}),
      },
    };

    if (options.includeClaims && claims) {
      auth.claims = claims;
    }

    if (options.includeRawAuth && isRecord(value)) {
      auth.raw = raw;
    }

    return auth;
  }

  const normalizedTokenType = tokenType ?? 'session_token';
  const auth: ClerkLogContext = {
    provider: 'clerk',
    authenticated: true,
    actor: {
      kind: 'user',
      ...(userId ? { id: userId } : {}),
      ...(hydratedEmail ? { email: hydratedEmail } : {}),
      ...(hydratedName ? { name: hydratedName } : {}),
    },
    ...(sessionId || organizationId
      ? {
          session: {
            ...(sessionId ? { id: sessionId } : {}),
            ...(organizationId ? { activeOrganizationId: organizationId } : {}),
          },
        }
      : {}),
    ...(organizationId || organizationSlug || organizationRole
      ? {
          organization: {
            ...(organizationId ? { id: organizationId } : {}),
            ...(organizationSlug ? { slug: organizationSlug } : {}),
            ...(organizationRole ? { role: organizationRole } : {}),
          },
        }
      : {}),
    ...(impersonatorId
      ? {
          impersonator: {
            id: impersonatorId,
          },
        }
      : {}),
    lookup: {
      provider: 'clerk',
      ...(userId ? { actorId: userId, actorKind: 'user' as const, userId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(organizationId ? { organizationId } : {}),
      ...(normalizedTokenType ? { tokenType: normalizedTokenType } : {}),
      ...(hydratedEmail ? { email: hydratedEmail } : {}),
    },
    clerk: {
      tokenType: normalizedTokenType,
      ...(orgPermissions !== undefined ? { orgPermissions } : {}),
      ...(factorVerificationAge !== undefined ? { factorVerificationAge } : {}),
    },
  };

  if (options.includeClaims && claims) {
    auth.claims = claims;
  }

  if (options.includeRawAuth && isRecord(value)) {
    auth.raw = raw;
  }

  return auth;
}

export function withClerkContextOverride(
  auth: ClerkLogContext,
  extra: Record<string, unknown> | undefined
): ClerkLogContext {
  if (!extra) {
    return auth;
  }

  const next = {
    ...auth,
    ...extra,
  } as ClerkLogContext;

  if (isRecord(extra.actor)) {
    next.actor = {
      ...auth.actor,
      ...extra.actor,
    };
  }

  if (isRecord(extra.session)) {
    next.session = {
      ...(auth.session ?? {}),
      ...extra.session,
    };
  }

  if (isRecord(extra.organization)) {
    next.organization = {
      ...(auth.organization ?? {}),
      ...extra.organization,
    };
  }

  if (isRecord(extra.impersonator)) {
    next.impersonator = {
      ...(auth.impersonator ?? {}),
      ...extra.impersonator,
    };
  }

  if (isRecord(extra.lookup)) {
    next.lookup = {
      ...auth.lookup,
      ...extra.lookup,
      provider: 'clerk',
    };
  }

  if (isRecord(extra.clerk)) {
    next.clerk = {
      ...(auth.clerk ?? {}),
      ...extra.clerk,
    };
  }

  return next;
}

export function resolveClerkAuthenticateRequestOptions<Ctx>(
  config: {
    authenticateRequest?:
      | ClerkAuthenticateRequestOptions
      | ((args: Ctx) =>
          | ClerkAuthenticateRequestOptions
          | Promise<ClerkAuthenticateRequestOptions>);
    authenticateRequestOptions?:
      | ClerkAuthenticateRequestOptions
      | ((args: Ctx) =>
          | ClerkAuthenticateRequestOptions
          | Promise<ClerkAuthenticateRequestOptions>);
    audience?: string | string[];
    authorizedParties?: string[];
    jwtKey?: string;
    secretKey?: string;
    publishableKey?: string;
    apiUrl?: string;
    apiVersion?: string;
    domain?: string;
    proxyUrl?: string;
    isSatellite?: boolean;
  },
  args: Ctx
): Promise<ClerkAuthenticateRequestOptions> | ClerkAuthenticateRequestOptions {
  const resolver = config.authenticateRequestOptions ?? config.authenticateRequest;
  const resolved = typeof resolver === 'function' ? resolver(args) : resolver;
  const base = {
    ...(config.audience !== undefined ? { audience: config.audience } : {}),
    ...(config.authorizedParties !== undefined
      ? { authorizedParties: config.authorizedParties }
      : {}),
    ...(config.jwtKey !== undefined ? { jwtKey: config.jwtKey } : {}),
    ...(config.secretKey !== undefined ? { secretKey: config.secretKey } : {}),
    ...(config.publishableKey !== undefined ? { publishableKey: config.publishableKey } : {}),
    ...(config.apiUrl !== undefined ? { apiUrl: config.apiUrl } : {}),
    ...(config.apiVersion !== undefined ? { apiVersion: config.apiVersion } : {}),
    ...(config.domain !== undefined ? { domain: config.domain } : {}),
    ...(config.proxyUrl !== undefined ? { proxyUrl: config.proxyUrl } : {}),
    ...(config.isSatellite !== undefined ? { isSatellite: config.isSatellite } : {}),
  };

  if (resolved && typeof (resolved as Promise<unknown>).then === 'function') {
    return (resolved as Promise<ClerkAuthenticateRequestOptions>).then((value) => {
      return {
        ...base,
        ...(value ?? {}),
      };
    });
  }

  return {
    ...base,
    ...(resolved ?? {}),
  };
}
