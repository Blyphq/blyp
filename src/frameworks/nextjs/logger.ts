import type {
  NextJsHandlerWithLogger,
  NextJsLoggerConfig,
  NextJsLoggerContext,
  NextJsLoggerFactory,
  NextJsRouteContext,
} from '../../types/frameworks/nextjs';
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
  request: Request,
  context?: NextJsRouteContext,
  response?: Response,
  error?: unknown
): NextJsLoggerContext {
  return { request, context, response, error };
}

export function createNextJsLogger(
  config: NextJsLoggerConfig = {}
): NextJsLoggerFactory {
  const shared = resolveServerLogger(config);

  return {
    logger: shared.logger,
    withLogger: <Ctx extends NextJsRouteContext = NextJsRouteContext>(
      handler: NextJsHandlerWithLogger<Ctx>
    ) => {
      return async (request: Request, context: Ctx) => {
        return runWithRequestContext(async () => {
          const startTime = performance.now();
          const path = extractPathname(request.url);
          const traceId = createRequestTraceId();
          let structuredLogEmitted = false;
          setActiveRequestTraceId(traceId);
          await resolveRequestAuthContext({
            config: shared,
            ctx: createContext(request, context),
            request,
            source: 'request',
          });
          const scopedLogger = createRequestScopedLogger(shared.logger, {
            resolveStructuredFields: () => ({
              method: request.method,
              path,
              ...resolveAdditionalProps(shared, createContext(request, context)),
            }),
            onStructuredEmit: () => {
              structuredLogEmitted = true;
            },
          });

          try {
            const response = await handler(request, context, { log: scopedLogger, traceId });
            if (structuredLogEmitted) {
              await flushServerLoggerSafely(shared);
              return withTraceResponseHeader(response, traceId);
            }

            const statusCode = response.status;
            const requestLike = createRequestLike(
              request.method,
              request.url,
              request.headers
            );
            const loggerContext = createContext(request, context, response);
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
                createRequestLike(request.method, request.url, request.headers),
                path,
                500,
                Math.round(performance.now() - startTime),
                toErrorLike(error, 500),
                resolveAdditionalProps(shared, createContext(request, context, undefined, error)),
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

        const result = await handleClientLogIngestion({
          config: shared,
          ctx: createContext(request),
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

export const createLogger = createNextJsLogger;
