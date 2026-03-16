import type { LogRecord } from '../file-logger';
import type { BlypPrimarySink } from '../primary-sink';
import type { ResolvedDatabaseLoggerConfig } from '../../types/database';
export declare class DatabasePrimarySink implements BlypPrimarySink {
    private readonly config;
    readonly isAsync = true;
    readonly isReady = true;
    private readonly warnOnce;
    private readonly queue;
    private readonly writer;
    private timer;
    private processing;
    private closed;
    private terminalError;
    private activeDispatch;
    constructor(config: ResolvedDatabaseLoggerConfig);
    write(record: LogRecord): void;
    flush(): Promise<void>;
    shutdown(): Promise<void>;
    private enqueue;
    private scheduleDispatch;
    private drain;
    private processQueue;
    private insertWithRetry;
}
