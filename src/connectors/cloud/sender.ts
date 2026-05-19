import type { CloudDestinationConfig, ResolvedBlypConfig } from '../../core/config';
import type { LogRecord } from '../../core/file-logger';
import { runtime } from '../../core/runtime';
import { createErrorOnceLogger } from '../../shared/once';
import { hasNonEmptyString } from '../../shared/validation';
import {
  getField,
  getRecordType,
} from '../shared';
import type {
  ConnectorBatchDispatchTarget,
  ConnectorDeliveryBinder,
} from '../delivery/types';
import {
  CONNECTOR_BATCH_DISPATCH,
  CONNECTOR_DELIVERY_BINDER,
  type ConnectorDispatchResult,
} from '../delivery/types';
import type {
  CloudDispatchResult,
  CloudIngestBatch,
  CloudIngestEvent,
  CloudSender,
  CloudTestHooks,
  CloudTransport,
} from '../../types/connectors/cloud';

const warnedKeys = new Set<string>();
const warnOnce = createErrorOnceLogger(warnedKeys);
const DEFAULT_CLOUD_HOST = 'https://ingest.blyp.cloud';
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_SDK_VERSION = '0.0.0';
let testHooks: CloudTestHooks = {};

function normalizeCloudHost(host: string | undefined): string {
  const base = hasNonEmptyString(host) ? host.trim() : DEFAULT_CLOUD_HOST;
  return base.replace(/\/+$/, '');
}

function resolveCloudApiKey(config: CloudDestinationConfig | undefined): string | undefined {
  return config?.apiKey ?? runtime.env.get('BLYP_CLOUD_API_KEY') ?? undefined;
}

function normalizeLevel(
  level: string
): CloudIngestEvent['level'] {
  if (level === 'warning') {
    return 'warn';
  }
  if (level === 'success' || level === 'table') {
    return 'info';
  }
  if (
    level === 'debug' ||
    level === 'info' ||
    level === 'warn' ||
    level === 'error' ||
    level === 'critical'
  ) {
    return level;
  }
  return 'info';
}

function normalizeTimestamp(timestamp: unknown): string {
  if (typeof timestamp === 'string' && timestamp.trim().length > 0) {
    return timestamp;
  }
  return new Date().toISOString();
}

function extractFields(record: LogRecord): Record<string, unknown> {
  if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
    return record.data as Record<string, unknown>;
  }
  return {};
}

function getGitMeta(): CloudIngestBatch['meta']['git'] {
  const gitlabRepo = runtime.env.get('CI_PROJECT_PATH');
  const gitlabBranch = runtime.env.get('CI_COMMIT_REF_NAME');
  const gitlabSha = runtime.env.get('CI_COMMIT_SHA');
  if (hasNonEmptyString(gitlabRepo) && hasNonEmptyString(gitlabBranch)) {
    return {
      provider: 'gitlab',
      repositoryFullName: gitlabRepo,
      branch: gitlabBranch,
      ...(hasNonEmptyString(gitlabSha) ? { commitSha: gitlabSha } : {}),
    };
  }

  const githubRepo = runtime.env.get('GITHUB_REPOSITORY');
  const githubBranch = runtime.env.get('GITHUB_REF_NAME');
  const githubSha = runtime.env.get('GITHUB_SHA');
  if (hasNonEmptyString(githubRepo) && hasNonEmptyString(githubBranch)) {
    return {
      provider: 'github',
      repositoryFullName: githubRepo,
      branch: githubBranch,
      ...(hasNonEmptyString(githubSha) ? { commitSha: githubSha } : {}),
    };
  }

  return {
    provider: 'github',
    repositoryFullName: 'local/local',
    branch: 'local',
  };
}

function getFramework(record: LogRecord): string | undefined {
  const framework = getField<string>(record, 'framework');
  return hasNonEmptyString(framework) ? framework : undefined;
}

function toIngestEvent(record: LogRecord): CloudIngestEvent {
  return {
    level: normalizeLevel(record.level),
    message: typeof record.message === 'string' ? record.message : String(record.message),
    timestamp: normalizeTimestamp(record.timestamp),
    fields: extractFields(record),
    ...(hasNonEmptyString(getField<string>(record, 'traceId'))
      ? { traceId: getField<string>(record, 'traceId') }
      : {}),
    ...(hasNonEmptyString(getField<string>(record, 'stack'))
      ? { stack: getField<string>(record, 'stack') }
      : {}),
  };
}

