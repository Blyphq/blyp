import { createBaseLogger, type BlypLogger } from '../../core/logger';
import { runtime } from '../../core/runtime';
import type { StandaloneLoggerConfig } from '../../types/frameworks/standalone';

export interface StandaloneLogger extends BlypLogger {
  success: (message: string | unknown, meta?: unknown) => void;
  critical: (message: string | unknown, meta?: unknown) => void;
  table: (message: string, data?: unknown) => void;
  warn: (message: unknown, ...args: unknown[]) => void;
  warning: (message: unknown, ...args: unknown[]) => void;
}

function buildStructuredArgs(message: unknown, args: unknown[]): { text: string; data: unknown[] } {
  const text = serializeMessage(message);
  if (typeof message === 'string') {
    return { text, data: args };
  }
  return { text, data: [message, ...args] };
}

function serializeMessage(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }
  if (message !== null && typeof message === 'object') {
    try {
      return JSON.stringify(message, (key, value) => {
        if (typeof value === 'function') {
          return `[Function: ${value.name || 'anonymous'}]`;
        }
        if (value === undefined) {
          return '[undefined]';
        }
        if (typeof value === 'symbol') {
          return value.toString();
        }
        return value;
      }, 2);
    } catch {
      try {
        const keys = Object.keys(message as object);
        if (keys.length > 0) {
          return `[Object with keys: ${keys.join(', ')}]`;
        }
      } catch {}
      return '[Object]';
    }
  }
  return String(message);
}

function wrapBaseLogger(baseLogger: BlypLogger, config: StandaloneLoggerConfig): StandaloneLogger {
  return {
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

    child: (bindings: Record<string, unknown>) => {
      return wrapBaseLogger(baseLogger.child(bindings), config);
    },
  };
}

export function createStandaloneLogger(config: StandaloneLoggerConfig = {}): StandaloneLogger {
  const baseLogger = createBaseLogger(config);
  return wrapBaseLogger(baseLogger, config);
}

let defaultLoggerInstance = createStandaloneLogger();

function getDefaultLogger(): StandaloneLogger {
  return defaultLoggerInstance;
}

function createLoggerProxy(): StandaloneLogger {
  return {
    debug: (message: unknown, ...args: unknown[]) => {
      getDefaultLogger().debug(message, ...args);
    },

    info: (message: unknown, ...args: unknown[]) => {
      getDefaultLogger().info(message, ...args);
    },

    error: (message: unknown, ...args: unknown[]) => {
      getDefaultLogger().error(message, ...args);
    },

    warn: (message: unknown, ...args: unknown[]) => {
      getDefaultLogger().warn(message, ...args);
    },

    warning: (message: unknown, ...args: unknown[]) => {
      getDefaultLogger().warning(message, ...args);
    },

    success: (message: unknown, meta?: unknown) => {
      if (meta === undefined) {
        getDefaultLogger().success(message);
        return;
      }

      getDefaultLogger().success(message, meta);
    },

    critical: (message: unknown, meta?: unknown) => {
      if (meta === undefined) {
        getDefaultLogger().critical(message);
        return;
      }

      getDefaultLogger().critical(message, meta);
    },

    table: (message: string, data?: unknown) => {
      getDefaultLogger().table(message, data);
    },

    child: (bindings: Record<string, unknown>) => {
      return getDefaultLogger().child(bindings);
    },
  };
}

export function configureDefaultStandaloneLogger(
  config: StandaloneLoggerConfig = {}
): StandaloneLogger {
  defaultLoggerInstance = createStandaloneLogger(config);
  return defaultLoggerInstance;
}

export const logger = createLoggerProxy();
