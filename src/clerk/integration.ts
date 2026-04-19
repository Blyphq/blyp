import { loadOptionalModule } from '../core/optional-module';
import {
  normalizeClerkAuthContext,
  resolveClerkAuthenticateRequestOptions,
  withClerkContextOverride,
} from './normalize';
import type {
  ClerkBackendClientLike,
  ClerkIntegrationConfig,
  ClerkIntegrationOptions,
  ClerkResolveArgs,
  ClerkUserLike,
} from '../types/clerk';

interface ClerkBackendModule {
  createClerkClient: (options: Record<string, unknown>) => ClerkBackendClientLike;
}

interface HydratedUserCacheEntry {
  expiresAt: number;
  value: Record<string, unknown> | undefined;
}

const resolvedClientCache = new WeakMap<object, ClerkBackendClientLike>();
const hydratedUserCache = new Map<string, HydratedUserCacheEntry>();
const DEFAULT_HYDRATED_USER_CACHE_MAX_ENTRIES = 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeHydratedUser(user: ClerkUserLike): Record<string, unknown> | undefined {
  const email = getString(user.primaryEmailAddress?.emailAddress) ??
    user.emailAddresses?.find((entry) => getString(entry.emailAddress))?.emailAddress;
  const name = getString(user.fullName) ??
    ([getString(user.firstName), getString(user.lastName)].filter(Boolean).join(' ') ||
    undefined);

  if (!user.id && !email && !name) {
    return undefined;
  }

  return {
    ...(user.id ? { id: user.id } : {}),
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    ...(user.fullName ? { fullName: user.fullName } : {}),
    ...(user.firstName ? { firstName: user.firstName } : {}),
    ...(user.lastName ? { lastName: user.lastName } : {}),
  };
}

function pruneHydratedUserCache(now: number, maxEntries: number): void {
  for (const [cacheKey, entry] of hydratedUserCache) {
    if (entry.expiresAt <= now) {
      hydratedUserCache.delete(cacheKey);
    }
  }

  while (hydratedUserCache.size > maxEntries) {
    const oldestKey = hydratedUserCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    hydratedUserCache.delete(oldestKey);
  }
}

function setHydratedUserCacheEntry(
  userId: string,
  entry: HydratedUserCacheEntry,
  now: number,
  maxEntries: number
): void {
  if (maxEntries <= 0) {
    return;
  }

  pruneHydratedUserCache(now, maxEntries - 1);
  hydratedUserCache.delete(userId);
  hydratedUserCache.set(userId, entry);
}

async function hydrateUser(
  config: ClerkIntegrationConfig<unknown>,
  clerkClient: ClerkBackendClientLike,
  auth: unknown
): Promise<Record<string, unknown> | undefined> {
  if (!config.hydrateUser || !isRecord(auth)) {
    return undefined;
  }

  const userId = getString(auth.userId);
  const getUser = clerkClient.users?.getUser;
  if (!userId || typeof getUser !== 'function') {
    return undefined;
  }

  const cacheTtlMs = config.hydrateUser.cacheTtlMs ?? 30_000;
  const maxEntries = Math.max(
    config.hydrateUser.maxEntries ?? DEFAULT_HYDRATED_USER_CACHE_MAX_ENTRIES,
    0
  );
  const cached = hydratedUserCache.get(userId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    hydratedUserCache.delete(userId);
    hydratedUserCache.set(userId, cached);
    return cached.value;
  }
  if (cached) {
    hydratedUserCache.delete(userId);
  }

  try {
    const user = await getUser(userId);
    const normalized = normalizeHydratedUser(user);
    setHydratedUserCacheEntry(userId, {
      value: normalized,
      expiresAt: now + cacheTtlMs,
    }, now, maxEntries);
    return normalized;
  } catch {
    setHydratedUserCacheEntry(userId, {
      value: undefined,
      expiresAt: now + cacheTtlMs,
    }, now, maxEntries);
    return undefined;
  }
}

export function clerk<Ctx = unknown>(
  options: ClerkIntegrationOptions<Ctx>
): ClerkIntegrationConfig<Ctx> {
  return {
    provider: 'clerk',
    ...options,
  };
}

export function resolveClerkClient<Ctx>(
  config: ClerkIntegrationConfig<Ctx>
): ClerkBackendClientLike {
  const directClient = config.clerkClient ?? config.client;
  if (directClient) {
    return directClient;
  }

  const cached = resolvedClientCache.get(config);
  if (cached) {
    return cached;
  }

  const backend = loadOptionalModule<ClerkBackendModule>(
    'clerk',
    ['@clerk/backend'],
    '@clerk/backend'
  );
  const client = backend.createClerkClient({
    ...(config.secretKey !== undefined ? { secretKey: config.secretKey } : {}),
    ...(config.publishableKey !== undefined ? { publishableKey: config.publishableKey } : {}),
    ...(config.jwtKey !== undefined ? { jwtKey: config.jwtKey } : {}),
    ...(config.apiUrl !== undefined ? { apiUrl: config.apiUrl } : {}),
    ...(config.apiVersion !== undefined ? { apiVersion: config.apiVersion } : {}),
    ...(config.domain !== undefined ? { domain: config.domain } : {}),
    ...(config.proxyUrl !== undefined ? { proxyUrl: config.proxyUrl } : {}),
    ...(config.isSatellite !== undefined ? { isSatellite: config.isSatellite } : {}),
    ...(config.audience !== undefined ? { audience: config.audience } : {}),
  });
  resolvedClientCache.set(config, client);
  return client;
}

export async function resolveClerkAuthContext<Ctx>(
  config: ClerkIntegrationConfig<Ctx>,
  args: Omit<ClerkResolveArgs<Ctx>, 'auth' | 'clerkClient' | 'requestState'>
): Promise<ReturnType<typeof normalizeClerkAuthContext>> {
  const clerkClient = resolveClerkClient(config);
  const seed = {
    ...args,
    auth: undefined,
    clerkClient,
    requestState: {
      toAuth() {
        return undefined;
      },
    },
  } as ClerkResolveArgs<Ctx>;
  const authenticateRequestOptions = await resolveClerkAuthenticateRequestOptions(config, seed);
  const requestState = await clerkClient.authenticateRequest(
    args.request,
    authenticateRequestOptions
  );
  const authObject = requestState.toAuth();
  const hydratedUser = await hydrateUser(
    config as ClerkIntegrationConfig<unknown>,
    clerkClient,
    authObject
  );
  const resolvedArgs: ClerkResolveArgs<Ctx> = {
    ...args,
    auth: authObject,
    clerkClient,
    requestState,
  };

  let auth = normalizeClerkAuthContext(authObject, {
    includeClaims: config.includeClaims,
    includeRawAuth: config.includeRawAuth,
    hydratedUser,
  });

  if (config.enrich) {
    const extra = await config.enrich(resolvedArgs);
    auth = withClerkContextOverride(auth, extra);
  }

  return auth;
}
