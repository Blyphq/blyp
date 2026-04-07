import type {
  SolidStartAPIEvent,
  SolidStartFetchEvent,
  SolidStartLoggerConfig,
  SolidStartLoggerContext,
  SolidStartLoggerFactory,
  SolidStartResponseStub,
} from '../../types/frameworks/solid-start';
import {
  createRequestTraceId,
  createRequestScopedLogger,
  createRequestLike,
  emitHttpErrorLog,
  emitHttpRequestLog,
  enterRequestContext,
  extractPathname,
  flushServerLoggerSafely,
  handleClientLogIngestion,
  isErrorStatus,
  resolveAdditionalProps,
  resolveServerLogger,
  runWithRequestContext,
  setActiveRequestLogger,
  setActiveRequestTraceId,
  shouldSkipAutoLogging,
  shouldSkipErrorLogging,
  toErrorLike,
} from '../shared';

function createContext(
  event: SolidStartFetchEvent | SolidStartAPIEvent,
  response?: SolidStartResponseStub | Response,
  error?: unknown
): SolidStartLoggerContext {
  return { event, response, error };
}

function ensureTraceHeader(response: SolidStartResponseStub, traceId: string): void {
  response.headers.set('x-blyp-trace-id', traceId);
}

export function createSolidStartLogger(
  config: SolidStartLoggerConfig = {}
): SolidStartLoggerFactory {
  const shared = resolveServerLogger(config);

  return {
    logger: shared.logger,
    middleware: {
      onRequest: (event) => {
        enterRequestContext();
        const traceId = createRequestTraceId();
        const path = extractPathname(event.request.url);
        setActiveRequestTraceId(traceId);
        event.locals.blypTraceId = traceId;
        event.locals.blypStartTime = performance.now();
        event.locals.blypStructuredLogEmitted = false;
        event.locals.blypLog = createRequestScopedLogger(shared.logger, {
          resolveStructuredFields: () => ({
            method: event.request.method,
            path,
            ...resolveAdditionalProps(shared, createContext(event, event.response)),
          }),
          onStructuredEmit: () => {
            event.locals.blypStructuredLogEmitted = true;
          },
        });
        ensureTraceHeader(event.response, traceId);
      },
      onBeforeResponse: async (event) => {
        return runWithRequestContext(async () => {
          const path = extractPathname(event.request.url);
          const traceId = event.locals.blypTraceId ?? createRequestTraceId();
          setActiveRequestTraceId(traceId);
          if (event.locals.blypLog) {
            setActiveRequestLogger(event.locals.blypLog);
          }
          ensureTraceHeader(event.response, traceId);

          if (event.locals.blypStructuredLogEmitted) {
            await flushServerLoggerSafely(shared);
            return;
          }

          const statusCode = event.response.status ?? 200;
          const responseTime = Math.round(
            performance.now() - (event.locals.blypStartTime ?? performance.now())
          );
          const requestLike = createRequestLike(
            event.request.method,
            event.request.url,
            event.request.headers
          );
          const loggerContext = createContext(event, event.response);

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
        });
      },
    },
    clientLogHandler: async (event) => {
      return runWithRequestContext(async () => {
        const traceId = createRequestTraceId();
        const path = extractPathname(event.request.url);
        setActiveRequestTraceId(traceId);
        event.locals.blypTraceId = traceId;
        ensureTraceHeader(event.response, traceId);

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

        const result = await handleClientLogIngestion({
          config: shared,
          ctx: createContext(event, event.response),
          request: event.request,
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

export const createLogger = createSolidStartLogger;
