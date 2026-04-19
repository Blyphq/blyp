import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { createJiti } from 'jiti';
import { dirname, resolve } from 'path';
import { getDefaultConnectorQueuePath } from '../connectors/delivery/queue-path';
import { DEFAULT_CLIENT_LOG_ENDPOINT } from '../shared/client-log';
import { createWarnOnceLogger } from '../shared/once';
import { resolveRedactionConfig } from '../shared/redaction';
import { hasNonEmptyString, isAbsoluteHttpUrl } from '../shared/validation';
import type {
  BetterStackConnectorConfig,
  BetterStackErrorTrackingConfig,
  BlypDestination,
  BlypConfig,
  BlypConnectorsConfig,
  BlypUserConfig,
  ClientLoggingConfig,
  ConfigFileMatch,
  ConnectorDeliveryConfig,
  ConnectorRetryConfig,
  DatabuddyConnectorConfig,
  DatabaseDeliveryConfig,
  DatabaseLoggerConfig,
  DatabaseRetryConfig,
  DrizzleDatabaseAdapterConfig,
  HTTPConnectorConfig,
  LogFileConfig,
  LogRotationConfig,
  OTLPConnectorConfig,
  PostHogConnectorConfig,
  PrismaDatabaseAdapterConfig,
  RedactionConfig,
  ResolvedBetterStackConnectorConfig,
  ResolvedBetterStackErrorTrackingConfig,
  ResolvedBlypConfig,
  ResolvedBlypConnectorsConfig,
  ResolvedConnectorDeliveryConfig,
  ResolvedConnectorRetryConfig,
  ResolvedDatabuddyConnectorConfig,
  ResolvedDatabaseLoggerConfig,
  ResolvedHTTPConnectorConfig,
  ResolvedOTLPConnectorConfig,
  ResolvedPostHogConnectorConfig,
  ResolvedRedactionConfig,
  ResolvedSentryConnectorConfig,
  SentryConnectorConfig
} from '../types/core/config';

export type { ConnectorMode } from '../types/connectors/mode';
export type {
  BlypConfig,
  BetterStackConnectorConfig,
  BetterStackErrorTrackingConfig,
  BlypDestination,
  BlypConnectorsConfig,
  BlypUserConfig,
  ClientLoggingConfig,
  ConnectorDeliveryConfig,
  ConnectorRetryConfig,
  DatabuddyConnectorConfig,
  DatabaseAdapterConfig,
  DatabaseAdapterKind,
  DatabaseDeliveryConfig,
  DatabaseDialect,
  DatabaseLoggerConfig,
  DatabaseRetryConfig,
  DrizzleDatabaseAdapterConfig,
  HTTPConnectorConfig,
  LogFileConfig,
  LogRotationConfig,
  OTLPConnectorConfig,
  PostHogConnectorConfig,
  PrismaDatabaseAdapterConfig,
  RedactionConfig,
  ResolvedBlypConfig,
  ResolvedBetterStackConnectorConfig,
  ResolvedBetterStackErrorTrackingConfig,
  ResolvedConnectorDeliveryConfig,
  ResolvedConnectorRetryConfig,
  ResolvedDatabuddyConnectorConfig,
  ResolvedDatabaseDeliveryConfig,
  ResolvedDatabaseLoggerConfig,
  ResolvedHTTPConnectorConfig,
  PostHogErrorTrackingConfig,
  ResolvedOTLPConnectorConfig,
  ResolvedPostHogConnectorConfig,
  ResolvedRedactionConfig,
  ResolvedDatabaseRetryConfig,
  ResolvedPostHogErrorTrackingConfig,
  ResolvedSentryConnectorConfig,
  SentryConnectorConfig
} from '../types/core/config';

const PACKAGE_NAME = '@blyp/core';
const GITIGNORE_FILE_NAME = '.gitignore';
const CONFIG_FILE_NAMES = [
  'blyp.config.ts',
  'blyp.config.mts',
  'blyp.config.cts',
  'blyp.config.js',
  'blyp.config.mjs',
  'blyp.config.cjs',
  'blyp.config.json',
] as const;
const CONFIG_FILE_NAME = 'blyp.config.ts';
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
const DEFAULT_CONNECTOR_SERVICE_NAME = 'blyp-app';
const DEFAULT_POSTHOG_SERVICE_NAME = DEFAULT_CONNECTOR_SERVICE_NAME;
const warnedKeys = new Set<string>();
const warnOnce = createWarnOnceLogger(warnedKeys);

