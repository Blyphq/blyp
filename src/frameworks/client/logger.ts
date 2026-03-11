/// <reference lib="dom" />

import {
  type ClientLogEvent,
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
import {
  createRemoteDeliveryManager,
  type DeliveryAttemptResult,
} from '../../shared/remote-delivery';
import type {
  ClientLogger,
  ClientLoggerConfig,
} from '../../types/frameworks/client';

interface ClientLoggerState {
  readonly pageId: string;
  readonly sessionId: string;
  readonly bindings: Record<string, unknown>;
  readonly delivery?: {
    enqueue: (event: ClientLogEvent) => void;
  };
}

const warnedMessages = new Set<string>();

function errorOnce(key: string, message: string): void {
  if (warnedMessages.has(key) || typeof console === 'undefined') {
    return;
  }

  warnedMessages.add(key);
  console.error(message);
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

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isBrowserRuntime(): boolean {
  return typeof navigator !== 'undefined' && typeof location !== 'undefined';
}

async function sendRemoteLog(
  config: Required<Pick<ClientLoggerConfig, 'endpoint' | 'credentials'>> & {
    headers?: Record<string, string>;
    connector?: ClientLoggerConfig['connector'];
  },
  payload: ClientLogEvent
): Promise<DeliveryAttemptResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      outcome: 'retry',
      reason: 'offline',
    };
  }

  if (typeof fetch !== 'function') {
    return {
      outcome: 'failure',
      reason: 'missing_transport',
      suppressWarning: true,
    };
  }

  const body = JSON.stringify(payload);
  const headers = resolveHeaders(config.headers);
  const canUseBeacon = shouldUseBeaconFallback(config.headers) &&
    typeof navigator !== 'undefined' &&
    typeof navigator.sendBeacon === 'function' &&
    typeof Blob !== 'undefined';

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      keepalive: true,
      credentials: config.credentials,
      headers,
      body,
    });

    if (response.ok) {
      if (config.connector === 'posthog' && response.headers.get('x-blyp-posthog-status') === 'missing') {
        errorOnce(
          'posthog-missing',
          '[blyp/client] PostHog connector requested but not configured on the server. Continuing without PostHog forwarding.'
        );
      }

      if (
        config.connector &&
        typeof config.connector === 'object' &&
        config.connector.type === 'otlp' &&
        response.headers.get('x-blyp-otlp-status') === 'missing'
      ) {
        errorOnce(
          `otlp-missing:${config.connector.name}`,
          `[blyp/client] OTLP target "${config.connector.name}" was requested but not configured on the server. Continuing without OTLP forwarding.`
        );
      }

      return {
        outcome: 'success',
        transport: 'fetch',
        status: response.status,
      };
    }

    if (isRetryableStatus(response.status)) {
      return {
        outcome: 'retry',
        reason: 'response_status',
        status: response.status,
      };
    }

    return {
      outcome: 'failure',
      reason: 'response_status',
      status: response.status,
    };
  } catch (error) {
    if (canUseBeacon) {
      try {
        if (
          navigator.sendBeacon(
            config.endpoint,
            new Blob([body], { type: 'application/json' })
          )
        ) {
          return {
            outcome: 'success',
            transport: 'beacon',
          };
        }
      } catch {}
    }

    return {
      outcome: 'retry',
      reason: 'network_error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function emitLocalConsole(
  level: 'warn' | 'debug' | 'info' | 'warning' | 'error' | 'critical' | 'success' | 'table',
  message: unknown,
  args: unknown[]
): void {
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
    connector: config.connector,
    metadata: config.metadata,
  };

  const delivery = state.delivery ??
    (
      resolvedConfig.remoteSync &&
      isBrowserRuntime() &&
      typeof fetch === 'function'
        ? createRemoteDeliveryManager({
            runtime: 'browser',
            delivery: config.delivery,
            send: (event) => sendRemoteLog(resolvedConfig, event),
            subscribeToResume: (resume) => {
              if (typeof globalThis.addEventListener !== 'function') {
                return;
              }

              const listener = () => {
                resume();
              };

              globalThis.addEventListener('online', listener);

              return () => {
                if (typeof globalThis.removeEventListener === 'function') {
                  globalThis.removeEventListener('online', listener);
                }
              };
            },
          })
        : undefined
    );

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
    const payload: ClientLogEvent = {
      type: 'client_log',
      source: 'client',
      id: createRandomId(),
      level: normalizedLevel,
      message: normalizedMessage,
      connector: resolvedConfig.connector,
      data: normalizedData,
      bindings: Object.keys(state.bindings).length > 0 ? normalizeLogValue(state.bindings) as Record<string, unknown> : undefined,
      clientTimestamp: new Date().toISOString(),
      page: getBrowserPageContext(),
      browser: getBrowserContext(),
      session: {
        pageId: state.pageId,
        sessionId: state.sessionId,
      },
      metadata,
    };

    delivery?.enqueue(payload);
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
        delivery,
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

export function resetClientWarningsForTests(): void {
  warnedMessages.clear();
}
