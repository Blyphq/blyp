import pino from 'pino';
import { createFileLogger, type LogRecord, type RotatingFileLogger } from './file-logger';
import { resolveConfig, type BlypConfig } from './config';
import {
  createStructuredLog as createStructuredLogCollector,
  type StructuredLog,
  type StructuredLogPayload,
} from './structured-log';
import { runtime } from './runtime';
import { shouldDropRootLogWrite } from '../frameworks/shared/request-context';

export interface BlypLogger {
  success: (message: unknown, ...args: unknown[]) => void;
  critical: (message: unknown, ...args: unknown[]) => void;
  warning: (message: unknown, ...args: unknown[]) => void;
  info: (message: unknown, ...args: unknown[]) => void;
  debug: (message: unknown, ...args: unknown[]) => void;
  error: (message: unknown, ...args: unknown[]) => void;
  warn: (message: unknown, ...args: unknown[]) => void;
  table: (message: string, data?: unknown) => void;
  createStructuredLog: (
    groupId: string,
    initial?: Record<string, unknown>
  ) => StructuredLog;
  child: (bindings: Record<string, unknown>) => BlypLogger;
}

export type InternalLoggerSource = 'root' | 'request-scoped' | 'structured-flush';

interface StructuredLogFactoryOptions {
  initialFields?: Record<string, unknown>;
  resolveDefaultFields?: () => Record<string, unknown>;
  onCreate?: () => void;
  onEmit?: (payload: StructuredLogPayload) => void;
}

type LogMethodName =
  | 'success'
  | 'critical'
  | 'warning'
  | 'info'
  | 'debug'
  | 'error'
  | 'warn'
  | 'table';

interface LoggerFactoryHandle {
  bindings: Record<string, unknown>;
  create: (source: InternalLoggerSource, bindings?: Record<string, unknown>) => BlypLogger;
  writeStructured: (
    payload: StructuredLogPayload,
    message: string,
    source?: InternalLoggerSource
  ) => void;
}

const LOGGER_FACTORY = Symbol('blyp.logger.factory');

type InternalBlypLogger = BlypLogger & {
  [LOGGER_FACTORY]: LoggerFactoryHandle;
};

export const CUSTOM_LEVELS: Record<string, number> = {
  success: 25,
  info: 30,
  debug: 35,
  table: 37,
  warning: 40,
  error: 50,
  critical: 60,
};

const RECORD_LEVELS: Record<LogMethodName, string> = {
  success: 'success',
  critical: 'critical',
  warning: 'warning',
  info: 'info',
  debug: 'debug',
  error: 'error',
  warn: 'warning',
  table: 'table',
};

const CONSOLE_LEVELS: Record<LogMethodName, string> = {
  success: 'success',
  critical: 'critical',
  warning: 'warning',
  info: 'info',
  debug: 'debug',
  error: 'error',
  warn: 'warn',
  table: 'debug',
};

const MAGENTA = '\x1b[35m';
const RESET = '\x1b[0m';

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function isInternalLoggerFrame(filePath: string): boolean {
  const normalizedPath = normalizePath(filePath);

  return (
    normalizedPath.startsWith('node:') ||
    normalizedPath.includes('/node_modules/pino') ||
    normalizedPath.includes('/node_modules/pino-pretty') ||
    normalizedPath.includes('/node_modules/blyp-js/') ||
    normalizedPath.includes('/blyp/src/core/') ||
    normalizedPath.includes('/blyp/src/frameworks/') ||
    normalizedPath.includes('/blyp/dist/')
  );
}

function formatCallerPath(filePath: string): string {
  const normalizedPath = normalizePath(filePath);
  const normalizedCwd = normalizePath(process.cwd());
  return normalizedPath.startsWith(`${normalizedCwd}/`)
    ? normalizedPath.slice(normalizedCwd.length + 1)
    : normalizedPath;
}

