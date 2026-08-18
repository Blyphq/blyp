import {
  definePlugin,
  type FarmEvent,
  type FarmEventType,
  type FarmPluginClientConfig,
  type FarmPluginRuntimeBaseEvent,
  type FarmPluginRuntimeBeforeEvent,
  type FarmPluginRuntimeAfterEvent,
  type FarmPluginRuntimeErrorEvent,
} from '@farm.js/core';
import {
  getFarmTraceContext,
  onFarmEvent,
} from '@farm.js/core/observability';
import type { BlypLogger } from '../../core/logger';
import type { ClientLogger } from '../../types/frameworks/client';
import type { AuthLogContext } from '../../types/auth';
import type {
  FarmJsBrowserTelemetryConfig,
  FarmJsLoggerConfig,
  FarmJsLoggerContext,
  FarmJsTelemetryEvents,
} from '../../types/frameworks/farmjs';
import type { ResolvedServerLogger } from '../../types/frameworks/shared';
import {
  createRequestLike,
  createRequestScopedLogger,
  createRequestTraceId,
  emitHttpErrorLog,
  emitHttpRequestLog,
  enterRequestContext,
  extractPathname,
  flushServerLoggerSafely,
  getActiveRequestAuthContext,
  hasStructuredLogBeenEmitted,
  handleClientLogIngestion,
  isErrorStatus,
  resolveAdditionalProps,
  resolveRequestAuthContext,
  resolveServerLogger,
  runWithRequestContext,
  setActiveRequestAuthContext,
  setActiveRequestLogger,
  setActiveRequestTraceId,
  shouldSkipAutoLogging,
  shouldSkipErrorLogging,
  toErrorLike,
} from '../shared';
import {
  createFarmJsBoundLogger,
  registerFarmJsRequestLogger,
  setFarmJsFallbackLogger,
} from './request-aware-logger';

const BLYP_LOG_KEY = 'blypLog';
const BLYP_TRACE_KEY = 'blypTraceId';
const BLYP_AUTH_KEY = 'blypAuth';
const BLYP_STRUCTURED_KEY = 'blypStructuredLogEmitted';
const BLYP_ERROR_LOGGED_KEY = 'blypErrorLogged';
const DEFAULT_TRACE_HEADER = 'x-blyp-trace-id';

const EDGE_PRESETS = new Set([
  'cloudflare',
  'cloudflare-pages',
  'deno',
  'netlify-edge',
]);

const CURATED_EVENT_TYPES = new Set<FarmEventType>([
  'server.start',
  'server.ready',
  'server.shutdown',
  'route.notFound',
  'api.validation.failed',
  'build.start',
  'build.complete',
  'build.error',
  'routes.generated',
  'types.generated',
  'manifest.generated',
]);

interface ResolvedBrowserTelemetryConfig {
  sampleRate: number;
  hydration: boolean;
  navigation: boolean;
  errors: boolean;
  performance: boolean;
  localConsole: boolean;
  credentials: RequestCredentials;
  connector?: FarmJsBrowserTelemetryConfig['connector'];
}

type FarmJsClientPublicConfig = ResolvedBrowserTelemetryConfig & {
  endpoint: string;
};

interface FarmJsClientState {
  logger: ClientLogger;
  sampled: boolean;
}

interface FarmJsPluginState {
  shared: ResolvedServerLogger<FarmJsLoggerContext>;
  events: FarmJsTelemetryEvents;
}

type FarmRuntimeEvent = FarmPluginRuntimeBaseEvent<FarmJsPluginState>;
type FarmBeforeEvent = FarmPluginRuntimeBeforeEvent<
  FarmJsPluginState,
  { blypTraceId: string; blypLog: BlypLogger }
>;
type FarmAfterEvent = FarmPluginRuntimeAfterEvent<
  FarmJsPluginState,
  { blypTraceId: string; blypLog: BlypLogger }
>;
type FarmErrorEvent = FarmPluginRuntimeErrorEvent<
  FarmJsPluginState,
  { blypTraceId: string; blypLog: BlypLogger }
>;

