import type { LogRecord } from './core/file-logger';

export type BlypDestination = 'file' | 'database';

export type DatabaseDialect = 'postgres' | 'mysql';

export type DatabaseAdapterKind = 'prisma' | 'drizzle';

export interface DatabaseRetryConfig {
  maxRetries?: number;
  backoffMs?: number;
}

export interface DatabaseDeliveryConfig {
  strategy?: 'immediate' | 'batch';
  batchSize?: number;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  overflowStrategy?: 'drop-oldest' | 'drop-new';
  flushTimeoutMs?: number;
  retry?: DatabaseRetryConfig;
}

export interface ResolvedDatabaseRetryConfig {
  maxRetries: number;
  backoffMs: number;
}

export interface ResolvedDatabaseDeliveryConfig {
  strategy: 'immediate' | 'batch';
  batchSize: number;
  flushIntervalMs: number;
  maxQueueSize: number;
  overflowStrategy: 'drop-oldest' | 'drop-new';
  flushTimeoutMs: number;
  retry: ResolvedDatabaseRetryConfig;
}

export interface PrismaDatabaseAdapterConfig {
  type: 'prisma';
  client: unknown;
  model?: string;
}

export interface DrizzleDatabaseAdapterConfig {
  type: 'drizzle';
  db: unknown;
  table: unknown;
}

export type DatabaseAdapterConfig =
  | PrismaDatabaseAdapterConfig
  | DrizzleDatabaseAdapterConfig;

export interface DatabaseLoggerConfig {
  dialect?: DatabaseDialect;
  adapter?: DatabaseAdapterConfig;
  delivery?: DatabaseDeliveryConfig;
}

export interface ResolvedDatabaseLoggerConfig {
  dialect?: DatabaseDialect;
  adapter?: DatabaseAdapterConfig;
  delivery: ResolvedDatabaseDeliveryConfig;
  ready: boolean;
  status: 'enabled' | 'missing';
}

export interface DatabaseLogRow {
  id: string;
  timestamp: Date;
  level: string;
  message: string;
  caller: string | null;
  type: string | null;
  traceId: string | null;
  groupId: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  duration: number | null;
  hasError: boolean;
  data: unknown | null;
  bindings: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  events: unknown[] | null;
  record: LogRecord;
  createdAt: Date;
}
