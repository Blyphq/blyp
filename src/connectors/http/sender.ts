import type {
  BlypConfig,
  HTTPConnectorConfig,
  ResolvedHTTPConnectorConfig,
} from '../../core/config';
import type { LogRecord } from '../../core/file-logger';
import type {
  ConnectorBatchDispatchTarget,
  ConnectorDeliveryBinder,
} from '../delivery/types';
import {
  CONNECTOR_BATCH_DISPATCH,
  CONNECTOR_DELIVERY_BINDER,
  type ConnectorDispatchResult,
} from '../delivery/types';
import { createErrorOnceLogger } from '../../shared/once';
import { isAbsoluteHttpUrl } from '../../shared/validation';
import type {
  HTTPLogSource,
  HTTPMetadata,
  HTTPNormalizedRecord,
  HTTPRegistry,
  HTTPSendOptions,
  HTTPSender,
  HTTPTestHooks,
  HTTPTransport,
  HTTPTransportResult,
} from '../../types/connectors/http';
import {
  getClientPageField,
  getClientSessionField,
  getField,
  getRecordType,
  isBlypConfig,
} from '../shared';

const warnedKeys = new Set<string>();
let testHooks: HTTPTestHooks = {};
const warnOnce = createErrorOnceLogger(warnedKeys);

export function normalizeHTTPRecord(
  record: LogRecord,
  connector: ResolvedHTTPConnectorConfig,
  source: HTTPLogSource = 'server'
): HTTPNormalizedRecord {
  const recordType = getRecordType(record);
  const caller = typeof record.caller === 'string' ? record.caller : undefined;
  const groupId = getField<string>(record, 'groupId');
  const traceId = getField<string>(record, 'traceId');
  const method = getField<string>(record, 'method');
  const path = getField<string>(record, 'path');
  const status = getField<number>(record, 'status');
  const duration = getField<number>(record, 'duration');
  const pagePath = getClientPageField(record, 'pathname');
  const pageUrl = getClientPageField(record, 'url');
  const sessionId = getClientSessionField(record, 'sessionId');
  const pageId = getClientSessionField(record, 'pageId');

  const metadata: HTTPMetadata = {};
  const httpMetadata: NonNullable<HTTPMetadata['http']> = {};
  const clientMetadata: NonNullable<HTTPMetadata['client']> = {};

  if (recordType) {
    metadata.type = recordType;
  }
  if (caller) {
    metadata.caller = caller;
  }
  if (groupId) {
    metadata.groupId = groupId;
  }
  if (traceId) {
    metadata.traceId = traceId;
  }

  if (method) {
    httpMetadata.method = method;
  }
  if (path) {
    httpMetadata.path = path;
  }
  if (status !== undefined) {
    httpMetadata.statusCode = status;
  }
  if (duration !== undefined) {
    httpMetadata.durationMs = duration;
  }
  if (Object.keys(httpMetadata).length > 0) {
    metadata.http = httpMetadata;
  }

  if (pagePath) {
    clientMetadata.pagePath = pagePath;
  }
  if (pageUrl) {
    clientMetadata.pageUrl = pageUrl;
  }
  if (sessionId) {
    clientMetadata.sessionId = sessionId;
  }
  if (pageId) {
    clientMetadata.pageId = pageId;
  }
  if (Object.keys(clientMetadata).length > 0) {
    metadata.client = clientMetadata;
  }

  return {
    timestamp: record.timestamp,
    level: record.level,
    message: typeof record.message === 'string' ? record.message : String(record.message),
    source,
    serviceName: connector.serviceName,
    target: connector.name,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    payload: record,
  };
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
          '[Blyp] Failed to flush HTTP logs during shutdown.',
          error
        );
      }
      if (event !== 'beforeExit') {
        process.exit(0);
      }
    });
  }
}

function findHeaderKey(
  headers: Record<string, string>,
  name: string
): string | undefined {
  const normalized = name.toLowerCase();
  return Object.keys(headers).find((key) => key.toLowerCase() === normalized);
}

function deleteHeader(
  headers: Record<string, string>,
  name: string
): void {
  const key = findHeaderKey(headers, name);
  if (key) {
    delete headers[key];
  }
}

function resolveTransportHeaders(
  connector: ResolvedHTTPConnectorConfig
): Record<string, string> {
  const headers = {
    ...(connector.headers ?? {}),
  };

  if (findHeaderKey(headers, 'Authorization') === undefined && connector.auth) {
    headers.Authorization = connector.auth;
  }

  deleteHeader(headers, 'content-type');
  deleteHeader(headers, 'accept');

  headers.Accept = 'application/json';
  headers['Content-Type'] = 'application/json';

  return headers;
}

function getDefaultFetch(): typeof fetch | undefined {
  return typeof globalThis.fetch === 'function'
    ? globalThis.fetch.bind(globalThis)
    : undefined;
}