export const DEFAULT_ROTATION_CONFIG: Required<LogRotationConfig> = {
  enabled: true,
  maxSizeBytes: 10 * 1024 * 1024,
  maxArchives: 5,
  compress: true,
};

export const DEFAULT_FILE_CONFIG: Required<LogFileConfig> = {
  enabled: true,
  dir: '',
  archiveDir: '',
  format: 'ndjson',
  rotation: DEFAULT_ROTATION_CONFIG,
};

export const DEFAULT_CLIENT_LOGGING_CONFIG: Required<ClientLoggingConfig> = {
  enabled: true,
  path: DEFAULT_CLIENT_LOG_ENDPOINT,
};

export const DEFAULT_REDACTION_CONFIG: ResolvedRedactionConfig = resolveRedactionConfig();

export const DEFAULT_CONNECTOR_RETRY_CONFIG: Required<ConnectorRetryConfig> = {
  maxAttempts: 8,
  initialBackoffMs: 500,
  maxBackoffMs: 30_000,
  multiplier: 2,
  jitter: true,
};

export const DEFAULT_CONNECTOR_DELIVERY_CONFIG:
Required<Omit<ConnectorDeliveryConfig, 'retry'>> & {
  retry: Required<ConnectorRetryConfig>;
} = {
  enabled: false,
  memoryBufferSize: 500,
  durableQueuePath: getDefaultConnectorQueuePath(),
  durableSpillStrategy: 'after-first-failure',
  memoryBatchSize: 25,
  sqliteWriteBatchSize: 100,
  sqliteReadBatchSize: 50,
  dispatchConcurrency: 4,
  pollIntervalMs: 1000,
  overflowStrategy: 'drop-oldest',
  retry: DEFAULT_CONNECTOR_RETRY_CONFIG,
};

export const DEFAULT_DATABASE_RETRY_CONFIG: Required<DatabaseRetryConfig> = {
  maxRetries: 1,
  backoffMs: 100,
};

export const DEFAULT_DATABASE_DELIVERY_CONFIG: Required<Omit<DatabaseDeliveryConfig, 'retry'>> & {
  retry: Required<DatabaseRetryConfig>;
} = {
  strategy: 'immediate',
  batchSize: 1,
  flushIntervalMs: 250,
  maxQueueSize: 1000,
  overflowStrategy: 'drop-oldest',
  flushTimeoutMs: 5000,
  retry: DEFAULT_DATABASE_RETRY_CONFIG,
};

export const DEFAULT_CONFIG: BlypConfig = {
  pretty: true,
  level: 'info',
  destination: 'file',
  file: DEFAULT_FILE_CONFIG,
  clientLogging: DEFAULT_CLIENT_LOGGING_CONFIG,
  redact: DEFAULT_REDACTION_CONFIG,
  connectors: {
    delivery: DEFAULT_CONNECTOR_DELIVERY_CONFIG,
  },
};

let cachedConfig: ResolvedBlypConfig | null = null;

function findNearestPackageName(startDir: string): string | undefined {
  let currentDir = startDir;

  while (true) {
    const packageJsonPath = resolve(currentDir, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
          name?: unknown;
        };
        if (hasNonEmptyString(packageJson.name)) {
          return packageJson.name;
        }
      } catch {}
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }

    currentDir = parentDir;
  }
}

function resolveDefaultConnectorServiceName(cwd: string = process.cwd()): string {
  return findNearestPackageName(cwd) ?? DEFAULT_POSTHOG_SERVICE_NAME;
}

function getBootstrapConfig(): BlypUserConfig {
  return {
    pretty: true,
    level: 'info',
    destination: 'file',
    clientLogging: {
      enabled: true,
      path: DEFAULT_CLIENT_LOG_ENDPOINT,
    },
  };
}

function renderBootstrapConfigFile(config: BlypUserConfig): string {
  return [
    "import { defineConfig } from '@blyp/core';",
    '',
    'export default defineConfig(',
    JSON.stringify(config, null, 2),
    ');',
    '',
  ].join('\n');
}

