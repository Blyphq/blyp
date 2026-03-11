import { SeverityNumber } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from '@opentelemetry/sdk-logs';
import type {
  BlypConfig,
  OTLPConnectorConfig,
  ResolvedOTLPConnectorConfig,
} from './config';
import type { LogRecord } from './file-logger';
import { serializeLogRecord } from './file-logger';

type OTLPLogSource = 'server' | 'client';

interface OTLPTransport {
  emit: (payload: OTLPNormalizedRecord) => void | Promise<void>;
  flush?: () => Promise<void>;
  shutdown?: () => Promise<void>;
}

interface OTLPSendOptions {
  source?: OTLPLogSource;
  warnIfUnavailable?: boolean;
}

export interface OTLPNormalizedRecord {
  body: string;
  severityText: string;
  severityNumber: SeverityNumber;
  attributes: Record<string, unknown>;
  resourceAttributes: {
    'service.name': string;
  };
}

export interface OTLPSender {
  readonly name: string;
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly mode: 'auto' | 'manual';
  readonly serviceName: string;
  readonly endpoint?: string;
  readonly status: 'enabled' | 'missing';
  send: (record: LogRecord, options?: OTLPSendOptions) => void;
  flush: () => Promise<void>;
}

export interface OTLPRegistry {
  get: (name: string) => OTLPSender;
  getAutoForwardTargets: () => OTLPSender[];
  send: (name: string, record: LogRecord, options?: OTLPSendOptions) => void;
  flush: () => Promise<void>;
}

interface OTLPTestHooks {
  createTransport?: (
    config: ResolvedOTLPConnectorConfig
  ) => OTLPTransport;
}

const warnedKeys = new Set<string>();
let testHooks: OTLPTestHooks = {};

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

function isBlypConfig(
  config: BlypConfig | ResolvedOTLPConnectorConfig[] | OTLPConnectorConfig[]
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

export function normalizeOTLPRecord(
  record: LogRecord,
  connector: ResolvedOTLPConnectorConfig,
  source: OTLPLogSource = 'server'
): OTLPNormalizedRecord {
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
          '[Blyp] Failed to flush OTLP logs during shutdown.',
          error
        );
      });
    });
  }
}

function resolveTransportHeaders(
  connector: ResolvedOTLPConnectorConfig
): Record<string, string> {
  const headers = {
    ...(connector.headers ?? {}),
  };

  if (headers.Authorization === undefined && connector.auth) {
    headers.Authorization = connector.auth;
  }

  return headers;
}

