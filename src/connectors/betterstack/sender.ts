import * as Sentry from '@sentry/node';
import { Logtail } from '@logtail/node';
import type {
  BetterStackConnectorConfig,
  BlypConfig,
  ResolvedBetterStackConnectorConfig,
} from '../../core/config';
import type { LogRecord } from '../../core/file-logger';
import { serializeLogRecord } from '../../core/file-logger';
import { createErrorOnceLogger } from '../../shared/once';
import { hasNonEmptyString, isAbsoluteHttpUrl, isPlainObject } from '../../shared/validation';
import type {
  BetterStackClientLike,
  BetterStackExceptionCaptureOptions,
  BetterStackLogSource,
  BetterStackSender,
  BetterStackTestHooks,
} from '../../types/connectors/betterstack';
import type { SentryModuleLike } from '../../types/connectors/sentry';
import {
  getClientPageField,
  getClientSessionField,
  getField,
  getPrimaryPayload,
  getRecordType,
  isBlypConfig,
} from '../shared';

const PREVIOUSLY_CAPTURED_ERROR_KEY = '__betterstack_previously_captured_error';
const warnedKeys = new Set<string>();
let testHooks: BetterStackTestHooks = {};
const warnOnce = createErrorOnceLogger(warnedKeys);

function getSentryModule(): SentryModuleLike {
  return testHooks.module ?? (Sentry as unknown as SentryModuleLike);
}

function resolveConnectorConfig(
  config: BlypConfig | ResolvedBetterStackConnectorConfig | BetterStackConnectorConfig
): ResolvedBetterStackConnectorConfig {
  const connector = isBlypConfig(config)
    ? config.connectors?.betterstack
    : config;
  const enabled = connector?.enabled ?? false;
  const sourceToken = connector?.sourceToken;
  const ingestingHost = connector?.ingestingHost;
  const errorTrackingEnabled = connector?.errorTracking?.enabled ?? enabled;
  const errorTrackingDsn = connector?.errorTracking?.dsn;
  const errorTrackingReady =
    enabled &&
    errorTrackingEnabled &&
    hasNonEmptyString(errorTrackingDsn);
  const ready =
    enabled &&
    hasNonEmptyString(sourceToken) &&
    isAbsoluteHttpUrl(ingestingHost);

  return {
    enabled,
    mode: connector?.mode ?? 'auto',
    sourceToken,
    ingestingHost,
    serviceName: connector?.serviceName ?? 'blyp-app',
    errorTracking: {
      enabled: errorTrackingEnabled,
      dsn: errorTrackingDsn,
      tracesSampleRate: connector?.errorTracking?.tracesSampleRate ?? 1.0,
      environment: connector?.errorTracking?.environment,
      release: connector?.errorTracking?.release,
      ready: errorTrackingReady,
      status: errorTrackingReady ? 'enabled' : 'missing',
    },
    ready,
    status: ready ? 'enabled' : 'missing',
  };
}

function resolveBetterStackLevel(level: string): string {
  switch (level) {
    case 'debug':
      return 'debug';
    case 'warning':
    case 'warn':
      return 'warn';
    case 'error':
      return 'error';
    case 'critical':
      return 'fatal';
    case 'success':
    case 'table':
    case 'info':
    default:
      return 'info';
  }
}

function parseCaller(caller: unknown): { file?: string; line?: number } {
  if (typeof caller !== 'string' || caller.trim().length === 0) {
    return {};
  }

  const match = caller.match(/^(.*):(\d+)$/);
  if (!match) {
    return {};
  }

  const file = match[1]?.trim();
  const line = Number.parseInt(match[2] ?? '', 10);

  return {
    ...(file ? { file } : {}),
    ...(Number.isFinite(line) ? { line } : {}),
  };
}

