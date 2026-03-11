import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { FastifyLoggerConfig } from '../../types/frameworks/fastify';
import {
  buildAbsoluteUrl,
  createRequestScopedLogger,
  createRequestLike,
  enterRequestContext,
  emitHttpErrorLog,
  emitHttpRequestLog,
  extractPathname,
  handleClientLogIngestion,
  isErrorStatus,
  resolveAdditionalProps,
  resolveServerLogger,
  shouldSkipAutoLogging,
  shouldSkipErrorLogging,
  toErrorLike,
} from '../shared';

export function createFastifyLogger(
  config: FastifyLoggerConfig = {}
): FastifyPluginAsync {
  const shared = resolveServerLogger(config);

  return fp(async (fastify) => {
    fastify.decorateRequest('blypLogHolder');
    fastify.decorateRequest('blypLog', {
      getter() {
        return (this as typeof this & { blypLogHolder?: typeof shared.logger }).blypLogHolder as typeof shared.logger;
      },
      setter(value) {
        (this as typeof this & { blypLogHolder?: typeof shared.logger }).blypLogHolder = value;
      },
    });
    fastify.decorateRequest('blypStartTime', undefined);
    fastify.decorateRequest('blypError', undefined);
    fastify.decorateRequest('blypStructuredLogEmitted', undefined);

    fastify.addHook('onRequest', async (request) => {
      enterRequestContext();
      request.blypStartTime = performance.now();
      request.blypError = undefined;
      request.blypStructuredLogEmitted = false;
    });

    fastify.addHook('preHandler', async (request) => {
      request.blypLog = createRequestScopedLogger(shared.logger, {
        resolveStructuredFields: () => ({
          method: request.method,
          path: extractPathname(request.url),
          ...resolveAdditionalProps(shared, {
            request,
            reply: {} as unknown,
            error: request.blypError,
          } as any),
        }),
        onStructuredEmit: () => {
          request.blypStructuredLogEmitted = true;
        },
      });
    });

    fastify.addHook('onError', async (request, _reply, error) => {
      request.blypError = error;
    });

    fastify.addHook('onResponse', async (request, reply) => {
      const path = extractPathname(request.url);
      const requestLike = createRequestLike(
        request.method,
        buildAbsoluteUrl(request.url, request.headers),
        request.headers
      );
      const responseTime = Math.round(
        performance.now() - (request.blypStartTime ?? performance.now())
      );
      const context = {
        request,
        reply,
        error: request.blypError,
      };

      if (request.blypStructuredLogEmitted) {
        return;
      }

      if (request.blypError || isErrorStatus(reply.statusCode)) {
        if (!shouldSkipErrorLogging(shared, path)) {
          emitHttpErrorLog(
            shared.logger,
            shared.level,
            requestLike,
            path,
            reply.statusCode,
            responseTime,
            toErrorLike(request.blypError, reply.statusCode),
            resolveAdditionalProps(shared, context),
            {
              error: request.blypError,
            }
          );
        }
        return;
      }

      if (!shouldSkipAutoLogging(shared, context, path)) {
        emitHttpRequestLog(
          shared.logger,
          shared.level,
          requestLike,
          path,
          reply.statusCode,
          responseTime,
          resolveAdditionalProps(shared, context)
        );
      }
    });

    if (shared.resolvedClientLogging) {
      fastify.route({
        method: 'POST',
        url: shared.ingestionPath,
        handler: async (request, reply) => {
          const result = await handleClientLogIngestion({
            config: shared,
            ctx: {
              request,
              reply,
            },
            request: createRequestLike(
              request.method,
              buildAbsoluteUrl(request.url, request.headers),
              request.headers
            ),
            body: request.body,
            deliveryPath: shared.ingestionPath,
          });
          reply.code(result.status);
          if (result.headers) {
            for (const [key, value] of Object.entries(result.headers)) {
              reply.header(key, value);
            }
          }
          return null;
        },
      });
    }
  });
}

export const createLogger = createFastifyLogger;
