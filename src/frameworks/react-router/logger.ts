import type { BlypLogger } from '../../core/logger';
import type {
  ReactRouterContextStore,
  ReactRouterLoggerConfig,
  ReactRouterLoggerContext,
  ReactRouterLoggerFactory,
  ReactRouterMiddlewareArgs,
} from '../../types/frameworks/react-router';
import {
  createRequestTraceId,
  createRequestScopedLogger,
  createRequestLike,
  emitHttpErrorLog,
  emitHttpRequestLog,
  extractPathname,
  flushServerLoggerSafely,
  handleClientLogIngestion,
  isErrorStatus,
  resolveAdditionalProps,
  resolveServerLogger,
  runWithRequestContext,
  setActiveRequestTraceId,
  shouldSkipAutoLogging,
  shouldSkipErrorLogging,
  toErrorLike,
  withTraceResponseHeader,
} from '../shared';

const REACT_ROUTER_LOGGER_KEY = Symbol.for('blyp.react-router.logger');
const REACT_ROUTER_LOGGER_FALLBACK_KEY = '__blypLog';
const REACT_ROUTER_TRACE_KEY = Symbol.for('blyp.react-router.trace-id');
const REACT_ROUTER_TRACE_FALLBACK_KEY = '__blypTraceId';

function createContext(
  args: ReactRouterMiddlewareArgs,
  response?: Response,
  error?: unknown
): ReactRouterLoggerContext {
  return {
    request: args.request,
    params: args.params,
    context: args.context,
    response,
    error,
  };
}

function readLoggerValue(context: ReactRouterContextStore): unknown {
  if (typeof context.get === 'function') {
    const symbolValue = context.get(REACT_ROUTER_LOGGER_KEY);
    if (symbolValue) {
      return symbolValue;
    }

    return context.get(REACT_ROUTER_LOGGER_FALLBACK_KEY);
  }

  return context[REACT_ROUTER_LOGGER_KEY] ?? context[REACT_ROUTER_LOGGER_FALLBACK_KEY];
}

function writeLoggerValue(context: ReactRouterContextStore, logger: BlypLogger): void {
  if (typeof context.set === 'function') {
    context.set(REACT_ROUTER_LOGGER_KEY, logger);
    context.set(REACT_ROUTER_LOGGER_FALLBACK_KEY, logger);
    return;
  }

  context[REACT_ROUTER_LOGGER_KEY] = logger;
  context[REACT_ROUTER_LOGGER_FALLBACK_KEY] = logger;
}

function readTraceValue(context: ReactRouterContextStore): unknown {
  if (typeof context.get === 'function') {
    const symbolValue = context.get(REACT_ROUTER_TRACE_KEY);
    if (symbolValue) {
      return symbolValue;
    }

    return context.get(REACT_ROUTER_TRACE_FALLBACK_KEY);
  }

  return context[REACT_ROUTER_TRACE_KEY] ?? context[REACT_ROUTER_TRACE_FALLBACK_KEY];
}

function writeTraceValue(context: ReactRouterContextStore, traceId: string): void {
  if (typeof context.set === 'function') {
    context.set(REACT_ROUTER_TRACE_KEY, traceId);
    context.set(REACT_ROUTER_TRACE_FALLBACK_KEY, traceId);
    return;
  }

  context[REACT_ROUTER_TRACE_KEY] = traceId;
  context[REACT_ROUTER_TRACE_FALLBACK_KEY] = traceId;
}

function resolveThrownStatusCode(error: unknown): number {
  const errorLike = toErrorLike(error);
  return errorLike?.status ?? errorLike?.statusCode ?? 500;
}

