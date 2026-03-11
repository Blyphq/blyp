import type {
  TanStackStartLoggerConfig,
  TanStackStartLoggerContext,
  TanStackStartLoggerFactory,
  TanStackStartMiddlewareContext,
} from '../../types/frameworks/tanstack-start';
import {
  createRequestScopedLogger,
  createRequestLike,
  emitHttpErrorLog,
  emitHttpRequestLog,
  extractPathname,
  handleClientLogIngestion,
  isErrorStatus,
  resolveAdditionalProps,
  resolveServerLogger,
  runWithRequestContext,
  shouldSkipAutoLogging,
  shouldSkipErrorLogging,
  toErrorLike,
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
        let structuredLogEmitted = false;
        const nextContext: Record<string, unknown> = {
          ...context,
        };
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
            return response;
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

          return response;
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
              resolveAdditionalProps(shared, createContext(request, nextContext, undefined, error))
            );
          }
          throw error;
        }
      });
    },
    clientLogHandlers: {
      POST: async (request: Request) => {
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
              },
            }
          );
        }

        const result = await handleClientLogIngestion({
          config: shared,
          ctx: createContext(request, {}),
          request,
          deliveryPath: path,
        });
        return new Response(null, {
          status: result.status,
          headers: result.headers,
        });
      },
    },
  };
}

export const createLogger = createTanStackStartLogger;
