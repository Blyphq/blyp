import type {
  SvelteKitHandle,
  SvelteKitLoggerConfig,
  SvelteKitLoggerContext,
  SvelteKitLoggerFactory,
  SvelteKitRequestEvent,
} from '../../types/frameworks/sveltekit';
import {
  createRequestLike,
  emitHttpErrorLog,
  emitHttpRequestLog,
  handleClientLogIngestion,
  isErrorStatus,
  resolveAdditionalProps,
  resolveServerLogger,
  shouldSkipAutoLogging,
  shouldSkipErrorLogging,
  toErrorLike,
} from '../shared';

function createContext(
  event: SvelteKitRequestEvent,
  response?: Response,
  error?: unknown
): SvelteKitLoggerContext {
  return { event, response, error };
}

export function createSvelteKitLogger(
  config: SvelteKitLoggerConfig = {}
): SvelteKitLoggerFactory {
  const shared = resolveServerLogger(config);

  const handle: SvelteKitHandle = async ({ event, resolve }) => {
    event.locals.blypLog = shared.logger;
    const startTime = performance.now();
    const path = event.url.pathname;
    const requestLike = createRequestLike(
      event.request.method,
      event.request.url,
      event.request.headers
    );

    try {
      const response = await resolve(event);
      const statusCode = response.status;
      const loggerContext = createContext(event, response);
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
      if (!shouldSkipErrorLogging(shared, path)) {
        emitHttpErrorLog(
          shared.logger,
          shared.level,
          requestLike,
          path,
          500,
          Math.round(performance.now() - startTime),
          toErrorLike(error, 500),
          resolveAdditionalProps(shared, createContext(event, undefined, error))
        );
      }
      throw error;
    }
  };

  return {
    logger: shared.logger,
    handle,
    clientLogHandler: async (event) => {
      const path = event.url.pathname;
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
        ctx: createContext(event),
        request: event.request,
        deliveryPath: path,
      });
      return new Response(null, { status: result.status });
    },
  };
}

export const createLogger = createSvelteKitLogger;
