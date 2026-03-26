import type { BlypLogger } from '../../core/logger';
import type {
  NitroAppLike,
  NitroEventLike,
  NitroLoggerConfig,
  NitroLoggerContext,
  NitroLoggerFactory,
  NitroResponseLike,
} from '../../types/frameworks/nitro';
import { enterRequestContext } from '../shared/request-context';
import {
  createRequestTraceId,
  createRequestScopedLogger,
  emitHttpErrorLog,
  emitHttpRequestLog,
  flushServerLoggerSafely,
  handleClientLogIngestion,
  isErrorStatus,
  resolveAdditionalProps,
  resolveServerLogger,
  setActiveRequestTraceId,
  shouldSkipAutoLogging,
  shouldSkipErrorLogging,
  toErrorLike,
} from '../shared';
import {
  createNitroRequestLike,
  getNitroMethod,
  getNitroPath,
  getNitroState,
  getNitroStatus,
  readNitroBody,
  setNitroState,
} from '../shared/h3';

function createContext(
  event: NitroEventLike,
  response?: NitroResponseLike | Response,
  error?: unknown
): NitroLoggerContext {
  return { event, response, error };
}

function buildFactory(shared: ReturnType<typeof resolveServerLogger<NitroLoggerContext>>): NitroLoggerFactory {
  const getLogger = (event: NitroEventLike): BlypLogger => event.context.blypLog ?? shared.logger;

  const logSuccess = async (
    event: NitroEventLike,
    response?: NitroResponseLike | Response
  ): Promise<void> => {
    const state = getNitroState(event);
    if (!state || state.structuredLogEmitted || state.errorLogged) {
      return;
    }

    const requestLike = createNitroRequestLike(event);
    const statusCode = getNitroStatus(event, response);
    const responseTime = Math.round(performance.now() - state.startTime);
    const loggerContext = createContext(event, response);

    if (isErrorStatus(statusCode)) {
      if (!shouldSkipErrorLogging(shared, state.path)) {
        emitHttpErrorLog(
          shared.logger,
          shared.level,
          requestLike,
          state.path,
          statusCode,
          responseTime,
          toErrorLike(undefined, statusCode),
          resolveAdditionalProps(shared, loggerContext)
        );
      }
    } else if (!shouldSkipAutoLogging(shared, loggerContext, state.path)) {
      emitHttpRequestLog(
        shared.logger,
        shared.level,
        requestLike,
        state.path,
        statusCode,
        responseTime,
        resolveAdditionalProps(shared, loggerContext)
      );
    }
  };

  const logError = async (
    event: NitroEventLike,
    error: unknown,
    response?: NitroResponseLike | Response
  ): Promise<void> => {
    const state = getNitroState(event);
    if (!state || state.structuredLogEmitted || state.errorLogged || shouldSkipErrorLogging(shared, state.path)) {
      return;
    }

    state.errorLogged = true;
    emitHttpErrorLog(
      shared.logger,
      shared.level,
      createNitroRequestLike(event),
      state.path,
      getNitroStatus(event, response, 500),
      Math.round(performance.now() - state.startTime),
      toErrorLike(error, 500),
      resolveAdditionalProps(shared, createContext(event, response, error)),
      { error }
    );
  };

  return {
    logger: shared.logger,
    getLogger,
    plugin: async (nitroApp: NitroAppLike) => {
      await nitroApp.hooks.hook('request', async (eventArg: unknown) => {
        const event = eventArg as NitroEventLike;
        enterRequestContext();
        const traceId = createRequestTraceId();
        setActiveRequestTraceId(traceId);
        if (typeof event.node?.res === 'object' && event.node.res && 'setHeader' in event.node.res) {
          (event.node.res as { setHeader?: (name: string, value: string) => void }).setHeader?.(
            'x-blyp-trace-id',
            traceId
          );
        }
        const path = getNitroPath(event);
        let state = setNitroState(event, {
          startTime: performance.now(),
          path,
          structuredLogEmitted: false,
        });
        event.context.blypTraceId = traceId;
        const scopedLogger = createRequestScopedLogger(shared.logger, {
          resolveStructuredFields: () => ({
            method: getNitroMethod(event),
            path,
            ...resolveAdditionalProps(shared, createContext(event)),
          }),
          onStructuredEmit: () => {
            const currentState = getNitroState(event);
            if (currentState) {
              currentState.structuredLogEmitted = true;
            }
          },
        });
        event.context.blypLog = scopedLogger;
        state.scopedLogger = scopedLogger;
      });

      await nitroApp.hooks.hook('beforeResponse', async (eventArg: unknown, payload?: unknown) => {
        await logSuccess(eventArg as NitroEventLike, payload as NitroResponseLike | Response | undefined);
      });

      await nitroApp.hooks.hook('afterResponse', async (eventArg: unknown) => {
        await flushServerLoggerSafely(shared);
        const state = getNitroState(eventArg as NitroEventLike);
        if (state) {
          state.errorLogged = true;
        }
      });

      await nitroApp.hooks.hook('error', async (errorArg: unknown, eventArg?: unknown) => {
        if (eventArg && typeof eventArg === 'object') {
          await logError(eventArg as NitroEventLike, errorArg);
          await flushServerLoggerSafely(shared);
        }
      });
    },
    clientLogHandler: async (event: NitroEventLike) => {
      enterRequestContext();
      const traceId = createRequestTraceId();
      setActiveRequestTraceId(traceId);
      event.context.blypTraceId = traceId;
      const path = getNitroPath(event);
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

      const body = await readNitroBody(event);

      const result = await handleClientLogIngestion({
        config: shared,
        ctx: createContext(event),
        request: {
          ...createNitroRequestLike(event),
          json: async () => body,
        },
        body,
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
    },
  };
}

export function createNitroLogger(
  config: NitroLoggerConfig = {}
): NitroLoggerFactory {
  const shared = resolveServerLogger(config);
  return buildFactory(shared);
}

export const createLogger = createNitroLogger;
export { buildFactory as createNitroLoggerFactory };
