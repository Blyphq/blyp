import { type StructuredLog } from '../../core/structured-log';
import type { OTLPLogger, OTLPLoggerConfig } from '../../types/connectors/otlp';
export type { OTLPLogger, OTLPLoggerConfig, } from '../../types/connectors/otlp';
export declare function createOtlpLogger(config?: OTLPLoggerConfig): OTLPLogger;
export declare function createStructuredOtlpLogger<TFields extends Record<string, unknown> = Record<string, unknown>>(groupId: string, initial?: TFields, config?: OTLPLoggerConfig): StructuredLog<TFields>;