function shouldBootstrapProjectFiles(cwd: string): boolean {
  const packageJsonPath = resolve(cwd, 'package.json');

  if (!existsSync(packageJsonPath)) {
    return true;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { name?: string };
    return packageJson.name !== PACKAGE_NAME;
  } catch {
    return true;
  }
}

function ensureConfigFile(cwd: string): void {
  if (CONFIG_FILE_NAMES.some((fileName) => existsSync(resolve(cwd, fileName)))) {
    return;
  }

  const configPath = resolve(cwd, CONFIG_FILE_NAME);

  if (existsSync(configPath)) {
    return;
  }

  try {
    writeFileSync(configPath, renderBootstrapConfigFile(getBootstrapConfig()));
  } catch (error) {
    console.error(`[Blyp] Warning: Failed to create ${CONFIG_FILE_NAME}:`, error);
  }
}

function ensureLogsIgnored(cwd: string): void {
  const gitignorePath = resolve(cwd, GITIGNORE_FILE_NAME);

  if (!existsSync(gitignorePath)) {
    try {
      writeFileSync(gitignorePath, 'logs\n.blyp\n');
    } catch (error) {
      console.error('[Blyp] Warning: Failed to create .gitignore:', error);
    }
    return;
  }

  try {
    const currentContent = readFileSync(gitignorePath, 'utf-8');
    const entriesToAdd = ['logs', '.blyp'].filter((entry) => {
      const escaped = entry.replace('.', '\\.');
      return !(new RegExp(`^(?:/?${escaped}/?)\\s*$`, 'm')).test(currentContent);
    });

    if (entriesToAdd.length === 0) {
      return;
    }

    const separator = currentContent.endsWith('\n') ? '' : '\n';
    appendFileSync(gitignorePath, `${separator}${entriesToAdd.join('\n')}\n`);
  } catch (error) {
    console.error('[Blyp] Warning: Failed to update .gitignore:', error);
  }
}

function bootstrapProjectFiles(): void {
  const cwd = process.cwd();

  if (!shouldBootstrapProjectFiles(cwd)) {
    return;
  }

  ensureConfigFile(cwd);
  ensureLogsIgnored(cwd);
}

function findConfigFile(): ConfigFileMatch | null {
  const cwd = process.cwd();
  const matches = CONFIG_FILE_NAMES
    .map((fileName) => resolve(cwd, fileName))
    .filter((filePath) => existsSync(filePath));

  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    const preferred = matches[0]!;
    warnOnce(
      `config-multiple:${preferred}`,
      `[Blyp] Warning: Multiple config files found. Using ${preferred} and ignoring ${matches.slice(1).join(', ')}.`
    );
  }

  const selectedPath = matches[0]!;
  return {
    path: selectedPath,
    type: selectedPath.endsWith('.json') ? 'json' : 'jiti',
  };
}

function normalizeLoadedConfig(
  value: unknown,
  configPath: string
): BlypUserConfig {
  const normalized = (
    value &&
    typeof value === 'object' &&
    'default' in value &&
    (value as { default?: unknown }).default !== undefined
  )
    ? (value as { default: unknown }).default
    : value;

  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    warnOnce(
      `config-invalid:${configPath}`,
      `[Blyp] Warning: Config file ${configPath} did not export an object. Falling back to defaults.`
    );
    return {};
  }

  return normalized as BlypUserConfig;
}

function parseJsonConfigFile(configPath: string): BlypUserConfig {
  try {
    const content = readFileSync(configPath, 'utf-8');
    return normalizeLoadedConfig(JSON.parse(content), configPath);
  } catch (error) {
    console.error('[Blyp] Warning: Failed to parse blyp.config.json:', error);
    return {};
  }
}

function parseExecutableConfigFile(configPath: string): BlypUserConfig {
  try {
    const jiti = createJiti(process.cwd(), {
      interopDefault: true,
      moduleCache: false,
      fsCache: false,
    });
    return normalizeLoadedConfig(jiti(configPath), configPath);
  } catch (error) {
    console.error(`[Blyp] Warning: Failed to load ${configPath}:`, error);
    return {};
  }
}

function parseConfigFile(config: ConfigFileMatch): BlypUserConfig {
  return config.type === 'json'
    ? parseJsonConfigFile(config.path)
    : parseExecutableConfigFile(config.path);
}