function createDefaultTransport(
  connector: ResolvedHTTPConnectorConfig
): HTTPTransport {
  const headers = resolveTransportHeaders(connector);

  return {
    async emit(payload: HTTPNormalizedRecord): Promise<HTTPTransportResult> {
      const fetchImpl = getDefaultFetch();
      if (!fetchImpl) {
        return {
          ok: false,
          retryable: false,
          error: 'Global fetch is not available for HTTP connector delivery.',
        };
      }

      try {
        const response = await fetchImpl(connector.endpoint ?? '', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          return {
            ok: true,
            status: response.status,
          };
        }

        const retryable = response.status === 429 || response.status >= 500;

        return {
          ok: false,
          retryable,
          status: response.status,
          error: `HTTP ${response.status}`,
        };
      } catch (error) {
        return {
          ok: false,
          retryable: true,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function resolveConnectors(
  config: BlypConfig | ResolvedHTTPConnectorConfig[] | HTTPConnectorConfig[]
): ResolvedHTTPConnectorConfig[] {
  const connectors = isBlypConfig(config)
    ? (config.connectors?.http ?? [])
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
  connector?: Partial<ResolvedHTTPConnectorConfig>
): HTTPSender {
  const senderName = name || connector?.name || 'http';
  const key = `${senderName}:${connector?.serviceName ?? 'blyp-app'}:${connector?.endpoint ?? 'missing'}`;

  const emitUnavailableWarning = (): void => {
    warnOnce(
      `http-unavailable:${key}`,
      `[Blyp] HTTP target "${senderName}" is not configured or not ready. Skipping HTTP delivery.`
    );
  };

  const sender = {
    name: senderName,
    enabled: connector?.enabled ?? false,
    ready: false,
    mode: connector?.mode ?? 'auto',
    serviceName: connector?.serviceName ?? 'blyp-app',
    endpoint: connector?.endpoint,
    status: 'missing',
    send(_record: LogRecord, options: HTTPSendOptions = {}) {
      if (options.warnIfUnavailable) {
        emitUnavailableWarning();
      }
    },
    async flush() {},
    [CONNECTOR_BATCH_DISPATCH]: {
      dispatchKey: `http:${senderName}`,
      dispatch: async () => ({
        ok: false,
        retryable: false,
        error: `HTTP target "${senderName}" is unavailable.`,
      }),
    },
    [CONNECTOR_DELIVERY_BINDER](_binder: ConnectorDeliveryBinder | null) {},
  } as HTTPSender & ConnectorBatchDispatchTarget;

  return sender;
}

function createSender(connector: ResolvedHTTPConnectorConfig): HTTPSender {
  if (!connector.ready || !connector.endpoint) {
    return createUnavailableSender(connector.name, connector);
  }

  const key = `${connector.name}:${connector.serviceName}:${connector.endpoint}:${connector.mode}`;
  const transportConnector: ResolvedHTTPConnectorConfig = {
    ...connector,
    headers: resolveTransportHeaders(connector),
  };
  const transport =
    testHooks.createTransport?.(transportConnector) ??
    createDefaultTransport(transportConnector);

  let deliveryBinder: ConnectorDeliveryBinder | null = null;

  const dispatchBatch = async (records: LogRecord[]): Promise<ConnectorDispatchResult> => {
    for (const record of records) {
      const result = await Promise.resolve(
        transport.emit(normalizeHTTPRecord(record, connector, 'server'))
      ).catch((error) => ({
        ok: false,
        retryable: true,
        status: undefined,
        error: error instanceof Error ? error.message : String(error),
      } satisfies HTTPTransportResult));

      if (!result.ok) {
        return {
          ok: false,
          retryable: result.retryable ?? false,
          status: result.status,
          error: result.error,
        };
      }
    }

    if (transport.flush) {
      try {
        await transport.flush();
      } catch (error) {
        return {
          ok: false,
          retryable: true,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return { ok: true };
  };

  const sender = {
    name: connector.name,
    enabled: connector.enabled,
    ready: connector.ready,
    mode: connector.mode,
    serviceName: connector.serviceName,
    endpoint: connector.endpoint,
    status: connector.status,
    send(record: LogRecord, options: HTTPSendOptions = {}) {
      if ((options.source ?? 'server') !== 'client' && deliveryBinder) {
        deliveryBinder.enqueue('http', record, sender[CONNECTOR_BATCH_DISPATCH]!, connector.name);
        return;
      }

      const source = options.source ?? 'server';
      const normalized = normalizeHTTPRecord(record, connector, source);

      void Promise.resolve(transport.emit(normalized))
        .then(async (result) => {
          if (!result.ok) {
            warnOnce(
              `http-emit:${key}:${result.status ?? result.error ?? 'unknown'}`,
              `[Blyp] Failed to deliver log to HTTP target "${connector.name}" (${connector.endpoint}).`,
              result.error ?? result.status
            );
            return;
          }

          if (transport.flush) {
            await transport.flush();
          }
        })
        .catch((error) => {
          warnOnce(
            `http-emit:${key}`,
            `[Blyp] Failed to deliver log to HTTP target "${connector.name}" (${connector.endpoint}).`,
            error
          );
        });
    },
    async flush() {
      try {
        if (transport.flush) {
          await transport.flush();
        }
      } catch (error) {
        warnOnce(
          `http-flush:${key}`,
          `[Blyp] Failed to flush HTTP logs for target "${connector.name}".`,
          error
        );
      }
    },
    [CONNECTOR_BATCH_DISPATCH]: {
      dispatchKey: `http:${connector.name}`,
      dispatch: (records) => dispatchBatch(records),
    },
    [CONNECTOR_DELIVERY_BINDER](binder: ConnectorDeliveryBinder | null) {
      deliveryBinder = binder;
    },
  } as HTTPSender & ConnectorBatchDispatchTarget;

  return sender;
}

export function createHTTPRegistry(
  config: BlypConfig | ResolvedHTTPConnectorConfig[] | HTTPConnectorConfig[]
): HTTPRegistry {
  const senders = new Map<string, HTTPSender>();

  for (const connector of resolveConnectors(config)) {
    senders.set(connector.name, createSender(connector));
  }

  const registry: HTTPRegistry = {
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

  registerShutdownHooks('http-registry', () => registry.flush());

  return registry;
}

export function setHTTPTestHooks(hooks: HTTPTestHooks): void {
  testHooks = hooks;
}

export function resetHTTPTestHooks(): void {
  testHooks = {};
  warnedKeys.clear();
}
