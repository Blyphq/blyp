import { Databuddy } from '@databuddy/sdk/node';
import type {
  BlypConfig,
  DatabuddyConnectorConfig,
  ResolvedDatabuddyConnectorConfig,
} from '../../core/config';
import type { LogRecord } from '../../core/file-logger';
import { serializeLogRecord } from '../../core/file-logger';
import type {
  ConnectorBatchDispatchTarget,
  ConnectorDeliveryBinder,
} from '../delivery/types';
import {
  CONNECTOR_BATCH_DISPATCH,
  CONNECTOR_DELIVERY_BINDER,
  type ConnectorDispatchResult,
} from '../delivery/types';
import { normalizeLogValue } from '../../shared/log-value';
import { createErrorOnceLogger } from '../../shared/once';
import { hasNonEmptyString, isPlainObject } from '../../shared/validation';
import type {
  DatabuddyCaptureExceptionOptions,
  DatabuddyClientLike,
  DatabuddySender,
  DatabuddySource,
  DatabuddyTestHooks,
  DatabuddyTrackEvent,
} from '../../types/connectors/databuddy';
import {
  getClientPageField,
  getClientSessionField,
  getField,
  getPrimaryPayload,
  getRecordType,
  isBlypConfig,
} from '../shared';

const warnedKeys = new Set<string>();
const senderCache = new Map<string, DatabuddySender>();
let testHooks: DatabuddyTestHooks = {};
const warnOnce = createErrorOnceLogger(warnedKeys);

function registerShutdownHooks(key: string, shutdown: () => Promise<void>): void {
  const handlers: Array<NodeJS.Signals | 'beforeExit'> = ['beforeExit', 'SIGINT', 'SIGTERM'];

  for (const event of handlers) {
    process.once(event, () => {
      void shutdown().catch((error) => {
        warnOnce(
          `${key}:shutdown`,
          '[Blyp] Failed to flush Databuddy telemetry during shutdown.',
          error
        );
      });
    });
  }
}

function resolveConnectorConfig(
  config: BlypConfig | ResolvedDatabuddyConnectorConfig | DatabuddyConnectorConfig
): ResolvedDatabuddyConnectorConfig {
  const connector = isBlypConfig(config)
    ? config.connectors?.databuddy
    : config;
  const enabled = connector?.enabled ?? false;
  const apiKey = connector?.apiKey;
  const websiteId = connector?.websiteId;
  const ready = enabled && hasNonEmptyString(apiKey) && hasNonEmptyString(websiteId);

  return {
    enabled,
    mode: connector?.mode ?? 'auto',
    apiKey,
    websiteId,
    namespace: connector?.namespace,
    source: connector?.source,
    apiUrl: connector?.apiUrl,
    debug: connector?.debug ?? false,
    enableBatching: connector?.enableBatching ?? true,
    batchSize: connector?.batchSize,
    batchTimeout: connector?.batchTimeout,
    maxQueueSize: connector?.maxQueueSize,
    ready,
    status: ready ? 'enabled' : 'missing',
  };
}

function createDefaultClient(
  connector: ResolvedDatabuddyConnectorConfig
): DatabuddyClientLike {
  return new Databuddy({
    apiKey: connector.apiKey ?? '',
    ...(connector.websiteId ? { websiteId: connector.websiteId } : {}),
    ...(connector.namespace ? { namespace: connector.namespace } : {}),
    ...(connector.source ? { source: connector.source } : {}),
    ...(connector.apiUrl ? { apiUrl: connector.apiUrl } : {}),
    debug: connector.debug,
    enableBatching: connector.enableBatching,
    ...(connector.batchSize !== undefined ? { batchSize: connector.batchSize } : {}),
    ...(connector.batchTimeout !== undefined ? { batchTimeout: connector.batchTimeout } : {}),
    ...(connector.maxQueueSize !== undefined ? { maxQueueSize: connector.maxQueueSize } : {}),
  });
}

function getDatabuddySenderKey(
  connector: ResolvedDatabuddyConnectorConfig
): string {
  return JSON.stringify({
    enabled: connector.enabled,
    mode: connector.mode,
    apiKey: connector.apiKey ?? null,
    websiteId: connector.websiteId ?? null,
    namespace: connector.namespace ?? null,
    source: connector.source ?? null,
    apiUrl: connector.apiUrl ?? null,
    debug: connector.debug,
    enableBatching: connector.enableBatching,
    batchSize: connector.batchSize ?? null,
    batchTimeout: connector.batchTimeout ?? null,
    maxQueueSize: connector.maxQueueSize ?? null,
  });
}

