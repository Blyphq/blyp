import {
  attachLoggerInternals,
  createBaseLogger,
  createLazyLogger,
  type BlypLogger,
} from '../../core/logger';
import { serializeLogMessage } from '../../shared/log-value';
import type { StandaloneLogger, StandaloneLoggerConfig } from '../../types/frameworks/standalone';

export type { StandaloneLogger } from '../../types/frameworks/standalone';

function buildStructuredArgs(message: unknown, args: unknown[]): { text: unknown; data: unknown[] } {
  const text = serializeMessage(message);
  if (typeof message === 'string' || message instanceof Error) {
    return { text: message instanceof Error ? message : text, data: args };
  }
  return { text, data: [message, ...args] };
}

function serializeMessage(message: unknown): string {
  return serializeLogMessage(message);
}

function wrapBaseLogger(baseLogger: BlypLogger, config: StandaloneLoggerConfig): StandaloneLogger {
  return attachLoggerInternals({
    debug: (message: unknown, ...args: unknown[]) => {
      const { text, data } = buildStructuredArgs(message, args);
      baseLogger.debug(text, ...data);
    },

    info: (message: unknown, ...args: unknown[]) => {
      const { text, data } = buildStructuredArgs(message, args);
      baseLogger.info(text, ...data);
    },

    error: (message: unknown, ...args: unknown[]) => {
      const { text, data } = buildStructuredArgs(message, args);
      baseLogger.error(text, ...data);
    },

    warn: (message: unknown, ...args: unknown[]) => {
      const { text, data } = buildStructuredArgs(message, args);
      baseLogger.warn(text, ...data);
    },

    warning: (message: unknown, ...args: unknown[]) => {
      const { text, data } = buildStructuredArgs(message, args);
      baseLogger.warning(text, ...data);
    },

    success: (message: unknown, meta?: unknown) => {
      const { text, data } = buildStructuredArgs(message, meta === undefined ? [] : [meta]);
      if (meta) {
        baseLogger.success(text, ...data);
      } else {
        baseLogger.success(text);
      }
    },

    critical: (message: unknown, meta?: unknown) => {
      const { text, data } = buildStructuredArgs(message, meta === undefined ? [] : [meta]);
      if (meta) {
        baseLogger.critical(text, ...data);
      } else {
        baseLogger.critical(text);
      }
    },

    table: (message: string, data?: unknown) => {
      baseLogger.table(message, data);
    },

    flush: options => baseLogger.flush(options),

    shutdown: options => baseLogger.shutdown(options),

    createStructuredLog: (groupId: string, initial?: Record<string, unknown>) => {
      return baseLogger.createStructuredLog(groupId, initial);
    },

    child: (bindings: Record<string, unknown>) => {
      return wrapBaseLogger(baseLogger.child(bindings), config);
    },
  }, baseLogger);
}

export function createStandaloneLogger(config: StandaloneLoggerConfig = {}): StandaloneLogger {
  const baseLogger = createBaseLogger(config);
  return wrapBaseLogger(baseLogger, config);
}

let defaultLoggerInstance: StandaloneLogger | undefined;

function getDefaultLogger(): StandaloneLogger {
  return defaultLoggerInstance ??= createStandaloneLogger();
}

export function configureDefaultStandaloneLogger(
  config: StandaloneLoggerConfig = {}
): StandaloneLogger {
  defaultLoggerInstance = createStandaloneLogger(config);
  return defaultLoggerInstance;
}

export const logger = createLazyLogger(getDefaultLogger);
