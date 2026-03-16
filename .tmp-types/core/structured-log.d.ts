import type { CreateStructuredLogOptions, StructuredLog } from '../types/core/structured-log';
export type { CreateStructuredLogOptions, StructuredLog, StructuredLogError, StructuredLogEvent, StructuredLogEmitOptions, StructuredLogLevel, StructuredLogPayload, } from '../types/core/structured-log';
export declare function createStructuredLog(groupId: string, options: CreateStructuredLogOptions): StructuredLog<Record<string, unknown>>;
