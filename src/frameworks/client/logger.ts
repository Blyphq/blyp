/// <reference lib="dom" />

import {
  DEFAULT_CLIENT_LOG_ENDPOINT,
  createRandomId,
  getBrowserContext,
  getBrowserPageContext,
  getClientSessionId,
  normalizeClientLogLevel,
  normalizeClientPayloadData,
  normalizeLogValue,
  normalizeMetadata,
  serializeLogMessage,
} from '../../shared/client-log';
import type {
  ClientLogger,
  ClientLoggerConfig,
} from '../../types/frameworks/client';

interface ClientLoggerState {
  readonly pageId: string;
  readonly sessionId: string;
  readonly bindings: Record<string, unknown>;
}

function resolveHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(headers ?? {}),
  };
}

function shouldUseBeaconFallback(headers: Record<string, string> | undefined): boolean {
  return Object.keys(headers ?? {}).length === 0;
}

function sendRemoteLog(
  config: Required<Pick<ClientLoggerConfig, 'endpoint' | 'credentials'>> & {
    headers?: Record<string, string>;
  },
  payload: unknown
): void {
  if (typeof fetch !== 'function') {
    return;
  }

  const body = JSON.stringify(payload);
  const headers = resolveHeaders(config.headers);
  const canUseBeacon = shouldUseBeaconFallback(config.headers) &&
    typeof navigator !== 'undefined' &&
    typeof navigator.sendBeacon === 'function' &&
    typeof Blob !== 'undefined';

  try {
    fetch(config.endpoint, {
      method: 'POST',
      keepalive: true,
      credentials: config.credentials,
      headers,
      body,
    }).catch(() => {
      if (!canUseBeacon) {
        return;
      }

      try {
        navigator.sendBeacon(
          config.endpoint,
          new Blob([body], { type: 'application/json' })
        );
      } catch {}
    });
  } catch {
    if (!canUseBeacon) {
      return;
    }

    try {
      navigator.sendBeacon(
        config.endpoint,
        new Blob([body], { type: 'application/json' })
      );
    } catch {}
  }
}

function emitLocalConsole(level: 'warn' | 'debug' | 'info' | 'warning' | 'error' | 'critical' | 'success' | 'table', message: unknown, args: unknown[]): void {
  if (typeof console === 'undefined') {
    return;
  }

  const normalizedArgs = args.map((entry) => normalizeLogValue(entry));
  const text = serializeLogMessage(message);

  switch (level) {
    case 'table':
      console.log(text);
      if (normalizedArgs.length > 0 && typeof console.table === 'function') {
        console.table(normalizedArgs[0]);
      }
      return;
    case 'warning':
    case 'warn':
      console.warn(text, ...normalizedArgs);
      return;
    case 'error':
    case 'critical':
      console.error(text, ...normalizedArgs);
      return;
    case 'debug':
      console.debug(text, ...normalizedArgs);
      return;
    case 'success':
      console.log(text, ...normalizedArgs);
      return;
    case 'info':
    default:
      console.info(text, ...normalizedArgs);
  }
}

function buildClientLogger(config: ClientLoggerConfig, state: ClientLoggerState): ClientLogger {
  const resolvedConfig = {
    endpoint: config.endpoint ?? DEFAULT_CLIENT_LOG_ENDPOINT,
    headers: config.headers,
    credentials: config.credentials ?? 'same-origin',
    localConsole: config.localConsole ?? true,
    remoteSync: config.remoteSync ?? true,
    metadata: config.metadata,
  };

  const writeLog = (
    level: 'warn' | 'debug' | 'info' | 'warning' | 'error' | 'critical' | 'success' | 'table',
    message: unknown,
    args: unknown[]
  ): void => {
    if (resolvedConfig.localConsole) {
      emitLocalConsole(level, message, args);
    }

    if (!resolvedConfig.remoteSync) {
      return;
    }

    const normalizedLevel = normalizeClientLogLevel(level);
    const normalizedMessage = serializeLogMessage(message);
    const normalizedData = normalizeClientPayloadData(message, args);
    const metadata = normalizeMetadata(resolvedConfig.metadata);
    const payload = {
      type: 'client_log' as const,
      source: 'client' as const,
      id: createRandomId(),
      level: normalizedLevel,
      message: normalizedMessage,
      data: normalizedData,
      bindings: Object.keys(state.bindings).length > 0 ? normalizeLogValue(state.bindings) : undefined,
      clientTimestamp: new Date().toISOString(),
      page: getBrowserPageContext(),
      browser: getBrowserContext(),
      session: {
        pageId: state.pageId,
        sessionId: state.sessionId,
      },
      metadata,
    };

    sendRemoteLog(resolvedConfig, payload);
  };

  return {
    debug: (message: unknown, ...args: unknown[]) => {
      writeLog('debug', message, args);
    },
    info: (message: unknown, ...args: unknown[]) => {
      writeLog('info', message, args);
    },
    error: (message: unknown, ...args: unknown[]) => {
      writeLog('error', message, args);
    },
    warn: (message: unknown, ...args: unknown[]) => {
      writeLog('warn', message, args);
    },
    warning: (message: unknown, ...args: unknown[]) => {
      writeLog('warning', message, args);
    },
    success: (message: unknown, ...args: unknown[]) => {
      writeLog('success', message, args);
    },
    critical: (message: unknown, ...args: unknown[]) => {
      writeLog('critical', message, args);
    },
    table: (message: string, data?: unknown) => {
      writeLog('table', message, data === undefined ? [] : [data]);
    },
    child: (bindings: Record<string, unknown>) => {
      return buildClientLogger(config, {
        ...state,
        bindings: {
          ...state.bindings,
          ...bindings,
        },
      });
    },
  };
}

export function createClientLogger(config: ClientLoggerConfig = {}): ClientLogger {
  return buildClientLogger(config, {
    pageId: createRandomId(),
    sessionId: getClientSessionId(),
    bindings: {},
  });
}

export const logger = createClientLogger();