function createDefaultTransport(
  connector: ResolvedOTLPConnectorConfig
): OTLPTransport {
  const exporter = new OTLPLogExporter({
    url: connector.endpoint,
    headers: resolveTransportHeaders(connector),
  });
  const provider = new LoggerProvider({
    resource: resourceFromAttributes({
      'service.name': connector.serviceName,
    }),
    processors: [new BatchLogRecordProcessor(exporter)],
  });
  const logger = provider.getLogger(`blyp-otlp:${connector.name}`);

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

function resolveConnectors(
  config: BlypConfig | ResolvedOTLPConnectorConfig[] | OTLPConnectorConfig[]
): ResolvedOTLPConnectorConfig[] {
  const connectors = isBlypConfig(config)
    ? (config.connectors?.otlp ?? [])
    : config;

  return connectors.map((connector) => {
    const headers = {
      ...(connector.headers ?? {}),
    };
    const enabled = connector.enabled ?? false;
    const endpoint = connector.endpoint;
    const explicitReady =
      'ready' in connector && typeof connector.ready === 'boolean'
        ? connector.ready
        : undefined;
    const ready =
      (explicitReady ?? (enabled && isAbsoluteHttpUrl(endpoint))) &&
      isAbsoluteHttpUrl(endpoint);

    return {
      name: connector.name,
      enabled,
      mode: connector.mode ?? 'auto',
      endpoint,
      headers,
      auth: connector.auth,
      serviceName: connector.serviceName ?? 'blyp-app',
      ready,
      status: ready ? 'enabled' : 'missing',
    };
  });
}

function createUnavailableSender(
  name: string,
  connector?: Partial<ResolvedOTLPConnectorConfig>
): OTLPSender {
  const senderName = name || connector?.name || 'otlp';
  const key = `${senderName}:${connector?.serviceName ?? 'blyp-app'}:${connector?.endpoint ?? 'missing'}`;

  const emitUnavailableWarning = (): void => {
    warnOnce(
      `otlp-unavailable:${key}`,
      `[Blyp] OTLP target "${senderName}" is not configured or not ready. Skipping OTLP delivery.`
    );
  };

  return {
    name: senderName,
    enabled: connector?.enabled ?? false,
    ready: false,
    mode: connector?.mode ?? 'auto',
    serviceName: connector?.serviceName ?? 'blyp-app',
    endpoint: connector?.endpoint,
    status: 'missing',
    send(_record, options = {}) {
      if (options.warnIfUnavailable) {
        emitUnavailableWarning();
      }
    },
    async flush() {},
  };
}

function createSender(connector: ResolvedOTLPConnectorConfig): OTLPSender {
  if (!connector.ready || !connector.endpoint) {
    return createUnavailableSender(connector.name, connector);
  }

  const key = `${connector.name}:${connector.serviceName}:${connector.endpoint}:${connector.mode}`;
  const transportConnector: ResolvedOTLPConnectorConfig = {
    ...connector,
    headers: resolveTransportHeaders(connector),
  };
  const transport =
    testHooks.createTransport?.(transportConnector) ??
    createDefaultTransport(transportConnector);

  if (transport.shutdown) {
    registerShutdownHooks(key, transport.shutdown);
  } else if (transport.flush) {
    registerShutdownHooks(key, transport.flush);
  }

  return {
    name: connector.name,
    enabled: connector.enabled,
    ready: connector.ready,
    mode: connector.mode,
    serviceName: connector.serviceName,
    endpoint: connector.endpoint,
    status: connector.status,
    send(record, options = {}) {
      const source = options.source ?? 'server';
      const normalized = normalizeOTLPRecord(record, connector, source);

      try {
        const result = transport.emit(normalized);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          void (result as Promise<void>).catch((error) => {
            warnOnce(
              `otlp-emit:${key}`,
              `[Blyp] Failed to deliver log to OTLP target "${connector.name}".`,
              error
            );
          });
        }
      } catch (error) {
        warnOnce(
          `otlp-emit:${key}`,
          `[Blyp] Failed to deliver log to OTLP target "${connector.name}".`,
          error
        );
      }
    },
    async flush() {
      try {
        if (transport.flush) {
          await transport.flush();
        }
      } catch (error) {
        warnOnce(
          `otlp-flush:${key}`,
          `[Blyp] Failed to flush OTLP logs for target "${connector.name}".`,
          error
        );
      }
    },
  };
}

export function createOTLPRegistry(
  config: BlypConfig | ResolvedOTLPConnectorConfig[] | OTLPConnectorConfig[]
): OTLPRegistry {
  const senders = new Map<string, OTLPSender>();

  for (const connector of resolveConnectors(config)) {
    senders.set(connector.name, createSender(connector));
  }

  return {
    get(name: string) {
      return senders.get(name) ?? createUnavailableSender(name);
    },
    getAutoForwardTargets() {
      return Array.from(senders.values()).filter((sender) => sender.ready && sender.mode === 'auto');
    },
    send(name, record, options = {}) {
      const sender = senders.get(name) ?? createUnavailableSender(name);
      sender.send(record, options);
    },
    async flush() {
      await Promise.all(Array.from(senders.values()).map((sender) => sender.flush()));
    },
  };
}

export function setOTLPTestHooks(hooks: OTLPTestHooks): void {
  testHooks = hooks;
}

export function resetOTLPTestHooks(): void {
  testHooks = {};
  warnedKeys.clear();
}