function isPrismaAdapter(
  value: DatabaseLoggerConfig['adapter']
): value is PrismaDatabaseAdapterConfig {
  return !!value && typeof value === 'object' && value.type === 'prisma';
}

function isDrizzleAdapter(
  value: DatabaseLoggerConfig['adapter']
): value is DrizzleDatabaseAdapterConfig {
  return !!value && typeof value === 'object' && value.type === 'drizzle';
}

function mergeDatabaseRetryConfig(
  base: DatabaseRetryConfig | undefined,
  override: DatabaseRetryConfig | undefined
): Required<DatabaseRetryConfig> {
  return {
    ...DEFAULT_DATABASE_RETRY_CONFIG,
    ...base,
    ...override,
  };
}

function mergeDatabaseDeliveryConfig(
  base: DatabaseDeliveryConfig | undefined,
  override: DatabaseDeliveryConfig | undefined
): ResolvedDatabaseLoggerConfig['delivery'] {
  return {
    ...DEFAULT_DATABASE_DELIVERY_CONFIG,
    ...base,
    ...override,
    retry: mergeDatabaseRetryConfig(base?.retry, override?.retry),
  };
}

function hasPrismaDelegate(adapter: PrismaDatabaseAdapterConfig): boolean {
  const model = adapter.model ?? 'blypLog';
  const client = adapter.client as Record<string, unknown> | null | undefined;
  const delegate = client?.[model] as Record<string, unknown> | undefined;

  return !!delegate && typeof delegate.create === 'function';
}

function hasDrizzleAdapterShape(adapter: DrizzleDatabaseAdapterConfig): boolean {
  const db = adapter.db as { insert?: unknown } | null | undefined;
  return !!db && typeof db.insert === 'function' && adapter.table !== undefined;
}

function resolveDatabaseLoggerConfig(
  config: DatabaseLoggerConfig | undefined,
  sourceType?: ConfigFileMatch['type']
): ResolvedDatabaseLoggerConfig | undefined {
  if (!config) {
    return undefined;
  }

  const adapter = config.adapter;
  let ready = false;

  if (sourceType === 'json') {
    warnOnce(
      'database-json-config',
      '[Blyp] Warning: Database logging requires an executable blyp config file. Database destination remains disabled until you move this config to blyp.config.ts/js.'
    );
  } else if (config.dialect !== 'postgres' && config.dialect !== 'mysql') {
    warnOnce(
      `database-dialect:${String(config.dialect)}`,
      `[Blyp] Warning: Unsupported database dialect "${String(config.dialect)}". Database logging is disabled.`
    );
  } else if (!adapter) {
    warnOnce(
      'database-adapter-missing',
      '[Blyp] Warning: Database logging is enabled without an adapter. Database logging is disabled.'
    );
  } else if (isPrismaAdapter(adapter)) {
    ready = hasPrismaDelegate({
      ...adapter,
      model: adapter.model ?? 'blypLog',
    });

    if (!ready) {
      warnOnce(
        'database-prisma-missing',
        `[Blyp] Warning: Prisma database adapter is missing the "${adapter.model ?? 'blypLog'}" delegate or its create method. Database logging is disabled.`
      );
    }
  } else if (isDrizzleAdapter(adapter)) {
    ready = hasDrizzleAdapterShape(adapter);

    if (!ready) {
      warnOnce(
        'database-drizzle-missing',
        '[Blyp] Warning: Drizzle database adapter is missing a db.insert function or table reference. Database logging is disabled.'
      );
    }
  }

  const normalizedAdapter = isPrismaAdapter(adapter)
    ? {
        ...adapter,
        model: adapter.model ?? 'blypLog',
      }
    : adapter;

  return {
    dialect: config.dialect,
    adapter: normalizedAdapter,
    delivery: mergeDatabaseDeliveryConfig(undefined, config.delivery),
    ready,
    status: ready ? 'enabled' : 'missing',
  };
}

function mergeRotationConfig(
  base: LogRotationConfig | undefined,
  override: LogRotationConfig | undefined
): Required<LogRotationConfig> {
  return {
    ...DEFAULT_ROTATION_CONFIG,
    ...base,
    ...override,
  };
}

function mergeFileConfig(
  base: LogFileConfig | undefined,
  override: LogFileConfig | undefined
): Required<LogFileConfig> {
  return {
    ...DEFAULT_FILE_CONFIG,
    ...base,
    ...override,
    rotation: mergeRotationConfig(base?.rotation, override?.rotation),
  };
}

