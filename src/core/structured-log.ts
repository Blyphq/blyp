import type {
  CreateStructuredLogOptions,
  StructuredLog,
  StructuredLogError,
  StructuredLogEvent,
  StructuredLogEmitOptions,
  StructuredLogLevel,
  StructuredLogPayload,
} from '../types/core/structured-log';

export type {
  CreateStructuredLogOptions,
  StructuredLog,
  StructuredLogError,
  StructuredLogEvent,
  StructuredLogEmitOptions,
  StructuredLogLevel,
  StructuredLogPayload,
} from '../types/core/structured-log';

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
      return '[Object]';
    }
  }

  return String(message);
}

function normalizeEventData(message: unknown, args: unknown[]): unknown {
  if (typeof message === 'string') {
    if (args.length === 0) {
      return undefined;
    }

    return args.length === 1 ? args[0] : args;
  }

  const values = [message, ...args];
  return values.length === 1 ? values[0] : values;
}

function normalizeDetails(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function normalizeError(error: unknown, fallbackStatus?: number): StructuredLogError | undefined {
  if (error === undefined || error === null) {
    return fallbackStatus === undefined || fallbackStatus < 400
      ? undefined
      : {
          message: `HTTP ${fallbackStatus}`,
          code: fallbackStatus,
          type: 'HttpError',
        };
  }

  if (error instanceof Error) {
    const errorLike = error as Error & {
      code?: string | number;
      why?: string;
      fix?: string;
      link?: string;
      details?: unknown;
      cause?: unknown;
      type?: string;
    };

    return {
      message: error.message,
      code: errorLike.code,
      type: errorLike.type ?? error.name ?? error.constructor?.name,
      stack: error.stack,
      why: errorLike.why,
      fix: errorLike.fix,
      link: errorLike.link,
      details: normalizeDetails(errorLike.details),
      cause: errorLike.cause,
    };
  }

  if (typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const statusCode =
      typeof record.statusCode === 'number'
        ? record.statusCode
        : typeof record.status === 'number'
          ? record.status
          : fallbackStatus;

    return {
      message:
        typeof record.message === 'string'
          ? record.message
          : `HTTP ${statusCode ?? 500}`,
      code:
        typeof record.code === 'string' || typeof record.code === 'number'
          ? record.code
          : statusCode,
      type:
        typeof record.type === 'string'
          ? record.type
          : typeof record.name === 'string'
            ? record.name
            : 'Error',
      stack: typeof record.stack === 'string' ? record.stack : undefined,
      why: typeof record.why === 'string' ? record.why : undefined,
      fix: typeof record.fix === 'string' ? record.fix : undefined,
      link: typeof record.link === 'string' ? record.link : undefined,
      details: normalizeDetails(record.details),
      cause: record.cause,
    };
  }

  return {
    message: String(error),
    code: fallbackStatus,
    type: typeof error,
  };
}

function resolveEmitStatus(options: StructuredLogEmitOptions): number | undefined {
  if (options.response && typeof options.response.status === 'number') {
    return options.response.status;
  }

  if (typeof options.status === 'number') {
    return options.status;
  }

  if (
    options.error &&
    typeof options.error === 'object' &&
    options.error !== null &&
    typeof (options.error as { statusCode?: unknown }).statusCode === 'number'
  ) {
    return (options.error as { statusCode: number }).statusCode;
  }

  if (
    options.error &&
    typeof options.error === 'object' &&
    options.error !== null &&
    typeof (options.error as { status?: unknown }).status === 'number'
  ) {
    return (options.error as { status: number }).status;
  }

  return options.error ? 500 : undefined;
}

export function createStructuredLog(
  groupId: string,
  options: CreateStructuredLogOptions
): StructuredLog<Record<string, unknown>> {
  const startedAt = performance.now();
  const fields = { ...(options.initialFields ?? {}) };
  const events: StructuredLogEvent[] = [];
  let emittedPayload: StructuredLogPayload<Record<string, unknown>> | undefined;

  options.onCreate?.();

  const appendEvent = (
    level: StructuredLogLevel,
    message: unknown,
    args: unknown[]
  ): StructuredLog<Record<string, unknown>> => {
    events.push({
      level,
      message: serializeMessage(message),
      timestamp: new Date().toISOString(),
      ...(normalizeEventData(message, args) === undefined
        ? {}
        : { data: normalizeEventData(message, args) }),
    });

    return structuredLog;
  };

  const structuredLog: StructuredLog<Record<string, unknown>> = {
    set<TNextFields extends Record<string, unknown>>(extraFields: TNextFields) {
      Object.assign(fields, extraFields);
      return structuredLog as StructuredLog<Record<string, unknown> & TNextFields>;
    },

    debug(message, ...args) {
      return appendEvent('debug', message, args);
    },

    info(message, ...args) {
      return appendEvent('info', message, args);
    },

    warn(message, ...args) {
      return appendEvent('warn', message, args);
    },

    warning(message, ...args) {
      return appendEvent('warning', message, args);
    },

    error(message, ...args) {
      return appendEvent('error', message, args);
    },

    success(message, ...args) {
      return appendEvent('success', message, args);
    },

    critical(message, ...args) {
      return appendEvent('critical', message, args);
    },

    table(message, data) {
      return appendEvent('table', message, data === undefined ? [] : [data]);
    },

    emit(emitOptions = {}) {
      if (emittedPayload) {
        return emittedPayload;
      }

      const defaultFields = options.resolveDefaultFields?.() ?? {};
      const status = resolveEmitStatus(emitOptions);
      const error = normalizeError(emitOptions.error, status);
      const level = emitOptions.level ?? (error ? 'error' : 'info');
      const payload: StructuredLogPayload<Record<string, unknown>> = {
        ...defaultFields,
        ...fields,
        groupId,
        timestamp: new Date().toISOString(),
        level,
        duration: Math.round(performance.now() - startedAt),
        ...(typeof status === 'number' ? { status } : {}),
        ...(events.length > 0 ? { events: [...events] } : {}),
        ...(error ? { error } : {}),
      };

      options.write(payload, emitOptions.message ?? 'structured_log');
      emittedPayload = payload;
      options.onEmit?.(payload);
      return payload;
    },
  };

  return structuredLog;
}
