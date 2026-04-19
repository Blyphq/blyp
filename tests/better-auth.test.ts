import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  blyp,
  blypClient,
  identifyUser,
  normalizeBetterAuthContext,
  withBetterAuthContextOverride,
} from '../src/better-auth';
import { createStandaloneLogger } from '../src/frameworks/standalone';
import { createClientPayload } from './helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from './helpers/fs';

describe('Better Auth integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('blyp-better-auth-');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('normalizes Better Auth sessions into canonical auth context', () => {
    const auth = normalizeBetterAuthContext({
      session: {
        id: 'sess_1',
        activeOrganizationId: 'org_1',
      },
      user: {
        id: 'user_1',
        email: 'ada@example.com',
        name: 'Ada',
        claims: {
          role: 'admin',
        },
      },
    });

    expect(auth).toEqual({
      provider: 'better-auth',
      authenticated: true,
      actor: {
        kind: 'user',
        id: 'user_1',
        email: 'ada@example.com',
        name: 'Ada',
      },
      session: {
        id: 'sess_1',
        activeOrganizationId: 'org_1',
      },
      organization: {
        id: 'org_1',
      },
      lookup: {
        provider: 'better-auth',
        userId: 'user_1',
        sessionId: 'sess_1',
        organizationId: 'org_1',
        email: 'ada@example.com',
      },
    });
  });

  it('keeps claims and raw session opt-in only', () => {
    const session = {
      session: {
        id: 'sess_1',
        claims: {
          team: 'ops',
        },
      },
      user: {
        id: 'user_1',
      },
    };

    const withoutExtras = normalizeBetterAuthContext(session);
    const withExtras = normalizeBetterAuthContext(session, {
      includeClaims: true,
      includeRawSession: true,
    });

    expect(withoutExtras?.claims).toBeUndefined();
    expect(withoutExtras?.raw).toBeUndefined();
    expect(withExtras?.claims).toEqual({ team: 'ops' });
    expect(withExtras?.raw).toEqual(session);
  });

  it('returns null when no Better Auth session is present', () => {
    expect(normalizeBetterAuthContext(null)).toBeNull();
    expect(normalizeBetterAuthContext({})).toBeNull();
  });

  it('ignores invalid Better Auth overrides and preserves canonical provider fields', () => {
    const base = normalizeBetterAuthContext(
      {
        session: {
          id: 'sess_1',
          activeOrganizationId: 'org_1',
        },
        user: {
          id: 'user_1',
          email: 'ada@example.com',
        },
      },
      {
        includeClaims: true,
        includeRawSession: true,
      }
    );

    const overridden = withBetterAuthContextOverride(base, {
      provider: 'clerk',
      authenticated: false,
      actor: {
        email: 'grace@example.com',
      },
      session: 'broken',
      organization: 123,
      lookup: {
        provider: 'clerk',
        email: 'grace@example.com',
      },
      claims: 'invalid',
      raw: [],
    });

    expect(overridden).toMatchObject({
      provider: 'better-auth',
      authenticated: false,
      actor: {
        kind: 'user',
        id: 'user_1',
        email: 'grace@example.com',
      },
      session: {
        id: 'sess_1',
        activeOrganizationId: 'org_1',
      },
      organization: {
        id: 'org_1',
      },
      lookup: {
        provider: 'better-auth',
        userId: 'user_1',
        sessionId: 'sess_1',
        organizationId: 'org_1',
        email: 'grace@example.com',
      },
    });
    expect(overridden?.claims).toBeUndefined();
    expect(overridden?.raw).toEqual({
      session: {
        id: 'sess_1',
        activeOrganizationId: 'org_1',
      },
      user: {
        id: 'user_1',
        email: 'ada@example.com',
      },
    });
  });

  it('identifies users from canonical records and database rows', () => {
    expect(
      identifyUser({
        auth: {
          lookup: {
            provider: 'better-auth',
            userId: 'user_1',
            sessionId: 'sess_1',
            organizationId: 'org_1',
            email: 'ada@example.com',
          },
        },
      })
    ).toEqual({
      provider: 'better-auth',
      userId: 'user_1',
      sessionId: 'sess_1',
      organizationId: 'org_1',
      email: 'ada@example.com',
    });

    expect(
      identifyUser({
        authProvider: 'better-auth',
        authActorId: 'user_2',
        authSessionId: 'sess_2',
        authOrganizationId: 'org_2',
      })
    ).toEqual({
      provider: 'better-auth',
      userId: 'user_2',
      sessionId: 'sess_2',
      organizationId: 'org_2',
    });

    expect(identifyUser({ authProvider: 'clerk' })).toBeNull();
  });

  it('creates a Better Auth-compatible plugin and logs auth requests', async () => {
    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
    });
    const plugin = blyp({
      logger,
      authEndpointLogging: true,
    });
    const request = new Request('http://localhost/api/auth/get-session', {
      method: 'GET',
    });
    const ctx = {
      session: {
        session: {
          id: 'sess_1',
        },
        user: {
          id: 'user_1',
          email: 'ada@example.com',
        },
      },
    };

    expect(plugin.id).toBe('blyp');
    expect(typeof plugin.onRequest).toBe('function');
    expect(typeof plugin.onResponse).toBe('function');

    await plugin.onRequest?.(request, ctx as never);
    await plugin.onResponse?.(new Response(null, { status: 200 }), ctx as never);
    await logger.flush();
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const record = records.find((entry) => entry.message === 'better_auth_request');

    expect(record).toBeDefined();
    expect(record?.auth).toMatchObject({
      provider: 'better-auth',
      actor: {
        id: 'user_1',
        email: 'ada@example.com',
      },
      session: {
        id: 'sess_1',
      },
    });
    expect(record?.traceId).toMatch(/^trace_/);
    expect(record?.data).toMatchObject({
      type: 'better_auth_request',
      method: 'GET',
      path: '/api/auth/get-session',
      status: 200,
      betterAuth: {
        action: 'get_session',
      },
    });
  });

  it('prefers newSession over session in the Better Auth client-ingestion endpoint', async () => {
    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
    });
    const plugin = blyp({
      logger,
      clientLogging: true,
    }) as {
      endpoints?: {
        blypLog?: (ctx: Record<string, unknown>) => Promise<Response>;
      };
    };

    const response = await plugin.endpoints?.blypLog?.({
      headers: new Headers({
        'content-type': 'application/json',
      }),
      body: createClientPayload(),
      context: {
        session: {
          session: {
            id: 'sess_old',
          },
          user: {
            id: 'user_old',
            email: 'old@example.com',
          },
        },
        newSession: {
          session: {
            id: 'sess_new',
          },
          user: {
            id: 'user_new',
            email: 'new@example.com',
          },
        },
      },
    });
    await logger.flush();
    await waitForFileFlush();

    expect(response?.status).toBe(204);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const record = records.find((entry) => entry.message === '[client] frontend rendered');

    expect(record?.auth).toMatchObject({
      provider: 'better-auth',
      actor: {
        id: 'user_new',
        email: 'new@example.com',
      },
      session: {
        id: 'sess_new',
      },
    });
  });

  it('redacts Better Auth claims and raw session fields before persisting auth context', async () => {
    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      redact: {
        keys: ['secret', 'token', 'password'],
      },
    });
    const plugin = blyp({
      logger,
      clientLogging: true,
      includeClaims: true,
      includeRawSession: true,
    }) as {
      endpoints?: {
        blypLog?: (ctx: Record<string, unknown>) => Promise<Response>;
      };
    };

    await plugin.endpoints?.blypLog?.({
      headers: new Headers({
        'content-type': 'application/json',
      }),
      body: createClientPayload(),
      context: {
        session: {
          session: {
            id: 'sess_1',
            token: 'session-secret',
            claims: {
              secret: 'claim-secret',
            },
          },
          user: {
            id: 'user_1',
            email: 'ada@example.com',
            password: 'hunter2',
          },
        },
        newSession: {
          session: {
            id: 'sess_1',
            token: 'session-secret',
            claims: {
              secret: 'claim-secret',
            },
          },
          user: {
            id: 'user_1',
            email: 'ada@example.com',
            password: 'hunter2',
          },
        },
      },
    });
    await logger.flush();
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const record = records.find((entry) => entry.message === '[client] frontend rendered');
    const auth = record?.auth as Record<string, any> | undefined;

    expect(auth?.claims?.secret).toBe('[REDACTED]');
    expect(auth?.raw?.session?.token).toBe('[REDACTED]');
    expect(auth?.raw?.user?.password).toBe('[REDACTED]');
  });

  it('creates a Better Auth client plugin logger that posts to the plugin endpoint', async () => {
    const fetchCalls: Array<{ url: string; options?: Record<string, unknown> }> = [];
    const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: ((url: string | URL | Request) => Promise.resolve(new Response(null, { status: 204 }))) as typeof fetch,
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
      const plugin = blypClient();
      const actions = plugin.getActions?.(
        (async (url: string, options?: Record<string, unknown>) => {
          fetchCalls.push({ url, options });
          return { data: null, error: null };
        }) as never,
        {} as never,
        undefined
      );
      const logger = actions?.blyp.createLogger();

      logger.info('clicked upgrade');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]?.url).toBe('/blyp/log');
      expect(fetchCalls[0]?.options?.method).toBe('POST');
      expect(fetchCalls[0]?.options?.body).toMatchObject({
        type: 'client_log',
        message: 'clicked upgrade',
      });
      expect((fetchCalls[0]?.options?.body as Record<string, unknown>)?.auth).toBeUndefined();
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
});
