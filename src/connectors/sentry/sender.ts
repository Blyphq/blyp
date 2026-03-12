import * as Sentry from '@sentry/node';
import type {
  BlypConfig,
  ResolvedSentryConnectorConfig,
  SentryConnectorConfig,
} from '../../core/config';
import type { LogRecord } from '../../core/file-logger';
import { serializeLogRecord } from '../../core/file-logger';
import { createErrorOnceLogger } from '../../shared/once';
import { hasNonEmptyString, isPlainObject } from '../../shared/validation';
import type {
  SentryClientLike,
  SentryLogSource,
  SentryModuleLike,
  SentrySender,
  SentryTestHooks,
} from '../../types/connectors/sentry';
import {
  getClientPageField,
  getClientSessionField,
  getField,
  getPrimaryPayload,
  getRecordType,
  isBlypConfig,
} from '../shared';

const warnedKeys = new Set<string>();
let testHooks: SentryTestHooks = {};
const warnOnce = createErrorOnceLogger(warnedKeys);

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
  const ready = enabled && hasNonEmptyString(dsn);

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

  const ifTruthy: Array<[string, unknown]> = [
    ['blyp.type', recordType],
    ['blyp.caller', caller],
    ['blyp.group_id', groupId],
    ['http.method', method],
    ['url.path', path],
    ['client.page_path', pagePath],
    ['client.page_url', pageUrl],
    ['client.session_id', sessionId],
    ['client.page_id', pageId],
  ];
  const ifDefined: Array<[string, unknown]> = [
    ['http.status_code', status],
    ['blyp.duration_ms', duration],
  ];
  for (const [k, v] of ifTruthy) if (v) attributes[k] = v;
  for (const [k, v] of ifDefined) if (v !== undefined) attributes[k] = v;

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
  if (!isPlainObject(value)) {
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

  if (isPlainObject(record.data)) {
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
  if (isPlainObject(payload)) {
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

function hasConfigMismatch(
  connector: ResolvedSentryConnectorConfig,
  client: SentryClientLike | undefined
): boolean {
  const options = getClientOptions(client);

  return (
    (hasNonEmptyString(connector.dsn) && connector.dsn !== options.dsn) ||
    (hasNonEmptyString(connector.environment) && connector.environment !== options.environment) ||
    (hasNonEmptyString(connector.release) && connector.release !== options.release)
  );
}

export function createSentrySender(
  config: BlypConfig | ResolvedSentryConnectorConfig | SentryConnectorConfig
): SentrySender {
  const connector = resolveConnectorConfig(config);
  const key = `${connector.mode}:${connector.dsn ?? 'missing'}`;
  const module = getSentryModule();
  let client = connector.enabled ? module.getClient() : undefined;

  if (!client && connector.enabled && hasNonEmptyString(connector.dsn)) {
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
