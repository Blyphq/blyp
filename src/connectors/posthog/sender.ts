import { SeverityNumber } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from '@opentelemetry/sdk-logs';
import { PostHog } from 'posthog-node';
import type {
  BlypConfig,
  PostHogConnectorConfig,
  ResolvedPostHogConnectorConfig,
} from '../../core/config';
import type { LogRecord } from '../../core/file-logger';
import { serializeLogRecord } from '../../core/file-logger';
import { normalizeLogValue } from '../../shared/log-value';
import { createErrorOnceLogger } from '../../shared/once';
import { hasNonEmptyString, isPlainObject } from '../../shared/validation';
import type {
  NormalizedPostHogException,
  PostHogExceptionClient,
  PostHogLogTransport,
  PostHogNormalizedRecord,
  PostHogSender,
  PostHogSource,
  PostHogTestHooks
} from '../../types/connectors/posthog';
import {
  getClientPageField,
  getClientSessionField,
  getField,
  getRecordType,
  isBlypConfig,
} from '../shared';

const PREVIOUSLY_CAPTURED_ERROR_KEY = '__posthog_previously_captured_error';

const warnedKeys = new Set<string>();
let testHooks: PostHogTestHooks = {};
const warnOnce = createErrorOnceLogger(warnedKeys);

function normalizeHost(host: string | undefined): string {
  const trimmed = (host || 'https://us.i.posthog.com').trim();
  return trimmed.replace(/\/+$/, '');
}

function buildRecordAttributes(
  record: LogRecord,
  source: PostHogSource
): Record<string, unknown> {
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

  const attributes: Record<string, unknown> = {
    'blyp.level': record.level,
    'blyp.source': source,
    'blyp.payload': serializeLogRecord(record),
  };

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

function normalizeExceptionProperties(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    return {};
  }

  return normalizeLogValue(value) as Record<string, unknown>;
}

function assignExceptionField(
  target: Error,
  key: string,
  value: unknown
): void {
  if (value === undefined) {
    return;
  }

  try {
    ((target as unknown) as Record<string, unknown>)[key] = value;
  } catch {}
}

function createSyntheticError(
  message: string,
  source: Record<string, unknown>
): Error {
  const error = new Error(message);
  const name = hasNonEmptyString(source.name) ? source.name : 'Error';
  error.name = name;

  if (hasNonEmptyString(source.stack)) {
    error.stack = source.stack;
  }

  assignExceptionField(error, 'cause', source.cause);
  assignExceptionField(error, 'status', source.status);
  assignExceptionField(error, 'statusCode', source.statusCode);
  assignExceptionField(error, 'code', source.code);
  assignExceptionField(error, 'why', source.why);
  assignExceptionField(error, 'fix', source.fix);
  assignExceptionField(error, 'link', source.link);
  assignExceptionField(error, 'details', source.details);

  return error;
}

function normalizeExceptionInput(
  input: unknown,
  fallbackMessage: string = 'Unknown error'
): NormalizedPostHogException {
  if (input instanceof Error) {
    return {
      error: input,
      properties: normalizeExceptionProperties(input as unknown as Record<string, unknown>),
    };
  }

  if (isPlainObject(input)) {
    const message = hasNonEmptyString(input.message)
      ? input.message
      : hasNonEmptyString(input.error)
        ? input.error
        : fallbackMessage;

    return {
      error: createSyntheticError(message, input),
      properties: normalizeExceptionProperties(input),
    };
  }

  if (typeof input === 'string') {
    return {
      error: new Error(input),
      properties: {
        message: input,
      },
    };
  }

  return {
    error: new Error(fallbackMessage),
    properties: {
      value: normalizeLogValue(input),
    },
  };
}

function createExceptionPropertiesFromRecord(
  record: LogRecord,
  source: PostHogSource
): Record<string, unknown> {
  return buildRecordAttributes(record, source);
}

export function isPreviouslyCapturedPostHogError(value: unknown): boolean {
  return isPlainObject(value) && value[PREVIOUSLY_CAPTURED_ERROR_KEY] === true;
}

