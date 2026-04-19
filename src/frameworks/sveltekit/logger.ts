import type {
  SvelteKitHandle,
  SvelteKitLoggerConfig,
  SvelteKitLoggerContext,
  SvelteKitLoggerFactory,
  SvelteKitRequestEvent,
} from '../../types/frameworks/sveltekit';
import {
  createRequestTraceId,
  createRequestScopedLogger,
  createRequestLike,
  emitHttpErrorLog,
  emitHttpRequestLog,
  flushServerLoggerSafely,
  handleClientLogIngestion,
  isErrorStatus,
  resolveAdditionalProps,
  resolveRequestAuthContext,
  resolveServerLogger,
  runWithRequestContext,
  setActiveRequestTraceId,
  shouldSkipAutoLogging,
  shouldSkipErrorLogging,
  toErrorLike,
  withTraceResponseHeader,
} from '../shared';

function createContext(
  event: SvelteKitRequestEvent,
  response?: Response,
  error?: unknown
): SvelteKitLoggerContext {
  return { event, response, error };
}

export function createSvelteKitLogger(
  config: SvelteKitLoggerConfig = {}
): SvelteKitLoggerFactory {
  const shared = resolveServerLogger(config);

  const handle: SvelteKitHandle = async ({ event, resolve }) => {
    return runWithRequestContext(async () => {
      const traceId = createRequestTraceId();
      let structuredLogEmitted = false;
      setActiveRequestTraceId(traceId);
      event.locals.blypTraceId = traceId;
      await resolveRequestAuthContext({
        config: shared,
        ctx: createContext(event),
        request: event.request,
        source: 'request',
      });
      event.locals.blypLog = createRequestScopedLogger(shared.logger, {
        resolveStructuredFields: () => ({
          method: event.request.method,
          path: event.url.pathname,
          ...resolveAdditionalProps(shared, createContext(event)),
        }),
        onStructuredEmit: () => {
          structuredLogEmitted = true;
        },
      });
      const startTime = performance.now();
      const path = event.url.pathname;
      const requestLike = createRequestLike(
        event.request.method,
        event.request.url,
        event.request.headers
      );

      try {
        const response = await resolve(event);
        if (structuredLogEmitted) {
          await flushServerLoggerSafely(shared);
          return withTraceResponseHeader(response, traceId);
        }

        const statusCode = response.status;
        const loggerContext = createContext(event, response);
        const responseTime = Math.round(performance.now() - startTime);

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
          emitHttpErrorLog(
            shared.logger,
            shared.level,
            requestLike,
            path,
            500,
            Math.round(performance.now() - startTime),
            toErrorLike(error, 500),
            resolveAdditionalProps(shared, createContext(event, undefined, error)),
            {
              error,
            }
          );
        }
        await flushServerLoggerSafely(shared);
        throw error;
      }
    });
  };

  return {
    logger: shared.logger,
    handle,
    clientLogHandler: async (event) => {
      return runWithRequestContext(async () => {
        const traceId = createRequestTraceId();
        setActiveRequestTraceId(traceId);
        event.locals.blypTraceId = traceId;
        const path = event.url.pathname;
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
          ctx: createContext(event),
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

export const createLogger = createSvelteKitLogger;
