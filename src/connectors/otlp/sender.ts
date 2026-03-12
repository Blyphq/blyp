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
} from '../../core/config';
import type { LogRecord } from '../../core/file-logger';
import { serializeLogRecord } from '../../core/file-logger';
import { createErrorOnceLogger } from '../../shared/once';
import { isAbsoluteHttpUrl } from '../../shared/validation';
import type {
  OTLPLogSource,
  OTLPNormalizedRecord,
  OTLPRegistry,
  OTLPSender,
  OTLPTestHooks,
  OTLPTransport,
} from '../../types/connectors/otlp';
import {
  getClientPageField,
  getClientSessionField,
  getField,
  getRecordType,
  isBlypConfig,
} from '../shared';

const warnedKeys = new Set<string>();
let testHooks: OTLPTestHooks = {};
const warnOnce = createErrorOnceLogger(warnedKeys);

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
    process.once(event, async () => {
      try {
        await shutdown();
      } catch (error) {
        warnOnce(
          `${key}:shutdown`,
          '[Blyp] Failed to flush OTLP logs during shutdown.',
          error
        );
      }
      if (event !== 'beforeExit') {
        process.exit(0);
      }
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

  const registry: OTLPRegistry = {
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

  registerShutdownHooks('otlp-registry', () => registry.flush());

  return registry;
}

export function setOTLPTestHooks(hooks: OTLPTestHooks): void {
  testHooks = hooks;
}

export function resetOTLPTestHooks(): void {
  testHooks = {};
  warnedKeys.clear();
}