export function createReactRouterLogger(
  config: ReactRouterLoggerConfig = {}
): ReactRouterLoggerFactory {
  const shared = resolveServerLogger(config);

  const setLogger = (context: ReactRouterContextStore, logger: BlypLogger): void => {
    writeLoggerValue(context, logger);
  };

  const getLogger = (context: ReactRouterContextStore): BlypLogger => {
    const logger = readLoggerValue(context);
    return logger && typeof logger === 'object' ? logger as BlypLogger : shared.logger;
  };
  const setTraceId = (context: ReactRouterContextStore, traceId: string): void => {
    writeTraceValue(context, traceId);
  };
  const getTraceId = (context: ReactRouterContextStore): string | undefined => {
    const traceId = readTraceValue(context);
    return typeof traceId === 'string' ? traceId : undefined;
  };

  return {
    logger: shared.logger,
    setLogger,
    getLogger,
    setTraceId,
    getTraceId,
    middleware: async (args, next) => {
      return runWithRequestContext(async () => {
        const startTime = performance.now();
        const path = extractPathname(args.request.url);
        const traceId = createRequestTraceId();
        let structuredLogEmitted = false;
        setActiveRequestTraceId(traceId);
        const scopedLogger = createRequestScopedLogger(shared.logger, {
          resolveStructuredFields: () => ({
            method: args.request.method,
            path,
            ...resolveAdditionalProps(shared, createContext(args)),
          }),
          onStructuredEmit: () => {
            structuredLogEmitted = true;
          },
        });

        setLogger(args.context, scopedLogger);
        setTraceId(args.context, traceId);

        try {
          const response = await next();
          if (structuredLogEmitted) {
            await flushServerLoggerSafely(shared);
            return withTraceResponseHeader(response, traceId);
          }

          const statusCode = response.status;
          const loggerContext = createContext(args, response);
          const responseTime = Math.round(performance.now() - startTime);
          const requestLike = createRequestLike(
            args.request.method,
            args.request.url,
            args.request.headers
          );

          if (isErrorStatus(statusCode)) {
            if (!shouldSkipErrorLogging(shared, path)) {
              emitHttpErrorLog(
                shared.logger,
                shared.level,
                requestLike,
                path,
                statusCode,
                responseTime,
                toErrorLike(undefined, statusCode),
                resolveAdditionalProps(shared, loggerContext)
              );
            }
          } else if (!shouldSkipAutoLogging(shared, loggerContext, path)) {
            emitHttpRequestLog(
              shared.logger,
              shared.level,
              requestLike,
              path,
              statusCode,
              responseTime,
              resolveAdditionalProps(shared, loggerContext)
            );
          }

          await flushServerLoggerSafely(shared);
          return withTraceResponseHeader(response, traceId);
        } catch (error) {
          if (!structuredLogEmitted && !shouldSkipErrorLogging(shared, path)) {
            const statusCode = resolveThrownStatusCode(error);
            emitHttpErrorLog(
              shared.logger,
              shared.level,
              createRequestLike(args.request.method, args.request.url, args.request.headers),
              path,
              statusCode,
              Math.round(performance.now() - startTime),
              toErrorLike(error, statusCode),
              resolveAdditionalProps(shared, createContext(args, undefined, error)),
              { error }
            );
          }

          await flushServerLoggerSafely(shared);
          throw error;
        }
      });
    },
    clientLogHandler: async (request: Request) => {
      return runWithRequestContext(async () => {
        const traceId = createRequestTraceId();
        setActiveRequestTraceId(traceId);
        const path = extractPathname(request.url);
        if (path !== shared.ingestionPath) {
          return new Response(
            JSON.stringify({
              error: `Mounted route path ${path} does not match configured client logging path ${shared.ingestionPath}`,
            }),
            {
              status: 500,
              headers: {
                'content-type': 'application/json',
                'x-blyp-trace-id': traceId,
              },
            }
          );
        }

        const context: ReactRouterContextStore = {};
        const result = await handleClientLogIngestion({
          config: shared,
          ctx: createContext({ request, context }),
          request,
          deliveryPath: path,
        });
        await flushServerLoggerSafely(shared);
        return new Response(null, {
          status: result.status,
          headers: {
            ...result.headers,
            'x-blyp-trace-id': traceId,
          },
        });
      });
    },
  };
}

export const createLogger = createReactRouterLogger;
