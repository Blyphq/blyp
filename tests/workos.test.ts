import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  extractWorkOsSessionCookie,
  identifyUser,
  normalizeWorkOsContext,
  withWorkOsContextOverride,
} from '../src/workos';
import { resolveServerLogger, resolveRequestAuthContext, runWithRequestContext } from '../src/frameworks/shared';
import { getActiveRequestAuthContext } from '../src/frameworks/shared/request-context';
import { createStandaloneLogger } from '../src/frameworks/standalone';
import { makeTempDir, readJsonLines, waitForFileFlush } from './helpers/fs';
import type { WorkOsAuthenticateResponse, WorkOsIntegrationConfig, WorkOsLogContext } from '../src/types/workos';

function createMockWorkOs(authResponse: WorkOsAuthenticateResponse | null = null) {
  return {
    userManagement: {
      loadSealedSession: (_options: { sessionData: string; cookiePassword: string }) => ({
        authenticate: async () => authResponse ?? { authenticated: false as const, reason: 'no_session' },
      }),
    },
  };
}

function createAuthenticatedResponse(overrides: Partial<Extract<WorkOsAuthenticateResponse, { authenticated: true }>> = {}): WorkOsAuthenticateResponse {
  return {
    authenticated: true,
    sessionId: 'sess_workos_1',
    organizationId: 'org_workos_1',
    role: 'admin',
    permissions: ['read', 'write', 'delete'],
    entitlements: [{ feature: 'premium' }],
    featureFlags: [{ key: 'dark_mode', enabled: true }],
    user: {
      id: 'user_workos_1',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    },
    impersonator: undefined,
    ...overrides,
  };
}

