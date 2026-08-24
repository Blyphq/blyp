import { createStructuredLog } from '../../core/structured-log';
import {
  resolveRedactionConfig,
  sanitizeLogMessage,
  sanitizeLogValue,
} from '../../shared/redaction';
import { serializeLogMessage } from '../../shared/log-value';
import type {
  ConvexConsoleMethod,
  ConvexFunctionKind,
  ConvexLogLevel,
  ConvexLogger,
  ConvexLoggerConfig,
  ConvexRuntimeStore,
  ResolvedConvexOtlpConfig,
} from '../../types/frameworks/convex';
import {
  canSendRemoteLogs,
  createConvexRuntimeStorage,
  createConvexRuntimeStore,
  resolveConvexFunctionKind,
} from './context';
import { sendOtlpLog } from './otlp';

const MAX_CONSOLE_BYTES = 3_500;

interface ConvexLoggerState {
  readonly config: ConvexLoggerConfig;
  readonly bindings: Record<string, unknown>;
  readonly boundCtx?: unknown;
  readonly redact: ReturnType<typeof resolveRedactionConfig>;
  readonly otlp: ResolvedConvexOtlpConfig;
  readonly storage: ReturnType<typeof createConvexRuntimeStorage>;
  readonly pending: Promise<void>[];
}

