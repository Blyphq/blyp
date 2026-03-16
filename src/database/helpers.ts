import { randomUUID } from 'crypto';
import { normalizeLogValue } from '../shared/log-value';
import type {
  DatabaseAdapterConfig,
  DatabaseLogRow,
  PrismaDatabaseAdapterConfig,
  DrizzleDatabaseAdapterConfig,
  ResolvedDatabaseLoggerConfig,
} from '../types/database';
import type { LogRecord } from '../core/file-logger';
import { createDrizzleRowWriter } from './adapters/drizzle';
import { createPrismaRowWriter, type DatabaseRowWriter } from './adapters/prisma';

function normalizeNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseTimestamp(value: unknown): Date {
  if (typeof value === 'string') {
    const timestamp = new Date(value);
    if (!Number.isNaN(timestamp.getTime())) {
      return timestamp;
    }
  }

  return new Date();
}

export function toDatabaseLogRow(record: LogRecord): DatabaseLogRow {
  const normalizedRecord = normalizeLogValue(record) as LogRecord;

  return {
    id: randomUUID(),
    timestamp: parseTimestamp(record.timestamp),
    level: record.level,
    message: record.message,
    caller: normalizeNullableString(record.caller),
    type: normalizeNullableString(record.type),
    groupId: normalizeNullableString(record.groupId),
    method: normalizeNullableString(record.method),
    path: normalizeNullableString(record.path),
    status: normalizeNullableNumber(record.status),
    duration: normalizeNullableNumber(record.duration),
    hasError: normalizedRecord.error != null,
    data: normalizedRecord.data ?? null,
    bindings: (normalizedRecord.bindings as Record<string, unknown> | undefined) ?? null,
    error: (normalizedRecord.error as Record<string, unknown> | undefined) ?? null,
    events: (normalizedRecord.events as unknown[] | undefined) ?? null,
    record: normalizedRecord,
    createdAt: new Date(),
  };
}

function isPrismaAdapter(
  adapter: DatabaseAdapterConfig | undefined
): adapter is PrismaDatabaseAdapterConfig {
  return !!adapter && adapter.type === 'prisma';
}

function isDrizzleAdapter(
  adapter: DatabaseAdapterConfig | undefined
): adapter is DrizzleDatabaseAdapterConfig {
  return !!adapter && adapter.type === 'drizzle';
}

export function createDatabaseRowWriter(
  config: ResolvedDatabaseLoggerConfig
): DatabaseRowWriter {
  if (isPrismaAdapter(config.adapter)) {
    return createPrismaRowWriter(config.adapter);
  }

  if (isDrizzleAdapter(config.adapter)) {
    return createDrizzleRowWriter(config.adapter);
  }

  throw new Error('[Blyp] Unsupported database adapter configuration.');
}
