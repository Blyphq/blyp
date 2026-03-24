import type {
  AstroEndpointContext,
  AstroLoggerConfig,
  AstroLoggerContext,
  AstroLoggerFactory,
  AstroMiddlewareContext,
} from '../../types/frameworks/astro';
import {
  createRequestScopedLogger,
  createRequestLike,
  emitHttpErrorLog,
  emitHttpRequestLog,
  flushServerLoggerSafely,
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
  context: AstroMiddlewareContext,
  response?: Response,
  error?: unknown
): AstroLoggerContext {
  return { context, response, error };
}

export function createAstroLogger(
  config: AstroLoggerConfig = {}
): AstroLoggerFactory {
  const shared = resolveServerLogger(config);

  return {
    logger: shared.logger,
    onRequest: async (context, next) => {
      return runWithRequestContext(async () => {
        let structuredLogEmitted = false;
        context.locals.blypLog = createRequestScopedLogger(shared.logger, {
          resolveStructuredFields: () => ({
            method: context.request.method,
            path: context.url.pathname,
            ...resolveAdditionalProps(shared, createContext(context)),
          }),
          onStructuredEmit: () => {
            structuredLogEmitted = true;
          },
        });
        const startTime = performance.now();
        const path = context.url.pathname;
        const requestLike = createRequestLike(
          context.request.method,
          context.request.url,
          context.request.headers
        );

        try {
          const response = await next();
          if (structuredLogEmitted) {
            await flushServerLoggerSafely(shared);
            return response;
          }

          const statusCode = response.status;
          const loggerContext = createContext(context, response);
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
          return response;
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
              resolveAdditionalProps(shared, createContext(context, undefined, error)),
              { error }
            );
          }

          await flushServerLoggerSafely(shared);
          throw error;
        }
      });
    },
    clientLogHandler: async (context: AstroEndpointContext) => {
      const path = context.url.pathname;
      if (path !== shared.ingestionPath) {
        return new Response(
          JSON.stringify({
            error: `Mounted route path ${path} does not match configured client logging path ${shared.ingestionPath}`,
          }),
          {
            status: 500,
            headers: { 'content-type': 'application/json' },
          }
        );
      }

      const result = await handleClientLogIngestion({
        config: shared,
        ctx: createContext(context),
        request: context.request,
        deliveryPath: path,
      });
      await flushServerLoggerSafely(shared);
      return new Response(null, {
        status: result.status,
        headers: result.headers,
      });
    },
  };
}

export const createLogger = createAstroLogger;
