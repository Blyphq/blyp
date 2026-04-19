import type {
  WorkOsAuthenticateResponse,
  WorkOsLogContext,
  WorkOsResolutionOptions,
} from '../types/workos';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function normalizeWorkOsContext(
  authResponse: WorkOsAuthenticateResponse | null,
  options: WorkOsResolutionOptions = {}
): WorkOsLogContext | null {
  if (!authResponse || !authResponse.authenticated) {
    return null;
  }

  const user = authResponse.user;
  const userId = getString(user?.id);
  const sessionId = getString(authResponse.sessionId);
  const email = getString(user?.email);
  const organizationId = getString(authResponse.organizationId);
  const firstName = getString(user?.firstName);
  const lastName = getString(user?.lastName);
  const name = firstName && lastName
    ? `${firstName} ${lastName}`
    : firstName || lastName || undefined;

  const auth: WorkOsLogContext = {
    provider: 'workos',
    authenticated: true,
    actor: {
      kind: 'user',
      ...(userId ? { id: userId } : {}),
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
    },
    ...(sessionId
      ? { session: { id: sessionId } }
      : {}),
    ...(organizationId
      ? { organization: { id: organizationId } }
      : {}),
    lookup: {
      provider: 'workos',
      ...(userId ? { userId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(organizationId ? { organizationId } : {}),
      ...(email ? { email } : {}),
    },
  };

  if (getString(authResponse.role)) {
    auth.role = authResponse.role;
  }

  if (authResponse.role) {
    auth.roles = [authResponse.role];
  }

  if (Array.isArray(authResponse.permissions) && authResponse.permissions.length > 0) {
    auth.permissions = authResponse.permissions;
  }

  if (Array.isArray(authResponse.entitlements) && authResponse.entitlements.length > 0) {
    auth.entitlements = authResponse.entitlements;
  }

  if (Array.isArray(authResponse.featureFlags) && authResponse.featureFlags.length > 0) {
    auth.featureFlags = authResponse.featureFlags;
  }

  if (isRecord(authResponse.impersonator)) {
    auth.impersonator = authResponse.impersonator;
  }

  if (options.includeClaims) {
    const standardUserFields = new Set([
      'id',
      'email',
      'firstName',
      'lastName',
      'emailVerified',
      'profilePictureUrl',
      'createdAt',
      'updatedAt',
      'object',
    ]);
    const claims: Record<string, unknown> = {};
    let hasClaims = false;
    if (user) {
      for (const [key, value] of Object.entries(user)) {
        if (!standardUserFields.has(key)) {
          claims[key] = value;
          hasClaims = true;
        }
      }
    }
    if (hasClaims) {
      auth.claims = claims;
    }
  }

  if (options.includeRawSession) {
    auth.raw = authResponse as unknown as Record<string, unknown>;
  }

  return auth;
}

export function withWorkOsContextOverride(
  auth: WorkOsLogContext | null,
  extra: Record<string, unknown> | undefined
): WorkOsLogContext | null {
  if (!auth || !extra) {
    return auth;
  }

  const next: WorkOsLogContext = {
    ...auth,
    provider: 'workos',
    actor: { ...auth.actor },
    lookup: {
      ...auth.lookup,
      provider: 'workos',
    },
    ...(auth.session ? { session: { ...auth.session } } : {}),
    ...(auth.organization ? { organization: { ...auth.organization } } : {}),
    ...(auth.claims ? { claims: auth.claims } : {}),
    ...(auth.raw ? { raw: auth.raw } : {}),
    ...(auth.role !== undefined ? { role: auth.role } : {}),
    ...(auth.roles ? { roles: [...auth.roles] } : {}),
    ...(auth.permissions ? { permissions: [...auth.permissions] } : {}),
    ...(auth.entitlements ? { entitlements: [...auth.entitlements] } : {}),
    ...(auth.featureFlags ? { featureFlags: [...auth.featureFlags] } : {}),
    ...(auth.impersonator ? { impersonator: { ...auth.impersonator } } : {}),
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
      provider: 'workos',
    };
  }

  if (isRecord(extra.claims)) {
    next.claims = extra.claims;
  }

  if (isRecord(extra.raw)) {
    next.raw = extra.raw;
  }

  if (typeof extra.role === 'string') {
    next.role = extra.role;
  }

  if (Array.isArray(extra.roles)) {
    next.roles = extra.roles;
  }

  if (Array.isArray(extra.permissions)) {
    next.permissions = extra.permissions;
  }

  if (Array.isArray(extra.entitlements)) {
    next.entitlements = extra.entitlements;
  }

  if (Array.isArray(extra.featureFlags)) {
    next.featureFlags = extra.featureFlags;
  }

  if (isRecord(extra.impersonator)) {
    next.impersonator = extra.impersonator;
  }

  return next;
}
