import type { LogRecord } from '../file-logger';
import { type RotatingFileLogger } from '../file-logger';
import type { BlypConfig } from '../config';
import type { BlypPrimarySink } from '../primary-sink';
export declare class FilePrimarySink implements BlypPrimarySink {
    private readonly logger;
    readonly isAsync = false;
    readonly isReady = true;
    constructor(logger: RotatingFileLogger);
    write(record: LogRecord): void;
    flush(): Promise<void>;
    shutdown(): Promise<void>;
}
export declare function createFilePrimarySink(config: BlypConfig): FilePrimarySink;
