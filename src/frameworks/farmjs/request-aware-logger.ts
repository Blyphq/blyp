import type { BlypLogger } from '../../core/logger';
import type { AuthLogContext } from '../../types/auth';
import { getCurrentRequest } from '@farm.js/core/request';
import { logger as rootLogger } from '../standalone';
import {
  getActiveRequestAuthContext,
  getActiveRequestLogger,
  getActiveRequestTraceId,
  runWithRequestContext,
  setActiveRequestAuthContext,
  setActiveRequestLogger,
  setActiveRequestTraceId,
} from '../shared';

let fallbackLogger: BlypLogger = rootLogger;
interface FarmJsLoggerBinding {
  logger: BlypLogger;
  traceId?: string;
  auth?: AuthLogContext | null;
}

const requestLoggers = new WeakMap<Request, FarmJsLoggerBinding>();

export function setFarmJsFallbackLogger(nextLogger: BlypLogger): void {
  fallbackLogger = nextLogger;
}

export function registerFarmJsRequestLogger(
  request: Request,
  binding: FarmJsLoggerBinding
): void {
  requestLoggers.set(request, binding);
}

export function createFarmJsBoundLogger(request: Request): BlypLogger {
  return createRequestAwareLogger(() => requestLoggers.get(request) ?? currentBinding());
}

function currentBinding(): FarmJsLoggerBinding {
  try {
    const request = getCurrentRequest();
    const binding = requestLoggers.get(request);
    if (binding) {
      return binding;
    }
  } catch {}

  return {
    logger: getActiveRequestLogger() ?? fallbackLogger,
    traceId: getActiveRequestTraceId(),
    auth: getActiveRequestAuthContext(),
  };
}

function withBinding<T>(binding: FarmJsLoggerBinding, callback: () => T): T {
  if (!binding.traceId && binding.auth === undefined) {
    return callback();
  }

  return runWithRequestContext(() => {
    setActiveRequestLogger(binding.logger);
    setActiveRequestTraceId(binding.traceId);
    if (binding.auth !== undefined) {
      setActiveRequestAuthContext(binding.auth);
    }
    return callback();
  });
}

function createRequestAwareLogger(resolveBinding: () => FarmJsLoggerBinding): BlypLogger {
  return {
    success: (message, ...args) => {
      const binding = resolveBinding();
      withBinding(binding, () => binding.logger.success(message, ...args));
    },
    critical: (message, ...args) => {
      const binding = resolveBinding();
      withBinding(binding, () => binding.logger.critical(message, ...args));
    },
    warning: (message, ...args) => {
      const binding = resolveBinding();
      withBinding(binding, () => binding.logger.warning(message, ...args));
    },
    info: (message, ...args) => {
      const binding = resolveBinding();
      withBinding(binding, () => binding.logger.info(message, ...args));
    },
    debug: (message, ...args) => {
      const binding = resolveBinding();
      withBinding(binding, () => binding.logger.debug(message, ...args));
    },
    error: (message, ...args) => {
      const binding = resolveBinding();
      withBinding(binding, () => binding.logger.error(message, ...args));
    },
    warn: (message, ...args) => {
      const binding = resolveBinding();
      withBinding(binding, () => binding.logger.warn(message, ...args));
    },
    table: (message, data) => {
      const binding = resolveBinding();
      withBinding(binding, () => binding.logger.table(message, data));
    },
    flush: () => {
      const binding = resolveBinding();
      return withBinding(binding, () => binding.logger.flush());
    },
    shutdown: () => {
      const binding = resolveBinding();
      return withBinding(binding, () => binding.logger.shutdown());
    },
    createStructuredLog: (groupId, initial) => {
      const binding = resolveBinding();
      return withBinding(binding, () => binding.logger.createStructuredLog(groupId, {
        ...initial,
        ...(binding.traceId ? { traceId: binding.traceId } : {}),
        ...(binding.auth ? { auth: binding.auth } : {}),
      }));
    },
    child: (bindings) => createRequestAwareLogger(() => {
      const parent = resolveBinding();
      return {
        ...parent,
        logger: parent.logger.child(bindings),
      };
    }),
  };
}

export const logger: BlypLogger = createRequestAwareLogger(currentBinding);
