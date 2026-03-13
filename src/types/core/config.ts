import type { ConnectorMode } from '../connectors/mode';

export type { ConnectorMode } from '../connectors/mode';

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

export interface PostHogConnectorConfig {
  enabled?: boolean;
  mode?: ConnectorMode;
  projectKey?: string;
  host?: string;
  serviceName?: string;
  errorTracking?: PostHogErrorTrackingConfig;
}

export interface BetterStackConnectorConfig {
  enabled?: boolean;
  mode?: ConnectorMode;
  sourceToken?: string;
  ingestingHost?: string;
  serviceName?: string;
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

export interface ResolvedBetterStackConnectorConfig {
  enabled: boolean;
  mode: ConnectorMode;
  sourceToken?: string;
  ingestingHost?: string;
  serviceName: string;
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

export interface BlypConnectorsConfig {
  betterstack?: BetterStackConnectorConfig;
  posthog?: PostHogConnectorConfig;
  sentry?: SentryConnectorConfig;
  otlp?: OTLPConnectorConfig[];
}

export interface BlypConfig {
  pretty: boolean;
  level: string;
  logDir?: string;
  file?: LogFileConfig;
  clientLogging?: ClientLoggingConfig;
  connectors?: BlypConnectorsConfig;
}

export interface ConfigFileMatch {
  path: string;
  type: 'json' | 'jiti';
}