function getCallerLocation(): { file: string | null; line: number | null } {
  try {
    const stack = new Error().stack;
    if (!stack) return { file: null, line: null };

    const lines = stack.split('\n');
    let fallback: { file: string; line: number | null } | null = null;

    for (let index = 2; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) continue;

      const match = line.match(/\((.*):(\d+):\d+\)/) || line.match(/at\s+(.*):(\d+):(\d+)/);
      if (!match) {
        continue;
      }

      const fileName = match[1] || '';
      const lineNumber = parseInt(match[2] || '0', 10) || null;

      if (
        fileName &&
        !fileName.includes('node_modules') &&
        !isInternalLoggerFrame(fileName)
      ) {
        const formattedPath = formatCallerPath(fileName);
        const normalizedFormattedPath = normalizePath(formattedPath);

        if (!normalizedFormattedPath.startsWith('dist/')) {
          return { file: formattedPath, line: lineNumber };
        }

        fallback ??= { file: formattedPath, line: lineNumber };
      }
    }

    if (fallback) {
      return fallback;
    }
  } catch {
    return { file: null, line: null };
  }

  return { file: null, line: null };
}

function serializeMessage(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }

  if (message !== null && typeof message === 'object') {
    try {
      return JSON.stringify(
        message,
        (_key, value) => {
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
        },
        2
      );
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

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function summarizeClientConsoleData(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const record = data as {
    data?: unknown;
    metadata?: unknown;
    page?: { pathname?: unknown; url?: unknown };
  };
  const summary: Record<string, unknown> = {};

  if (record.data !== undefined) {
    summary.data = record.data;
  }

  const pathname = typeof record.page?.pathname === 'string'
    ? record.page.pathname
    : undefined;
  const url = typeof record.page?.url === 'string'
    ? record.page.url
    : undefined;

  if (pathname || url) {
    summary.page = pathname ?? url;
  }

  if (record.metadata !== undefined) {
    summary.metadata = record.metadata;
  }

  return Object.keys(summary).length > 0 ? summary : null;
}

function getConsoleDataPayload(data: unknown): { hidden: boolean; value?: unknown } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { hidden: false, value: data };
  }

  const record = data as { type?: unknown };
  if (record.type === 'http_request' || record.type === 'http_error') {
    return { hidden: true };
  }

  if (record.type === 'client_log') {
    const summary = summarizeClientConsoleData(data);
    if (!summary) {
      return { hidden: true };
    }

    return {
      hidden: false,
      value: summary,
    };
  }

  return { hidden: false, value: data };
}

function createPinoLogger(config: BlypConfig) {
  if (config.pretty) {
    const pinoPretty = require('pino-pretty');
    const pretty = pinoPretty.default({
      colorize: true,
      translateTime: 'SYS:HH:MM:ss',
      ignore: 'pid,hostname,caller',
      customColors: {
        success: 'green',
        critical: 'red bold',
        info: 'blue',
        warning: 'yellow',
        error: 'red',
        debug: 'cyan',
        table: 'cyan',
      },
      messageFormat: (log: Record<string, unknown>, messageKey: string) => {
        const message = String(log[messageKey] ?? '');
        const caller = typeof log.caller === 'string' ? log.caller.trim() : '';

        if (!caller) {
          return message;
        }

        return `${message} ${MAGENTA}${caller}${RESET}`;
      },
    });
    return pino(
      {
        level: config.level,
        customLevels: CUSTOM_LEVELS,
      },
      pretty
    );
  }

  return pino({
    level: config.level,
    customLevels: CUSTOM_LEVELS,
  });
}

