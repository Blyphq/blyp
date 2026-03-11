import * as Sentry from '@sentry/node';
import type {
  BlypConfig,
  ResolvedSentryConnectorConfig,
  SentryConnectorConfig,
} from './config';
import type { LogRecord } from './file-logger';
import { serializeLogRecord } from './file-logger';

type SentryLogSource = 'server' | 'client';

interface SentrySendOptions {
  source?: SentryLogSource;
  warnIfUnavailable?: boolean;
}

interface SentryClientLike {
  getOptions?: () => {
    dsn?: unknown;
    environment?: unknown;
    release?: unknown;
  };
}

interface SentryModuleLike {
  init: (options: Record<string, unknown>) => unknown;
  getClient: () => SentryClientLike | undefined;
  captureException: (error: unknown) => unknown;
  flush: (timeout?: number) => PromiseLike<boolean>;
  withScope: (callback: (scope: Sentry.Scope) => void) => void;
  logger: {
    debug: (message: string, attributes?: Record<string, unknown>) => void;
    info: (message: string, attributes?: Record<string, unknown>) => void;
    warn: (message: string, attributes?: Record<string, unknown>) => void;
    error: (message: string, attributes?: Record<string, unknown>) => void;
    fatal: (message: string, attributes?: Record<string, unknown>) => void;
  };
}

interface SentryTestHooks {
  module?: SentryModuleLike;
}

export interface SentrySender {
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly mode: 'auto' | 'manual';
  readonly status: 'enabled' | 'missing';
  shouldAutoForwardServerLogs: () => boolean;
  send: (record: LogRecord, options?: SentrySendOptions) => void;
  flush: () => Promise<void>;
}

const warnedKeys = new Set<string>();
let testHooks: SentryTestHooks = {};

