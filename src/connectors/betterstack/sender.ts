import { Logtail } from '@logtail/node';
import type {
  BetterStackConnectorConfig,
  BlypConfig,
  ResolvedBetterStackConnectorConfig,
} from '../../core/config';
import type { LogRecord } from '../../core/file-logger';
import { serializeLogRecord } from '../../core/file-logger';
import { createErrorOnceLogger } from '../../shared/once';
import { hasNonEmptyString, isAbsoluteHttpUrl } from '../../shared/validation';
import type {
  BetterStackClientLike,
  BetterStackLogSource,
  BetterStackSender,
  BetterStackTestHooks,
} from '../../types/connectors/betterstack';
import {
  getClientPageField,
  getClientSessionField,
  getField,
  getRecordType,
  isBlypConfig,
} from '../shared';

const warnedKeys = new Set<string>();
let testHooks: BetterStackTestHooks = {};
const warnOnce = createErrorOnceLogger(warnedKeys);

function resolveConnectorConfig(
  config: BlypConfig | ResolvedBetterStackConnectorConfig | BetterStackConnectorConfig
): ResolvedBetterStackConnectorConfig {
  const connector = isBlypConfig(config)
    ? config.connectors?.betterstack
    : config;
  const enabled = connector?.enabled ?? false;
  const sourceToken = connector?.sourceToken;
  const ingestingHost = connector?.ingestingHost;
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

function createDefaultClient(
  connector: ResolvedBetterStackConnectorConfig
): BetterStackClientLike {
  return new Logtail(connector.sourceToken ?? '', {
    endpoint: connector.ingestingHost,
    captureStackContext: false,
  }) as BetterStackClientLike;
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
      `betterstack-unavailable:${key}`,
      '[Blyp] Better Stack connector is not configured or not ready. Skipping Better Stack delivery.'
    );
  };

  return {
    enabled: connector.enabled,
    ready: connector.ready,
    mode: connector.mode,
    serviceName: connector.serviceName,
    ingestingHost: connector.ingestingHost,
    status: connector.status,
    shouldAutoForwardServerLogs() {
      return connector.ready && connector.mode === 'auto';
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
    async flush() {
      if (!client) {
        return;
      }

      try {
        await client.flush();
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