function buildRecord(
  level: LogMethodName,
  message: unknown,
  args: unknown[],
  bindings: Record<string, unknown>
): LogRecord {
  const { file, line } = getCallerLocation();
  const serializedMessage = serializeMessage(message);
  const record: LogRecord = {
    timestamp: new Date().toISOString(),
    level: RECORD_LEVELS[level],
    message: stripAnsi(serializedMessage),
  };

  if (file) {
    record.caller = line !== null ? `${file}:${line}` : file;
  }

  if (args.length === 1) {
    record.data = args[0];
  } else if (args.length > 1) {
    record.data = args;
  }

  if (Object.keys(bindings).length > 0) {
    record.bindings = bindings;
  }

  return record;
}

function buildStructuredRecord(
  level: LogMethodName,
  message: string,
  payload: StructuredLogPayload,
  bindings: Record<string, unknown>
): LogRecord {
  const { file, line } = getCallerLocation();
  const record: LogRecord = {
    message: stripAnsi(message),
    ...payload,
  };

  if (file) {
    record.caller = line !== null ? `${file}:${line}` : file;
  }

  if (Object.keys(bindings).length > 0) {
    record.bindings = bindings;
  }

  record.level =
    typeof payload.level === 'string' && payload.level.length > 0
      ? payload.level
      : RECORD_LEVELS[level];
  record.timestamp =
    typeof payload.timestamp === 'string' && payload.timestamp.length > 0
      ? payload.timestamp
      : new Date().toISOString();

  return record;
}

function resolveStructuredWriteLevel(level: StructuredLogPayload['level']): LogMethodName {
  switch (level) {
    case 'debug':
      return 'debug';
    case 'warning':
      return 'warning';
    case 'warn':
      return 'warn';
    case 'error':
      return 'error';
    case 'success':
      return 'success';
    case 'critical':
      return 'critical';
    case 'table':
      return 'table';
    case 'info':
    default:
      return 'info';
  }
}

function getLoggerFactory(logger: BlypLogger): LoggerFactoryHandle {
  const factory = (logger as InternalBlypLogger)[LOGGER_FACTORY];
  if (!factory) {
    throw new Error('Unsupported Blyp logger instance');
  }

  return factory;
}

