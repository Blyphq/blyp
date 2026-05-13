import type { ConnectorMode } from '../connectors/mode';
import type {
  BlypDestination,
  DatabaseLoggerConfig,
  ResolvedDatabaseLoggerConfig,
} from '../database';

export type { ConnectorMode } from '../connectors/mode';
export type {
  BlypDestination,
  DatabaseAdapterConfig,
  DatabaseAdapterKind,
  DatabaseDeliveryConfig,
  DatabaseDialect,
  DatabaseLoggerConfig,
  DatabaseRetryConfig,
  DrizzleDatabaseAdapterConfig,
  PrismaDatabaseAdapterConfig,
  ResolvedDatabaseDeliveryConfig,
  ResolvedDatabaseLoggerConfig,
  ResolvedDatabaseRetryConfig,
} from '../database';

export interface LogRotationConfig {
  enabled?: boolean;
  maxSizeBytes?: number;
  maxArchives?: number;
  compress?: boolean;
}

export interface LogFileConfig {
  enabled?: boolean;
  dir?: string;
  archiveDir?: string;
  format?: 'ndjson';
  rotation?: LogRotationConfig;
}

export interface ClientLoggingConfig {
  enabled?: boolean;
  path?: string;
}

export interface CloudDestinationConfig {
  /** Project key from Cloud Studio — blyp_proj_xxxx */
  projectKey: string;
  /** API key used as Bearer token for POST /ingest. */
  apiKey?: string;
  /** Data region. Auto-detected from server response on first call; you can pre-set to avoid one round-trip. */
  region?: 'us' | 'eu';
  /** Override the ingest base URL. Defaults to https://ingest.blyp.cloud */
  host?: string;
  /** Batch up to this many events per HTTP request. Default: 25 */
  batchSize?: number;
  /** Flush interval in milliseconds. Default: 2000 */
  flushIntervalMs?: number;
}

export interface RedactionConfig {
  keys?: string[];
  paths?: string[];
  patterns?: RegExp[];
  disablePatternScanning?: boolean;
}

export interface ResolvedRedactionConfig {
  keys: string[];
  paths: string[];
  patterns: RegExp[];
  disablePatternScanning: boolean;
}

export interface ConnectorRetryConfig {
  maxAttempts?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  multiplier?: number;
  jitter?: boolean;
}

export interface ResolvedConnectorRetryConfig {
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  multiplier: number;
  jitter: boolean;
}

export interface ConnectorDeliveryConfig {
  enabled?: boolean;
  memoryBufferSize?: number;
  durableQueuePath?: string;
  durableSpillStrategy?: 'after-first-failure';
  memoryBatchSize?: number;
  sqliteWriteBatchSize?: number;
  sqliteReadBatchSize?: number;
  dispatchConcurrency?: number;
  pollIntervalMs?: number;
  overflowStrategy?: 'drop-oldest' | 'drop-new';
  retry?: ConnectorRetryConfig;
}

export interface ResolvedConnectorDeliveryConfig {
  enabled: boolean;
  memoryBufferSize: number;
  durableQueuePath: string;
  durableSpillStrategy: 'after-first-failure';
  memoryBatchSize: number;
  sqliteWriteBatchSize: number;
  sqliteReadBatchSize: number;
  dispatchConcurrency: number;
  pollIntervalMs: number;
  overflowStrategy: 'drop-oldest' | 'drop-new';
  retry: ResolvedConnectorRetryConfig;
  durableReady: boolean;
}

export interface PostHogConnectorConfig {
  enabled?: boolean;
  mode?: ConnectorMode;
  projectKey?: string;
  host?: string;
  serviceName?: string;
  errorTracking?: PostHogErrorTrackingConfig;
}

export interface DatabuddyConnectorConfig {
  enabled?: boolean;
  mode?: ConnectorMode;
  apiKey?: string;
  websiteId?: string;
  namespace?: string;
  source?: string;
  apiUrl?: string;
  debug?: boolean;
  enableBatching?: boolean;
  batchSize?: number;
  batchTimeout?: number;
  maxQueueSize?: number;
}

export interface BetterStackConnectorConfig {
  enabled?: boolean;
  mode?: ConnectorMode;
  sourceToken?: string;
  ingestingHost?: string;
  serviceName?: string;
  errorTracking?: BetterStackErrorTrackingConfig;
}

export interface BetterStackErrorTrackingConfig {
  enabled?: boolean;
  dsn?: string;
  tracesSampleRate?: number;
  environment?: string;
  release?: string;
}

export interface PostHogErrorTrackingConfig {
  enabled?: boolean;
  mode?: ConnectorMode;
  enableExceptionAutocapture?: boolean;
}