function warnOnce(key: string, message: string, error?: unknown): void {
  if (warnedKeys.has(key)) {
    return;
  }

  warnedKeys.add(key);
  if (error === undefined) {
    console.error(message);
    return;
  }

  console.error(message, error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBlypConfig(
  config: BlypConfig | ResolvedSentryConnectorConfig | SentryConnectorConfig
): config is BlypConfig {
  return 'connectors' in config || 'pretty' in config || 'level' in config;
}

function getSentryModule(): SentryModuleLike {
  return testHooks.module ?? (Sentry as unknown as SentryModuleLike);
}

function resolveConnectorConfig(
  config: BlypConfig | ResolvedSentryConnectorConfig | SentryConnectorConfig
): ResolvedSentryConnectorConfig {
  const connector = isBlypConfig(config)
    ? config.connectors?.sentry
    : config;
  const enabled = connector?.enabled ?? false;
  const dsn = connector?.dsn;
  const ready = enabled && typeof dsn === 'string' && dsn.trim().length > 0;

  return {
    enabled,
    mode: connector?.mode ?? 'auto',
    dsn,
    environment: connector?.environment,
    release: connector?.release,
    ready,
    status: ready ? 'enabled' : 'missing',
  };
}

function getPrimaryPayload(record: LogRecord): Record<string, unknown> {
  if (isRecord(record.data)) {
    return record.data;
  }

  return record;
}

function getField<T extends string | number>(
  record: LogRecord,
  key: string
): T | undefined {
  if (key in record) {
    const direct = record[key];
    if (typeof direct === 'string' || typeof direct === 'number') {
      return direct as T;
    }
  }

  const payload = getPrimaryPayload(record);
  const nested = payload[key];
  if (typeof nested === 'string' || typeof nested === 'number') {
    return nested as T;
  }

  return undefined;
}

function getClientPageField(record: LogRecord, key: 'pathname' | 'url'): string | undefined {
  const payload = getPrimaryPayload(record);
  const page = isRecord(payload.page) ? payload.page : undefined;
  const value = page?.[key];
  return typeof value === 'string' ? value : undefined;
}

function getClientSessionField(
  record: LogRecord,
  key: 'sessionId' | 'pageId'
): string | undefined {
  const payload = getPrimaryPayload(record);
  const session = isRecord(payload.session) ? payload.session : undefined;
  const value = session?.[key];
  return typeof value === 'string' ? value : undefined;
}

function getRecordType(record: LogRecord): string | undefined {
  return getField<string>(record, 'type');
}

function normalizeAttributes(
  record: LogRecord,
  source: SentryLogSource
): Record<string, unknown> {
  const attributes: Record<string, unknown> = {
    'blyp.level': record.level,
    'blyp.source': source,
    'blyp.payload': serializeLogRecord(record),
  };
  const recordType = getRecordType(record);
  const caller = typeof record.caller === 'string' ? record.caller : undefined;
  const groupId = getField<string>(record, 'groupId');
  const method = getField<string>(record, 'method');
  const path = getField<string>(record, 'path');
  const status = getField<number>(record, 'status');
  const duration = getField<number>(record, 'duration');
  const pagePath = getClientPageField(record, 'pathname');
  const pageUrl = getClientPageField(record, 'url');
  const sessionId = getClientSessionField(record, 'sessionId');
  const pageId = getClientSessionField(record, 'pageId');

  if (recordType) {
    attributes['blyp.type'] = recordType;
  }

  if (caller) {
    attributes['blyp.caller'] = caller;
  }

  if (groupId) {
    attributes['blyp.group_id'] = groupId;
  }

  if (method) {
    attributes['http.method'] = method;
  }

  if (path) {
    attributes['url.path'] = path;
  }

  if (status !== undefined) {
    attributes['http.status_code'] = status;
  }

  if (duration !== undefined) {
    attributes['blyp.duration_ms'] = duration;
  }

  if (pagePath) {
    attributes['client.page_path'] = pagePath;
  }

  if (pageUrl) {
    attributes['client.page_url'] = pageUrl;
  }

  if (sessionId) {
    attributes['client.session_id'] = sessionId;
  }

  if (pageId) {
    attributes['client.page_id'] = pageId;
  }

  return attributes;
}

function resolveLogMethod(
  module: SentryModuleLike,
  level: string
): (message: string, attributes?: Record<string, unknown>) => void {
  switch (level) {
    case 'debug':
      return module.logger.debug;
    case 'warning':
    case 'warn':
      return module.logger.warn;
    case 'error':
      return module.logger.error;
    case 'critical':
      return module.logger.fatal;
    case 'success':
    case 'table':
    case 'info':
    default:
      return module.logger.info;
  }
}

function normalizeScopeLevel(level: string): Sentry.SeverityLevel {
  switch (level) {
    case 'debug':
      return 'debug';
    case 'warning':
    case 'warn':
      return 'warning';
    case 'critical':
      return 'fatal';
    case 'error':
      return 'error';
    case 'success':
    case 'table':
    case 'info':
    default:
      return 'info';
  }
}

function toExceptionCandidate(value: unknown): unknown {
  if (!isRecord(value)) {
    return undefined;
  }

  const message = typeof value.message === 'string' ? value.message : undefined;
  const name = typeof value.name === 'string' ? value.name : undefined;
  const stack = typeof value.stack === 'string' ? value.stack : undefined;

  if (!message && !name && !stack) {
    return undefined;
  }

  const error = new Error(message ?? name ?? 'Unknown error');
  error.name = name ?? 'Error';
  if (stack) {
    error.stack = stack;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (key === 'message' || key === 'name' || key === 'stack') {
      continue;
    }

    ((error as unknown) as Record<string, unknown>)[key] = entry;
  }

  return error;
}

function extractExceptionCandidate(record: LogRecord): unknown {
  if (record.level !== 'error' && record.level !== 'critical') {
    return undefined;
  }

  const direct = toExceptionCandidate(record.error);
  if (direct) {
    return direct;
  }

  if (isRecord(record.data)) {
    const directData = toExceptionCandidate(record.data);
    if (directData) {
      return directData;
    }

    const nested = toExceptionCandidate(record.data.error);
    if (nested) {
      return nested;
    }
  }

  const payload = getPrimaryPayload(record);
  if (isRecord(payload)) {
    const nested = toExceptionCandidate(payload.error);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function getClientOptions(client: SentryClientLike | undefined): {
  dsn?: unknown;
  environment?: unknown;
  release?: unknown;
} {
  return client?.getOptions?.() ?? {};
}

function hasValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasConfigMismatch(
  connector: ResolvedSentryConnectorConfig,
  client: SentryClientLike | undefined
): boolean {
  const options = getClientOptions(client);

  return (
    (hasValue(connector.dsn) && connector.dsn !== options.dsn) ||
    (hasValue(connector.environment) && connector.environment !== options.environment) ||
    (hasValue(connector.release) && connector.release !== options.release)
  );
}

export function createSentrySender(
  config: BlypConfig | ResolvedSentryConnectorConfig | SentryConnectorConfig
): SentrySender {
  const connector = resolveConnectorConfig(config);
  const key = `${connector.mode}:${connector.dsn ?? 'missing'}`;
  const module = getSentryModule();
  let client = connector.enabled ? module.getClient() : undefined;

  if (!client && connector.enabled && typeof connector.dsn === 'string' && connector.dsn.trim().length > 0) {
    try {
      module.init({
        dsn: connector.dsn,
        environment: connector.environment,
        release: connector.release,
        enableLogs: true,
      });
      client = module.getClient();
    } catch (error) {
      warnOnce(
        `sentry-init:${key}`,
        '[Blyp] Failed to initialize Sentry. Skipping Sentry delivery.',
        error
      );
    }
  }

  if (client && hasConfigMismatch(connector, client)) {
    warnOnce(
      `sentry-mismatch:${key}`,
      '[Blyp] Sentry is already initialized with different options. Reusing the existing Sentry client.'
    );
  }

  const ready = connector.enabled && client !== undefined;

  const emitUnavailableWarning = (): void => {
    warnOnce(
      `sentry-unavailable:${key}`,
      '[Blyp] Sentry connector is not configured. Skipping Sentry delivery.'
    );
  };

  return {
    enabled: connector.enabled,
    ready,
    mode: connector.mode,
    status: ready ? 'enabled' : 'missing',
    shouldAutoForwardServerLogs() {
      return ready && connector.mode === 'auto';
    },
    send(record, options = {}) {
      if (!ready) {
        if (options.warnIfUnavailable) {
          emitUnavailableWarning();
        }
        return;
      }

      const source = options.source ?? 'server';
      const attributes = normalizeAttributes(record, source);
      const logMethod = resolveLogMethod(module, record.level);

      try {
        logMethod(record.message, attributes);
      } catch (error) {
        warnOnce(
          `sentry-log:${key}`,
          '[Blyp] Failed to deliver log to Sentry.',
          error
        );
      }

      const exception = extractExceptionCandidate(record);
      if (!exception) {
        return;
      }

      try {
        module.withScope((scope) => {
          scope.setLevel(normalizeScopeLevel(record.level));
          scope.setContext('blyp', attributes);
          scope.setExtra('blyp.payload', serializeLogRecord(record));
          module.captureException(exception);
        });
      } catch (error) {
        warnOnce(
          `sentry-exception:${key}`,
          '[Blyp] Failed to capture exception in Sentry.',
          error
        );
      }
    },
    async flush() {
      try {
        await module.flush(2000);
      } catch (error) {
        warnOnce(
          `sentry-flush:${key}`,
          '[Blyp] Failed to flush Sentry logs.',
          error
        );
      }
    },
  };
}

export function setSentryTestHooks(hooks: SentryTestHooks): void {
  testHooks = hooks;
}

export function resetSentryTestHooks(): void {
  testHooks = {};
  warnedKeys.clear();
}