export function attachLoggerInternals<T extends BlypLogger>(target: T, source: BlypLogger): T {
  const factory = getLoggerFactory(source);
  Object.defineProperty(target, LOGGER_FACTORY, {
    value: factory,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return target;
}

export function createLoggerWithSource(
  logger: BlypLogger,
  source: InternalLoggerSource
): BlypLogger {
  const factory = getLoggerFactory(logger);
  return factory.create(source, factory.bindings);
}

export function createStructuredLogForLogger(
  logger: BlypLogger,
  groupId: string,
  options: StructuredLogFactoryOptions = {}
): StructuredLog {
  const factory = getLoggerFactory(logger);

  return createStructuredLogCollector(groupId, {
    initialFields: options.initialFields,
    resolveDefaultFields: () => ({
      ...factory.bindings,
      ...(options.resolveDefaultFields?.() ?? {}),
    }),
    write: (payload, message) => {
      factory.writeStructured(payload, message, 'structured-flush');
    },
    onCreate: options.onCreate,
    onEmit: options.onEmit,
  });
}

function createLoggerInstance(
  rootRawLogger: any,
  fileLogger: RotatingFileLogger,
  bindings: Record<string, unknown> = {},
  source: InternalLoggerSource = 'root'
): BlypLogger {
  const rawLogger = Object.keys(bindings).length > 0
    ? rootRawLogger.child(bindings)
    : rootRawLogger;

  const writeRecord = (
    level: LogMethodName,
    message: unknown,
    args: unknown[],
    writeSource: InternalLoggerSource = source
  ): void => {
    if (writeSource === 'root' && shouldDropRootLogWrite()) {
      return;
    }

    const record = buildRecord(level, message, args, bindings);
    const consoleMessage = serializeMessage(message);
    const payload: Record<string, unknown> = {
      caller: record.caller,
    };
    const consoleData = getConsoleDataPayload(record.data);

    if (!consoleData.hidden && consoleData.value !== undefined) {
      payload.data = consoleData.value;
    }

    const consoleMethod = CONSOLE_LEVELS[level];
    const boundLogger = rawLogger as Record<string, (payload: unknown, message: string) => void>;
    const logMethod =
      boundLogger[consoleMethod] ??
      boundLogger.info ??
      ((_payload: unknown, _message: string) => {});

    (logMethod as (this: unknown, payload: unknown, message: string) => void).call(
      rawLogger,
      payload,
      consoleMessage
    );
    fileLogger.write(record);
  };

  const writeStructuredRecord = (
    payload: StructuredLogPayload,
    message: string,
    writeSource: InternalLoggerSource = 'structured-flush'
  ): void => {
    const level = resolveStructuredWriteLevel(payload.level);
    const record = buildStructuredRecord(level, message, payload, bindings);
    const consoleMethod = CONSOLE_LEVELS[level];
    const boundLogger = rawLogger as Record<string, (payload: unknown, message: string) => void>;
    const logMethod =
      boundLogger[consoleMethod] ??
      boundLogger.info ??
      ((_payload: unknown, _message: string) => {});

    (logMethod as (this: unknown, payload: unknown, message: string) => void).call(
      rawLogger,
      {
        caller: record.caller,
        ...payload,
      },
      message
    );

    if (writeSource !== 'root' || !shouldDropRootLogWrite()) {
      fileLogger.write(record);
    }
  };

  const logger: InternalBlypLogger = {
    success: (message: unknown, ...args: unknown[]) => {
      writeRecord('success', message, args);
    },

    critical: (message: unknown, ...args: unknown[]) => {
      writeRecord('critical', message, args);
    },

    warning: (message: unknown, ...args: unknown[]) => {
      writeRecord('warning', message, args);
    },

    info: (message: unknown, ...args: unknown[]) => {
      writeRecord('info', message, args);
    },

    debug: (message: unknown, ...args: unknown[]) => {
      writeRecord('debug', message, args);
    },

    error: (message: unknown, ...args: unknown[]) => {
      writeRecord('error', message, args);
    },

    warn: (message: unknown, ...args: unknown[]) => {
      writeRecord('warn', message, args);
    },

    table: (message: string, data?: unknown) => {
      if (data && typeof data === 'object' && runtime.env.get('NODE_ENV') !== 'production') {
        console.log('TABLE:', message);
        console.table(data);
      }
      writeRecord('table', message, data === undefined ? [] : [data]);
    },

    createStructuredLog: (
      groupId: string,
      initial?: Record<string, unknown>
    ): StructuredLog => {
      return createStructuredLogForLogger(logger, groupId, {
        initialFields: initial,
      });
    },

    child: (childBindings: Record<string, unknown>) => {
      const mergedBindings = { ...bindings, ...childBindings };
      return createLoggerInstance(rootRawLogger, fileLogger, mergedBindings, source);
    },

    [LOGGER_FACTORY]: {
      bindings,
      create: (nextSource: InternalLoggerSource, nextBindings: Record<string, unknown> = bindings) => {
        return createLoggerInstance(rootRawLogger, fileLogger, nextBindings, nextSource);
      },
      writeStructured: (
        payload: StructuredLogPayload,
        message: string,
        nextSource: InternalLoggerSource = 'structured-flush'
      ) => {
        writeStructuredRecord(payload, message, nextSource);
      },
    },
  };

  return logger;
}

let loggerInstance: BlypLogger | null = null;

export function createBaseLogger(config?: Partial<BlypConfig>): BlypLogger {
  if (config === undefined && loggerInstance) {
    return loggerInstance;
  }

  const resolvedConfig = resolveConfig(config);
  const rawLogger = createPinoLogger(resolvedConfig);
  const fileLogger = createFileLogger(resolvedConfig);
  const instance = createLoggerInstance(rawLogger, fileLogger);

  if (config === undefined) {
    loggerInstance = instance;
  }

  return instance;
}

export const logger = createBaseLogger();