describe('WorkOS AuthKit integration', () => {
  describe('normalizeWorkOsContext', () => {
    it('normalizes authenticated session into canonical auth context', () => {
      const auth = normalizeWorkOsContext(createAuthenticatedResponse());

      expect(auth).toEqual({
        provider: 'workos',
        authenticated: true,
        actor: {
          kind: 'user',
          id: 'user_workos_1',
          email: 'ada@example.com',
          name: 'Ada Lovelace',
        },
        session: {
          id: 'sess_workos_1',
        },
        organization: {
          id: 'org_workos_1',
        },
        lookup: {
          provider: 'workos',
          userId: 'user_workos_1',
          sessionId: 'sess_workos_1',
          organizationId: 'org_workos_1',
          email: 'ada@example.com',
        },
        role: 'admin',
        roles: ['admin'],
        permissions: ['read', 'write', 'delete'],
        entitlements: [{ feature: 'premium' }],
        featureFlags: [{ key: 'dark_mode', enabled: true }],
      });
    });

    it('maps user, session, org, role(s), permissions, and impersonator', () => {
      const auth = normalizeWorkOsContext(createAuthenticatedResponse({
        impersonator: { email: 'support@example.com', reason: 'customer-request' },
      }));

      expect(auth?.actor.id).toBe('user_workos_1');
      expect(auth?.session?.id).toBe('sess_workos_1');
      expect(auth?.organization?.id).toBe('org_workos_1');
      expect(auth?.role).toBe('admin');
      expect(auth?.roles).toEqual(['admin']);
      expect(auth?.permissions).toEqual(['read', 'write', 'delete']);
      expect(auth?.impersonator).toEqual({
        email: 'support@example.com',
        reason: 'customer-request',
      });
    });

    it('returns null for missing auth response', () => {
      expect(normalizeWorkOsContext(null)).toBeNull();
    });

    it('returns null for unauthenticated auth response', () => {
      expect(normalizeWorkOsContext({
        authenticated: false,
        reason: 'session_expired',
      })).toBeNull();
    });

    it('keeps claims and raw session opt-in only', () => {
      const response = createAuthenticatedResponse({
        user: {
          id: 'user_1',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          customField: 'custom_value',
          metadata: { plan: 'pro' },
        },
      });

      const withoutExtras = normalizeWorkOsContext(response);
      const withExtras = normalizeWorkOsContext(response, {
        includeClaims: true,
        includeRawSession: true,
      });

      expect(withoutExtras?.claims).toBeUndefined();
      expect(withoutExtras?.raw).toBeUndefined();
      expect(withExtras?.claims).toEqual({
        customField: 'custom_value',
        metadata: { plan: 'pro' },
      });
      expect(withExtras?.raw).toBeDefined();
      expect((withExtras?.raw as Record<string, unknown>)?.authenticated).toBe(true);
    });

    it('handles user with only first name', () => {
      const auth = normalizeWorkOsContext(createAuthenticatedResponse({
        user: {
          id: 'user_1',
          firstName: 'Ada',
        },
      }));

      expect(auth?.actor.name).toBe('Ada');
    });

    it('handles user with only last name', () => {
      const auth = normalizeWorkOsContext(createAuthenticatedResponse({
        user: {
          id: 'user_1',
          lastName: 'Lovelace',
        },
      }));

      expect(auth?.actor.name).toBe('Lovelace');
    });

    it('omits optional fields when absent', () => {
      const auth = normalizeWorkOsContext(createAuthenticatedResponse({
        organizationId: undefined,
        role: undefined,
        permissions: [],
        entitlements: [],
        featureFlags: [],
        impersonator: undefined,
      }));

      expect(auth?.organization).toBeUndefined();
      expect(auth?.role).toBeUndefined();
      expect(auth?.roles).toBeUndefined();
      expect(auth?.permissions).toBeUndefined();
      expect(auth?.entitlements).toBeUndefined();
      expect(auth?.featureFlags).toBeUndefined();
      expect(auth?.impersonator).toBeUndefined();
    });
  });

  describe('withWorkOsContextOverride', () => {
    it('preserves provider field when overrides attempt to change it', () => {
      const base = normalizeWorkOsContext(createAuthenticatedResponse());
      const overridden = withWorkOsContextOverride(base, {
        provider: 'clerk',
        actor: { email: 'grace@example.com' },
        lookup: { provider: 'clerk', email: 'grace@example.com' },
      });

      expect(overridden?.provider).toBe('workos');
      expect(overridden?.actor.email).toBe('grace@example.com');
      expect(overridden?.lookup.provider).toBe('workos');
      expect(overridden?.lookup.email).toBe('grace@example.com');
    });

    it('handles invalid override types gracefully', () => {
      const base = normalizeWorkOsContext(createAuthenticatedResponse());
      const overridden = withWorkOsContextOverride(base, {
        session: 'broken',
        organization: 123,
        claims: 'invalid',
        raw: [],
      });

      expect(overridden?.session).toEqual({ id: 'sess_workos_1' });
      expect(overridden?.organization).toEqual({ id: 'org_workos_1' });
      expect(overridden?.claims).toBeUndefined();
      expect(overridden?.raw).toBeUndefined();
    });

    it('returns null when base is null', () => {
      expect(withWorkOsContextOverride(null, { actor: { email: 'test@example.com' } })).toBeNull();
    });

    it('returns base when extra is undefined', () => {
      const base = normalizeWorkOsContext(createAuthenticatedResponse());
      expect(withWorkOsContextOverride(base, undefined)).toBe(base);
    });

    it('allows overriding WorkOS-specific fields', () => {
      const base = normalizeWorkOsContext(createAuthenticatedResponse());
      const overridden = withWorkOsContextOverride(base, {
        role: 'member',
        roles: ['member', 'viewer'],
        permissions: ['read'],
        impersonator: { email: 'admin@example.com' },
      });

      expect(overridden?.role).toBe('member');
      expect(overridden?.roles).toEqual(['member', 'viewer']);
      expect(overridden?.permissions).toEqual(['read']);
      expect(overridden?.impersonator).toEqual({ email: 'admin@example.com' });
    });
  });

  describe('identifyUser', () => {
    it('identifies users from canonical log records', () => {
      expect(
        identifyUser({
          auth: {
            lookup: {
              provider: 'workos',
              userId: 'user_1',
              sessionId: 'sess_1',
              organizationId: 'org_1',
              email: 'ada@example.com',
            },
          },
        })
      ).toEqual({
        provider: 'workos',
        userId: 'user_1',
        sessionId: 'sess_1',
        organizationId: 'org_1',
        email: 'ada@example.com',
      });
    });

    it('identifies users from database rows with authProvider=workos', () => {
      expect(
        identifyUser({
          authProvider: 'workos',
          authActorId: 'user_2',
          authSessionId: 'sess_2',
          authOrganizationId: 'org_2',
        })
      ).toEqual({
        provider: 'workos',
        userId: 'user_2',
        sessionId: 'sess_2',
        organizationId: 'org_2',
      });
    });

    it('returns null for non-WorkOS records', () => {
      expect(identifyUser({ authProvider: 'better-auth' })).toBeNull();
      expect(identifyUser({ authProvider: 'clerk' })).toBeNull();
      expect(identifyUser(null)).toBeNull();
      expect(identifyUser({})).toBeNull();
    });
  });

  describe('extractWorkOsSessionCookie', () => {
    it('extracts cookie from Headers instance', () => {
      const headers = new Headers({
        cookie: 'wos-session=sealed_token_abc; other=value',
      });

      expect(extractWorkOsSessionCookie(headers)).toBe('sealed_token_abc');
    });

    it('extracts cookie from plain object', () => {
      const headers = { cookie: 'wos-session=sealed_token_abc; other=value' };

      expect(extractWorkOsSessionCookie(headers)).toBe('sealed_token_abc');
    });

    it('supports case-insensitive Cookie header in plain objects', () => {
      const headers = { Cookie: 'wos-session=sealed_token_abc' };

      expect(extractWorkOsSessionCookie(headers)).toBe('sealed_token_abc');
    });

    it('supports custom cookie name', () => {
      const headers = new Headers({
        cookie: 'my-session=custom_token; wos-session=default_token',
      });

      expect(extractWorkOsSessionCookie(headers, 'my-session')).toBe('custom_token');
    });

    it('returns null when cookie is not present', () => {
      const headers = new Headers({ cookie: 'other=value' });

      expect(extractWorkOsSessionCookie(headers)).toBeNull();
    });

    it('returns null for missing headers', () => {
      expect(extractWorkOsSessionCookie(null)).toBeNull();
      expect(extractWorkOsSessionCookie(undefined)).toBeNull();
    });

    it('returns null for empty cookie value', () => {
      const headers = new Headers({ cookie: 'wos-session=' });

      expect(extractWorkOsSessionCookie(headers)).toBeNull();
    });
  });

  describe('framework auth resolution', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = makeTempDir('blyp-workos-');
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('resolves WorkOS auth context from request with valid session cookie', async () => {
      const authResponse = createAuthenticatedResponse();
      const workos = createMockWorkOs(authResponse);

      const config = resolveServerLogger({
        pretty: false,
        logDir: tempDir,
        auth: {
          workos: {
            workos,
            cookiePassword: 'test-password-32-chars-xxxxxxxxx',
          },
        },
      });

      const request = {
        method: 'GET',
        url: 'http://localhost/api/data',
        headers: new Headers({
          cookie: 'wos-session=sealed_token_abc',
        }),
      };

      const result = { auth: null as WorkOsLogContext | null };

      await runWithRequestContext(async () => {
        result.auth = await resolveRequestAuthContext({
          config,
          ctx: {},
          request,
          source: 'request',
        }) as WorkOsLogContext | null;
      });

      expect(result.auth).not.toBeNull();
      expect(result.auth?.provider).toBe('workos');
      expect(result.auth?.authenticated).toBe(true);
      expect(result.auth?.actor.id).toBe('user_workos_1');
      expect(result.auth?.actor.email).toBe('ada@example.com');
      expect(result.auth?.session?.id).toBe('sess_workos_1');
      expect(result.auth?.organization?.id).toBe('org_workos_1');
    });

    it('returns null when no session cookie is present', async () => {
      const workos = createMockWorkOs(createAuthenticatedResponse());

      const config = resolveServerLogger({
        pretty: false,
        logDir: tempDir,
        auth: {
          workos: {
            workos,
            cookiePassword: 'test-password-32-chars-xxxxxxxxx',
          },
        },
      });

      const request = {
        method: 'GET',
        url: 'http://localhost/api/data',
        headers: new Headers(),
      };

      const result = { auth: null as WorkOsLogContext | null };

      await runWithRequestContext(async () => {
        result.auth = await resolveRequestAuthContext({
          config,
          ctx: {},
          request,
          source: 'request',
        }) as WorkOsLogContext | null;
      });

      expect(result.auth).toBeNull();
    });

    it('returns null when WorkOS authentication fails', async () => {
      const workos = createMockWorkOs({
        authenticated: false,
        reason: 'session_expired',
      });

      const config = resolveServerLogger({
        pretty: false,
        logDir: tempDir,
        auth: {
          workos: {
            workos,
            cookiePassword: 'test-password-32-chars-xxxxxxxxx',
          },
        },
      });

      const request = {
        method: 'GET',
        url: 'http://localhost/api/data',
        headers: new Headers({
          cookie: 'wos-session=expired_token',
        }),
      };

      const result = { auth: null as WorkOsLogContext | null };

      await runWithRequestContext(async () => {
        result.auth = await resolveRequestAuthContext({
          config,
          ctx: {},
          request,
          source: 'request',
        }) as WorkOsLogContext | null;
      });

      expect(result.auth).toBeNull();
    });

    it('stores WorkOS auth context in request context', async () => {
      const authResponse = createAuthenticatedResponse();
      const workos = createMockWorkOs(authResponse);

      const config = resolveServerLogger({
        pretty: false,
        logDir: tempDir,
        auth: {
          workos: {
            workos,
            cookiePassword: 'test-password-32-chars-xxxxxxxxx',
          },
        },
      });

      const request = {
        method: 'GET',
        url: 'http://localhost/api/data',
        headers: new Headers({
          cookie: 'wos-session=sealed_token_abc',
        }),
      };

      await runWithRequestContext(async () => {
        await resolveRequestAuthContext({
          config,
          ctx: {},
          request,
          source: 'request',
        });

        const stored = getActiveRequestAuthContext();
        expect(stored?.provider).toBe('workos');
        expect((stored as WorkOsLogContext)?.actor.id).toBe('user_workos_1');
      });
    });

    it('handles stale cookies without breaking request logging', async () => {
      const workos = {
        userManagement: {
          loadSealedSession: () => ({
            authenticate: async () => {
              throw new Error('Unseal failure: corrupted data');
            },
          }),
        },
      };

      const config = resolveServerLogger({
        pretty: false,
        logDir: tempDir,
        auth: {
          workos: {
            workos,
            cookiePassword: 'test-password-32-chars-xxxxxxxxx',
          },
        },
      });

      const request = {
        method: 'GET',
        url: 'http://localhost/api/data',
        headers: new Headers({
          cookie: 'wos-session=corrupted_token',
        }),
      };

      const result = { auth: null as WorkOsLogContext | null };

      await runWithRequestContext(async () => {
        result.auth = await resolveRequestAuthContext({
          config,
          ctx: {},
          request,
          source: 'request',
        }) as WorkOsLogContext | null;
      });

      expect(result.auth).toBeNull();
    });

    it('runs the enrich hook and merges results', async () => {
      const authResponse = createAuthenticatedResponse();
      const workos = createMockWorkOs(authResponse);

      const config = resolveServerLogger({
        pretty: false,
        logDir: tempDir,
        auth: {
          workos: {
            workos,
            cookiePassword: 'test-password-32-chars-xxxxxxxxx',
            enrich: async (args) => ({
              actor: { name: 'Ada (VIP)' },
              permissions: [...(args.authResponse as Extract<WorkOsAuthenticateResponse, { authenticated: true }>)?.permissions ?? [], 'vip'],
            }),
          },
        },
      });

      const request = {
        method: 'GET',
        url: 'http://localhost/api/data',
        headers: new Headers({
          cookie: 'wos-session=sealed_token_abc',
        }),
      };

      const result = { auth: null as WorkOsLogContext | null };

      await runWithRequestContext(async () => {
        result.auth = await resolveRequestAuthContext({
          config,
          ctx: {},
          request,
          source: 'request',
        }) as WorkOsLogContext | null;
      });

      expect(result.auth?.actor.name).toBe('Ada (VIP)');
      expect(result.auth?.permissions).toEqual(['read', 'write', 'delete', 'vip']);
    });

    it('continues with base auth when enrich hook fails', async () => {
      const authResponse = createAuthenticatedResponse();
      const workos = createMockWorkOs(authResponse);

      const config = resolveServerLogger({
        pretty: false,
        logDir: tempDir,
        auth: {
          workos: {
            workos,
            cookiePassword: 'test-password-32-chars-xxxxxxxxx',
            enrich: async () => {
              throw new Error('enrich failed');
            },
          },
        },
      });

      const request = {
        method: 'GET',
        url: 'http://localhost/api/data',
        headers: new Headers({
          cookie: 'wos-session=sealed_token_abc',
        }),
      };

      const result = { auth: null as WorkOsLogContext | null };

      await runWithRequestContext(async () => {
        result.auth = await resolveRequestAuthContext({
          config,
          ctx: {},
          request,
          source: 'request',
        }) as WorkOsLogContext | null;
      });

      expect(result.auth).not.toBeNull();
      expect(result.auth?.provider).toBe('workos');
      expect(result.auth?.actor.id).toBe('user_workos_1');
    });

    it('resolves WorkOS auth in client ingestion context', async () => {
      const authResponse = createAuthenticatedResponse();
      const workos = createMockWorkOs(authResponse);

      const config = resolveServerLogger({
        pretty: false,
        logDir: tempDir,
        auth: {
          workos: {
            workos,
            cookiePassword: 'test-password-32-chars-xxxxxxxxx',
          },
        },
      });

      const request = {
        method: 'POST',
        url: 'http://localhost/blyp/log',
        headers: new Headers({
          cookie: 'wos-session=sealed_token_abc',
        }),
      };

      const result = { auth: null as WorkOsLogContext | null };

      await runWithRequestContext(async () => {
        result.auth = await resolveRequestAuthContext({
          config,
          ctx: {},
          request,
          source: 'client_ingestion',
        }) as WorkOsLogContext | null;
      });

      expect(result.auth?.provider).toBe('workos');
      expect(result.auth?.authenticated).toBe(true);
    });

    it('supports custom cookie name', async () => {
      const authResponse = createAuthenticatedResponse();
      const workos = createMockWorkOs(authResponse);

      const config = resolveServerLogger({
        pretty: false,
        logDir: tempDir,
        auth: {
          workos: {
            workos,
            cookiePassword: 'test-password-32-chars-xxxxxxxxx',
            cookieName: 'my-auth-session',
          },
        },
      });

      const request = {
        method: 'GET',
        url: 'http://localhost/api/data',
        headers: new Headers({
          cookie: 'my-auth-session=sealed_token_abc',
        }),
      };

      const result = { auth: null as WorkOsLogContext | null };

      await runWithRequestContext(async () => {
        result.auth = await resolveRequestAuthContext({
          config,
          ctx: {},
          request,
          source: 'request',
        }) as WorkOsLogContext | null;
      });

      expect(result.auth?.provider).toBe('workos');
      expect(result.auth?.authenticated).toBe(true);
    });
  });

  describe('configuration validation', () => {
    it('rejects configuration with both Better Auth and WorkOS', () => {
      const workos = createMockWorkOs();
      const betterAuth = {
        api: {
          getSession: async () => null,
        },
      };

      expect(() => {
        resolveServerLogger({
          auth: {
            betterAuth: {
              betterAuth,
            },
            workos: {
              workos,
              cookiePassword: 'test-password',
            },
          },
        });
      }).toThrow('Cannot configure both Better Auth and WorkOS');
    });

    it('accepts legacy Better Auth config format', () => {
      const betterAuth = {
        api: {
          getSession: async () => null,
        },
      };

      const config = resolveServerLogger({
        auth: {
          betterAuth,
        },
      });

      expect(config.resolvedAuth?.provider).toBe('better-auth');
    });

    it('accepts expanded Better Auth config format', () => {
      const betterAuth = {
        api: {
          getSession: async () => null,
        },
      };

      const config = resolveServerLogger({
        auth: {
          betterAuth: {
            betterAuth,
            includeClaims: true,
          },
        },
      });

      expect(config.resolvedAuth?.provider).toBe('better-auth');
    });

    it('accepts WorkOS-only config', () => {
      const workos = createMockWorkOs();

      const config = resolveServerLogger({
        auth: {
          workos: {
            workos,
            cookiePassword: 'test-password',
          },
        },
      });

      expect(config.resolvedAuth?.provider).toBe('workos');
    });
  });
});
