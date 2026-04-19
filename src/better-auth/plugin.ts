import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint, getSessionFromCtx, sessionMiddleware } from 'better-auth/api';
import { createStandaloneLogger } from '../frameworks/standalone';
import {
  createRequestLike,
  createRequestTraceId,
  extractPathname,
  flushServerLoggerSafely,
  handleClientLogIngestion,
  resolveServerLogger,
  runWithRequestContext,
  setActiveRequestAuthContext,
  setActiveRequestTraceId,
} from '../frameworks/shared';
import {
  normalizeBetterAuthContext,
  withBetterAuthContextOverride,
} from './normalize';
import { createWarnOnceLogger } from '../shared/once';
import type {
  BetterAuthLogContext,
  BetterAuthPluginEnrichArgs,
  BetterAuthSessionEnvelope,
  BlypBetterAuthPluginOptions,
} from '../types/better-auth';

const DEFAULT_BETTER_AUTH_CLIENT_LOG_PATH = '/blyp/log';
const BLYP_BETTER_AUTH_PLUGIN_SYMBOL = Symbol.for('blyp.better-auth-plugin');
const pluginWarnings = new Set<string>();
const warnPluginOnce = createWarnOnceLogger(pluginWarnings);

type RequestState = {
  request: Request;
  traceId: string;
  startedAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePluginPath(path: string | undefined): string {
  if (!path) {
    return DEFAULT_BETTER_AUTH_CLIENT_LOG_PATH;
  }

  return path.startsWith('/') ? path : `/${path}`;
}

function resolveClientLogging(
  clientLogging: BlypBetterAuthPluginOptions['clientLogging']
): { enabled: boolean; path: string } {
  if (clientLogging === false || clientLogging === undefined) {
    return {
      enabled: false,
      path: DEFAULT_BETTER_AUTH_CLIENT_LOG_PATH,
    };
  }

  if (clientLogging === true) {
    return {
      enabled: true,
      path: DEFAULT_BETTER_AUTH_CLIENT_LOG_PATH,
    };
  }

  return {
    enabled: true,
    path: normalizePluginPath(clientLogging.path),
  };
}

function resolveBetterAuthAction(path: string): string {
  if (path.includes('/sign-in')) {
    return 'sign_in';
  }

  if (path.includes('/sign-up')) {
    return 'sign_up';
  }

  if (path.includes('/sign-out')) {
    return 'sign_out';
  }

  if (path.includes('/get-session')) {
    return 'get_session';
  }

  if (
    path.includes('/organization/set-active') ||
    path.includes('/set-active-organization')
  ) {
    return 'set_active_organization';
  }

  return 'unknown';
}

function resolveSessionEnvelope(value: unknown): BetterAuthSessionEnvelope | null {
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

async function enrichPluginAuth(
  auth: BetterAuthLogContext | null,
  options: Pick<
    BlypBetterAuthPluginOptions,
    'enrich'
  >,
  args: BetterAuthPluginEnrichArgs
): Promise<BetterAuthLogContext | null> {
  if (!options.enrich) {
    return auth;
  }

  try {
    const extra = await options.enrich(args);
    return withBetterAuthContextOverride(auth, extra);
  } catch (error) {
    warnPluginOnce(
      'better-auth-plugin-enrich-failure',
      '[blyp] Better Auth plugin enrich hook failed. Continuing with the normalized auth context.',
      error
    );
    return auth;
  }
}

export function isBlypBetterAuthPlugin(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      BLYP_BETTER_AUTH_PLUGIN_SYMBOL in (value as Record<PropertyKey, unknown>)
  );
}

export function blyp(
  options: BlypBetterAuthPluginOptions = {}
): BetterAuthPlugin {
  const logger = options.logger ?? createStandaloneLogger(options.loggerConfig ?? {});
  const clientLogging = resolveClientLogging(options.clientLogging);
  const authEndpointLogging = options.authEndpointLogging ?? true;
  const requestState = new WeakMap<object, RequestState>();

  const plugin: BetterAuthPlugin = {
    id: 'blyp',
    ...(clientLogging.enabled
      ? {
          endpoints: {
            blypLog: createAuthEndpoint(
              clientLogging.path,
              {
                method: 'POST',
                requireHeaders: true,
                use: [sessionMiddleware],
              },
              async (ctx) => {
                const session =
                  resolveSessionEnvelope(ctx.context.newSession) ??
                  resolveSessionEnvelope(ctx.context.session) ??
                  await getSessionFromCtx(ctx).catch(() => null);
                const auth = normalizeBetterAuthContext(session, {
                  includeClaims: options.includeClaims,
                  includeRawSession: options.includeRawSession,
                });
                const traceId =
                  requestState.get(ctx.context as object)?.traceId ?? createRequestTraceId();
                const request = createRequestLike(
                  'POST',
                  clientLogging.path,
                  ctx.headers
                );
                const shared = resolveServerLogger(
                  {
                    clientLogging: {
                      path: clientLogging.path,
                    },
                  },
                  logger as any
                );

                const result = await runWithRequestContext(async () => {
                  setActiveRequestTraceId(traceId);
                  setActiveRequestAuthContext(auth);
                  return handleClientLogIngestion({
                    config: shared,
                    ctx,
                    request,
                    body: ctx.body,
                    deliveryPath: clientLogging.path,
                  });
                });

                await flushServerLoggerSafely(shared);
                return new Response(null, {
                  status: result.status,
                  headers: result.headers,
                });
              }
            ),
          },
        }
      : {}),
    ...(authEndpointLogging
      ? {
          onRequest: async (request, ctx) => {
            requestState.set(ctx, {
              request,
              traceId: createRequestTraceId(),
              startedAt: performance.now(),
            });
          },
          onResponse: async (response, ctx) => {
            const state = requestState.get(ctx);
            if (!state) {
              return;
            }

            const path = extractPathname(state.request.url);
            if (clientLogging.enabled && path === clientLogging.path) {
              return;
            }

            const session =
              resolveSessionEnvelope(ctx.newSession) ??
              resolveSessionEnvelope(ctx.session);
            const action = resolveBetterAuthAction(path);
            let auth = normalizeBetterAuthContext(session, {
              includeClaims: options.includeClaims,
              includeRawSession: options.includeRawSession,
            });
            auth = await enrichPluginAuth(auth, options, {
              request: state.request,
              response,
              auth,
              action,
              session,
            });

            await runWithRequestContext(async () => {
              setActiveRequestTraceId(state.traceId);
              setActiveRequestAuthContext(auth);
              logger.info('better_auth_request', {
                type: 'better_auth_request',
                method: state.request.method,
                path,
                status: response.status,
                duration: Math.round(performance.now() - state.startedAt),
                traceId: state.traceId,
                betterAuth: {
                  action,
                },
              });
            });
          },
        }
      : {}),
  };

  Object.defineProperty(plugin, BLYP_BETTER_AUTH_PLUGIN_SYMBOL, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });

  return plugin;
}