function buildContext(
  record: LogRecord,
  connector: ResolvedBetterStackConnectorConfig,
  source: BetterStackLogSource
): Record<string, unknown> {
  const recordType = getRecordType(record);
  const groupId = getField<string>(record, 'groupId');
  const method = getField<string>(record, 'method');
  const path = getField<string>(record, 'path');
  const status = getField<number>(record, 'status');
  const duration = getField<number>(record, 'duration');
  const pagePath = getClientPageField(record, 'pathname');
  const pageUrl = getClientPageField(record, 'url');
  const sessionId = getClientSessionField(record, 'sessionId');
  const pageId = getClientSessionField(record, 'pageId');
  const runtime = parseCaller(record.caller);

  return {
    service: connector.serviceName,
    context: {
      blyp: {
        level: record.level,
        source,
        ...(recordType ? { type: recordType } : {}),
        ...(groupId ? { group_id: groupId } : {}),
        ...(record.caller ? { caller: record.caller } : {}),
        ...(duration !== undefined ? { duration_ms: duration } : {}),
        ...(record.bindings ? { bindings: record.bindings } : {}),
        payload: serializeLogRecord(record),
      },
      ...(method || path || status !== undefined
        ? {
            http: {
              ...(method ? { method } : {}),
              ...(path ? { path } : {}),
              ...(status !== undefined ? { status_code: status } : {}),
            },
          }
        : {}),
      ...(pagePath || pageUrl || sessionId || pageId
        ? {
            client: {
              ...(pagePath ? { page_path: pagePath } : {}),
              ...(pageUrl ? { page_url: pageUrl } : {}),
              ...(sessionId ? { session_id: sessionId } : {}),
              ...(pageId ? { page_id: pageId } : {}),
            },
          }
        : {}),
      ...(Object.keys(runtime).length > 0 ? { runtime } : {}),
      ...(record.data !== undefined ? { data: record.data } : {}),
      ...(record.error !== undefined ? { error: record.error } : {}),
    },
  };
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

function normalizeExceptionInput(input: unknown): unknown {
  if (input instanceof Error) {
    return input;
  }

  const direct = toExceptionCandidate(input);
  if (direct) {
    return direct;
  }

  if (typeof input === 'string') {
    return new Error(input);
  }

  return new Error('Unknown Better Stack exception');
}

function isPreviouslyCapturedError(value: unknown): boolean {
  return isPlainObject(value) && value[PREVIOUSLY_CAPTURED_ERROR_KEY] === true;
}

function markCapturedError(value: unknown): void {
  if (!isPlainObject(value) || isPreviouslyCapturedError(value)) {
    return;
  }

  try {
    Object.defineProperty(value, PREVIOUSLY_CAPTURED_ERROR_KEY, {
      value: true,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  } catch {
    try {
      value[PREVIOUSLY_CAPTURED_ERROR_KEY] = true;
    } catch {}
  }
}

function createDefaultClient(
  connector: ResolvedBetterStackConnectorConfig
): BetterStackClientLike {
  return new Logtail(connector.sourceToken ?? '', {
    endpoint: connector.ingestingHost,
    captureStackContext: false,
  }) as BetterStackClientLike;
}

function getClientOptions(client: ReturnType<SentryModuleLike['getClient']>): {
  dsn?: unknown;
  environment?: unknown;
  release?: unknown;
} {
  return client?.getOptions?.() ?? {};
}

function registerShutdownHooks(key: string, flush: () => Promise<void>): void {
  const handlers: Array<NodeJS.Signals | 'beforeExit'> = ['beforeExit', 'SIGINT', 'SIGTERM'];

  for (const event of handlers) {
    process.once(event, () => {
      void flush().catch((error) => {
        warnOnce(
          `${key}:shutdown`,
          '[Blyp] Failed to flush Better Stack logs during shutdown.',
          error
        );
      });
    });
  }
}

export function createBetterStackSender(
  config: BlypConfig | ResolvedBetterStackConnectorConfig | BetterStackConnectorConfig
): BetterStackSender {
  const connector = resolveConnectorConfig(config);
  const key = `${connector.serviceName}:${connector.ingestingHost ?? 'missing'}:${connector.mode}`;
  const sentryModule = getSentryModule();
  const client = connector.ready
    ? (testHooks.createClient?.(connector) ?? createDefaultClient(connector))
    : undefined;
  let sentryClient = connector.errorTracking.enabled
    ? sentryModule?.getClient?.()
    : undefined;

  if (sentryClient) {
    const options = getClientOptions(sentryClient);
    if (
      (hasNonEmptyString(connector.errorTracking.dsn) && connector.errorTracking.dsn !== options.dsn) ||
      (hasNonEmptyString(connector.errorTracking.environment) && connector.errorTracking.environment !== options.environment) ||
      (hasNonEmptyString(connector.errorTracking.release) && connector.errorTracking.release !== options.release)
    ) {
      warnOnce(
        `betterstack-error-mismatch:${key}`,
        '[Blyp] Sentry is already initialized with different options. Reusing the existing Sentry client for Better Stack error tracking.'
      );
    }
  }

  if (
    !sentryClient &&
    connector.errorTracking.enabled &&
    hasNonEmptyString(connector.errorTracking.dsn) &&
    sentryModule
  ) {
    try {
      sentryModule.init({
        dsn: connector.errorTracking.dsn,
        tracesSampleRate: connector.errorTracking.tracesSampleRate,
        environment: connector.errorTracking.environment,
        release: connector.errorTracking.release,
      });
      sentryClient = sentryModule.getClient();
    } catch (error) {
      warnOnce(
        `betterstack-error-init:${key}`,
        '[Blyp] Failed to initialize Better Stack error tracking.',
        error
      );
    }
  }

  const errorTrackingReady = connector.errorTracking.enabled && sentryClient !== undefined;

  if (client || errorTrackingReady) {
    registerShutdownHooks(key, async () => {
      if (client) {
        await client.flush();
      }
      if (errorTrackingReady) {
        await sentryModule.flush(2000);
      }
    });
  }

  const emitUnavailableWarning = (): void => {
    warnOnce(
      `betterstack-unavailable:${key}`,
      '[Blyp] Better Stack connector is not configured or not ready. Skipping Better Stack delivery.'
    );
  };

  const emitExceptionUnavailableWarning = (): void => {
    warnOnce(
      `betterstack-exception-unavailable:${key}`,
      '[Blyp] Better Stack error tracking is not configured. Skipping Better Stack exception capture.'
    );
  };

  return {
    enabled: connector.enabled,
    ready: connector.ready,
    mode: connector.mode,
    serviceName: connector.serviceName,
    ingestingHost: connector.ingestingHost,
    status: connector.status,
    errorTracking: {
      enabled: connector.errorTracking.enabled,
      ready: errorTrackingReady,
      status: errorTrackingReady ? 'enabled' : 'missing',
      dsn: connector.errorTracking.dsn,
      tracesSampleRate: connector.errorTracking.tracesSampleRate,
      environment: connector.errorTracking.environment,
      release: connector.errorTracking.release,
    },
    shouldAutoForwardServerLogs() {
      return connector.ready && connector.mode === 'auto';
    },
    shouldAutoCaptureExceptions() {
      return errorTrackingReady;
    },
    send(record, options = {}) {
      if (!connector.ready || !client) {
        if (options.warnIfUnavailable) {
          emitUnavailableWarning();
        }
        return;
      }

      const source = options.source ?? 'server';
      void client.log(
        record.message,
        resolveBetterStackLevel(record.level),
        buildContext(record, connector, source)
      ).catch((error) => {
        warnOnce(
          `betterstack-send:${key}`,
          '[Blyp] Failed to deliver log to Better Stack.',
          error
        );
      });
    },
    captureException(error, options: BetterStackExceptionCaptureOptions = {}) {
      if (!errorTrackingReady || !sentryModule) {
        if (options.warnIfUnavailable) {
          emitExceptionUnavailableWarning();
        }
        return;
      }

      if (isPreviouslyCapturedError(error)) {
        return;
      }

      try {
        const exception = normalizeExceptionInput(error);
        sentryModule.withScope((scope) => {
          scope.setLevel(
            normalizeScopeLevel(
              options.source === 'client' ? 'error' : 'error'
            )
          );
          scope.setContext('blyp', {
            source: options.source ?? 'server',
            ...(options.context ? { context: options.context } : {}),
          });
          sentryModule.captureException(exception);
        });
        markCapturedError(error);
        markCapturedError(exception);
      } catch (captureError) {
        warnOnce(
          `betterstack-manual-capture:${key}`,
          '[Blyp] Failed to capture exception in Better Stack error tracking.',
          captureError
        );
      }
    },
    async flush() {
      if (!client) {
        if (!errorTrackingReady || !sentryModule) {
          return;
        }
      }

      try {
        if (client) {
          await client.flush();
        }
        if (errorTrackingReady && sentryModule) {
          await sentryModule.flush(2000);
        }
      } catch (error) {
        warnOnce(
          `betterstack-flush:${key}`,
          '[Blyp] Failed to flush Better Stack logs.',
          error
        );
      }
    },
  };
}

export function setBetterStackTestHooks(hooks: BetterStackTestHooks): void {
  testHooks = hooks;
}

export function resetBetterStackTestHooks(): void {
  testHooks = {};
  warnedKeys.clear();
}
