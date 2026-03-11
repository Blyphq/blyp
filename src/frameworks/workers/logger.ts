import {
  buildClientDetails,
  buildInfoLogMessage,
  buildRequestLogData,
  createRequestLike,
  extractPathname,
  isErrorStatus,
  toErrorLike,
  type HttpRequestLog,
  type RequestLike,
} from '../shared/http';
import { createStructuredLog } from '../../core/structured-log';
import type {
  WorkersConsoleMethod,
  WorkersEmitOptions,
  WorkersLoggerConfig,
  WorkersLogLevel,
  WorkersRequestLogger,
  WorkersLoggerState,
} from '../../types/frameworks/workers';

let workersLoggerState: WorkersLoggerState = {};

function serializeMessage(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }

  if (message !== null && typeof message === 'object') {
    try {
      return JSON.stringify(message, (_key, value) => {
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
      return '[Object]';
    }
  }

  return String(message);
}

function normalizeStructuredData(message: unknown, args: unknown[]): unknown {
  if (typeof message === 'string') {
    if (args.length === 0) {
      return undefined;
    }

    return args.length === 1 ? args[0] : args;
  }

  const values = [message, ...args];
  return values.length === 1 ? values[0] : values;
}

function getConsoleMethod(level: WorkersLogLevel): WorkersConsoleMethod {
  switch (level) {
    case 'debug':
      return 'debug';
    case 'warn':
    case 'warning':
      return 'warn';
    case 'error':
    case 'critical':
      return 'error';
    case 'success':
      return 'log';
    case 'info':
    default:
      return 'info';
  }
}

function writeConsole(method: WorkersConsoleMethod, message: string, payload?: unknown): void {
  if (typeof console === 'undefined') {
    return;
  }

  const logger = console[method] ?? console.info;
  if (payload === undefined) {
    logger.call(console, message);
    return;
  }

  logger.call(console, message, payload);
}

function writeStructuredConsole(
  level: WorkersLogLevel,
  message: string,
  payload: Record<string, unknown>
): void {
  writeConsole(getConsoleMethod(level), message, payload);
}

function buildRequestMetadata(request: RequestLike, path: string): Record<string, unknown> {
  return {
    method: request.method,
    url: path,
    ...buildClientDetails(request, path),
  };
}

function createScopedPayload(
  request: RequestLike,
  path: string,
  fields: Record<string, unknown>,
  data: unknown
): Record<string, unknown> {
  return {
    request: buildRequestMetadata(request, path),
    ...fields,
    ...(data === undefined ? {} : { data }),
  };
}

function emitScopedLog(
  level: WorkersLogLevel,
  request: RequestLike,
  path: string,
  fields: Record<string, unknown>,
  message: unknown,
  args: unknown[]
): void {
  writeConsole(
    getConsoleMethod(level),
    serializeMessage(message),
    createScopedPayload(request, path, fields, normalizeStructuredData(message, args))
  );
}

function resolveEmitStatus(options: WorkersEmitOptions): number {
  return options.response?.status ?? options.status ?? (options.error ? 500 : 200);
}

function createEmitPayload(
  request: RequestLike,
  path: string,
  fields: Record<string, unknown>,
  startTime: number,
  options: WorkersEmitOptions
): HttpRequestLog {
  const statusCode = resolveEmitStatus(options);
  const errorLike = toErrorLike(options.error, statusCode);

  return buildRequestLogData(
    request,
    options.error || isErrorStatus(statusCode) ? 'http_error' : 'http_request',
    path,
    statusCode,
    Math.round(performance.now() - startTime),
    {
      ...fields,
      ...(errorLike
        ? {
            error: errorLike.message,
            stack: errorLike.stack,
            code: errorLike.code,
            why: errorLike.why,
            fix: errorLike.fix,
            link: errorLike.link,
            details: errorLike.details,
          }
        : {}),
    }
  );
}

function createScopedFields(request: Request): Record<string, unknown> {
  return {
    ...(workersLoggerState.env ?? {}),
    ...(workersLoggerState.customProps?.(request) ?? {}),
  };
}

export function initWorkersLogger(config: WorkersLoggerConfig = {}): void {
  workersLoggerState = {
    env: config.env ? { ...config.env } : undefined,
    customProps: config.customProps,
  };
}

export function createWorkersLogger(request: Request): WorkersRequestLogger {
  const startTime = performance.now();
  const requestLike = createRequestLike(request.method, request.url, request.headers);
  const path = extractPathname(request.url);
  const fields = createScopedFields(request);
  let emittedRecord: HttpRequestLog | undefined;

  const logger: WorkersRequestLogger = {
    set(extraFields) {
      Object.assign(fields, extraFields);
      return logger;
    },

    emit(options: WorkersEmitOptions = {}) {
      if (emittedRecord) {
        return emittedRecord;
      }

      emittedRecord = createEmitPayload(requestLike, path, fields, startTime, options);
      writeConsole(
        emittedRecord.type === 'http_error' ? 'error' : 'info',
        buildInfoLogMessage(
          requestLike.method,
          emittedRecord.statusCode,
          path,
          emittedRecord.responseTime
        ),
        emittedRecord
      );

      return emittedRecord;
    },

    debug(message, ...args) {
      emitScopedLog('debug', requestLike, path, fields, message, args);
    },

    info(message, ...args) {
      emitScopedLog('info', requestLike, path, fields, message, args);
    },

    warn(message, ...args) {
      emitScopedLog('warn', requestLike, path, fields, message, args);
    },

    warning(message, ...args) {
      emitScopedLog('warning', requestLike, path, fields, message, args);
    },

    error(message, ...args) {
      emitScopedLog('error', requestLike, path, fields, message, args);
    },

    success(message, ...args) {
      emitScopedLog('success', requestLike, path, fields, message, args);
    },

    critical(message, ...args) {
      emitScopedLog('critical', requestLike, path, fields, message, args);
    },

    table(message, data) {
      writeConsole('log', message, createScopedPayload(requestLike, path, fields, data));

      if (typeof console !== 'undefined' && typeof console.table === 'function' && data !== undefined) {
        console.table(data);
      }
    },

    createStructuredLog(groupId, initial) {
      return createStructuredLog(groupId, {
        initialFields: initial,
        resolveDefaultFields: () => ({
          method: requestLike.method,
          path,
          ...fields,
        }),
        write: (payload, message) => {
          const writeLevel = payload.level === 'warning' ? 'warning' : payload.level;
          writeStructuredConsole(
            writeLevel === 'table'
              ? 'info'
              : (writeLevel as Exclude<WorkersLogLevel, 'warn'>),
            message,
            payload
          );
        },
      });
    },
  };

  return logger;
}
