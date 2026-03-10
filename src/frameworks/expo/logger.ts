import {
  type ClientLogEvent,
  createRandomId,
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
import type { ExpoLogger, ExpoLoggerConfig } from '../../types/frameworks/expo';
import {
  getExpoNetworkSnapshot,
  loadExpoNetworkModule,
  subscribeToExpoNetworkState,
} from './network';

interface ExpoLoggerState {
  readonly pageId: string;
  readonly sessionId: string;
  readonly bindings: Record<string, unknown>;
  readonly delivery?: {
    enqueue: (event: ClientLogEvent) => void;
  };
}

type ExpoLogLevel =
  | 'warn'
  | 'debug'
  | 'info'
  | 'warning'
  | 'error'
  | 'critical'
  | 'success'
  | 'table';

const expoSessionId = createRandomId();
const warnedMessages = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warnedMessages.has(key) || typeof console === 'undefined') {
    return;
  }

  warnedMessages.add(key);
  console.warn(message);
}

function isAbsoluteHttpUrl(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function resolveHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(headers ?? {}),
  };
}

function emitLocalConsole(level: ExpoLogLevel, message: unknown, args: unknown[]): void {
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

async function sendRemoteLog(
  config: {
    endpoint?: string;
    headers?: Record<string, string>;
    metadata?: ExpoLoggerConfig['metadata'];
  },
  event: ClientLogEvent
): Promise<DeliveryAttemptResult> {
  if (!isAbsoluteHttpUrl(config.endpoint)) {
    warnOnce(
      'invalid-endpoint',
      '[blyp/expo] `endpoint` must be an absolute http(s) URL. Remote sync skipped.'
    );
    return {
      outcome: 'failure',
      reason: 'invalid_endpoint',
      suppressWarning: true,
    };
  }

  const expoNetworkModule = await loadExpoNetworkModule();
  if (!expoNetworkModule) {
    warnOnce(
      'missing-expo-network',
      '[blyp/expo] Install `expo-network` to enable remote sync in Expo.'
    );
    return {
      outcome: 'failure',
      reason: 'missing_transport',
      suppressWarning: true,
    };
  }

  if (typeof fetch !== 'function') {
    return {
      outcome: 'failure',
      reason: 'missing_transport',
    };
  }

  const network = await getExpoNetworkSnapshot();
  if (network?.isConnected === false || network?.isInternetReachable === false) {
    return {
      outcome: 'retry',
      reason: 'offline',
    };
  }

  const payload: ClientLogEvent = {
    ...event,
    device: {
      runtime: 'expo',
      network,
    },
  };

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: resolveHeaders(config.headers),
      body: JSON.stringify(payload),
    });

    if (response.ok) {
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
    return {
      outcome: 'retry',
      reason: 'network_error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildExpoLogger(
  config: ExpoLoggerConfig | undefined,
  state: ExpoLoggerState
): ExpoLogger {
  const resolvedConfig = {
    endpoint: config?.endpoint,
    headers: config?.headers,
    localConsole: config?.localConsole ?? true,
    remoteSync: config?.remoteSync ?? true,
    metadata: config?.metadata,
  };

  const delivery = state.delivery ??
    (
      resolvedConfig.remoteSync
        ? createRemoteDeliveryManager({
            runtime: 'expo',
            delivery: config?.delivery,
            send: (event) => sendRemoteLog(resolvedConfig, event),
            subscribeToResume: (resume) => {
              return subscribeToExpoNetworkState((network) => {
                if (network?.isConnected === false || network?.isInternetReachable === false) {
                  return;
                }

                resume();
              });
            },
          })
        : undefined
    );

  const writeLog = (level: ExpoLogLevel, message: unknown, args: unknown[]): void => {
    if (resolvedConfig.localConsole) {
      emitLocalConsole(level, message, args);
    }

    if (!resolvedConfig.remoteSync) {
      return;
    }

    const payload: ClientLogEvent = {
      type: 'client_log',
      source: 'client',
      id: createRandomId(),
      level: normalizeClientLogLevel(level),
      message: serializeLogMessage(message),
      data: normalizeClientPayloadData(message, args),
      bindings: Object.keys(state.bindings).length > 0 ? normalizeLogValue(state.bindings) as Record<string, unknown> : undefined,
      clientTimestamp: new Date().toISOString(),
      page: {},
      browser: {},
      device: {
        runtime: 'expo',
      },
      session: {
        pageId: state.pageId,
        sessionId: state.sessionId,
      },
      metadata: normalizeMetadata(resolvedConfig.metadata),
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
      return buildExpoLogger(config, {
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

export function createExpoLogger(config: ExpoLoggerConfig): ExpoLogger {
  return buildExpoLogger(config, {
    pageId: createRandomId(),
    sessionId: expoSessionId,
    bindings: {},
  });
}

export function resetExpoWarningsForTests(): void {
  warnedMessages.clear();
}
