import type { ClerkBackendClientLike } from '../../src/types/clerk';

interface MockClerkClientOptions {
  auth?: unknown;
  inspect?: (request: Request) => void;
}

export function createMockClerkClient(
  options: MockClerkClientOptions = {}
): ClerkBackendClientLike {
  return {
    async authenticateRequest(request) {
      options.inspect?.(request);
      return {
        isAuthenticated: Boolean(options.auth),
        toAuth() {
          return options.auth;
        },
      };
    },
  };
}

export function createSessionClerkAuth(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: 'user_1',
    sessionId: 'sess_1',
    orgId: 'org_1',
    orgSlug: 'acme',
    orgRole: 'org:admin',
    orgPermissions: ['org:read'],
    factorVerificationAge: [0, 5],
    claims: {
      sub: 'user_1',
      email: 'ada@example.com',
    },
    ...overrides,
  };
}

export function createMachineClerkAuth(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'oauth_1',
    tokenType: 'oauth_token',
    userId: 'user_1',
    clientId: 'client_1',
    scopes: ['logs:write'],
    claims: {
      sub: 'oauth_1',
      email: 'ada@example.com',
    },
    ...overrides,
  };
}
