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
} from './config';
import type { LogRecord } from './file-logger';
import { serializeLogRecord } from './file-logger';
import { normalizeLogValue } from '../shared/log-value';

type PostHogSource = 'server' | 'client';

const PREVIOUSLY_CAPTURED_ERROR_KEY = '__posthog_previously_captured_error';

interface PostHogLogTransport {
  emit: (payload: PostHogNormalizedRecord) => void | Promise<void>;
  flush?: () => Promise<void>;
  shutdown?: () => Promise<void>;
}

interface PostHogExceptionClient {
  captureException: (
    error: unknown,
    distinctId?: string,
    additionalProperties?: Record<string | number, unknown>
  ) => void | Promise<void>;
  shutdown?: () => Promise<void>;
}

interface PostHogSendOptions {
  source?: PostHogSource;
  warnIfUnavailable?: boolean;
}

export interface PostHogCaptureExceptionOptions {
  source?: PostHogSource;
  warnIfUnavailable?: boolean;
  distinctId?: string;
  properties?: Record<string, unknown>;
}

export interface PostHogNormalizedRecord {
  body: string;
  severityText: string;
  severityNumber: SeverityNumber;
  attributes: Record<string, unknown>;
  resourceAttributes: {
    'service.name': string;
  };
}

export interface PostHogSender {
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly mode: 'auto' | 'manual';
  readonly serviceName: string;
  readonly host: string;
  readonly status: 'enabled' | 'missing';
  readonly errorTracking: {
    enabled: boolean;
    ready: boolean;
    mode: 'auto' | 'manual';
    status: 'enabled' | 'missing';
    enableExceptionAutocapture: boolean;
  };
  shouldAutoForwardServerLogs: () => boolean;
  shouldAutoCaptureExceptions: () => boolean;
  send: (record: LogRecord, options?: PostHogSendOptions) => void;
  captureException: (
    error: unknown,
    options?: PostHogCaptureExceptionOptions
  ) => void;
  flush: () => Promise<void>;
}

interface PostHogTestHooks {
  createTransport?: (
    config: ResolvedPostHogConnectorConfig
  ) => PostHogLogTransport;
  createExceptionClient?: (
    config: ResolvedPostHogConnectorConfig
  ) => PostHogExceptionClient;
}

interface NormalizedException {
  error: Error;
  properties: Record<string, unknown>;
}

const warnedKeys = new Set<string>();
let testHooks: PostHogTestHooks = {};

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

function hasString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeHost(host: string | undefined): string {
  const trimmed = (host || 'https://us.i.posthog.com').trim();
  return trimmed.replace(/\/+$/, '');
}

function isBlypConfig(
  config: BlypConfig | ResolvedPostHogConnectorConfig | PostHogConnectorConfig
): config is BlypConfig {
  return 'connectors' in config || 'pretty' in config || 'level' in config;
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

function normalizeExceptionProperties(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
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
  const name = hasString(source.name) ? source.name : 'Error';
  error.name = name;

  if (hasString(source.stack)) {
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
): NormalizedException {
  if (input instanceof Error) {
    return {
      error: input,
      properties: normalizeExceptionProperties(input as unknown as Record<string, unknown>),
    };
  }

  if (isRecord(input)) {
    const message = hasString(input.message)
      ? input.message
      : hasString(input.error)
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
  return isRecord(value) && value[PREVIOUSLY_CAPTURED_ERROR_KEY] === true;
}

export function markPostHogCapturedError(value: unknown): void {
  if (!isRecord(value) || isPreviouslyCapturedPostHogError(value)) {
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
  const recordType = getRecordType(record);
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
    hasString(projectKey);

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
    hasString(connector.projectKey);
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
