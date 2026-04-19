import type {
  AstroEndpointContext,
  AstroLoggerConfig,
  AstroLoggerContext,
  AstroLoggerFactory,
  AstroMiddlewareContext,
} from '../../types/frameworks/astro';
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
        const traceId = createRequestTraceId();
        let structuredLogEmitted = false;
        setActiveRequestTraceId(traceId);
        context.locals.blypTraceId = traceId;
        await resolveRequestAuthContext({
          config: shared,
          ctx: createContext(context),
          request: context.request,
          source: 'request',
        });
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
            return withTraceResponseHeader(response, traceId);
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
      return runWithRequestContext(async () => {
        const traceId = createRequestTraceId();
        setActiveRequestTraceId(traceId);
        context.locals.blypTraceId = traceId;
        const path = context.url.pathname;
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
          ctx: createContext(context),
          request: context.request,
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

export const createLogger = createAstroLogger;
