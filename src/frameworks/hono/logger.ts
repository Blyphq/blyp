import type { MiddlewareHandler } from 'hono';
import type { HonoLoggerConfig } from '../../types/frameworks/hono';
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

export function createHonoLogger(config: HonoLoggerConfig = {}): MiddlewareHandler {
  const shared = resolveServerLogger(config);

  return async (context, next) => {
    return runWithRequestContext(async () => {
      const startTime = performance.now();
      let structuredLogEmitted = false;
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
      context.set('blypStartTime', startTime);

      const path = context.req.path || extractPathname(context.req.url);
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

        return new Response(null, { status: result.status });
      }

      let thrownError: unknown;
      try {
        await next();
      } catch (error) {
        thrownError = error;
        throw error;
      } finally {
        if (structuredLogEmitted) {
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
              resolveAdditionalProps(shared, context)
            );
          }
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
      }
    });
  };
}

export const createLogger = createHonoLogger;