function buildIngestBatch(records: LogRecord[]): CloudIngestBatch {
  const framework = records.map(getFramework).find((value) => hasNonEmptyString(value));
  const sdkVersion = testHooks.sdkVersion ?? runtime.env.get('BLYP_SDK_VERSION') ?? DEFAULT_SDK_VERSION;

  return {
    events: records.map(toIngestEvent),
    meta: {
      sdk: '@blyp/core',
      sdkVersion,
      runtime: runtime.isBun ? 'bun' : 'node',
      ...(framework ? { framework } : {}),
      git: getGitMeta(),
    },
  };
}

function createDefaultTransport(): CloudTransport {
  return {
    async sendBatch(endpoint, batch, headers) {
      const fetchImpl = globalThis.fetch;
      if (!fetchImpl) {
        return {
          ok: false,
          retryable: false,
          error: 'global fetch is unavailable',
        };
      }

      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(batch),
        });

        if (!response.ok) {
          return {
            ok: false,
            retryable: response.status >= 500 || response.status === 429,
            status: response.status,
            error: `Ingest failed with status ${response.status}`,
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
    },
  };
}

function createUnavailableSender(config: CloudDestinationConfig): CloudSender {
  const sender = {
    enabled: true,
    ready: false,
    mode: 'auto',
    status: 'missing',
    config,
    send(_record: LogRecord, options: { warnIfUnavailable?: boolean } = {}) {
      if (options.warnIfUnavailable) {
        warnOnce(
          'cloud-unavailable',
          '[Blyp] Cloud destination is enabled but missing cloud.apiKey. Skipping cloud delivery.'
        );
      }
    },
    async flush() {},
    [CONNECTOR_BATCH_DISPATCH]: {
      dispatchKey: 'cloud:default',
      dispatch: async (): Promise<ConnectorDispatchResult> => ({
        ok: false,
        retryable: false,
        error: 'Cloud destination is unavailable.',
      }),
    },
    [CONNECTOR_DELIVERY_BINDER](_binder: ConnectorDeliveryBinder | null) {},
  } as CloudSender & ConnectorBatchDispatchTarget;

  return sender;
}

export function createCloudSender(config: ResolvedBlypConfig): CloudSender {
  const cloudConfig = config.cloud ?? { projectKey: '' };
  const apiKey = resolveCloudApiKey(cloudConfig);
  const ready =
    hasNonEmptyString(cloudConfig.projectKey) &&
    hasNonEmptyString(apiKey);

  if (!ready) {
    return createUnavailableSender(cloudConfig);
  }

  let deliveryBinder: ConnectorDeliveryBinder | null = null;
  const transport = testHooks.createTransport?.() ?? createDefaultTransport();
  const endpoint = `${normalizeCloudHost(cloudConfig.host)}/ingest`;
  const region = cloudConfig.region?.toLowerCase();

  const sender = {
    enabled: true,
    ready: true,
    mode: 'auto',
    status: 'enabled',
    config: cloudConfig,
    send(record: LogRecord, options: { warnIfUnavailable?: boolean } = {}) {
      if (getRecordType(record) === 'client_log') {
        return;
      }

      if (deliveryBinder) {
        deliveryBinder.enqueue('cloud', record, sender[CONNECTOR_BATCH_DISPATCH]!);
        return;
      }

      void sender[CONNECTOR_BATCH_DISPATCH]!.dispatch([record], { source: 'server' }).then((result) => {
        if (!result.ok && options.warnIfUnavailable) {
          warnOnce(
            `cloud-send:${result.status ?? result.error ?? 'unknown'}`,
            '[Blyp] Failed to deliver log to cloud ingest.',
            result.error ?? result.status
          );
        }
      });
    },
    async flush() {},
    [CONNECTOR_BATCH_DISPATCH]: {
      dispatchKey: 'cloud:default',
      dispatch: async (records: LogRecord[]): Promise<ConnectorDispatchResult> => {
        const batch = buildIngestBatch(records.slice(0, cloudConfig.batchSize ?? DEFAULT_BATCH_SIZE));
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Blyp-Project-Id': cloudConfig.projectKey,
        };
        if (region === 'us' || region === 'eu') {
          headers['X-Blyp-Region'] = region;
        }
        const result: CloudDispatchResult = await transport.sendBatch(endpoint, batch, headers);
        return {
          ok: result.ok,
          retryable: result.retryable ?? false,
          status: result.status,
          error: result.error,
        };
      },
    },
    [CONNECTOR_DELIVERY_BINDER](binder: ConnectorDeliveryBinder | null) {
      deliveryBinder = binder;
    },
  } as CloudSender & ConnectorBatchDispatchTarget;

  return sender;
}

export function setCloudTestHooks(next: CloudTestHooks): void {
  testHooks = next;
}

export function resetCloudTestHooks(): void {
  testHooks = {};
  warnedKeys.clear();
}
