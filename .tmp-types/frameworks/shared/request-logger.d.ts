import { type BlypLogger } from '../../core/logger';
import type { RequestScopedLoggerOptions } from '../../types/frameworks/request-logger';
export type { RequestScopedLoggerOptions } from '../../types/frameworks/request-logger';
export declare function createRequestScopedLogger(logger: BlypLogger, options?: RequestScopedLoggerOptions): BlypLogger;
