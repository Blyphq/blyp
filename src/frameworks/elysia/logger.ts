import { Elysia } from 'elysia';
import type {
  ClientLogIngestionConfig,
  ElysiaContext,
  ElysiaLoggerConfig,
  ElysiaLoggerPlugin,
} from '../../types/frameworks/elysia';
import {
  BLYP_TRACE_HEADER,
  createRequestTraceId,
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
  resolveRequestAuthContext,
  resolveRequestStatus,
  resolveServerLogger,
  setActiveRequestTraceId,
  shouldSkipAutoLogging,
  shouldSkipErrorLogging,
} from '../shared';

export function createElysiaLogger(
  config: ElysiaLoggerConfig = {}
): ElysiaLoggerPlugin {
  const shared = resolveServerLogger(config);

  // Keep the implementation value opaque so declaration emit does not expose
  // Elysia's concrete type through this public factory.
  const plugin = new Elysia({ name: 'logger' })
    .decorate('log', shared.logger)
    .derive({ as: 'scoped' }, async (ctx) => {
      enterRequestContext();
      const traceId = createRequestTraceId();
      setActiveRequestTraceId(traceId);
      const requestContext = ctx as unknown as ElysiaContext & {
        blypStructuredLogEmitted?: boolean;
      };

      requestContext.blypStructuredLogEmitted = false;
      requestContext.blypTraceId = traceId;
      requestContext.set.headers = {
        ...(requestContext.set.headers ?? {}),
        [BLYP_TRACE_HEADER]: traceId,
      };

      await resolveRequestAuthContext({
        config: shared,
        ctx: requestContext,
        request: requestContext.request,
        source: 'request',
      });

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
    plugin.post(shared.ingestionPath, async (ctx) => {
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
        headers: {
          ...result.headers,
          [BLYP_TRACE_HEADER]: requestContext.blypTraceId ?? createRequestTraceId(),
        },
      });
    });
  }

  return plugin as unknown as ElysiaLoggerPlugin;
}
