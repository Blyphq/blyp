import { type StructuredLog } from '../../core/structured-log';
import type { PostHogErrorTracker, PostHogExceptionCaptureOptions, PostHogLogger, PostHogLoggerConfig } from '../../types/connectors/posthog';
export type { PostHogErrorTracker, PostHogExceptionCaptureOptions, PostHogLogger, PostHogLoggerConfig, } from '../../types/connectors/posthog';
export declare function createPosthogLogger(config?: PostHogLoggerConfig): PostHogLogger;
export declare function createStructuredPosthogLogger<TFields extends Record<string, unknown> = Record<string, unknown>>(groupId: string, initial?: TFields, config?: PostHogLoggerConfig): StructuredLog<TFields>;
export declare function createPosthogErrorTracker(config?: PostHogLoggerConfig): PostHogErrorTracker;
export declare function capturePosthogException(error: unknown, options?: PostHogExceptionCaptureOptions, config?: PostHogLoggerConfig): void;
