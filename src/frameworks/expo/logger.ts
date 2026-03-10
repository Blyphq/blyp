import {
  createRandomId,
  normalizeClientLogLevel,
  normalizeClientPayloadData,
  normalizeLogValue,
  normalizeMetadata,
  serializeLogMessage,
} from '../../shared/client-log';
import type { ExpoLogger, ExpoLoggerConfig } from '../../types/frameworks/expo';
import { getExpoNetworkSnapshot, loadExpoNetworkModule } from './network';

interface ExpoLoggerState {
  readonly pageId: string;
  readonly sessionId: string;
  readonly bindings: Record<string, unknown>;
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
  state: ExpoLoggerState,
  level: ExpoLogLevel,
  message: unknown,
  args: unknown[]
): Promise<void> {
  if (!isAbsoluteHttpUrl(config.endpoint)) {
    warnOnce(
      'invalid-endpoint',
      '[blyp/expo] `endpoint` must be an absolute http(s) URL. Remote sync skipped.'
    );
    return;
  }

  const expoNetworkModule = await loadExpoNetworkModule();
  if (!expoNetworkModule) {
    warnOnce(
      'missing-expo-network',
      '[blyp/expo] Install `expo-network` to enable remote sync in Expo.'
    );
    return;
  }

  if (typeof fetch !== 'function') {
    return;
  }

  const payload = {
    type: 'client_log' as const,
    source: 'client' as const,
    id: createRandomId(),
    level: normalizeClientLogLevel(level),
    message: serializeLogMessage(message),
    data: normalizeClientPayloadData(message, args),
    bindings: Object.keys(state.bindings).length > 0 ? normalizeLogValue(state.bindings) : undefined,
    clientTimestamp: new Date().toISOString(),
    page: {},
    browser: {},
    device: {
      runtime: 'expo' as const,
      network: await getExpoNetworkSnapshot(),
    },
    session: {
      pageId: state.pageId,
      sessionId: state.sessionId,
    },
    metadata: normalizeMetadata(config.metadata),
  };

  try {
    await fetch(config.endpoint, {
      method: 'POST',
      headers: resolveHeaders(config.headers),
      body: JSON.stringify(payload),
    });
  } catch {}
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

  const writeLog = (level: ExpoLogLevel, message: unknown, args: unknown[]): void => {
    if (resolvedConfig.localConsole) {
      emitLocalConsole(level, message, args);
    }

    if (!resolvedConfig.remoteSync) {
      return;
    }

    void sendRemoteLog(resolvedConfig, state, level, message, args);
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
