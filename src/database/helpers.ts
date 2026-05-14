import { randomUUID } from 'crypto';
import { normalizeLogValue } from '../shared/log-value';
import type {
  DatabaseAdapterConfig,
  DatabaseLogRow,
  PrismaDatabaseAdapterConfig,
  DrizzleDatabaseAdapterConfig,
  MongooseDatabaseAdapterConfig,
  ResolvedDatabaseLoggerConfig,
} from '../types/database';
import type { LogRecord } from '../core/file-logger';
import { createDrizzleRowWriter } from './adapters/drizzle';
import { createMongooseRowWriter } from './adapters/mongoose';
import { createPrismaRowWriter, type DatabaseRowWriter } from './adapters/prisma';

function normalizeNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeActorKind(value: unknown): string | null {
  return value === 'user' || value === 'machine' ? value : null;
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
  const auth = normalizedRecord.auth as Record<string, unknown> | undefined;
  const authActor = auth?.actor as Record<string, unknown> | undefined;
  const authSession = auth?.session as Record<string, unknown> | undefined;
  const authOrganization = auth?.organization as Record<string, unknown> | undefined;
  const authLookup = auth?.lookup as Record<string, unknown> | undefined;
  const authClerk = auth?.clerk as Record<string, unknown> | undefined;
  const authImpersonator = auth?.impersonator as Record<string, unknown> | undefined;

  return {
    id: randomUUID(),
    timestamp: parseTimestamp(record.timestamp),
    level: record.level,
    message: record.message,
    caller: normalizeNullableString(record.caller),
    type: normalizeNullableString(record.type),
    traceId: normalizeNullableString(record.traceId),
    groupId: normalizeNullableString(record.groupId),
    method: normalizeNullableString(record.method),
    path: normalizeNullableString(record.path),
    status: normalizeNullableNumber(record.status),
    duration: normalizeNullableNumber(record.duration),
    hasError: normalizedRecord.error != null,
    authProvider: normalizeNullableString(auth?.provider),
    authAuthenticated: normalizeBoolean(auth?.authenticated),
    authActorId: normalizeNullableString(authActor?.id),
    authSessionId: normalizeNullableString(authSession?.id),
    authOrganizationId: normalizeNullableString(authOrganization?.id),
    authActorKind: normalizeActorKind(authActor?.kind),
    authTokenType: normalizeNullableString(authClerk?.tokenType ?? authLookup?.tokenType),
    authImpersonatorId: normalizeNullableString(authImpersonator?.id),
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

function isMongooseAdapter(
  adapter: DatabaseAdapterConfig | undefined
): adapter is MongooseDatabaseAdapterConfig {
  return !!adapter && adapter.type === 'mongoose';
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

  if (isMongooseAdapter(config.adapter)) {
    return createMongooseRowWriter(config.adapter);
  }

  throw new Error('[Blyp] Unsupported database adapter configuration.');
}
