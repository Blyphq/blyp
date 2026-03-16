import type { BlypConfig } from './config';
import type { FileLoggerDependencies, LogRecord } from '../types/core/file-logger';
export type { LogRecord } from '../types/core/file-logger';
export declare function serializeLogRecord(record: LogRecord): string;
export declare class RotatingFileLogger {
    private readonly config;
    private readonly gzip;
    private readonly warn;
    private readonly combined;
    private readonly error;
    constructor(config: BlypConfig, dependencies?: FileLoggerDependencies);
    write(record: LogRecord): void;
    private enqueue;
    private processQueue;
    private seedStream;
    private append;
    private rotate;
}
export declare function createFileLogger(config: BlypConfig): RotatingFileLogger;