function mergeClientLoggingConfig(
  base: ClientLoggingConfig | undefined,
  override: ClientLoggingConfig | undefined
): Required<ClientLoggingConfig> {
  return {
    ...DEFAULT_CLIENT_LOGGING_CONFIG,
    ...base,
    ...override,
    path: override?.path ?? base?.path ?? DEFAULT_CLIENT_LOGGING_CONFIG.path,
  };
}

function mergeRedactionConfig(
  base: RedactionConfig | ResolvedRedactionConfig | undefined,
  override: RedactionConfig | undefined
): ResolvedRedactionConfig {
  return resolveRedactionConfig(base, override);
}

function mergeConnectorRetryConfig(
  base: ConnectorRetryConfig | undefined,
  override: ConnectorRetryConfig | undefined
): ResolvedConnectorRetryConfig {
  return {
    maxAttempts: Math.max(
      1,
      Math.floor(
        override?.maxAttempts ??
        base?.maxAttempts ??
        DEFAULT_CONNECTOR_RETRY_CONFIG.maxAttempts
      )
    ),
    initialBackoffMs: Math.max(
      0,
      Math.floor(
        override?.initialBackoffMs ??
        base?.initialBackoffMs ??
        DEFAULT_CONNECTOR_RETRY_CONFIG.initialBackoffMs
      )
    ),
    maxBackoffMs: Math.max(
      0,
      Math.floor(
        override?.maxBackoffMs ??
        base?.maxBackoffMs ??
        DEFAULT_CONNECTOR_RETRY_CONFIG.maxBackoffMs
      )
    ),
    multiplier: Math.max(
      1,
      override?.multiplier ??
      base?.multiplier ??
      DEFAULT_CONNECTOR_RETRY_CONFIG.multiplier
    ),
    jitter: override?.jitter ?? base?.jitter ?? DEFAULT_CONNECTOR_RETRY_CONFIG.jitter,
  };
}

function mergeConnectorDeliveryConfig(
  base: ConnectorDeliveryConfig | undefined,
  override: ConnectorDeliveryConfig | undefined
): ResolvedConnectorDeliveryConfig {
  const durableQueuePath =
    override?.durableQueuePath ??
    base?.durableQueuePath ??
    DEFAULT_CONNECTOR_DELIVERY_CONFIG.durableQueuePath;

  return {
    enabled: override?.enabled ?? base?.enabled ?? DEFAULT_CONNECTOR_DELIVERY_CONFIG.enabled,
    memoryBufferSize: Math.max(
      1,
      Math.floor(
        override?.memoryBufferSize ??
        base?.memoryBufferSize ??
        DEFAULT_CONNECTOR_DELIVERY_CONFIG.memoryBufferSize
      )
    ),
    durableQueuePath: hasNonEmptyString(durableQueuePath)
      ? durableQueuePath
      : DEFAULT_CONNECTOR_DELIVERY_CONFIG.durableQueuePath,
    durableSpillStrategy:
      override?.durableSpillStrategy ??
      base?.durableSpillStrategy ??
      DEFAULT_CONNECTOR_DELIVERY_CONFIG.durableSpillStrategy,
    memoryBatchSize: Math.max(
      1,
      Math.floor(
        override?.memoryBatchSize ??
        base?.memoryBatchSize ??
        DEFAULT_CONNECTOR_DELIVERY_CONFIG.memoryBatchSize
      )
    ),
    sqliteWriteBatchSize: Math.max(
      1,
      Math.floor(
        override?.sqliteWriteBatchSize ??
        base?.sqliteWriteBatchSize ??
        DEFAULT_CONNECTOR_DELIVERY_CONFIG.sqliteWriteBatchSize
      )
    ),
    sqliteReadBatchSize: Math.max(
      1,
      Math.floor(
        override?.sqliteReadBatchSize ??
        base?.sqliteReadBatchSize ??
        DEFAULT_CONNECTOR_DELIVERY_CONFIG.sqliteReadBatchSize
      )
    ),
    dispatchConcurrency: Math.max(
      1,
      Math.floor(
        override?.dispatchConcurrency ??
        base?.dispatchConcurrency ??
        DEFAULT_CONNECTOR_DELIVERY_CONFIG.dispatchConcurrency
      )
    ),
    pollIntervalMs: Math.max(
      50,
      Math.floor(
        override?.pollIntervalMs ??
        base?.pollIntervalMs ??
        DEFAULT_CONNECTOR_DELIVERY_CONFIG.pollIntervalMs
      )
    ),
    overflowStrategy:
      override?.overflowStrategy ??
      base?.overflowStrategy ??
      DEFAULT_CONNECTOR_DELIVERY_CONFIG.overflowStrategy,
    retry: mergeConnectorRetryConfig(base?.retry, override?.retry),
    durableReady: false,
  };
}

