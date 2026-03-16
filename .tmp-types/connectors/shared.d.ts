import type { BlypConfig } from '../core/config';
import type { LogRecord } from '../core/file-logger';
export declare function isBlypConfig(config: unknown): config is BlypConfig;
export declare function getPrimaryPayload(record: LogRecord): Record<string, unknown>;
export declare function getField<T extends string | number>(record: LogRecord, key: string): T | undefined;
export declare function getClientPageField(record: LogRecord, key: 'pathname' | 'url'): string | undefined;
export declare function getClientSessionField(record: LogRecord, key: 'sessionId' | 'pageId'): string | undefined;
export declare function getRecordType(record: LogRecord): string | undefined;
