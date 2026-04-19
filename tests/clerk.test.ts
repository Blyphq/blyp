import { describe, expect, it } from 'bun:test';
import {
  clerk,
  createClerkClientLogger,
  identifyUser,
  normalizeClerkAuthContext,
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
      }
      if (originalNavigator) {
        Object.defineProperty(globalThis, 'navigator', originalNavigator);
      }
      if (originalLocation) {
        Object.defineProperty(globalThis, 'location', originalLocation);
      }
      if (originalDocument) {
        Object.defineProperty(globalThis, 'document', originalDocument);
      }
      if (originalSessionStorage) {
        Object.defineProperty(globalThis, 'sessionStorage', originalSessionStorage);
      }
    }
  });
});