function mergeDatabaseLoggerConfig(
  base: DatabaseLoggerConfig | undefined,
  override: DatabaseLoggerConfig | undefined,
  sourceType?: ConfigFileMatch['type']
): ResolvedDatabaseLoggerConfig | undefined {
  if (!base && !override) {
    return undefined;
  }

  return resolveDatabaseLoggerConfig(
    {
      dialect: override?.dialect ?? base?.dialect,
      adapter: override?.adapter ?? base?.adapter,
      delivery: {
        ...(base?.delivery ?? {}),
        ...(override?.delivery ?? {}),
        retry: {
          ...(base?.delivery?.retry ?? {}),
          ...(override?.delivery?.retry ?? {}),
        },
      },
    },
    sourceType
  );
}

function mergePostHogConnectorConfig(
  base: PostHogConnectorConfig | undefined,
  override: PostHogConnectorConfig | undefined
): ResolvedPostHogConnectorConfig {
  const enabled = override?.enabled ?? base?.enabled ?? false;
  const projectKey = override?.projectKey ?? base?.projectKey;
  const baseErrorTracking = base?.enabled === true ? base?.errorTracking : undefined;
  const errorTrackingMode =
    override?.errorTracking?.mode ??
    baseErrorTracking?.mode ??
    'auto';
  const errorTrackingEnabled =
    override?.errorTracking?.enabled ??
    baseErrorTracking?.enabled ??
    enabled;
  const errorTrackingReady =
    enabled &&
    errorTrackingEnabled &&
    typeof projectKey === 'string' &&
    projectKey.trim().length > 0;

  return {
    enabled,
    mode: override?.mode ?? base?.mode ?? 'auto',
    projectKey,
    host: override?.host ?? base?.host ?? DEFAULT_POSTHOG_HOST,
    serviceName:
      override?.serviceName ??
      base?.serviceName ??
      resolveDefaultConnectorServiceName(),
    errorTracking: {
      enabled: errorTrackingEnabled,
      mode: errorTrackingMode,
      enableExceptionAutocapture:
        override?.errorTracking?.enableExceptionAutocapture ??
        baseErrorTracking?.enableExceptionAutocapture ??
        (errorTrackingMode === 'auto'),
      ready: errorTrackingReady,
      status: errorTrackingReady ? 'enabled' : 'missing',
    },
  };
}

function mergeDatabuddyConnectorConfig(
  base: DatabuddyConnectorConfig | undefined,
  override: DatabuddyConnectorConfig | undefined
): ResolvedDatabuddyConnectorConfig {
  const enabled = override?.enabled ?? base?.enabled ?? false;
  const apiKey = override?.apiKey ?? base?.apiKey;
  const websiteId = override?.websiteId ?? base?.websiteId;
  const ready = enabled && hasNonEmptyString(apiKey) && hasNonEmptyString(websiteId);

  return {
    enabled,
    mode: override?.mode ?? base?.mode ?? 'auto',
    apiKey,
    websiteId,
    namespace: override?.namespace ?? base?.namespace,
    source: override?.source ?? base?.source,
    apiUrl: override?.apiUrl ?? base?.apiUrl,
    debug: override?.debug ?? base?.debug ?? false,
    enableBatching: override?.enableBatching ?? base?.enableBatching ?? true,
    batchSize: override?.batchSize ?? base?.batchSize,
    batchTimeout: override?.batchTimeout ?? base?.batchTimeout,
    maxQueueSize: override?.maxQueueSize ?? base?.maxQueueSize,
    ready,
    status: ready ? 'enabled' : 'missing',
  };
}