function resolveBrowserTelemetry(
  telemetry: FarmJsLoggerConfig['telemetry']
): ResolvedBrowserTelemetryConfig | null {
  if (telemetry === false || telemetry?.browser === false) {
    return null;
  }

  const input = typeof telemetry?.browser === 'object' ? telemetry.browser : {};
  const sampleRate = input.sampleRate ?? 0.1;
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
    throw new Error('[blyp/farmjs] telemetry.browser.sampleRate must be between 0 and 1.');
  }

  return {
    sampleRate,
    hydration: input.hydration ?? true,
    navigation: input.navigation ?? true,
    errors: input.errors ?? true,
    performance: input.performance ?? true,
    localConsole: input.localConsole ?? false,
    credentials: input.credentials ?? 'same-origin',
    ...(input.connector !== undefined ? { connector: input.connector } : {}),
  };
}

function resolveFarmEvents(
  telemetry: FarmJsLoggerConfig['telemetry']
): FarmJsTelemetryEvents {
  if (telemetry === false) {
    return false;
  }
  return telemetry?.events ?? 'curated';
}

function shouldForwardFarmEvent(event: FarmEvent, configured: FarmJsTelemetryEvents): boolean {
  if (configured === false || event.type.startsWith('request.')) {
    return false;
  }
  if (configured === 'all') {
    return true;
  }
  if (Array.isArray(configured)) {
    return configured.includes(event.type);
  }
  return event.level === 'warn' || event.level === 'error' || CURATED_EVENT_TYPES.has(event.type);
}

function writeFarmEvent(logger: BlypLogger, event: FarmEvent): void {
  const payload = {
    type: 'farm_event',
    framework: 'farmjs',
    event,
  };
  const message = `[farm] ${event.type}`;

  switch (event.level) {
    case 'error':
      logger.error(message, payload);
      return;
    case 'warn':
      logger.warning(message, payload);
      return;
    case 'debug':
      logger.debug(message, payload);
      return;
    case 'info':
    default:
      logger.info(message, payload);
  }
}

function forwardFarmEvent(
  shared: ResolvedServerLogger<FarmJsLoggerContext>,
  configured: FarmJsTelemetryEvents,
  event: FarmEvent
): void {
  if (!shouldForwardFarmEvent(event, configured)) {
    return;
  }

  runWithRequestContext(() => {
    setActiveRequestTraceId(event.traceId);
    writeFarmEvent(shared.logger, event);
  });
}

function getTraceId(request: Request, traceHeader: string): string {
  const incoming = request.headers.get(traceHeader)?.trim();
  if (incoming) {
    return incoming;
  }
  return getFarmTraceContext()?.traceId ?? createRequestTraceId();
}

function getLoggerFromEvent(event: FarmRuntimeEvent): BlypLogger {
  return event.req.get<BlypLogger>(BLYP_LOG_KEY) ?? event.state.shared.logger;
}

function getTraceFromEvent(event: FarmRuntimeEvent): string {
  return event.req.get<string>(BLYP_TRACE_KEY) ?? createRequestTraceId();
}

function restoreRequestContext(event: FarmRuntimeEvent): { logger: BlypLogger; traceId: string } {
  enterRequestContext();
  const logger = getLoggerFromEvent(event);
  const traceId = getTraceFromEvent(event);
  setActiveRequestTraceId(traceId);
  setActiveRequestLogger(logger);
  const auth = event.req.get<AuthLogContext | null>(BLYP_AUTH_KEY);
  if (auth !== undefined) {
    setActiveRequestAuthContext(auth);
  }
  return { logger, traceId };
}

function createLoggerContext(
  event: FarmRuntimeEvent,
  response?: Response,
  error?: unknown
): FarmJsLoggerContext {
  return {
    request: event.request,
    kind: event.kind,
    route: event.route,
    response,
    error,
    traceId: getTraceFromEvent(event),
    log: getLoggerFromEvent(event),
  };
}

function resolveFarmProps(
  event: FarmRuntimeEvent,
  response?: Response,
  error?: unknown
): Record<string, unknown> {
  return {
    ...resolveAdditionalProps(event.state.shared, createLoggerContext(event, response, error)),
    framework: 'farmjs',
    farm: {
      kind: event.kind,
      route: event.route?.pattern,
      params: event.route?.params,
    },
  };
}

