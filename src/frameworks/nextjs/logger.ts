import type {
  NextJsHandlerWithLogger,
  NextJsLoggerConfig,
  NextJsLoggerContext,
  NextJsLoggerFactory,
  NextJsRouteContext,
} from '../../types/frameworks/nextjs';
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
          let structuredLogEmitted = false;
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
            const response = await handler(request, context, { log: scopedLogger });
            if (structuredLogEmitted) {
              return response;
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
                resolveAdditionalProps(shared, createContext(request, context, undefined, error))
              );
            }
            throw error;
          }
        });
      };
    },
    clientLogHandler: async (request: Request) => {
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
        ctx: createContext(request),
        request,
        deliveryPath: path,
      });
      return new Response(null, {
        status: result.status,
        headers: result.headers,
      });
    },
  };
}

export const createLogger = createNextJsLogger;