function getSessionId(record: LogRecord): string | undefined {
  const direct = getField<string>(record, 'sessionId');
  if (hasNonEmptyString(direct)) {
    return direct;
  }

  return getClientSessionField(record, 'sessionId');
}

function getAnonymousId(record: LogRecord): string | undefined {
  const direct = getField<string>(record, 'anonymousId');
  if (hasNonEmptyString(direct)) {
    return direct;
  }

  const payload = getPrimaryPayload(record);
  if (isPlainObject(payload.metadata) && hasNonEmptyString(payload.metadata.databuddyAnonymousId)) {
    return payload.metadata.databuddyAnonymousId;
  }

  return undefined;
}

function getDatabuddyEventName(record: LogRecord): string {
  const recordType = getRecordType(record);
  if (hasNonEmptyString(recordType)) {
    return recordType;
  }

  return 'log';
}

function buildRecordProperties(
  record: LogRecord,
  source: DatabuddySource
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    blyp_level: record.level,
    blyp_source: source,
    blyp_payload: serializeLogRecord(record),
    message: typeof record.message === 'string' ? record.message : String(record.message),
  };

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

  const ifTruthy: Array<[string, unknown]> = [
    ['blyp_type', getRecordType(record)],
    ['caller', caller],
    ['group_id', groupId],
    ['trace_id', traceId],
    ['method', method],
    ['path', path],
    ['page_path', pagePath],
    ['page_url', pageUrl],
    ['session_id', sessionId],
    ['page_id', pageId],
  ];
  const ifDefined: Array<[string, unknown]> = [
    ['status_code', status],
    ['duration_ms', duration],
  ];

  for (const [key, value] of ifTruthy) {
    if (value) {
      properties[key] = value;
    }
  }

  for (const [key, value] of ifDefined) {
    if (value !== undefined) {
      properties[key] = value;
    }
  }

  return properties;
}

function createTrackEvent(
  record: LogRecord,
  source: DatabuddySource
): DatabuddyTrackEvent {
  return {
    name: getDatabuddyEventName(record),
    anonymousId: getAnonymousId(record),
    sessionId: getSessionId(record),
    properties: buildRecordProperties(record, source),
  };
}

function normalizeExceptionProperties(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    return {};
  }

  return normalizeLogValue(value) as Record<string, unknown>;
}

function normalizeExceptionInput(
  value: unknown,
  fallbackMessage: string
): { message: string; properties: Record<string, unknown> } {
  if (value instanceof Error) {
    return {
      message: value.message || fallbackMessage,
      properties: {
        error_type: value.name,
        ...(value.stack ? { stack: value.stack } : {}),
        ...normalizeExceptionProperties(value as unknown as Record<string, unknown>),
      },
    };
  }

  if (isPlainObject(value)) {
    const message = hasNonEmptyString(value.message)
      ? value.message
      : hasNonEmptyString(value.error)
        ? value.error
        : fallbackMessage;

    return {
      message,
      properties: normalizeExceptionProperties(value),
    };
  }

  if (typeof value === 'string') {
    return {
      message: value,
      properties: {
        message: value,
      },
    };
  }

  return {
    message: fallbackMessage,
    properties: {
      value: normalizeLogValue(value),
    },
  };
}

function getResolvedFailureMessage(result: unknown): string | null {
  if (!isPlainObject(result) || result.success !== false) {
    return null;
  }

  if (hasNonEmptyString(result.error)) {
    return result.error;
  }

  if (hasNonEmptyString(result.message)) {
    return result.message;
  }

  return 'Databuddy SDK reported delivery failure.';
}

