import type {
  TanStackStartLoggerConfig,
  TanStackStartLoggerContext,
  TanStackStartLoggerFactory,
  TanStackStartMiddlewareContext,
} from '../../types/frameworks/tanstack-start';
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
  context: Record<string, unknown>,
  response?: Response,
  error?: unknown
): TanStackStartLoggerContext {
  return { request, context, response, error };
}

export function createTanStackStartLogger(
  config: TanStackStartLoggerConfig = {}
): TanStackStartLoggerFactory {
  const shared = resolveServerLogger(config);

  return {
    logger: shared.logger,
    requestMiddleware: async ({ request, context, next }: TanStackStartMiddlewareContext) => {
      return runWithRequestContext(async () => {
        const startTime = performance.now();
        const path = extractPathname(request.url);
        const traceId = createRequestTraceId();
        let structuredLogEmitted = false;
        const nextContext: Record<string, unknown> = {
          ...context,
          blypTraceId: traceId,
        };
        setActiveRequestTraceId(traceId);
        await resolveRequestAuthContext({
          config: shared,
          ctx: createContext(request, nextContext),
          request,
          source: 'request',
        });
        const scopedLogger = createRequestScopedLogger(shared.logger, {
          resolveStructuredFields: (): Record<string, unknown> => ({
            method: request.method,
            path,
            ...resolveAdditionalProps(shared, createContext(request, nextContext)),
          }),
          onStructuredEmit: () => {
            structuredLogEmitted = true;
          },
        });
        nextContext.blypLog = scopedLogger;

        try {
          const response = await next({ context: nextContext });
          if (structuredLogEmitted) {
            await flushServerLoggerSafely(shared);
            return withTraceResponseHeader(response, traceId);
          }

          const statusCode = response.status;
          const loggerContext = createContext(request, nextContext, response);
          const responseTime = Math.round(performance.now() - startTime);

          if (isErrorStatus(statusCode)) {
            if (!shouldSkipErrorLogging(shared, path)) {
              emitHttpErrorLog(
                shared.logger,
                shared.level,
                createRequestLike(request.method, request.url, request.headers),
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
              createRequestLike(request.method, request.url, request.headers),
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
              resolveAdditionalProps(shared, createContext(request, nextContext, undefined, error)),
              {
                error,
              }
            );
          }
          await flushServerLoggerSafely(shared);
          throw error;
        }
      });
    },
    clientLogHandlers: {
      POST: async (request: Request) => {
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
            ctx: createContext(request, { blypTraceId: traceId }),
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
    },
  };
}

export const createLogger = createTanStackStartLogger;
