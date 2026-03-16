import type { BlypConfig, ClientLoggingConfig, ConfigFileMatch, DatabaseDeliveryConfig, DatabaseRetryConfig, LogFileConfig, LogRotationConfig } from '../types/core/config';
export type { ConnectorMode } from '../types/connectors/mode';
export type { BlypConfig, BetterStackConnectorConfig, BetterStackErrorTrackingConfig, BlypDestination, BlypConnectorsConfig, ClientLoggingConfig, DatabaseAdapterConfig, DatabaseAdapterKind, DatabaseDeliveryConfig, DatabaseDialect, DatabaseLoggerConfig, DatabaseRetryConfig, DrizzleDatabaseAdapterConfig, LogFileConfig, LogRotationConfig, OTLPConnectorConfig, PostHogConnectorConfig, PrismaDatabaseAdapterConfig, ResolvedBetterStackConnectorConfig, ResolvedBetterStackErrorTrackingConfig, ResolvedDatabaseDeliveryConfig, ResolvedDatabaseLoggerConfig, PostHogErrorTrackingConfig, ResolvedOTLPConnectorConfig, ResolvedPostHogConnectorConfig, ResolvedDatabaseRetryConfig, ResolvedPostHogErrorTrackingConfig, ResolvedSentryConnectorConfig, SentryConnectorConfig } from '../types/core/config';
export declare const DEFAULT_ROTATION_CONFIG: Required<LogRotationConfig>;
export declare const DEFAULT_FILE_CONFIG: Required<LogFileConfig>;
export declare const DEFAULT_CLIENT_LOGGING_CONFIG: Required<ClientLoggingConfig>;
export declare const DEFAULT_DATABASE_RETRY_CONFIG: Required<DatabaseRetryConfig>;
export declare const DEFAULT_DATABASE_DELIVERY_CONFIG: Required<Omit<DatabaseDeliveryConfig, 'retry'>> & {
    retry: Required<DatabaseRetryConfig>;
};
export declare const DEFAULT_CONFIG: BlypConfig;
export declare function mergeBlypConfig(base: BlypConfig, override?: Partial<BlypConfig>, options?: {
    configFileType?: ConfigFileMatch['type'];
}): BlypConfig;
export declare function loadConfig(): BlypConfig;
export declare function resolveConfig(overrides?: Partial<BlypConfig>): BlypConfig;
export declare function getConfig(): BlypConfig;
export declare function resetConfigCache(): void;