function mergeBetterStackConnectorConfig(
  base: BetterStackConnectorConfig | undefined,
  override: BetterStackConnectorConfig | undefined
): ResolvedBetterStackConnectorConfig {
  const sourceToken = override?.sourceToken ?? base?.sourceToken;
  const ingestingHost = override?.ingestingHost ?? base?.ingestingHost;
  const enabled = override?.enabled ?? base?.enabled ?? false;
  const baseErrorTracking = base?.enabled === true ? base?.errorTracking : undefined;
  const errorTracking = mergeBetterStackErrorTrackingConfig(
    enabled,
    baseErrorTracking,
    override?.errorTracking
  );
  const ready =
    enabled &&
    hasNonEmptyString(sourceToken) &&
    isAbsoluteHttpUrl(ingestingHost);

  return {
    enabled,
    mode: override?.mode ?? base?.mode ?? 'auto',
    sourceToken,
    ingestingHost,
    serviceName:
      override?.serviceName ??
      base?.serviceName ??
      resolveDefaultConnectorServiceName(),
    errorTracking,
    ready,
    status: ready ? 'enabled' : 'missing',
  };
}

function mergeBetterStackErrorTrackingConfig(
  connectorEnabled: boolean,
  base: BetterStackErrorTrackingConfig | undefined,
  override: BetterStackErrorTrackingConfig | undefined
): ResolvedBetterStackErrorTrackingConfig {
  const dsn = override?.dsn ?? base?.dsn;
  const enabled = override?.enabled ?? base?.enabled ?? connectorEnabled;
  const ready = enabled && hasNonEmptyString(dsn);

  return {
    enabled,
    dsn,
    tracesSampleRate: override?.tracesSampleRate ?? base?.tracesSampleRate ?? 1.0,
    environment: override?.environment ?? base?.environment,
    release: override?.release ?? base?.release,
    ready,
    status: ready ? 'enabled' : 'missing',
  };
}

function mergeSentryConnectorConfig(
  base: SentryConnectorConfig | undefined,
  override: SentryConnectorConfig | undefined
): ResolvedSentryConnectorConfig {
  const dsn = override?.dsn ?? base?.dsn;
  const enabled = override?.enabled ?? base?.enabled ?? false;
  const ready = enabled && typeof dsn === 'string' && dsn.trim().length > 0;

  return {
    enabled,
    mode: override?.mode ?? base?.mode ?? 'auto',
    dsn,
    environment: override?.environment ?? base?.environment,
    release: override?.release ?? base?.release,
    ready,
    status: ready ? 'enabled' : 'missing',
  };
}

function mergeOTLPConnectorConfig(
  base: OTLPConnectorConfig | undefined,
  override: OTLPConnectorConfig | undefined
): ResolvedOTLPConnectorConfig {
  const endpoint = override?.endpoint ?? base?.endpoint;
  const enabled = override?.enabled ?? base?.enabled ?? false;
  const resolvedHeaders = {
    ...(base?.headers ?? {}),
    ...(override?.headers ?? {}),
  };
  const ready = enabled && isAbsoluteHttpUrl(endpoint);

  return {
    name: override?.name ?? base?.name ?? '',
    enabled,
    mode: override?.mode ?? base?.mode ?? 'auto',
    endpoint,
    headers: resolvedHeaders,
    auth: override?.auth ?? base?.auth,
    serviceName:
      override?.serviceName ??
      base?.serviceName ??
      resolveDefaultConnectorServiceName(),
    ready,
    status: ready ? 'enabled' : 'missing',
  };
}

function mergeOTLPConnectorsConfig(
  base: OTLPConnectorConfig[] | undefined,
  override: OTLPConnectorConfig[] | undefined
): ResolvedOTLPConnectorConfig[] {
  const source = override ?? base ?? [];
  const deduped = new Map<string, ResolvedOTLPConnectorConfig>();

  for (const connector of source) {
    if (!connector || typeof connector.name !== 'string' || connector.name.length === 0) {
      continue;
    }

    if (deduped.has(connector.name)) {
      warnOnce(
        `otlp-duplicate:${connector.name}`,
        `[Blyp] Warning: Duplicate OTLP connector name "${connector.name}" found. Using the last definition.`
      );
    }

    deduped.set(connector.name, mergeOTLPConnectorConfig(undefined, connector));
  }

  return Array.from(deduped.values());
}