export interface ResolvedPostHogErrorTrackingConfig {
  enabled: boolean;
  mode: ConnectorMode;
  enableExceptionAutocapture: boolean;
  ready: boolean;
  status: 'enabled' | 'missing';
}

export interface ResolvedPostHogConnectorConfig {
  enabled: boolean;
  mode: ConnectorMode;
  projectKey?: string;
  host: string;
  serviceName: string;
  errorTracking: ResolvedPostHogErrorTrackingConfig;
}

export interface ResolvedDatabuddyConnectorConfig {
  enabled: boolean;
  mode: ConnectorMode;
  apiKey?: string;
  websiteId?: string;
  namespace?: string;
  source?: string;
  apiUrl?: string;
  debug: boolean;
  enableBatching: boolean;
  batchSize?: number;
  batchTimeout?: number;
  maxQueueSize?: number;
  ready: boolean;
  status: 'enabled' | 'missing';
}

export interface ResolvedBetterStackConnectorConfig {
  enabled: boolean;
  mode: ConnectorMode;
  sourceToken?: string;
  ingestingHost?: string;
  serviceName: string;
  errorTracking: ResolvedBetterStackErrorTrackingConfig;
  ready: boolean;
  status: 'enabled' | 'missing';
}

export interface ResolvedBetterStackErrorTrackingConfig {
  enabled: boolean;
  dsn?: string;
  tracesSampleRate: number;
  environment?: string;
  release?: string;
  ready: boolean;
  status: 'enabled' | 'missing';
}

export interface SentryConnectorConfig {
  enabled?: boolean;
  mode?: ConnectorMode;
  dsn?: string;
  environment?: string;
  release?: string;
}

export interface ResolvedSentryConnectorConfig {
  enabled: boolean;
  mode: ConnectorMode;
  dsn?: string;
  environment?: string;
  release?: string;
  ready: boolean;
  status: 'enabled' | 'missing';
}

export interface OTLPConnectorConfig {
  name: string;
  enabled?: boolean;
  mode?: ConnectorMode;
  endpoint?: string;
  headers?: Record<string, string>;
  auth?: string;
  serviceName?: string;
}

export interface ResolvedOTLPConnectorConfig {
  name: string;
  enabled: boolean;
  mode: ConnectorMode;
  endpoint?: string;
  headers: Record<string, string>;
  auth?: string;
  serviceName: string;
  ready: boolean;
  status: 'enabled' | 'missing';
}

export interface HTTPConnectorConfig {
  name: string;
  enabled?: boolean;
  mode?: ConnectorMode;
  endpoint?: string;
  headers?: Record<string, string>;
  auth?: string;
  serviceName?: string;
}

export interface ResolvedHTTPConnectorConfig {
  name: string;
  enabled: boolean;
  mode: ConnectorMode;
  endpoint?: string;
  headers: Record<string, string>;
  auth?: string;
  serviceName: string;
  ready: boolean;
  status: 'enabled' | 'missing';
}

export interface BlypConnectorsConfig {
  betterstack?: BetterStackConnectorConfig;
  databuddy?: DatabuddyConnectorConfig;
  posthog?: PostHogConnectorConfig;
  sentry?: SentryConnectorConfig;
  http?: HTTPConnectorConfig[];
  otlp?: OTLPConnectorConfig[];
  delivery?: ConnectorDeliveryConfig;
}

export interface BlypConfig {
  pretty: boolean;
  level: string;
  destination?: BlypDestination;
  logDir?: string;
  file?: LogFileConfig;
  database?: DatabaseLoggerConfig;
  cloud?: CloudDestinationConfig;
  clientLogging?: ClientLoggingConfig;
  redact?: RedactionConfig;
  connectors?: BlypConnectorsConfig;
}

export type BlypUserConfig = Partial<BlypConfig>;

export interface ResolvedBlypConnectorsConfig {
  betterstack: ResolvedBetterStackConnectorConfig;
  databuddy: ResolvedDatabuddyConnectorConfig;
  posthog: ResolvedPostHogConnectorConfig;
  sentry: ResolvedSentryConnectorConfig;
  http: ResolvedHTTPConnectorConfig[];
  otlp: ResolvedOTLPConnectorConfig[];
  delivery: ResolvedConnectorDeliveryConfig;
}

export interface ResolvedBlypConfig extends BlypConfig {
  destination: BlypDestination;
  file: Required<LogFileConfig>;
  database?: ResolvedDatabaseLoggerConfig;
  cloud?: CloudDestinationConfig;
  clientLogging: Required<ClientLoggingConfig>;
  redact: ResolvedRedactionConfig;
  connectors: ResolvedBlypConnectorsConfig;
}

export interface ConfigFileMatch {
  path: string;
  type: 'json' | 'jiti';
}
