import type { MiddlewareHandler } from 'hono';
import type { HonoLoggerConfig } from '../../types/frameworks/hono';
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

export function createHonoLogger(config: HonoLoggerConfig = {}): MiddlewareHandler {
  const shared = resolveServerLogger(config);

  return async (context, next) => {
    return runWithRequestContext(async () => {
      const startTime = performance.now();
      const traceId = createRequestTraceId();
      const path = context.req.path || extractPathname(context.req.url);
      let structuredLogEmitted = false;
      setActiveRequestTraceId(traceId);

      if (
        shared.resolvedClientLogging &&
        context.req.method === 'POST' &&
        path === shared.ingestionPath
      ) {
        const result = await handleClientLogIngestion({
          config: shared,
          ctx: context,
          request: context.req.raw,
          deliveryPath: shared.ingestionPath,
        });
        await flushServerLoggerSafely(shared);

        return new Response(null, {
          status: result.status,
          headers: {
            ...result.headers,
            'x-blyp-trace-id': traceId,
          },
        });
      }

      await resolveRequestAuthContext({
        config: shared,
        ctx: context,
        request: context.req.raw,
        source: 'request',
      });
      context.set(
        'blypLog',
        createRequestScopedLogger(shared.logger, {
          resolveStructuredFields: () => ({
            method: context.req.method,
            path: context.req.path || extractPathname(context.req.url),
            ...resolveAdditionalProps(shared, context),
          }),
          onStructuredEmit: () => {
            structuredLogEmitted = true;
          },
        })
      );
      context.set('blypTraceId', traceId);
      context.set('blypStartTime', startTime);

      let thrownError: unknown;
      try {
        await next();
      } catch (error) {
        thrownError = error;
        throw error;
      } finally {
        if (structuredLogEmitted) {
          await flushServerLoggerSafely(shared);
          context.res = withTraceResponseHeader(context.res, traceId);
          return;
        }

        const responseTime = Math.round(performance.now() - startTime);
        const request = createRequestLike(
          context.req.method,
          context.req.url,
          context.req.raw.headers
        );
        const statusCode = context.res?.status ?? (thrownError ? 500 : 200);

        if (thrownError || isErrorStatus(statusCode)) {
          if (!shouldSkipErrorLogging(shared, path)) {
            emitHttpErrorLog(
              shared.logger,
              shared.level,
              request,
              path,
              statusCode,
              responseTime,
              toErrorLike(thrownError, statusCode),
              resolveAdditionalProps(shared, context),
              {
                error: thrownError,
              }
            );
          }
          await flushServerLoggerSafely(shared);
          return;
        }

        if (!shouldSkipAutoLogging(shared, context, path)) {
          emitHttpRequestLog(
            shared.logger,
            shared.level,
            request,
            path,
            statusCode,
            responseTime,
            resolveAdditionalProps(shared, context)
          );
        }
        await flushServerLoggerSafely(shared);
        context.res = withTraceResponseHeader(context.res, traceId);
      }
    });
  };
}

export const createLogger = createHonoLogger;