function mergeHTTPConnectorConfig(
  base: HTTPConnectorConfig | undefined,
  override: HTTPConnectorConfig | undefined
): ResolvedHTTPConnectorConfig {
  const endpoint = override?.endpoint ?? base?.endpoint;
  const enabled = override?.enabled ?? base?.enabled ?? false;
  const resolvedHeaders = {
    ...(base?.headers ?? {}),
    ...(override?.headers ?? {}),
  };
  const ready = enabled && isAbsoluteHttpUrl(endpoint);

  return {
    name: override?.name ?? base?.name ?? '',
    enabled,
    mode: override?.mode ?? base?.mode ?? 'auto',
    endpoint,
    headers: resolvedHeaders,
    auth: override?.auth ?? base?.auth,
    serviceName:
      override?.serviceName ??
      base?.serviceName ??
      resolveDefaultConnectorServiceName(),
    ready,
    status: ready ? 'enabled' : 'missing',
  };
}

function mergeHTTPConnectorsConfig(
  base: HTTPConnectorConfig[] | undefined,
  override: HTTPConnectorConfig[] | undefined
): ResolvedHTTPConnectorConfig[] {
  const source = override ?? base ?? [];
  const deduped = new Map<string, ResolvedHTTPConnectorConfig>();

  for (const connector of source) {
    if (!connector || typeof connector.name !== 'string' || connector.name.length === 0) {
      continue;
    }

    if (deduped.has(connector.name)) {
      warnOnce(
        `http-duplicate:${connector.name}`,
        `[Blyp] Warning: Duplicate HTTP connector name "${connector.name}" found. Using the last definition.`
      );
    }

    deduped.set(connector.name, mergeHTTPConnectorConfig(undefined, connector));
  }

  return Array.from(deduped.values());
}

function mergeConnectorsConfig(
  base: BlypConnectorsConfig | undefined,
  override: BlypConnectorsConfig | undefined
): ResolvedBlypConnectorsConfig {
  return {
    betterstack: mergeBetterStackConnectorConfig(base?.betterstack, override?.betterstack),
    databuddy: mergeDatabuddyConnectorConfig(base?.databuddy, override?.databuddy),
    posthog: mergePostHogConnectorConfig(base?.posthog, override?.posthog),
    sentry: mergeSentryConnectorConfig(base?.sentry, override?.sentry),
    http: mergeHTTPConnectorsConfig(base?.http, override?.http),
    otlp: mergeOTLPConnectorsConfig(base?.otlp, override?.otlp),
    delivery: mergeConnectorDeliveryConfig(base?.delivery, override?.delivery),
  };
}

export function mergeBlypConfig(
  base: BlypConfig,
  override: BlypUserConfig = {},
  options: { configFileType?: ConfigFileMatch['type'] } = {}
): ResolvedBlypConfig {
  return {
    ...base,
    ...override,
    destination: override.destination ?? base.destination ?? 'file',
    file: mergeFileConfig(base.file, override.file),
    database: mergeDatabaseLoggerConfig(base.database, override.database, options.configFileType),
    clientLogging: mergeClientLoggingConfig(base.clientLogging, override.clientLogging),
    redact: mergeRedactionConfig(base.redact, override.redact),
    connectors: mergeConnectorsConfig(base.connectors, override.connectors),
  };
}

export function defineConfig(config: BlypUserConfig): BlypUserConfig {
  return config;
}

export function loadConfig(): ResolvedBlypConfig {
  if (cachedConfig !== null) {
    return cachedConfig;
  }

  bootstrapProjectFiles();
  const configFile = findConfigFile();

  if (configFile) {
    const userConfig = parseConfigFile(configFile);
    cachedConfig = mergeBlypConfig(DEFAULT_CONFIG, userConfig, {
      configFileType: configFile.type,
    });
  } else {
    cachedConfig = mergeBlypConfig(DEFAULT_CONFIG);
  }

  return cachedConfig;
}

export function resolveConfig(overrides: BlypUserConfig = {}): ResolvedBlypConfig {
  return mergeBlypConfig(loadConfig(), overrides);
}

export function getConfig(): ResolvedBlypConfig {
  return loadConfig();
}

export function resetConfigCache(): void {
  cachedConfig = null;
  warnedKeys.clear();
}