function withTraceHeader(response: Response, traceHeader: string, traceId: string): Response {
  const headers = new Headers(response.headers);
  headers.set(traceHeader, traceId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleBrowserIngestion(event: FarmBeforeEvent): Promise<Response | undefined> {
  const path = extractPathname(event.request.url);
  if (path !== event.state.shared.ingestionPath) {
    return undefined;
  }

  const result = await handleClientLogIngestion({
    config: event.state.shared,
    ctx: createLoggerContext(event),
    request: event.request,
    deliveryPath: path,
  });
  await flushServerLoggerSafely(event.state.shared);
  return new Response(null, {
    status: result.status,
    headers: result.headers,
  });
}

function createClientPlugin(
  browser: ResolvedBrowserTelemetryConfig,
  endpoint: string
): FarmPluginClientConfig<FarmJsClientState, FarmJsClientPublicConfig> {
  const publicConfig = {
    endpoint,
    sampleRate: browser.sampleRate,
    hydration: browser.hydration,
    navigation: browser.navigation,
    errors: browser.errors,
    performance: browser.performance,
    localConsole: browser.localConsole,
    credentials: browser.credentials,
    ...(browser.connector !== undefined ? { connector: browser.connector } : {}),
  };

  return {
    public: publicConfig,
    async setup({ public: config, isDev, deploymentId }) {
      const { createClientLogger } = await import('@blyp/core/client');
      const clientLogger = createClientLogger({
        endpoint: config.endpoint,
        localConsole: config.localConsole,
        remoteSync: true,
        credentials: config.credentials,
        connector: config.connector,
        pageContext: 'path-only',
        metadata: {
          framework: 'farmjs',
          ...(deploymentId ? { deploymentId } : {}),
        },
      });
      return {
        logger: clientLogger,
        sampled: isDev || Math.random() < config.sampleRate,
      };
    },
    hydration: {
      after({ state, public: config, mode, location, durationMs, recovered }) {
        if (!config.hydration || !state.sampled) return;
        state.logger.info('[farm] client.hydration.complete', {
          type: 'farm_client_event',
          event: 'hydration.complete',
          mode,
          pathname: location.pathname,
          durationMs,
          recovered,
        });
      },
    },
    navigation: {
      rendered({ state, public: config, id, to, action, route, durationMs }) {
        if (!config.navigation || !state.sampled) return;
        state.logger.info('[farm] client.navigation.rendered', {
          type: 'farm_client_event',
          event: 'navigation.rendered',
          navigationId: id,
          pathname: to.pathname,
          action,
          route: route?.pattern,
          durationMs,
        });
      },
      error({ state, public: config, id, to, action, route, durationMs, error }) {
        if (!config.errors) return;
        state.logger.error('[farm] client.navigation.error', {
          type: 'farm_client_event',
          event: 'navigation.error',
          navigationId: id,
          pathname: to.pathname,
          action,
          route: route?.pattern,
          durationMs,
          error,
        });
      },
    },
    error({ state, public: config, error, phase, location, navigation }) {
      if (!config.errors) return;
      state.logger.error('[farm] client.error', {
        type: 'farm_client_event',
        event: 'client.error',
        error,
        phase,
        pathname: location.pathname,
        navigationId: navigation?.id,
        route: navigation?.route?.pattern,
      });
    },
    performance({ state, public: config, entry, location }) {
      if (!config.performance || !state.sampled) return;
      const allowed = new Set([
        'navigation',
        'paint',
        'largest-contentful-paint',
        'layout-shift',
        'first-input',
        'event',
      ]);
      if (!allowed.has(entry.entryType)) return;
      const metric = entry as PerformanceEntry & {
        value?: number;
        processingStart?: number;
      };
      state.logger.debug('[farm] client.performance', {
        type: 'farm_client_event',
        event: 'performance',
        pathname: location.pathname,
        entryType: entry.entryType,
        startTime: entry.startTime,
        duration: entry.duration,
        ...(typeof metric.value === 'number' ? { value: metric.value } : {}),
        ...(typeof metric.processingStart === 'number'
          ? { processingStart: metric.processingStart }
          : {}),
      });
    },
  };
}

export function blypPlugin(config: FarmJsLoggerConfig = {}) {
  const traceHeader = config.traceHeader?.trim() || DEFAULT_TRACE_HEADER;
  const shared = resolveServerLogger(config);
  const events = resolveFarmEvents(config.telemetry);
  const browser = resolveBrowserTelemetry(config.telemetry);
  setFarmJsFallbackLogger(shared.logger);

  return definePlugin({
    name: 'blyp:logger',
    configure(farmConfig) {
      const preset = farmConfig.preset?.toLowerCase();
      if (preset && EDGE_PRESETS.has(preset)) {
        throw new Error(
          `[blyp/farmjs] The "${farmConfig.preset}" preset is not supported. ` +
          'The Farm.js plugin currently supports Node and Bun runtimes.'
        );
      }
    },
    setup({ lifecycle }) {
      const unsubscribe = events === false
        ? () => {}
        : onFarmEvent((event) => forwardFarmEvent(shared, events, event));
      lifecycle.onShutdown(unsubscribe);
      return { shared, events } satisfies FarmJsPluginState;
    },
    runtime: {
      async context(event) {
        enterRequestContext();
        const traceId = getTraceId(event.request, traceHeader);
        setActiveRequestTraceId(traceId);
        event.req.set(BLYP_TRACE_KEY, traceId, { exposeToPage: true });

        let scopedLogger!: BlypLogger;
        scopedLogger = createRequestScopedLogger(shared.logger, {
          resolveStructuredFields: () => ({
            method: event.request.method,
            path: extractPathname(event.request.url),
            ...resolveFarmProps(event),
          }),
          onStructuredEmit: () => event.req.set(BLYP_STRUCTURED_KEY, true),
        });
        await resolveRequestAuthContext({
          config: shared,
          ctx: createLoggerContext(event),
          request: event.request,
          source: 'request',
        });
        const auth = getActiveRequestAuthContext() ?? null;
        event.req.set(BLYP_AUTH_KEY, auth);
        registerFarmJsRequestLogger(event.request, {
          logger: scopedLogger,
          traceId,
          auth,
        });
        const boundLogger = createFarmJsBoundLogger(event.request);
        event.req.set(BLYP_LOG_KEY, boundLogger);

        return { blypTraceId: traceId, blypLog: boundLogger };
      },
      async before(event: FarmBeforeEvent) {
        restoreRequestContext(event);
        return await handleBrowserIngestion(event);
      },
      async after(event: FarmAfterEvent) {
        const { traceId } = restoreRequestContext(event);
        const path = extractPathname(event.request.url);
        const structuredLogEmitted =
          event.req.get<boolean>(BLYP_STRUCTURED_KEY) === true ||
          hasStructuredLogBeenEmitted();

        if (!structuredLogEmitted) {
          const statusCode = event.response.status;
          const requestLike = createRequestLike(
            event.request.method,
            event.request.url,
            event.request.headers
          );
          const props = resolveFarmProps(event, event.response);

          if (isErrorStatus(statusCode)) {
            if (!shouldSkipErrorLogging(shared, path)) {
              emitHttpErrorLog(
                shared.logger,
                shared.level,
                requestLike,
                path,
                statusCode,
                Math.round(event.durationMs),
                toErrorLike(undefined, statusCode),
                props
              );
              event.req.set(BLYP_ERROR_LOGGED_KEY, true);
            }
          } else if (!shouldSkipAutoLogging(shared, createLoggerContext(event, event.response), path)) {
            emitHttpRequestLog(
              shared.logger,
              shared.level,
              requestLike,
              path,
              statusCode,
              Math.round(event.durationMs),
              props
            );
          }
        }

        await flushServerLoggerSafely(shared);
        return withTraceHeader(event.response, traceHeader, traceId);
      },
      async error(event: FarmErrorEvent) {
        restoreRequestContext(event);
        const path = extractPathname(event.request.url);
        if (
          event.req.get<boolean>(BLYP_ERROR_LOGGED_KEY) !== true &&
          event.req.get<boolean>(BLYP_STRUCTURED_KEY) !== true &&
          !shouldSkipErrorLogging(shared, path)
        ) {
          emitHttpErrorLog(
            shared.logger,
            shared.level,
            createRequestLike(event.request.method, event.request.url, event.request.headers),
            path,
            500,
            Math.round(event.durationMs),
            toErrorLike(event.error, 500),
            resolveFarmProps(event, undefined, event.error),
            { error: event.error }
          );
          event.req.set(BLYP_ERROR_LOGGED_KEY, true);
        }
        await flushServerLoggerSafely(shared);
      },
      async close() {
        await shared.logger.shutdown();
      },
    },
    ...(browser ? { client: createClientPlugin(browser, shared.ingestionPath) } : {}),
  });
}
