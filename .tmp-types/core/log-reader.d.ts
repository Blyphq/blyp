import type { LogRecord } from './file-logger';
import type { ReadLogFileOptions } from '../types/core/log-reader';
export type { ReadLogFileOptions } from '../types/core/log-reader';
export declare function formatLogRecord(record: LogRecord): string;
export declare function readLogFile(filePath: string, options?: ReadLogFileOptions): Promise<string | LogRecord[]>;
