import { type StructuredLog } from '../../core/structured-log';
import type { SentryLogger, SentryLoggerConfig } from '../../types/connectors/sentry';
export type { SentryLogger, SentryLoggerConfig, } from '../../types/connectors/sentry';
export declare function createSentryLogger(config?: SentryLoggerConfig): SentryLogger;
export declare function createStructuredSentryLogger<TFields extends Record<string, unknown> = Record<string, unknown>>(groupId: string, initial?: TFields, config?: SentryLoggerConfig): StructuredLog<TFields>;
