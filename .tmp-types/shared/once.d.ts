import type { ConsoleOnceLogger } from '../types/shared/once';
export type { ConsoleOnceLogger } from '../types/shared/once';
export declare function createWarnOnceLogger(warnedKeys?: Set<string>): ConsoleOnceLogger;
export declare function createErrorOnceLogger(warnedKeys?: Set<string>): ConsoleOnceLogger;
