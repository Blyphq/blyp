import { describe, expect, it } from 'bun:test';
import {
  clerk,
  createClerkClientLogger,
  identifyUser,
  normalizeClerkAuthContext,
  resolveClerkAuthContext,
} from '../src/clerk';
import { createMachineClerkAuth, createSessionClerkAuth } from './helpers/clerk';

describe('Clerk integration', () => {
  it('normalizes signed-out requests into a canonical anonymous Clerk auth context', () => {
    expect(normalizeClerkAuthContext(null)).toEqual({
      provider: 'clerk',
      authenticated: false,
      actor: {
        kind: 'anonymous',
      },
      lookup: {
        provider: 'clerk',
      },
    });
  });

  it('normalizes signed-in session requests with organization metadata', () => {
    const auth = normalizeClerkAuthContext(createSessionClerkAuth());

    expect(auth).toEqual({
      provider: 'clerk',
      authenticated: true,
      actor: {
        kind: 'user',
        id: 'user_1',
        email: 'ada@example.com',
      },
      session: {
        id: 'sess_1',
        activeOrganizationId: 'org_1',
      },
      organization: {
        id: 'org_1',
        slug: 'acme',
        role: 'org:admin',
      },
      lookup: {
        provider: 'clerk',
        actorId: 'user_1',
        actorKind: 'user',
        userId: 'user_1',
        sessionId: 'sess_1',
        organizationId: 'org_1',
        tokenType: 'session_token',
        email: 'ada@example.com',
      },
      clerk: {
        tokenType: 'session_token',
        orgPermissions: ['org:read'],
        factorVerificationAge: [0, 5],
      },
    });
  });

  it('normalizes impersonated session requests', () => {
    const auth = normalizeClerkAuthContext(createSessionClerkAuth({
      actor: {
        sub: 'admin_user_1',
      },
    }));

    expect(auth?.impersonator).toEqual({
      id: 'admin_user_1',
    });
  });

  it('normalizes machine-authenticated requests', () => {
    const auth = normalizeClerkAuthContext(createMachineClerkAuth());

    expect(auth).toEqual({
      provider: 'clerk',
      authenticated: true,
      actor: {
        kind: 'machine',
        id: 'oauth_1',
        email: 'ada@example.com',
      },
      lookup: {
        provider: 'clerk',
        actorId: 'oauth_1',
        actorKind: 'machine',
        userId: 'user_1',
        tokenType: 'oauth_token',
        email: 'ada@example.com',
      },
      clerk: {
        tokenType: 'oauth_token',
        scopes: ['logs:write'],
        clientId: 'client_1',
      },
    });
  });

  it('keeps claims and raw auth opt-in only', () => {
    const auth = createSessionClerkAuth();

    const withoutExtras = normalizeClerkAuthContext(auth);
    const withExtras = normalizeClerkAuthContext(auth, {
      includeClaims: true,
      includeRawAuth: true,
    });

    expect(withoutExtras.claims).toBeUndefined();
    expect(withoutExtras.raw).toBeUndefined();
    expect(withExtras.claims).toEqual({
      sub: 'user_1',
      email: 'ada@example.com',
    });
    expect(withExtras.raw).toEqual(auth);
  });

  it('identifies actors from canonical records and database-style fallback columns', () => {
    expect(
      identifyUser({
        auth: {
          lookup: {
            provider: 'clerk',
            actorId: 'oauth_1',
            actorKind: 'machine',
            userId: 'user_1',
            tokenType: 'oauth_token',
          },
        },
      })
    ).toEqual({
      provider: 'clerk',
      actorId: 'oauth_1',
      actorKind: 'machine',
      userId: 'user_1',
      tokenType: 'oauth_token',
    });

    expect(
      identifyUser({
        authProvider: 'clerk',
        authActorId: 'user_2',
        authActorKind: 'user',
        authSessionId: 'sess_2',
        authOrganizationId: 'org_2',
        authTokenType: 'session_token',
      })
    ).toEqual({
      provider: 'clerk',
      actorId: 'user_2',
      actorKind: 'user',
      userId: 'user_2',
      sessionId: 'sess_2',
      organizationId: 'org_2',
      tokenType: 'session_token',
    });
  });

  it('creates a typed Clerk integration config via the public factory', () => {
    const integration = clerk({
      secretKey: 'sk_test',
      publishableKey: 'pk_test',
      authorizedParties: ['https://example.com'],
    });

    expect(integration.provider).toBe('clerk');
    expect(integration.authorizedParties).toEqual(['https://example.com']);
  });

  it('uses /blyp/log as the default Clerk client logger endpoint', async () => {
    const calls: Array<{ url: string; options?: RequestInit }> = [];
    const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: ((url: string | URL | Request, options?: RequestInit) => {
        calls.push({ url: String(url), options });
        return Promise.resolve(new Response(null, { status: 204 }));
      }) as typeof fetch,
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: {
        userAgent: 'Mozilla/5.0 Test Browser',
        language: 'en-US',
        platform: 'MacIntel',
        onLine: true,
      },
    });
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      writable: true,
      value: {
        href: 'https://dashboard.example.test/app',
        pathname: '/app',
        search: '',
        hash: '',
      },
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: {
        title: 'Dashboard',
        referrer: '',
      },
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem() {
          return null;
        },
        setItem() {},
      },
    });

    try {
      const logger = createClerkClientLogger();
      logger.info('clicked upgrade');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe('/blyp/log');
    } finally {
      if (originalFetch) {
        Object.defineProperty(globalThis, 'fetch', originalFetch);
      } else {
        delete (globalThis as Record<string, unknown>).fetch;
      }
      if (originalNavigator) {
        Object.defineProperty(globalThis, 'navigator', originalNavigator);
      } else {
        delete (globalThis as Record<string, unknown>).navigator;
      }
      if (originalLocation) {
        Object.defineProperty(globalThis, 'location', originalLocation);
      } else {
        delete (globalThis as Record<string, unknown>).location;
      }
      if (originalDocument) {
        Object.defineProperty(globalThis, 'document', originalDocument);
      } else {
        delete (globalThis as Record<string, unknown>).document;
      }
      if (originalSessionStorage) {
        Object.defineProperty(globalThis, 'sessionStorage', originalSessionStorage);
      } else {
        delete (globalThis as Record<string, unknown>).sessionStorage;
      }
    }
  });

  it('hydrates Clerk users once per TTL window and reuses the cached value', async () => {
    const getUserCalls: string[] = [];
    const clerkClient = {
      async authenticateRequest() {
        return {
          isAuthenticated: true,
          toAuth() {
            return createSessionClerkAuth({
              userId: 'user_cache_reuse',
              sessionId: 'sess_cache_reuse',
              claims: {
                sub: 'user_cache_reuse',
              },
            });
          },
        };
      },
      users: {
        async getUser(userId: string) {
          getUserCalls.push(userId);
          return {
            id: userId,
            fullName: 'Ada Lovelace',
            primaryEmailAddress: {
              emailAddress: 'ada@example.com',
            },
          };
        },
      },
    };
    const integration = clerk({
      clerkClient,
      hydrateUser: {
        cacheTtlMs: 1_000,
        maxEntries: 8,
      },
    });

    const first = await resolveClerkAuthContext(integration, {
      ctx: undefined,
      request: new Request('http://localhost/cache-reuse'),
      source: 'request',
    });
    const second = await resolveClerkAuthContext(integration, {
      ctx: undefined,
      request: new Request('http://localhost/cache-reuse'),
      source: 'request',
    });

    expect(getUserCalls).toEqual(['user_cache_reuse']);
    expect(first.actor).toMatchObject({
      kind: 'user',
      id: 'user_cache_reuse',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
    });
    expect(second.actor).toMatchObject({
      kind: 'user',
      id: 'user_cache_reuse',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
    });
  });

  it('refreshes hydrated Clerk users after the cache TTL expires', async () => {
    const getUserCalls: string[] = [];
    const clerkClient = {
      async authenticateRequest() {
        return {
          isAuthenticated: true,
          toAuth() {
            return createSessionClerkAuth({
              userId: 'user_cache_expire',
              sessionId: 'sess_cache_expire',
              claims: {
                sub: 'user_cache_expire',
              },
            });
          },
        };
      },
      users: {
        async getUser(userId: string) {
          getUserCalls.push(userId);
          return {
            id: userId,
            fullName: 'Grace Hopper',
          };
        },
      },
    };
    const integration = clerk({
      clerkClient,
      hydrateUser: {
        cacheTtlMs: 1,
        maxEntries: 8,
      },
    });

    await resolveClerkAuthContext(integration, {
      ctx: undefined,
      request: new Request('http://localhost/cache-expire'),
      source: 'request',
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const refreshed = await resolveClerkAuthContext(integration, {
      ctx: undefined,
      request: new Request('http://localhost/cache-expire'),
      source: 'request',
    });

    expect(getUserCalls).toEqual(['user_cache_expire', 'user_cache_expire']);
    expect(refreshed.actor).toMatchObject({
      kind: 'user',
      id: 'user_cache_expire',
      name: 'Grace Hopper',
    });
  });

  it('evicts older hydrated Clerk users when the cache reaches its max size', async () => {
    const getUserCalls: string[] = [];
    const authByPath: Record<string, ReturnType<typeof createSessionClerkAuth>> = {
      '/first': createSessionClerkAuth({
        userId: 'user_cache_first',
        sessionId: 'sess_cache_first',
        claims: {
          sub: 'user_cache_first',
        },
      }),
      '/second': createSessionClerkAuth({
        userId: 'user_cache_second',
        sessionId: 'sess_cache_second',
        claims: {
          sub: 'user_cache_second',
        },
      }),
    };
    const clerkClient = {
      async authenticateRequest(request: Request) {
        return {
          isAuthenticated: true,
          toAuth() {
            return authByPath[new URL(request.url).pathname];
          },
        };
      },
      users: {
        async getUser(userId: string) {
          getUserCalls.push(userId);
          return {
            id: userId,
            fullName: `Name for ${userId}`,
          };
        },
      },
    };
    const integration = clerk({
      clerkClient,
      hydrateUser: {
        cacheTtlMs: 1_000,
        maxEntries: 1,
      },
    });

    await resolveClerkAuthContext(integration, {
      ctx: undefined,
      request: new Request('http://localhost/first'),
      source: 'request',
    });
    await resolveClerkAuthContext(integration, {
      ctx: undefined,
      request: new Request('http://localhost/second'),
      source: 'request',
    });
    const rehydrated = await resolveClerkAuthContext(integration, {
      ctx: undefined,
      request: new Request('http://localhost/first'),
      source: 'request',
    });

    expect(getUserCalls).toEqual([
      'user_cache_first',
      'user_cache_second',
      'user_cache_first',
    ]);
    expect(rehydrated.actor).toMatchObject({
      kind: 'user',
      id: 'user_cache_first',
      name: 'Name for user_cache_first',
    });
  });
});
