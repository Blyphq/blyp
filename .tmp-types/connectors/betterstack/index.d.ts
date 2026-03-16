import { type StructuredLog } from '../../core/structured-log';
import type { BetterStackErrorTracker, BetterStackExceptionCaptureOptions, BetterStackLogger, BetterStackLoggerConfig } from '../../types/connectors/betterstack';
export type { BetterStackErrorTracker, BetterStackExceptionCaptureOptions, BetterStackLogger, BetterStackLoggerConfig, } from '../../types/connectors/betterstack';
export declare function createBetterStackLogger(config?: BetterStackLoggerConfig): BetterStackLogger;
export declare function createBetterStackErrorTracker(config?: BetterStackLoggerConfig): BetterStackErrorTracker;
export declare function captureBetterStackException(error: unknown, options?: BetterStackExceptionCaptureOptions, config?: BetterStackLoggerConfig): void;
export declare function createStructuredBetterStackLogger<TFields extends Record<string, unknown> = Record<string, unknown>>(groupId: string, initial?: TFields, config?: BetterStackLoggerConfig): StructuredLog<TFields>;
