import { SeverityNumber } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from '@opentelemetry/sdk-logs';
import type {
  BlypConfig,
  PostHogConnectorConfig,
  ResolvedPostHogConnectorConfig,
} from './config';
import type { LogRecord } from './file-logger';
import { serializeLogRecord } from './file-logger';

type PostHogLogSource = 'server' | 'client';

interface PostHogTransport {
  emit: (payload: PostHogNormalizedRecord) => void | Promise<void>;
  flush?: () => Promise<void>;
  shutdown?: () => Promise<void>;
}

interface PostHogSendOptions {
  source?: PostHogLogSource;
  warnIfUnavailable?: boolean;
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
  shouldAutoForwardServerLogs: () => boolean;
  send: (record: LogRecord, options?: PostHogSendOptions) => void;
  flush: () => Promise<void>;
}

interface PostHogTestHooks {
  createTransport?: (
    config: ResolvedPostHogConnectorConfig
  ) => PostHogTransport;
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

export function isClientLogRecord(record: LogRecord): boolean {
  return getRecordType(record) === 'client_log';
}

export function normalizePostHogRecord(
  record: LogRecord,
  connector: ResolvedPostHogConnectorConfig,
  source: PostHogLogSource = 'server'
): PostHogNormalizedRecord {
  const severity = resolveSeverity(record.level);
  const body = typeof record.message === 'string' ? record.message : String(record.message);
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

  return {
    body,
    severityText: severity.text,
    severityNumber: severity.number,
    attributes,
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
          '[Blyp] Failed to flush PostHog logs during shutdown.',
          error
        );
      });
    });
  }
}

function createDefaultTransport(
  connector: ResolvedPostHogConnectorConfig
): PostHogTransport {
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

function resolveConnectorConfig(
  config: BlypConfig | ResolvedPostHogConnectorConfig | PostHogConnectorConfig
): ResolvedPostHogConnectorConfig {
  const connector = isBlypConfig(config)
    ? config.connectors?.posthog
    : config;

  return {
    enabled: connector?.enabled ?? false,
    mode: connector?.mode ?? 'auto',
    projectKey: connector?.projectKey,
    host: normalizeHost(connector?.host),
    serviceName: connector?.serviceName ?? 'blyp-app',
  };
}

export function createPostHogSender(
  config: BlypConfig | ResolvedPostHogConnectorConfig | PostHogConnectorConfig
): PostHogSender {
  const connector = resolveConnectorConfig(config);
  const key = `${connector.serviceName}:${connector.host}:${connector.mode}`;
  const ready =
    connector.enabled === true &&
    typeof connector.projectKey === 'string' &&
    connector.projectKey.trim().length > 0;
  const transport = ready
    ? (testHooks.createTransport?.(connector) ?? createDefaultTransport(connector))
    : undefined;

  if (transport?.shutdown) {
    registerShutdownHooks(key, transport.shutdown);
  } else if (transport?.flush) {
    registerShutdownHooks(key, transport.flush);
  }

  const emitUnavailableWarning = (): void => {
    warnOnce(
      `posthog-unavailable:${key}`,
      '[Blyp] PostHog connector is not configured. Skipping PostHog delivery.'
    );
  };

  return {
    enabled: connector.enabled,
    ready,
    mode: connector.mode,
    serviceName: connector.serviceName,
    host: connector.host,
    status: ready ? 'enabled' : 'missing',
    shouldAutoForwardServerLogs() {
      return ready && connector.mode === 'auto';
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
    async flush() {
      try {
        if (transport?.flush) {
          await transport.flush();
        }
      } catch (error) {
        warnOnce(
          `posthog-flush:${key}`,
          '[Blyp] Failed to flush PostHog logs.',
          error
        );
      }
    },
  };
}

export function setPostHogTestHooks(hooks: PostHogTestHooks): void {
  testHooks = hooks;
}

export function resetPostHogTestHooks(): void {
  testHooks = {};
  warnedKeys.clear();
}
