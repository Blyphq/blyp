import pino from 'pino';
import { shouldDropRootLogWrite } from '../frameworks/shared/request-context';
import { type BlypConfig, resolveConfig } from './config';
import {
  buildRecord,
  buildStructuredRecord,
  resolveStructuredWriteLevel,
  serializeMessage,
  type LogMethodName,
} from './log-record';
import {
  createFileLogger,
  type RotatingFileLogger,
} from './file-logger';
import {
  createPostHogSender,
  isClientLogRecord,
  type PostHogSender,
} from './posthog';
import {
  createOTLPRegistry,
  type OTLPRegistry,
} from './otlp';
import { runtime } from './runtime';
import {
  createStructuredLog as createStructuredLogCollector,
  type StructuredLog,
  type StructuredLogPayload,
} from './structured-log';

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

interface LoggerFactoryHandle {
  bindings: Record<string, unknown>;
  posthog: PostHogSender;
  otlp: OTLPRegistry;
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

function getLoggerFactory(logger: BlypLogger): LoggerFactoryHandle {
  const factory = (logger as InternalBlypLogger)[LOGGER_FACTORY];
  if (!factory) {
    throw new Error('Unsupported Blyp logger instance');
  }

  return factory;
}

export function getPostHogSender(logger: BlypLogger): PostHogSender {
  return getLoggerFactory(logger).posthog;
}

export function getOtlpRegistry(logger: BlypLogger): OTLPRegistry {
  return getLoggerFactory(logger).otlp;
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

function maybeSendToPostHog(
  posthog: PostHogSender,
  record: ReturnType<typeof buildRecord> | ReturnType<typeof buildStructuredRecord>
): void {
  if (isClientLogRecord(record)) {
    return;
  }

  if (!posthog.shouldAutoForwardServerLogs()) {
    if (posthog.enabled && !posthog.ready) {
      posthog.send(record, { source: 'server', warnIfUnavailable: true });
    }
    return;
  }

  posthog.send(record, { source: 'server', warnIfUnavailable: true });
}

function maybeSendToOTLP(
  otlp: OTLPRegistry,
  record: ReturnType<typeof buildRecord> | ReturnType<typeof buildStructuredRecord>
): void {
  if (isClientLogRecord(record)) {
    return;
  }

  for (const sender of otlp.getAutoForwardTargets()) {
    sender.send(record, { source: 'server', warnIfUnavailable: true });
  }
}

function createLoggerInstance(
  rootRawLogger: any,
  fileLogger: RotatingFileLogger,
  posthog: PostHogSender,
  otlp: OTLPRegistry,
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
    maybeSendToPostHog(posthog, record);
    maybeSendToOTLP(otlp, record);
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

    maybeSendToPostHog(posthog, record);
    maybeSendToOTLP(otlp, record);
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
      return createLoggerInstance(rootRawLogger, fileLogger, posthog, otlp, mergedBindings, source);
    },

    [LOGGER_FACTORY]: {
      bindings,
      posthog,
      otlp,
      create: (
        nextSource: InternalLoggerSource,
        nextBindings: Record<string, unknown> = bindings
      ) => {
        return createLoggerInstance(
          rootRawLogger,
          fileLogger,
          posthog,
          otlp,
          nextBindings,
          nextSource
        );
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
  const posthog = createPostHogSender(resolvedConfig);
  const otlp = createOTLPRegistry(resolvedConfig);
  const instance = createLoggerInstance(rawLogger, fileLogger, posthog, otlp);

  if (config === undefined) {
    loggerInstance = instance;
  }

  return instance;
}

export const logger = createBaseLogger();
