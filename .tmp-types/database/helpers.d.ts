import type { DatabaseLogRow, ResolvedDatabaseLoggerConfig } from '../types/database';
import type { LogRecord } from '../core/file-logger';
import { type DatabaseRowWriter } from './adapters/prisma';
export declare function toDatabaseLogRow(record: LogRecord): DatabaseLogRow;
export declare function createDatabaseRowWriter(config: ResolvedDatabaseLoggerConfig): DatabaseRowWriter;
