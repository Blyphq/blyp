import { Elysia } from 'elysia';
import type {
  ClientLogIngestionConfig,
  ElysiaContext,
  ElysiaLoggerConfig,
} from '../../types/frameworks/elysia';
import {
  createRequestScopedLogger,
  createRequestLike,
  enterRequestContext,
  emitHttpErrorLog,
  emitHttpRequestLog,
  extractPathname,
  flushServerLoggerSafely,
  handleClientLogIngestion,
  isErrorStatus,
  resolveAdditionalProps,
  resolveRequestStatus,
  resolveServerLogger,
  shouldSkipAutoLogging,
  shouldSkipErrorLogging,
} from '../shared';

export function createElysiaLogger(config: ElysiaLoggerConfig = {}) {
  const shared = resolveServerLogger(config);

  let app = new Elysia({ name: 'logger' })
    .decorate('log', shared.logger)
    .derive({ as: 'scoped' }, (ctx) => {
      enterRequestContext();
      const requestContext = ctx as unknown as ElysiaContext & {
        blypStructuredLogEmitted?: boolean;
      };

      requestContext.blypStructuredLogEmitted = false;

      return {
        startTime: performance.now(),
        log: createRequestScopedLogger(shared.logger, {
          resolveStructuredFields: () => ({
            method: requestContext.request.method,
            path: requestContext.path || extractPathname(requestContext.request.url),
            ...resolveAdditionalProps(shared, requestContext),
          }),
          onStructuredEmit: () => {
            requestContext.blypStructuredLogEmitted = true;
          },
        }),
      };
    })
    .onAfterResponse({ as: 'scoped' }, async (ctx) => {
      const requestContext = ctx as unknown as ElysiaContext;
      const path = requestContext.path || extractPathname(requestContext.request.url);
      if ((requestContext as ElysiaContext & { blypStructuredLogEmitted?: boolean }).blypStructuredLogEmitted) {
        await flushServerLoggerSafely(shared);
        return;
      }
      if (shouldSkipAutoLogging(shared, requestContext, path)) {
        await flushServerLoggerSafely(shared);
        return;
      }

      const responseTime = Math.round(performance.now() - (requestContext.startTime ?? performance.now()));
      const statusCode = resolveRequestStatus(requestContext, 200, 500);
      if (isErrorStatus(statusCode)) {
        if (shouldSkipErrorLogging(shared, path)) {
          return;
        }
        emitHttpErrorLog(
          shared.logger,
          shared.level,
          createRequestLike(requestContext.request.method, requestContext.request.url, requestContext.request.headers),
          path,
          statusCode,
          responseTime,
          requestContext.error,
          resolveAdditionalProps(shared, requestContext),
          {
            error: requestContext.error,
          }
        );
        await flushServerLoggerSafely(shared);
        return;
      }

      emitHttpRequestLog(
        shared.logger,
        shared.level,
        createRequestLike(requestContext.request.method, requestContext.request.url, requestContext.request.headers),
        path,
        statusCode,
        responseTime,
        resolveAdditionalProps(shared, requestContext)
      );
      await flushServerLoggerSafely(shared);
    })
    .onError({ as: 'scoped' }, async (ctx) => {
      const requestContext = ctx as unknown as ElysiaContext;
      const path = requestContext.path || extractPathname(requestContext.request.url);
      if ((requestContext as ElysiaContext & { blypStructuredLogEmitted?: boolean }).blypStructuredLogEmitted) {
        await flushServerLoggerSafely(shared);
        return;
      }
      if (shouldSkipErrorLogging(shared, path)) {
        await flushServerLoggerSafely(shared);
        return;
      }
      const responseTime = Math.round(performance.now() - (requestContext.startTime ?? performance.now()));
      const statusCode = resolveRequestStatus(requestContext, 200, 500, true);

      try {
        requestContext.set!.status = statusCode;
      } catch {}

      emitHttpErrorLog(
        shared.logger,
        shared.level,
        createRequestLike(requestContext.request.method, requestContext.request.url, requestContext.request.headers),
        path,
        statusCode,
        responseTime,
        requestContext.error,
        resolveAdditionalProps(shared, requestContext),
        {
          error: requestContext.error,
        }
      );
      await flushServerLoggerSafely(shared);
    });

  if (shared.resolvedClientLogging) {
    app = app.post(shared.ingestionPath, async (ctx) => {
      const requestContext = ctx as unknown as ElysiaContext;
      const result = await handleClientLogIngestion({
        config: shared,
        ctx: requestContext,
        request: requestContext.request,
        body: requestContext.body,
        deliveryPath: shared.ingestionPath,
      });
      await flushServerLoggerSafely(shared);

      return new Response(null, {
        status: result.status,
        headers: result.headers,
      });
    });
  }

  return app;
}
