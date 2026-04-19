import type { ErrorRequestHandler, RequestHandler } from 'express';
import type {
  ExpressLoggerConfig,
  ExpressLoggerContext,
} from '../../types/frameworks/express';
import {
  BLYP_TRACE_HEADER,
  buildAbsoluteUrl,
  createRequestTraceId,
  createRequestScopedLogger,
  createRequestLike,
  enterRequestContext,
  emitHttpErrorLog,
  emitHttpRequestLog,
  extractPathname,
  handleClientLogIngestion,
  isErrorStatus,
  readNodeRequestBody,
  resolveAdditionalProps,
  resolveRequestAuthContext,
  resolveServerLogger,
  setActiveRequestTraceId,
  shouldSkipAutoLogging,
  shouldSkipErrorLogging,
  toErrorLike,
} from '../shared';

function buildExpressContext(
  req: ExpressLoggerContext['req'],
  res: ExpressLoggerContext['res'],
  error?: unknown
): ExpressLoggerContext {
  return { req, res, error };
}

export function createExpressLogger(config: ExpressLoggerConfig = {}): RequestHandler {
  const shared = resolveServerLogger(config);

  return (req, res, next) => {
    void (async () => {
      enterRequestContext();
      const traceId = createRequestTraceId();
      const path = extractPathname(req.originalUrl || req.url || '/');
      setActiveRequestTraceId(traceId);
      let structuredLogEmitted = false;
      req.blypTraceId = traceId;
      res.setHeader(BLYP_TRACE_HEADER, traceId);

      if (
        shared.resolvedClientLogging &&
        req.method.toUpperCase() === 'POST' &&
        path === shared.ingestionPath
      ) {
        const body = req.body === undefined ? await readNodeRequestBody(req) : req.body;
        const result = await handleClientLogIngestion({
          config: shared,
          ctx: buildExpressContext(req, res),
          request: createRequestLike(
            req.method,
            buildAbsoluteUrl(req.originalUrl || req.url || '/', req.headers),
            req.headers
          ),
          body,
          deliveryPath: shared.ingestionPath,
        });
        if (result.headers) {
          for (const [key, value] of Object.entries(result.headers)) {
            res.setHeader(key, value);
          }
        }
        res.status(result.status).end();
        return;
      }

      await resolveRequestAuthContext({
        config: shared,
        ctx: buildExpressContext(req, res),
        request: createRequestLike(
          req.method,
          buildAbsoluteUrl(req.originalUrl || req.url || '/', req.headers),
          req.headers
        ),
        source: 'request',
      });

      req.blypLog = createRequestScopedLogger(shared.logger, {
        resolveStructuredFields: () => ({
          method: req.method,
          path: extractPathname(req.originalUrl || req.url || '/'),
          ...resolveAdditionalProps(shared, buildExpressContext(req, res, res.locals.blypError)),
        }),
        onStructuredEmit: () => {
          structuredLogEmitted = true;
        },
      });
      res.locals.blypStartTime = performance.now();

      res.on('finish', () => {
        const path = extractPathname(req.originalUrl || req.url || '/');
        const request = createRequestLike(
          req.method,
          buildAbsoluteUrl(req.originalUrl || req.url || '/', req.headers),
          req.headers
        );
        const responseTime = Math.round(
          performance.now() - (res.locals.blypStartTime ?? performance.now())
        );
        const context = buildExpressContext(req, res, res.locals.blypError);

        if (structuredLogEmitted) {
          return;
        }

        if (res.locals.blypError || isErrorStatus(res.statusCode)) {
          if (!shouldSkipErrorLogging(shared, path)) {
            emitHttpErrorLog(
              shared.logger,
              shared.level,
              request,
              path,
              res.statusCode,
              responseTime,
              toErrorLike(res.locals.blypError, res.statusCode),
              resolveAdditionalProps(shared, context),
              {
                error: res.locals.blypError,
              }
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
            res.statusCode,
            responseTime,
            resolveAdditionalProps(shared, context)
          );
        }
      });

      next();
    })().catch(next);
  };
}

export function createExpressErrorLogger(
  _config: ExpressLoggerConfig = {}
): ErrorRequestHandler {
  return (error, _req, res, next) => {
    res.locals.blypError = error;
    next(error);
  };
}

export const createLogger = createExpressLogger;
