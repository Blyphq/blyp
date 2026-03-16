import type { LogRecord } from './file-logger';
import type { StructuredLogPayload } from './structured-log';
import { serializeLogMessage } from '../shared/log-value';
import type { LogMethodName } from '../types/core/log-record';
export type { LogMethodName } from '../types/core/log-record';
export declare function getCallerLocation(): {
    file: string | null;
    line: number | null;
};
export declare const serializeMessage: typeof serializeLogMessage;
export declare function stripAnsi(value: string): string;
export declare function buildRecord(level: LogMethodName, message: unknown, args: unknown[], bindings: Record<string, unknown>): LogRecord;
export declare function buildStructuredRecord(level: LogMethodName, message: string, payload: StructuredLogPayload, bindings: Record<string, unknown>): LogRecord;
export declare function resolveStructuredWriteLevel(level: StructuredLogPayload['level']): LogMethodName;