export function markPostHogCapturedError(value: unknown): void {
  if (!isPlainObject(value) || isPreviouslyCapturedPostHogError(value)) {
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

export function isClientLogRecord(record: LogRecord): boolean {
  return getRecordType(record) === 'client_log';
}

export function normalizePostHogRecord(
  record: LogRecord,
  connector: ResolvedPostHogConnectorConfig,
  source: PostHogSource = 'server'
): PostHogNormalizedRecord {
  const severity = resolveSeverity(record.level);
  const body = typeof record.message === 'string' ? record.message : String(record.message);
  return {
    body,
    severityText: severity.text,
    severityNumber: severity.number,
    attributes: buildRecordAttributes(record, source),
    resourceAttributes: {
      'service.name': connector.serviceName,
    },
  };
}
function resolveSeverity(level: string): { text: string; number: SeverityNumber } {
  switch (level) {
    case 'debug':
      return { text: 'debug', number: SeverityNumber.DEBUG };
    case 'warning':
    case 'warn':
      return { text: 'warn', number: SeverityNumber.WARN };
    case 'error':
      return { text: 'error', number: SeverityNumber.ERROR };
    case 'critical':
      return { text: 'fatal', number: SeverityNumber.FATAL };
    case 'success':
    case 'table':
    case 'info':
    default:
      return { text: 'info', number: SeverityNumber.INFO };
  }
}

function registerShutdownHooks(key: string, shutdown: () => Promise<void>): void {
  const handlers: Array<NodeJS.Signals | 'beforeExit'> = ['beforeExit', 'SIGINT', 'SIGTERM'];

  for (const event of handlers) {
    process.once(event, () => {
      void shutdown().catch((error) => {
        warnOnce(
          `${key}:shutdown`,
          '[Blyp] Failed to flush PostHog telemetry during shutdown.',
          error
        );
      });
    });
  }
}

function createDefaultTransport(
  connector: ResolvedPostHogConnectorConfig
): PostHogLogTransport {
  const exporter = new OTLPLogExporter({
    url: `${normalizeHost(connector.host)}/i/v1/logs`,
    headers: {
      Authorization: `Bearer ${connector.projectKey}`,
    },
  });
  const provider = new LoggerProvider({
    resource: resourceFromAttributes({
      'service.name': connector.serviceName,
    }),
    processors: [new BatchLogRecordProcessor(exporter)],
  });
  const logger = provider.getLogger('blyp-posthog');

  return {
    emit(payload) {
      logger.emit({
        body: payload.body,
        severityText: payload.severityText,
        severityNumber: payload.severityNumber,
        attributes: payload.attributes as never,
      });
    },
    flush() {
      return provider.forceFlush();
    },
    shutdown() {
      return provider.shutdown();
    },
  };
}

function createDefaultExceptionClient(
  connector: ResolvedPostHogConnectorConfig
): PostHogExceptionClient {
  const client = new PostHog(connector.projectKey ?? '', {
    host: connector.host,
    enableExceptionAutocapture: connector.errorTracking.enableExceptionAutocapture,
  });

  return {
    captureException(error, distinctId, additionalProperties) {
      return client.captureExceptionImmediate(error, distinctId, additionalProperties);
    },
    shutdown() {
      return client._shutdown();
    },
  };
}

function resolveConnectorConfig(
  config: BlypConfig | ResolvedPostHogConnectorConfig | PostHogConnectorConfig
): ResolvedPostHogConnectorConfig {
  const connector = isBlypConfig(config)
    ? config.connectors?.posthog
    : config;
  const enabled = connector?.enabled ?? false;
  const projectKey = connector?.projectKey;
  const errorTrackingEnabled = connector?.errorTracking?.enabled ?? enabled;
  const errorTrackingMode = connector?.errorTracking?.mode ?? 'auto';
  const errorTrackingReady =
    enabled &&
    errorTrackingEnabled &&
    hasNonEmptyString(projectKey);

  return {
    enabled,
    mode: connector?.mode ?? 'auto',
    projectKey,
    host: normalizeHost(connector?.host),
    serviceName: connector?.serviceName ?? 'blyp-app',
    errorTracking: {
      enabled: errorTrackingEnabled,
      mode: errorTrackingMode,
      enableExceptionAutocapture:
        connector?.errorTracking?.enableExceptionAutocapture ??
        (errorTrackingMode === 'auto'),
      ready: errorTrackingReady,
      status: errorTrackingReady ? 'enabled' : 'missing',
    },
  };
}

export function createPostHogSender(
  config: BlypConfig | ResolvedPostHogConnectorConfig | PostHogConnectorConfig
): PostHogSender {
  const connector = resolveConnectorConfig(config);
  const key = `${connector.serviceName}:${connector.host}:${connector.mode}`;
  const ready =
    connector.enabled === true &&
    hasNonEmptyString(connector.projectKey);
  const transport = ready
    ? (testHooks.createTransport?.(connector) ?? createDefaultTransport(connector))
    : undefined;
  const exceptionClient = connector.errorTracking.ready
    ? (testHooks.createExceptionClient?.(connector) ?? createDefaultExceptionClient(connector))
    : undefined;

  const shutdown = async (): Promise<void> => {
    if (transport?.shutdown) {
      await transport.shutdown();
    } else if (transport?.flush) {
      await transport.flush();
    }

    if (exceptionClient?.shutdown) {
      await exceptionClient.shutdown();
    }
  };

  if (transport || exceptionClient) {
    registerShutdownHooks(key, shutdown);
  }

  const emitUnavailableWarning = (): void => {
    warnOnce(
      `posthog-unavailable:${key}`,
      '[Blyp] PostHog connector is not configured. Skipping PostHog delivery.'
    );
  };

  const emitExceptionUnavailableWarning = (): void => {
    warnOnce(
      `posthog-exception-unavailable:${key}`,
      '[Blyp] PostHog error tracking is not configured. Skipping PostHog exception capture.'
    );
  };

  return {
    enabled: connector.enabled,
    ready,
    mode: connector.mode,
    serviceName: connector.serviceName,
    host: connector.host,
    status: ready ? 'enabled' : 'missing',
    errorTracking: {
      enabled: connector.errorTracking.enabled,
      ready: connector.errorTracking.ready,
      mode: connector.errorTracking.mode,
      status: connector.errorTracking.status,
      enableExceptionAutocapture: connector.errorTracking.enableExceptionAutocapture,
    },
    shouldAutoForwardServerLogs() {
      return ready && connector.mode === 'auto';
    },
    shouldAutoCaptureExceptions() {
      return connector.errorTracking.ready && connector.errorTracking.mode === 'auto';
    },
    send(record, options = {}) {
      const source = options.source ?? 'server';

      if (!ready || !transport) {
        if (options.warnIfUnavailable) {
          emitUnavailableWarning();
        }
        return;
      }

      const normalized = normalizePostHogRecord(record, connector, source);
      try {
        const result = transport.emit(normalized);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          void (result as Promise<void>).catch((error) => {
            warnOnce(
              `posthog-emit:${key}`,
              '[Blyp] Failed to deliver log to PostHog.',
              error
            );
          });
        }
      } catch (error) {
        warnOnce(
          `posthog-emit:${key}`,
          '[Blyp] Failed to deliver log to PostHog.',
          error
        );
      }
    },
    captureException(error, options = {}) {
      if (!connector.errorTracking.ready || !exceptionClient) {
        if (options.warnIfUnavailable) {
          emitExceptionUnavailableWarning();
        }
        return;
      }

      if (isPreviouslyCapturedPostHogError(error)) {
        return;
      }

  const normalized = normalizeExceptionInput(
        error,
        options.source === 'client' ? 'Client error' : 'Server error'
      );
      const properties = {
        ...normalized.properties,
        ...(options.properties ?? {}),
        'blyp.source': options.source ?? 'server',
      };

      try {
        const result = exceptionClient.captureException(
          normalized.error,
          options.distinctId,
          properties
        );
        markPostHogCapturedError(error);
        markPostHogCapturedError(normalized.error);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          void (result as Promise<void>).catch((captureError) => {
            warnOnce(
              `posthog-capture:${key}`,
              '[Blyp] Failed to capture exception in PostHog.',
              captureError
            );
          });
        }
      } catch (captureError) {
        warnOnce(
          `posthog-capture:${key}`,
          '[Blyp] Failed to capture exception in PostHog.',
          captureError
        );
      }
    },
    async flush() {
      try {
        if (transport?.flush) {
          await transport.flush();
        }
      } catch (error) {
        warnOnce(
          `posthog-flush:${key}`,
          '[Blyp] Failed to flush PostHog telemetry.',
          error
        );
      }
    },
  };
}

export function buildPostHogExceptionProperties(
  record: LogRecord,
  source: PostHogSource,
  properties: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...createExceptionPropertiesFromRecord(record, source),
    ...properties,
  };
}

export function setPostHogTestHooks(hooks: PostHogTestHooks): void {
  testHooks = hooks;
}

export function resetPostHogTestHooks(): void {
  testHooks = {};
  warnedKeys.clear();
}