export function createDatabuddySender(
  config: BlypConfig | ResolvedDatabuddyConnectorConfig | DatabuddyConnectorConfig
): DatabuddySender {
  const connector = resolveConnectorConfig(config);
  const senderKey = getDatabuddySenderKey(connector);
  const cached = senderCache.get(senderKey);

  if (cached) {
    return cached;
  }

  const key = `${connector.apiUrl ?? 'default'}:${connector.mode}:${connector.apiKey ?? 'missing'}`;
  const client = connector.ready
    ? (testHooks.createClient?.(connector) ?? createDefaultClient(connector))
    : undefined;

  if (client) {
    registerShutdownHooks(key, async () => {
      await client.flush();
    });
  }

  const emitUnavailableWarning = (): void => {
    warnOnce(
      `databuddy-unavailable:${key}`,
      '[Blyp] Databuddy connector is not configured. Databuddy requires both apiKey and websiteId. Skipping Databuddy delivery.'
    );
  };

  const emitExceptionUnavailableWarning = (): void => {
    warnOnce(
      `databuddy-exception-unavailable:${key}`,
      '[Blyp] Databuddy error tracking is not configured. Databuddy requires both apiKey and websiteId. Skipping Databuddy exception capture.'
    );
  };

  let deliveryBinder: ConnectorDeliveryBinder | null = null;

  const dispatchBatch = async (records: LogRecord[]): Promise<ConnectorDispatchResult> => {
    if (!connector.ready || !client) {
      return {
        ok: false,
        retryable: false,
        error: 'Databuddy connector is not configured.',
      };
    }

    try {
      const trackResults = await Promise.all(records.map((record) => {
        return Promise.resolve(client.track(createTrackEvent(record, 'server')));
      }));
      for (const result of trackResults) {
        const failureMessage = getResolvedFailureMessage(result);
        if (failureMessage) {
          return {
            ok: false,
            retryable: true,
            error: failureMessage,
          };
        }
      }

      const flushResult = await client.flush();
      const flushFailure = getResolvedFailureMessage(flushResult);
      if (flushFailure) {
        return {
          ok: false,
          retryable: true,
          error: flushFailure,
        };
      }

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const sender = {
    enabled: connector.enabled,
    ready: connector.ready,
    mode: connector.mode,
    status: connector.status,
    shouldAutoForwardServerLogs() {
      return connector.ready && connector.mode === 'auto';
    },
    shouldAutoCaptureExceptions() {
      return connector.ready && connector.mode === 'auto';
    },
    send(record, options = {}) {
      if (options.source !== 'client' && deliveryBinder) {
        deliveryBinder.enqueue('databuddy', record, sender[CONNECTOR_BATCH_DISPATCH]!);
        return;
      }

      if (!connector.ready || !client) {
        if (options.warnIfUnavailable) {
          emitUnavailableWarning();
        }
        return;
      }

      try {
        const result = client.track(createTrackEvent(record, options.source ?? 'server'));
        if (result && typeof (result as Promise<void>).catch === 'function') {
          void (result as Promise<void>).catch((error) => {
            warnOnce(
              `databuddy-send:${key}`,
              '[Blyp] Failed to deliver log to Databuddy.',
              error
            );
          });
        }
      } catch (error) {
        warnOnce(
          `databuddy-send:${key}`,
          '[Blyp] Failed to deliver log to Databuddy.',
          error
        );
      }
    },
    captureException(error, options: DatabuddyCaptureExceptionOptions = {}) {
      if (!connector.ready || !client) {
        if (options.warnIfUnavailable) {
          emitExceptionUnavailableWarning();
        }
        return;
      }

      const normalized = normalizeExceptionInput(
        error,
        options.source === 'client' ? 'Client error' : 'Server error'
      );

      try {
        const result = client.track({
          name: 'error',
          anonymousId: options.anonymousId,
          sessionId: options.sessionId,
          properties: {
            message: normalized.message,
            blyp_source: options.source ?? 'server',
            blyp_level: 'error',
            ...normalized.properties,
            ...(options.properties ?? {}),
          },
        });

        if (result && typeof (result as Promise<void>).catch === 'function') {
          void (result as Promise<void>).catch((captureError) => {
            warnOnce(
              `databuddy-capture:${key}`,
              '[Blyp] Failed to capture exception in Databuddy.',
              captureError
            );
          });
        }
      } catch (captureError) {
        warnOnce(
          `databuddy-capture:${key}`,
          '[Blyp] Failed to capture exception in Databuddy.',
          captureError
        );
      }
    },
    async flush() {
      try {
        if (client) {
          await client.flush();
        }
      } catch (error) {
        warnOnce(
          `databuddy-flush:${key}`,
          '[Blyp] Failed to flush Databuddy telemetry.',
          error
        );
      }
    },
    [CONNECTOR_BATCH_DISPATCH]: {
      dispatchKey: 'databuddy',
      dispatch: (records) => dispatchBatch(records),
    },
    [CONNECTOR_DELIVERY_BINDER](binder: ConnectorDeliveryBinder | null) {
      deliveryBinder = binder;
    },
  } as DatabuddySender & ConnectorBatchDispatchTarget;

  senderCache.set(senderKey, sender);

  return sender;
}

export function setDatabuddyTestHooks(hooks: DatabuddyTestHooks): void {
  testHooks = hooks;
  senderCache.clear();
}

export function resetDatabuddyTestHooks(): void {
  testHooks = {};
  senderCache.clear();
  warnedKeys.clear();
}