function getEnv(name: string): string | undefined {
  try {
    if (typeof process === 'undefined' || typeof process.env !== 'object' || !process.env) {
      return undefined;
    }

    const value = process.env[name];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function withLogsPath(endpoint: string): string {
  if (/\/v1\/logs\/?$/.test(endpoint)) {
    return endpoint;
  }

  return endpoint.endsWith('/') ? `${endpoint}v1/logs` : `${endpoint}/v1/logs`;
}

function resolveServiceName(config: ConvexLoggerConfig): string {
  const otlpName = config.otlp && config.otlp !== false
    ? config.otlp.serviceName
    : undefined;

  return config.serviceName
    ?? otlpName
    ?? getEnv('BLYP_SERVICE_NAME')
    ?? 'convex';
}

function resolveOtlpHeaders(config: ConvexLoggerConfig): Record<string, string> {
  const otlp = config.otlp && config.otlp !== false ? config.otlp : undefined;
  const headers = {
    ...(otlp?.headers ?? {}),
  };

  if (headers.Authorization === undefined) {
    const auth = otlp?.auth ?? getEnv('BLYP_OTLP_AUTH');
    if (auth) {
      headers.Authorization = auth;
    }
  }

  return headers;
}

function resolveOtlpEndpoint(config: ConvexLoggerConfig): string | undefined {
  if (config.otlp === false) {
    return undefined;
  }

  const configured = config.otlp?.endpoint
    ?? getEnv('BLYP_OTLP_ENDPOINT')
    ?? getEnv('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT');

  if (configured) {
    return configured;
  }

  const rootEndpoint = getEnv('OTEL_EXPORTER_OTLP_ENDPOINT');
  return rootEndpoint ? withLogsPath(rootEndpoint) : undefined;
}

function resolveOtlpConfig(config: ConvexLoggerConfig): ResolvedConvexOtlpConfig {
  const serviceName = resolveServiceName(config);
  const endpoint = resolveOtlpEndpoint(config);
  const enabled = Boolean(endpoint && isAbsoluteHttpUrl(endpoint));

  return {
    enabled,
    endpoint: enabled ? endpoint : undefined,
    headers: resolveOtlpHeaders(config),
    serviceName,
  };
}

function getConsoleMethod(level: ConvexLogLevel): ConvexConsoleMethod {
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
    case 'table':
    default:
      return 'info';
  }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function truncateForConsole(payload: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(payload);
  if (serialized && utf8Bytes(serialized) <= MAX_CONSOLE_BYTES) {
    return payload;
  }

  const next: Record<string, unknown> = {
    ...payload,
    is_truncated: true,
  };
  delete next.data;

  const withoutData = JSON.stringify(next);
  if (withoutData && utf8Bytes(withoutData) <= MAX_CONSOLE_BYTES) {
    return next;
  }

  const message = typeof next.msg === 'string' ? next.msg : '';
  next.msg = message.slice(0, 1_024);
  return next;
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

function writeConsole(method: ConvexConsoleMethod, payload: Record<string, unknown>): void {
  if (typeof console === 'undefined') {
    return;
  }

  const logger = console[method] ?? console.info;
  logger.call(console, truncateForConsole(payload));
}

function createInitialBindings(config: ConvexLoggerConfig): Record<string, unknown> {
  return config.function ? { function: config.function } : {};
}

function resolveRuntime(state: ConvexLoggerState): ConvexRuntimeStore {
  if (state.boundCtx !== undefined) {
    return createConvexRuntimeStore(state.boundCtx);
  }

  return state.storage.getStore() ?? {
    ctx: undefined,
    kind: 'unknown',
  };
}

function buildConvexLogger(state: ConvexLoggerState): ConvexLogger {
  const enqueueOtlp = (
    level: ConvexLogLevel,
    message: string,
    payload: Record<string, unknown>,
    kind: ConvexFunctionKind
  ): void => {
    if (!state.otlp.enabled || !canSendRemoteLogs(kind)) {
      return;
    }

    const sendPromise = sendOtlpLog({
      timestamp: typeof payload.timestamp === 'string' ? payload.timestamp : new Date().toISOString(),
      level,
      message,
      serviceName: state.otlp.serviceName,
      attributes: {
        'blyp.function_kind': kind,
        'blyp.payload': JSON.stringify(payload),
        ...(typeof payload.function === 'string' ? { 'blyp.function': payload.function } : {}),
      },
    }, state.otlp, state.config.transport);

    state.pending.push(sendPromise);
  };

  const emit = (level: ConvexLogLevel, message: unknown, args: unknown[]): void => {
    const runtime = resolveRuntime(state);
    const data = sanitizeLogValue(
      normalizeStructuredData(message, args),
      state.redact
    );
    const text = sanitizeLogMessage(serializeLogMessage(message), state.redact);
    const payload = sanitizeLogValue({
      blyp: 1,
      level,
      msg: text,
      service: state.otlp.serviceName,
      source: 'convex',
      timestamp: new Date().toISOString(),
      ...(runtime.kind !== 'unknown' ? { functionKind: runtime.kind } : {}),
      ...state.bindings,
      ...(data === undefined ? {} : { data }),
    }, state.redact) as Record<string, unknown>;

    writeConsole(getConsoleMethod(level), payload);
    enqueueOtlp(level, text, payload, runtime.kind);
  };

  const logger: ConvexLogger = {
    debug: (message, ...args) => {
      emit('debug', message, args);
    },
    info: (message, ...args) => {
      emit('info', message, args);
    },
    warn: (message, ...args) => {
      emit('warn', message, args);
    },
    warning: (message, ...args) => {
      emit('warning', message, args);
    },
    error: (message, ...args) => {
      emit('error', message, args);
    },
    success: (message, ...args) => {
      emit('success', message, args);
    },
    critical: (message, ...args) => {
      emit('critical', message, args);
    },
    table: (message, data) => {
      emit('table', message, data === undefined ? [] : [data]);
      if (typeof console !== 'undefined' && typeof console.table === 'function' && data !== undefined) {
        console.table(sanitizeLogValue(data, state.redact));
      }
    },
    child: (bindings) => {
      return buildConvexLogger({
        ...state,
        bindings: {
          ...state.bindings,
          ...(sanitizeLogValue(bindings, state.redact) as Record<string, unknown>),
        },
      });
    },
    bind: (ctx) => {
      return buildConvexLogger({
        ...state,
        boundCtx: ctx,
      });
    },
    wrap: (handler) => {
      return async (ctx, ...args) => {
        const store = createConvexRuntimeStore(ctx);
        try {
          return await state.storage.run(store, () => handler(ctx, ...args));
        } finally {
          if (canSendRemoteLogs(store.kind)) {
            await logger.flush();
          }
        }
      };
    },
    flush: async () => {
      if (state.pending.length === 0) {
        return;
      }

      const pending = state.pending.splice(0, state.pending.length);
      await Promise.allSettled(pending);
    },
    shutdown: async () => {
      await logger.flush();
    },
    createStructuredLog: (groupId, initial) => {
      return createStructuredLog(groupId, {
        initialFields: initial,
        resolveDefaultFields: () => ({
          service: state.otlp.serviceName,
          source: 'convex',
          ...state.bindings,
        }),
        write: (payload, message) => {
          const runtime = resolveRuntime(state);
          const writeLevel = payload.level === 'warning' ? 'warning' : payload.level;
          const record = sanitizeLogValue({
            blyp: 1,
            msg: message,
            service: state.otlp.serviceName,
            source: 'convex',
            ...(runtime.kind !== 'unknown' ? { functionKind: runtime.kind } : {}),
            ...payload,
          }, state.redact) as Record<string, unknown>;

          writeConsole(
            getConsoleMethod(writeLevel === 'table' ? 'info' : writeLevel),
            record
          );
          enqueueOtlp(writeLevel, message, record, runtime.kind);
        },
        redact: state.redact,
      });
    },
  };

  return logger;
}

function createLoggerState(config: ConvexLoggerConfig = {}): ConvexLoggerState {
  return {
    config,
    bindings: createInitialBindings(config),
    redact: resolveRedactionConfig(undefined, config.redact),
    otlp: resolveOtlpConfig(config),
    storage: createConvexRuntimeStorage(),
    pending: [],
  };
}

export function createConvexLogger(config: ConvexLoggerConfig = {}): ConvexLogger {
  return buildConvexLogger(createLoggerState(config));
}

let defaultLogger = createConvexLogger();

export function configureConvexLogger(config: ConvexLoggerConfig = {}): ConvexLogger {
  defaultLogger = createConvexLogger(config);
  return defaultLogger;
}

function createLoggerProxy(): ConvexLogger {
  return {
    debug: (message, ...args) => {
      defaultLogger.debug(message, ...args);
    },
    info: (message, ...args) => {
      defaultLogger.info(message, ...args);
    },
    warn: (message, ...args) => {
      defaultLogger.warn(message, ...args);
    },
    warning: (message, ...args) => {
      defaultLogger.warning(message, ...args);
    },
    error: (message, ...args) => {
      defaultLogger.error(message, ...args);
    },
    success: (message, ...args) => {
      defaultLogger.success(message, ...args);
    },
    critical: (message, ...args) => {
      defaultLogger.critical(message, ...args);
    },
    table: (message, data) => {
      defaultLogger.table(message, data);
    },
    child: (bindings) => defaultLogger.child(bindings),
    bind: (ctx) => defaultLogger.bind(ctx),
    wrap: (handler) => defaultLogger.wrap(handler),
    flush: () => defaultLogger.flush(),
    shutdown: () => defaultLogger.shutdown(),
    createStructuredLog: (groupId, initial) => {
      return defaultLogger.createStructuredLog(groupId, initial);
    },
  };
}

export const logger = createLoggerProxy();

export {
  canSendRemoteLogs,
  resolveConvexFunctionKind,
};